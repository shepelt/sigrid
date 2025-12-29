import { describe, test, expect, beforeAll, afterEach } from '@jest/globals';
import 'dotenv/config';
import { createWorkspace, initializeClient, fileTools } from '../index.js';
import fs from 'fs/promises';

/**
 * Test for Issue #6: workspace.execute() hangs with file tools + enableMegawriter + tool_choice: any
 *
 * https://github.com/shepelt/sigrid/issues/6
 *
 * Run with: npm test -- tests/issue-6-filetools-megawriter.test.js
 */
describe('Issue #6: fileTools + enableMegawriter + tool_choice: any', () => {
    const hasGatewayConfig = !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);
    const testFn = hasGatewayConfig ? test : test.skip;
    const model = process.env.LLM_MODEL || 'anthropic/claude-haiku-4-5-20251001';

    let workspaces = [];

    beforeAll(() => {
        if (hasGatewayConfig) {
            console.log(`\nTesting Issue #6 with gateway: ${process.env.LLM_GATEWAY_URL}`);
            console.log(`Model: ${model}`);
            console.log(`fileTools:`, fileTools.map(t => t.name));

            initializeClient({
                apiKey: process.env.LLM_GATEWAY_API_KEY,
                baseURL: process.env.LLM_GATEWAY_URL
            });
        }
    });

    afterEach(async () => {
        for (const workspace of workspaces) {
            try {
                await fs.rm(workspace.path, { recursive: true });
            } catch (err) {
                // Ignore cleanup errors
            }
        }
        workspaces = [];
    });

    if (!hasGatewayConfig) {
        test('skipping - no gateway configuration', () => {
            console.log('ℹ️  Set LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY to run this test');
            expect(true).toBe(true);
        });
    }

    testFn('should NOT hang when using fileTools + enableMegawriter + tool_choice: any', async () => {
        // This is the exact scenario from Issue #6
        const workspace = await createWorkspace();
        workspaces.push(workspace);

        console.log(`\nWorkspace: ${workspace.path}`);
        console.log('Testing: fileTools + enableMegawriter + tool_choice: { type: "any" }');

        // Create a file for the LLM to read
        await fs.writeFile(
            `${workspace.path}/README.md`,
            '# Test Project\n\nThis is a test project for Issue #6.'
        );

        const startTime = Date.now();

        // This should complete within timeout, NOT hang indefinitely
        const result = await workspace.execute(
            'Read the README.md file and create a hello.txt file with a greeting.',
            {
                mode: 'static',
                model,
                enableMegawriter: true,
                tools: [...fileTools],  // read_file, list_dir, write_file
                tool_choice: { type: 'any' },  // Force tool use - Anthropic format
                snapshot: '[File tools mode]\nUse list_dir and read_file to explore, write_multiple_files to write.',
                max_tokens: 2048
            }
        );

        const elapsed = Date.now() - startTime;
        console.log(`\nCompleted in ${elapsed}ms`);
        console.log('Content:', result.content?.substring(0, 200));
        console.log('Files written:', result.filesWritten);

        // Test assertions
        expect(result).toBeDefined();
        expect(elapsed).toBeLessThan(60000); // Should complete well under 60s

        // Check files
        const files = await fs.readdir(workspace.path);
        console.log('Files in workspace:', files);

    }, 30000); // 30s timeout - if it hangs, test fails

    testFn('should work with tool_choice: auto (control test)', async () => {
        // Control test - this should work without issues
        const workspace = await createWorkspace();
        workspaces.push(workspace);

        await fs.writeFile(
            `${workspace.path}/README.md`,
            '# Test Project\n\nThis is a control test.'
        );

        const startTime = Date.now();

        const result = await workspace.execute(
            'Create a file called control.txt with the text "Control test passed"',
            {
                mode: 'static',
                model,
                enableMegawriter: true,
                tools: [...fileTools],
                tool_choice: { type: 'auto' },  // auto mode - should work
                max_tokens: 2048
            }
        );

        const elapsed = Date.now() - startTime;
        console.log(`\nControl test completed in ${elapsed}ms`);
        console.log('Files written:', result.filesWritten);

        expect(result).toBeDefined();

    }, 30000);

    testFn('should handle duplicate write tools gracefully', async () => {
        // Test that having both write_file and write_multiple_files doesn't cause issues
        const workspace = await createWorkspace();
        workspaces.push(workspace);

        console.log('\nTesting: Checking for duplicate write tools');
        console.log('fileTools contains:', fileTools.map(t => t.name));

        // With the fix, fileTools should contain megawriter instead of write_file
        // So there's no duplicate when enableMegawriter adds it again
        const hasWriteFile = fileTools.some(t => t.name === 'write_file');
        const hasMegawriter = fileTools.some(t => t.name === 'write_multiple_files');

        console.log(`write_file in fileTools: ${hasWriteFile}`);
        console.log(`write_multiple_files in fileTools: ${hasMegawriter}`);

        // After fix: fileTools should have megawriter, not write_file
        // This prevents duplicate tools when enableMegawriter adds megawriter
        expect(hasMegawriter).toBe(true);
        expect(hasWriteFile).toBe(false);

    }, 5000);
});
