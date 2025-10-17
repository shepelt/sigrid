import { describe, test, expect, beforeAll } from '@jest/globals';
import 'dotenv/config';  // Load .env file
import { initializeClient, execute, setSandboxRoot } from './llm.js';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

/**
 * Integration tests for LLM module
 * 
 * These tests require OPENAI_API_KEY environment variable.
 * Run with: OPENAI_API_KEY=xxx npm test
 * 
 * Skip if no API key: npm test (will skip automatically)
 */
describe('LLM Integration Tests', () => {
    const hasApiKey = !!process.env.OPENAI_API_KEY;
    const testFn = hasApiKey ? test : test.skip;

    let tempDir;

    beforeAll(async () => {
        if (hasApiKey) {
            initializeClient(process.env.OPENAI_API_KEY);

            // Create temporary sandbox directory
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sigrid-integration-'));
            setSandboxRoot(tempDir);
        }
    });

    if (!hasApiKey) {
        test('skipping integration tests - no OPENAI_API_KEY', () => {
            console.log('ℹ️  Set OPENAI_API_KEY to run integration tests');
            expect(true).toBe(true);
        });
    }

    describe('Basic Execution', () => {
        testFn('should execute simple prompt', async () => {
            const result = await execute('Say "test passed" and nothing else', {
                model: 'gpt-4o-mini'
            });

            expect(result).toHaveProperty('content');
            expect(result).toHaveProperty('conversationID');
            expect(typeof result.content).toBe('string');
            expect(result.content.length).toBeGreaterThan(0);
        }, 30000);

        testFn('should respect custom instructions', async () => {
            const result = await execute('What is 2+2?', {
                instructions: 'Respond with only the number, no explanation',
                model: 'gpt-4o-mini'
            });

            expect(result.content.trim()).toMatch(/4/);
        }, 30000);

        testFn('should handle multiple instructions', async () => {
            const result = await execute('Say hello', {
                instructions: [
                    'Be very brief',
                    'Use exactly 2 words'
                ],
                model: 'gpt-4o-mini'
            });

            const wordCount = result.content.trim().split(/\s+/).length;
            expect(wordCount).toBeLessThanOrEqual(3); // Allow some flexibility
        }, 30000);

        testFn('should handle prompts parameter (single string)', async () => {
            const result = await execute('What fruit did I mention?', {
                prompts: 'My favorite fruit is apple',
                model: 'gpt-4o-mini'
            });

            expect(result.content.toLowerCase()).toContain('apple');
        }, 30000);

        testFn('should handle prompts parameter (array)', async () => {
            const result = await execute('What are my favorite things?', {
                prompts: [
                    'My favorite color is blue',
                    'My favorite fruit is apple'
                ],
                model: 'gpt-4o-mini'
            });

            expect(result.content.toLowerCase()).toContain('blue');
            expect(result.content.toLowerCase()).toContain('apple');
        }, 30000);
    });

    describe('Tool Calling', () => {
        testFn('should use list_dir tool', async () => {
            // Create a test file
            await fs.writeFile(path.join(tempDir, 'test.txt'), 'hello');

            const result = await execute('List all files in the current directory', {
                model: 'gpt-4o-mini'
            });

            expect(result.content.toLowerCase()).toContain('test.txt');
        }, 30000);

        testFn('should use write_file tool', async () => {
            const result = await execute('Create a file named "hello.txt" with content "Hello World"', {
                model: 'gpt-4o-mini'
            });

            // Check if file was created
            const filePath = path.join(tempDir, 'hello.txt');
            const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
            expect(fileExists).toBe(true);

            if (fileExists) {
                const content = await fs.readFile(filePath, 'utf-8');
                expect(content.toLowerCase()).toContain('hello');
            }
        }, 30000);

        testFn('should use read_file tool', async () => {
            // Create a test file
            const testContent = 'This is test content for reading';
            await fs.writeFile(path.join(tempDir, 'readme.txt'), testContent);

            const result = await execute('Read the file readme.txt and tell me what it says', {
                model: 'gpt-4o-mini'
            });

            expect(result.content.toLowerCase()).toContain('test content');
        }, 30000);
    });

    describe('Conversation Mode', () => {
        testFn('should maintain conversation context', async () => {
            // First message
            const result1 = await execute('My favorite color is blue', {
                conversation: true,
                model: 'gpt-4o-mini'
            });

            expect(result1.conversationID).toBeDefined();

            // Second message in same conversation
            const result2 = await execute('What is my favorite color?', {
                conversationID: result1.conversationID,
                model: 'gpt-4o-mini'
            });

            expect(result2.content.toLowerCase()).toContain('blue');
        }, 60000);
    });

    describe('Pure Mode', () => {
        testFn('should produce output without explanations', async () => {
            const result = await execute('Write a Python for loop that prints 0 to 4', {
                pure: true,
                model: 'gpt-4o-mini'
            });

            // Pure mode should not include explanations or markdown
            expect(result.content).not.toMatch(/here.*is|this.*will|explanation|note/i);
            expect(result.content).not.toMatch(/```/);

            // Should contain the actual code
            expect(result.content.toLowerCase()).toContain('for');
            expect(result.content.toLowerCase()).toContain('range');
        }, 30000);
    });
});
