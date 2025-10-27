import { describe, test, expect, beforeAll } from '@jest/globals';
import 'dotenv/config';  // Load .env file
import { initializeClient, executeStatic, InMemoryPersistence } from './llm-static.js';

/**
 * Integration tests for LLM Static module
 *
 * These tests require OPENAI_API_KEY environment variable.
 * Run with: OPENAI_API_KEY=xxx npm test
 *
 * Skip if no API key: npm test (will skip automatically)
 */
describe('LLM Static Integration Tests', () => {
    const hasApiKey = !!process.env.OPENAI_API_KEY;
    const testFn = hasApiKey ? test : test.skip;

    beforeAll(async () => {
        if (hasApiKey) {
            initializeClient(process.env.OPENAI_API_KEY);
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
            const result = await executeStatic('Say "test passed" and nothing else', {
                model: 'gpt-4o-mini'
            });

            expect(result).toHaveProperty('content');
            expect(result).toHaveProperty('conversationID');
            expect(typeof result.content).toBe('string');
            expect(result.content.length).toBeGreaterThan(0);
        }, 30000);

        testFn('should respect custom instructions', async () => {
            const result = await executeStatic('What is 2+2?', {
                instructions: 'Respond with only the number, no explanation',
                model: 'gpt-4o-mini'
            });

            expect(result.content.trim()).toMatch(/4/);
        }, 30000);

        testFn('should handle multiple instructions', async () => {
            const result = await executeStatic('Say hello', {
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
            const result = await executeStatic('What fruit did I mention?', {
                prompts: 'My favorite fruit is apple',
                model: 'gpt-4o-mini'
            });

            expect(result.content.toLowerCase()).toContain('apple');
        }, 30000);

        testFn('should handle prompts parameter (array)', async () => {
            const result = await executeStatic('What are my favorite things?', {
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

    describe('Internal Conversation with Persistence', () => {
        testFn('should maintain conversation context with persistence', async () => {
            const persistence = new InMemoryPersistence();

            // First message
            const result1 = await executeStatic('My favorite color is blue', {
                conversation: true,
                conversationPersistence: persistence,
                model: 'gpt-4o-mini'
            });

            expect(result1.conversationID).toBeDefined();

            // Verify messages were saved to persistence
            const history = await persistence.get(result1.conversationID);
            expect(history.length).toBe(2); // user + assistant

            // Second message in same conversation
            const result2 = await executeStatic('What is my favorite color?', {
                conversation: true,
                conversationID: result1.conversationID,
                conversationPersistence: persistence,
                model: 'gpt-4o-mini'
            });

            expect(result2.content.toLowerCase()).toContain('blue');

            // Verify conversation grew
            const history2 = await persistence.get(result1.conversationID);
            expect(history2.length).toBe(4); // 2 user + 2 assistant
        }, 60000);

        testFn('should support multiple separate conversations', async () => {
            const persistence = new InMemoryPersistence();

            // Conversation 1
            const result1 = await executeStatic('My name is Alice', {
                conversation: true,
                conversationPersistence: persistence,
                model: 'gpt-4o-mini'
            });

            // Conversation 2
            const result2 = await executeStatic('My name is Bob', {
                conversation: true,
                conversationPersistence: persistence,
                model: 'gpt-4o-mini'
            });

            expect(result1.conversationID).not.toBe(result2.conversationID);

            // Ask each conversation what the name is
            const result3 = await executeStatic('What is my name?', {
                conversation: true,
                conversationID: result1.conversationID,
                conversationPersistence: persistence,
                model: 'gpt-4o-mini'
            });

            const result4 = await executeStatic('What is my name?', {
                conversation: true,
                conversationID: result2.conversationID,
                conversationPersistence: persistence,
                model: 'gpt-4o-mini'
            });

            expect(result3.content.toLowerCase()).toContain('alice');
            expect(result4.content.toLowerCase()).toContain('bob');
        }, 90000);
    });

    describe('Streaming', () => {
        testFn('should stream output via callback', async () => {
            const chunks = [];

            const result = await executeStatic('Count from 1 to 5', {
                model: 'gpt-4o-mini',
                stream: true,
                streamCallback: (chunk) => {
                    chunks.push(chunk);
                }
            });

            console.log(`Received ${chunks.length} chunks`);

            // Streaming mode should return empty content
            expect(result.content).toBe('');

            // Should have received multiple chunks
            expect(chunks.length).toBeGreaterThan(1);

            // Chunks combined should form complete response
            const fullText = chunks.join('');
            expect(fullText.length).toBeGreaterThan(0);
        }, 30000);

        testFn('should stream with internal conversation persistence', async () => {
            const persistence = new InMemoryPersistence();
            const chunks = [];

            // First message with streaming
            const result1 = await executeStatic('My favorite number is 42', {
                conversation: true,
                conversationPersistence: persistence,
                model: 'gpt-4o-mini',
                stream: true,
                streamCallback: (chunk) => {
                    chunks.push(chunk);
                }
            });

            console.log(`First message: received ${chunks.length} chunks`);

            expect(result1.content).toBe(''); // Empty in streaming mode
            expect(chunks.length).toBeGreaterThan(0);

            // Verify conversation was saved despite streaming
            const history = await persistence.get(result1.conversationID);
            expect(history.length).toBe(2); // user + assistant

            // Assistant message should contain the full streamed content
            const assistantMessage = history[1];
            expect(assistantMessage.role).toBe('assistant');
            expect(assistantMessage.content).toBe(chunks.join(''));

            // Second message in same conversation
            chunks.length = 0; // Clear chunks

            const result2 = await executeStatic('What is my favorite number?', {
                conversation: true,
                conversationID: result1.conversationID,
                conversationPersistence: persistence,
                model: 'gpt-4o-mini',
                stream: true,
                streamCallback: (chunk) => {
                    chunks.push(chunk);
                }
            });

            console.log(`Second message: received ${chunks.length} chunks`);

            const fullResponse = chunks.join('');
            expect(fullResponse.toLowerCase()).toContain('42');

            // Verify conversation history grew correctly
            const history2 = await persistence.get(result1.conversationID);
            expect(history2.length).toBe(4); // 2 user + 2 assistant
        }, 60000);

        testFn('should stream without persistence (no chunk accumulation)', async () => {
            const chunks = [];

            // Stream without persistence - no internal chunk accumulation needed
            const result = await executeStatic('Say hello', {
                model: 'gpt-4o-mini',
                stream: true,
                streamCallback: (chunk) => {
                    chunks.push(chunk);
                }
            });

            console.log(`Streaming without persistence: received ${chunks.length} chunks`);

            expect(result.content).toBe('');
            expect(chunks.length).toBeGreaterThan(0);

            // Should have received text chunks
            const fullText = chunks.join('');
            expect(fullText.toLowerCase()).toContain('hello');
        }, 30000);
    });

    describe('Non-streaming with Persistence', () => {
        testFn('should work with non-streaming and persistence', async () => {
            const persistence = new InMemoryPersistence();

            const result = await executeStatic('My favorite food is pizza', {
                conversation: true,
                conversationPersistence: persistence,
                model: 'gpt-4o-mini',
                stream: false
            });

            // Non-streaming should return full content
            expect(result.content.length).toBeGreaterThan(0);

            // Verify persistence
            const history = await persistence.get(result.conversationID);
            expect(history.length).toBe(2);

            const assistantMessage = history[1];
            expect(assistantMessage.content).toBe(result.content);
        }, 30000);
    });
});
