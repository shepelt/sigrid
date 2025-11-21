import { describe, test, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import 'dotenv/config';
import { SigridBuilder } from '../builder.js';
import { initializeClient } from '../llm-client.js';
import { setSandboxRoot } from '../filetooling.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Test SigridBuilder with tool calling
 *
 * Run with: npm test -- tests/builder-tools.test.js
 */
describe('SigridBuilder with Tool Calling', () => {
    const hasGatewayConfig = !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);
    const testFn = hasGatewayConfig ? test : test.skip;
    const model = process.env.LLM_MODEL || 'anthropic/claude-haiku-4-5-20251001';

    let tempDir;

    beforeAll(() => {
        if (hasGatewayConfig) {
            console.log(`\nTesting builder with gateway: ${process.env.LLM_GATEWAY_URL}`);
            console.log(`Model: ${model}\n`);

            initializeClient({
                apiKey: process.env.LLM_GATEWAY_API_KEY,
                baseURL: process.env.LLM_GATEWAY_URL
            });
        }
    });

    beforeEach(async () => {
        if (hasGatewayConfig) {
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sigrid-builder-tools-'));
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

    testFn('should use builder API with enableWriteFileTool', async () => {
        const builder = new SigridBuilder();
        const result = await builder
            .model(model)
            .static()
            .enableWriteFileTool()
            .toolChoice({ type: "auto" })
            .execute('Create a file called test.txt with content "Builder API works!"', {
                max_tokens: 1024
            });

        console.log('\n=== Result ===');
        console.log('Content:', result.content);

        expect(result.content).toBeTruthy();

        // Check if file was created
        const filePath = path.join(tempDir, 'test.txt');
        const fileExists = await fs.access(filePath).then(() => true).catch(() => false);

        expect(fileExists).toBe(true);

        if (fileExists) {
            const content = await fs.readFile(filePath, 'utf-8');
            console.log('File content:', content);
            expect(content).toContain('Builder API works!');
        }
    }, 60000);

    testFn('should use builder API with custom tools', async () => {
        const customTool = {
            type: "function",
            function: {
                name: "get_weather",
                description: "Get weather information",
                parameters: {
                    type: "object",
                    properties: {
                        location: { type: "string" }
                    },
                    required: ["location"]
                }
            }
        };

        let weatherToolCalled = false;
        const customExecutor = async (toolName, args) => {
            if (toolName === 'get_weather') {
                weatherToolCalled = true;
                return { temperature: 72, condition: "sunny" };
            }
            throw new Error(`Unknown tool: ${toolName}`);
        };

        const builder = new SigridBuilder();
        const result = await builder
            .model(model)
            .static()
            .tools([customTool])
            .toolChoice({ type: "auto" })
            .execute('Get the weather for San Francisco', {
                max_tokens: 1024,
                toolExecutor: customExecutor
            });

        console.log('\n=== Result ===');
        console.log('Content:', result.content);
        console.log('Weather tool called:', weatherToolCalled);

        expect(weatherToolCalled).toBe(true);
        expect(result.content).toBeTruthy();
    }, 60000);

    testFn('should combine file tools and custom tools', async () => {
        const customTool = {
            type: "function",
            function: {
                name: "add_numbers",
                description: "Add two numbers",
                parameters: {
                    type: "object",
                    properties: {
                        a: { type: "number" },
                        b: { type: "number" }
                    },
                    required: ["a", "b"]
                }
            }
        };

        const customExecutor = async (toolName, args, progressCallback, workspace) => {
            if (toolName === 'add_numbers') {
                return { result: args.a + args.b };
            }
            // Fall back to file tools
            const { executeFileTool } = await import('../filetooling.js');
            return executeFileTool(toolName, args, progressCallback, workspace);
        };

        const builder = new SigridBuilder();
        const result = await builder
            .model(model)
            .static()
            .enableWriteFileTool()
            .tools([customTool])
            .toolChoice({ type: "auto" })
            .execute('Add 5 and 3, then create a file result.txt with the answer', {
                max_tokens: 1024,
                toolExecutor: customExecutor
            });

        console.log('\n=== Result ===');
        console.log('Content:', result.content);

        expect(result.content).toBeTruthy();

        // Check if file was created
        const filePath = path.join(tempDir, 'result.txt');
        const fileExists = await fs.access(filePath).then(() => true).catch(() => false);

        if (fileExists) {
            const content = await fs.readFile(filePath, 'utf-8');
            console.log('File content:', content);
            expect(content).toContain('8');
        }
    }, 60000);
});
