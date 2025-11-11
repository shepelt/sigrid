import { describe, test, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import 'dotenv/config';
import { initializeClient, executeStatic } from '../llm-static.js';
import { fileTools, setSandboxRoot } from '../filetooling.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Test llm-static.js with tool calling
 *
 * Run with: npm test -- tests/llm-static-tools.test.js
 */
describe('LLM Static with Tool Calling', () => {
    const hasGatewayConfig = !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);
    const testFn = hasGatewayConfig ? test : test.skip;
    const model = process.env.LLM_MODEL || 'anthropic/claude-haiku-4-5-20251001';

    let tempDir;

    beforeAll(() => {
        if (hasGatewayConfig) {
            console.log(`\nTesting with gateway: ${process.env.LLM_GATEWAY_URL}`);
            console.log(`Model: ${model}\n`);

            initializeClient({
                apiKey: process.env.LLM_GATEWAY_API_KEY,
                baseURL: process.env.LLM_GATEWAY_URL
            });
        }
    });

    beforeEach(async () => {
        if (hasGatewayConfig) {
            // Create temporary sandbox directory
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sigrid-static-tools-'));
            setSandboxRoot(tempDir);
            console.log(`Test workspace: ${tempDir}`);
        }
    });

    afterEach(async () => {
        if (tempDir) {
            try {
                await fs.rm(tempDir, { recursive: true });
            } catch (err) {
                console.error('Error cleaning up:', err);
            }
        }
    });

    if (!hasGatewayConfig) {
        test('skipping - no gateway configuration', () => {
            console.log('ℹ️  Set LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY to run this test');
            expect(true).toBe(true);
        });
    }

    testFn('should work without tools (baseline)', async () => {
        const result = await executeStatic('Say "test passed"', {
            model,
            max_tokens: 100
        });

        expect(result).toHaveProperty('content');
        expect(result.content).toBeTruthy();
        console.log('Response:', result.content);
    }, 30000);

    testFn('should use file tools to create a file', async () => {
        const result = await executeStatic('Create a file called hello.txt with content "Hello World"', {
            model,
            max_tokens: 1024,
            tools: fileTools,
            tool_choice: { type: "auto" }
        });

        console.log('\n=== Result ===');
        console.log('Content:', result.content);
        console.log('Token usage:', result.tokenCount);

        expect(result).toHaveProperty('content');
        expect(result.content).toBeTruthy();

        // Check if file was created
        const filePath = path.join(tempDir, 'hello.txt');
        const fileExists = await fs.access(filePath).then(() => true).catch(() => false);

        expect(fileExists).toBe(true);

        if (fileExists) {
            const content = await fs.readFile(filePath, 'utf-8');
            console.log('File content:', content);
            expect(content.toLowerCase()).toContain('hello');
        }
    }, 60000);

    testFn('should use file tools to list directory', async () => {
        // Create some test files first
        await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1');
        await fs.writeFile(path.join(tempDir, 'file2.txt'), 'content2');

        const result = await executeStatic('List all files in the current directory', {
            model,
            max_tokens: 1024,
            tools: fileTools,
            tool_choice: { type: "auto" }
        });

        console.log('\n=== Result ===');
        console.log('Content:', result.content);

        expect(result.content).toBeTruthy();
        expect(result.content.toLowerCase()).toContain('file1');
        expect(result.content.toLowerCase()).toContain('file2');
    }, 60000);

    testFn('should use file tools to read a file', async () => {
        // Create test file
        const testContent = 'This is a test file for reading';
        await fs.writeFile(path.join(tempDir, 'readme.txt'), testContent);

        const result = await executeStatic('Read the file readme.txt and tell me what it says', {
            model,
            max_tokens: 1024,
            tools: fileTools,
            tool_choice: { type: "auto" }
        });

        console.log('\n=== Result ===');
        console.log('Content:', result.content);

        expect(result.content).toBeTruthy();
        expect(result.content.toLowerCase()).toContain('test');
    }, 60000);

    testFn('should handle custom tool executor', async () => {
        let customToolCalled = false;

        const customTools = [{
            type: "function",
            function: {
                name: "custom_echo",
                description: "Echo back a message",
                parameters: {
                    type: "object",
                    properties: {
                        message: { type: "string", description: "Message to echo" }
                    },
                    required: ["message"]
                }
            }
        }];

        const customExecutor = async (toolName, args) => {
            if (toolName === 'custom_echo') {
                customToolCalled = true;
                return { echoed: args.message };
            }
            throw new Error(`Unknown tool: ${toolName}`);
        };

        const result = await executeStatic('Use the custom_echo tool to echo "test message"', {
            model,
            max_tokens: 1024,
            tools: customTools,
            tool_choice: { type: "auto" },
            toolExecutor: customExecutor
        });

        console.log('\n=== Result ===');
        console.log('Content:', result.content);
        console.log('Custom tool called:', customToolCalled);

        expect(customToolCalled).toBe(true);
        expect(result.content).toBeTruthy();
    }, 60000);
});
