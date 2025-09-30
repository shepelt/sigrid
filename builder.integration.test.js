import { describe, test, expect, beforeAll } from '@jest/globals';
import 'dotenv/config';
import sigrid from './index.js';
import { initializeClient, setSandboxRoot } from './index.js';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

/**
 * Integration tests for Fluent Builder API
 *
 * These tests require OPENAI_API_KEY environment variable.
 * Run with: OPENAI_API_KEY=xxx npm test
 *
 * Skip if no API key: npm test (will skip automatically)
 */
describe('Builder Integration Tests', () => {
    const hasApiKey = !!process.env.OPENAI_API_KEY;
    const testFn = hasApiKey ? test : test.skip;

    let tempDir;

    beforeAll(async () => {
        if (hasApiKey) {
            initializeClient(process.env.OPENAI_API_KEY);

            // Create temporary sandbox directory
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sigrid-builder-'));
            setSandboxRoot(tempDir);
        }
    });

    if (!hasApiKey) {
        test('skipping integration tests - no OPENAI_API_KEY', () => {
            console.log('ℹ️  Set OPENAI_API_KEY to run integration tests');
            expect(true).toBe(true);
        });
    }

    describe('Basic Fluent Execution', () => {
        testFn('should execute with factory function', async () => {
            const result = await sigrid()
                .execute('Say "test passed" and nothing else');

            expect(result).toHaveProperty('content');
            expect(result).toHaveProperty('conversationID');
            expect(typeof result.content).toBe('string');
            expect(result.content.length).toBeGreaterThan(0);
        }, 30000);

        testFn('should execute with model selection', async () => {
            const result = await sigrid()
                .model('gpt-4o-mini')
                .execute('What is 2+2? Answer with only the number.');

            expect(result.content).toMatch(/4/);
        }, 30000);
    });

    describe('Instructions', () => {
        testFn('should accept single instruction', async () => {
            const result = await sigrid()
                .instruction('Respond with only the number, no explanation')
                .model('gpt-4o-mini')
                .execute('What is 3+3?');

            expect(result.content.trim()).toMatch(/6/);
        }, 30000);

        testFn('should accept multiple chained instructions', async () => {
            const result = await sigrid()
                .instruction('Be very brief')
                .instruction('Use exactly 2 words')
                .model('gpt-4o-mini')
                .execute('Say hello');

            const wordCount = result.content.trim().split(/\s+/).length;
            expect(wordCount).toBeLessThanOrEqual(3); // Allow some flexibility
        }, 30000);

        testFn('should accept instructions array', async () => {
            const result = await sigrid()
                .instructions([
                    'Be very brief',
                    'Use exactly 2 words'
                ])
                .model('gpt-4o-mini')
                .execute('Say hello');

            const wordCount = result.content.trim().split(/\s+/).length;
            expect(wordCount).toBeLessThanOrEqual(3); // Allow some flexibility
        }, 30000);

        testFn('should accept instructions as string', async () => {
            const result = await sigrid()
                .instructions('Respond with only the number')
                .model('gpt-4o-mini')
                .execute('What is 5+5?');

            expect(result.content.trim()).toMatch(/10/);
        }, 30000);
    });

    describe('Pure Mode', () => {
        testFn('should produce output without explanations', async () => {
            const result = await sigrid()
                .pure()
                .model('gpt-4o-mini')
                .execute('Write a Python for loop that prints 0 to 4');

            // Pure mode should not include explanations or markdown
            expect(result.content).not.toMatch(/here.*is|this.*will|explanation|note/i);
            expect(result.content).not.toMatch(/```/);

            // Should contain the actual code
            expect(result.content.toLowerCase()).toContain('for');
            expect(result.content.toLowerCase()).toContain('range');
        }, 30000);
    });

    describe('Conversation Mode', () => {
        testFn('should maintain conversation context', async () => {
            // First message
            const result1 = await sigrid()
                .conversation()
                .model('gpt-4o-mini')
                .execute('My favorite color is blue');

            expect(result1.conversationID).toBeDefined();

            // Second message in same conversation
            const result2 = await sigrid()
                .model('gpt-4o-mini')
                .execute('What is my favorite color?', {
                    conversationID: result1.conversationID
                });

            expect(result2.content.toLowerCase()).toContain('blue');
        }, 60000);
    });

    describe('Combined Options', () => {
        testFn('should combine pure mode, model, and instruction', async () => {
            const result = await sigrid()
                .pure()
                .model('gpt-4o-mini')
                .instruction('Output only the code, no comments')
                .execute('Write: print("hello")');

            expect(result.content).not.toMatch(/```/);
            expect(result.content.toLowerCase()).toContain('print');
            expect(result.content.toLowerCase()).toContain('hello');
        }, 30000);
    });

    describe('Tool Calling', () => {
        testFn('should use list_dir tool with builder', async () => {
            // Create a test file
            await fs.writeFile(path.join(tempDir, 'builder-test.txt'), 'hello from builder');

            const result = await sigrid()
                .model('gpt-4o-mini')
                .execute('List all files in the current directory');

            expect(result.content.toLowerCase()).toContain('builder-test.txt');
        }, 30000);

        testFn('should use write_file tool with builder', async () => {
            const result = await sigrid()
                .model('gpt-4o-mini')
                .execute('Create a file named "builder-write.txt" with content "Built by builder"');

            // Check if file was created
            const filePath = path.join(tempDir, 'builder-write.txt');
            const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
            expect(fileExists).toBe(true);

            if (fileExists) {
                const content = await fs.readFile(filePath, 'utf-8');
                expect(content.toLowerCase()).toContain('builder');
            }
        }, 30000);
    });

    describe('Independent Instances', () => {
        testFn('should create independent builder instances', async () => {
            const builder1 = sigrid()
                .instruction('Respond with only the number, no explanation')
                .model('gpt-4o-mini');
            const builder2 = sigrid()
                .instruction('Respond with only the number, no explanation')
                .model('gpt-4o-mini');

            const result1 = await builder1.execute('What is 1+1?');
            const result2 = await builder2.execute('What is 5+5?');

            // Results should be different (verifies state isn't shared)
            expect(result1.content.trim()).toMatch(/2/);
            expect(result2.content.trim()).toMatch(/10/);
            expect(result1.content).not.toBe(result2.content);
        }, 60000);
    });

    describe('Workspace', () => {
        testFn('should use workspace instead of global sandbox', async () => {
            // Set global sandbox to tempDir
            setSandboxRoot(tempDir);

            // Create a different workspace
            const workspace2 = await fs.mkdtemp(path.join(os.tmpdir(), 'sigrid-workspace2-'));
            await fs.writeFile(path.join(workspace2, 'workspace-test.txt'), 'in workspace2');

            // Use workspace (should override global sandbox)
            const result = await sigrid()
                .workspace(workspace2)
                .model('gpt-4o-mini')
                .execute('List all files in the current directory');

            // Should see file from workspace2, not tempDir
            expect(result.content.toLowerCase()).toContain('workspace-test.txt');
            // Should NOT see files from global tempDir sandbox
            expect(result.content.toLowerCase()).not.toContain('builder-test.txt');

            // Cleanup
            await fs.rm(workspace2, { recursive: true, force: true });
        }, 30000);
    });

    describe('Backward Compatibility', () => {
        testFn('should support original execute API', async () => {
            const result = await sigrid.execute('Say "legacy" and nothing else', {
                model: 'gpt-4o-mini'
            });

            expect(result).toHaveProperty('content');
            expect(result).toHaveProperty('conversationID');
            expect(result.content.toLowerCase()).toContain('legacy');
        }, 30000);

        testFn('should support both APIs in same test', async () => {
            // Old API
            const result1 = await sigrid.execute('Say "old"', {
                model: 'gpt-4o-mini'
            });

            // New API
            const result2 = await sigrid()
                .model('gpt-4o-mini')
                .execute('Say "new"');

            expect(result1.content.toLowerCase()).toContain('old');
            expect(result2.content.toLowerCase()).toContain('new');
        }, 60000);
    });
});