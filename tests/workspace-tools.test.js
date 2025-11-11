import { describe, test, expect, beforeAll, afterEach } from '@jest/globals';
import 'dotenv/config';
import { createWorkspace, initializeClient } from '../index.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Test Workspace with enableWriteFileTool
 *
 * Run with: npm test -- tests/workspace-tools.test.js
 */
describe('Workspace with enableWriteFileTool', () => {
    const hasGatewayConfig = !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);
    const testFn = hasGatewayConfig ? test : test.skip;
    const model = process.env.LLM_MODEL || 'anthropic/claude-haiku-4-5-20251001';

    let workspaces = [];

    beforeAll(() => {
        if (hasGatewayConfig) {
            console.log(`\nTesting workspace with gateway: ${process.env.LLM_GATEWAY_URL}`);
            console.log(`Model: ${model}\n`);

            initializeClient({
                apiKey: process.env.LLM_GATEWAY_API_KEY,
                baseURL: process.env.LLM_GATEWAY_URL
            });
        }
    });

    afterEach(async () => {
        // Clean up all created workspaces
        for (const workspace of workspaces) {
            try {
                await fs.rm(workspace.path, { recursive: true });
            } catch (err) {
                console.error('Error cleaning up workspace:', err);
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

    testFn('should use workspace.execute with enableWriteFileTool in static mode', async () => {
        // Create empty workspace
        const workspace = await createWorkspace();
        workspaces.push(workspace);

        console.log(`Workspace created at: ${workspace.path}`);

        // Execute with tool calling
        const result = await workspace.execute('Create a simple Hello.tsx React component', {
            mode: 'static',
            model,
            enableWriteFileTool: true,
            tool_choice: { type: "auto" },
            max_tokens: 2048
        });

        console.log('\n=== Result ===');
        console.log('Content:', result.content);
        console.log('Token usage:', result.tokenCount);

        expect(result.content).toBeTruthy();

        // Check if file was created
        const files = await fs.readdir(workspace.path, { recursive: true });
        console.log('\nFiles in workspace:', files);

        // Should have at least one .tsx file
        const tsxFiles = files.filter(f => f.endsWith('.tsx'));
        expect(tsxFiles.length).toBeGreaterThan(0);

        if (tsxFiles.length > 0) {
            const filePath = path.join(workspace.path, tsxFiles[0]);
            const content = await fs.readFile(filePath, 'utf-8');
            console.log(`\nContent of ${tsxFiles[0]}:`);
            console.log(content);
            expect(content).toContain('React');
        }
    }, 90000);

    testFn('should create multiple files with enableWriteFileTool', async () => {
        // Create empty workspace
        const workspace = await createWorkspace();
        workspaces.push(workspace);

        // Execute with tool calling - request multiple files
        const result = await workspace.execute(
            'Create a simple Todo app with: 1) Todo.tsx component, 2) TodoList.tsx component, 3) App.tsx that uses them',
            {
                mode: 'static',
                model,
                enableWriteFileTool: true,
                tool_choice: { type: "auto" },
                max_tokens: 4096
            }
        );

        console.log('\n=== Result ===');
        console.log('Content:', result.content);

        expect(result.content).toBeTruthy();

        // Check files created
        const files = await fs.readdir(workspace.path, { recursive: true });
        console.log('\nFiles created:', files);

        const tsxFiles = files.filter(f => f.endsWith('.tsx'));
        console.log('TSX files:', tsxFiles);

        // Should have created multiple components
        expect(tsxFiles.length).toBeGreaterThanOrEqual(2);
    }, 120000);

    testFn('should read existing files from snapshot and modify with tool', async () => {
        // Create workspace with initial file
        const workspace = await createWorkspace();
        workspaces.push(workspace);

        // Create initial file
        await fs.writeFile(
            path.join(workspace.path, 'Button.tsx'),
            `export default function Button() {
  return <button>Click me</button>;
}`
        );

        // Execute - ask to modify existing file
        const result = await workspace.execute(
            'Add a "disabled" prop to the Button component',
            {
                mode: 'static',
                model,
                enableWriteFileTool: true,
                tool_choice: { type: "auto" },
                max_tokens: 2048
            }
        );

        console.log('\n=== Result ===');
        console.log('Content:', result.content);

        expect(result.content).toBeTruthy();

        // Read modified file
        const modifiedContent = await fs.readFile(
            path.join(workspace.path, 'Button.tsx'),
            'utf-8'
        );

        console.log('\nModified Button.tsx:');
        console.log(modifiedContent);

        // Should have added disabled prop
        expect(modifiedContent.toLowerCase()).toContain('disabled');
    }, 90000);

    testFn('should handle custom tools with enableWriteFileTool', async () => {
        const workspace = await createWorkspace();
        workspaces.push(workspace);

        const customTool = {
            type: "function",
            function: {
                name: "get_timestamp",
                description: "Get current timestamp",
                parameters: {
                    type: "object",
                    properties: {}
                }
            }
        };

        let timestampCalled = false;
        const customExecutor = async (toolName, args, progressCallback, workspacePath) => {
            if (toolName === 'get_timestamp') {
                timestampCalled = true;
                return { timestamp: new Date().toISOString() };
            }

            // Fall back to file tools
            const { executeFileTool } = await import('../filetooling.js');
            return executeFileTool(toolName, args, progressCallback, workspacePath);
        };

        const result = await workspace.execute(
            'Get the current timestamp and create a file timestamp.txt with that timestamp',
            {
                mode: 'static',
                model,
                enableWriteFileTool: true,
                tools: [customTool],
                tool_choice: { type: "auto" },
                toolExecutor: customExecutor,
                max_tokens: 2048
            }
        );

        console.log('\n=== Result ===');
        console.log('Content:', result.content);
        console.log('Timestamp tool called:', timestampCalled);

        expect(timestampCalled).toBe(true);

        // Check if file was created
        const filePath = path.join(workspace.path, 'timestamp.txt');
        const fileExists = await fs.access(filePath).then(() => true).catch(() => false);

        if (fileExists) {
            const content = await fs.readFile(filePath, 'utf-8');
            console.log('\nTimestamp file content:', content);
            expect(content.length).toBeGreaterThan(0);
        }
    }, 90000);
});
