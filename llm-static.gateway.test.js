import { describe, test, expect } from '@jest/globals';
import 'dotenv/config';
import OpenAI from 'openai';
import { executeStatic, InMemoryPersistence } from './llm-static.js';

/**
 * Gateway tests for llm-static
 *
 * Set LLM_GATEWAY_URL in .env: LLM_GATEWAY_URL=http://localhost:3000/v1
 * Set LLM_MODEL to configure model: LLM_MODEL=gpt-oss:120b
 */
describe('Gateway Tests', () => {
    const gatewayUrl = process.env.LLM_GATEWAY_URL;
    const gatewayApiKey = process.env.LLM_GATEWAY_API_KEY || 'test-key';
    const model = process.env.LLM_MODEL || 'gpt-oss:120b';
    const hasGateway = !!gatewayUrl;
    const testFn = hasGateway ? test : test.skip;

    let client;

    if (!hasGateway) {
        test('skipping - no LLM_GATEWAY_URL set', () => {
            console.log('Set LLM_GATEWAY_URL in .env to run tests');
            expect(true).toBe(true);
        });
    } else {
        client = new OpenAI({
            apiKey: gatewayApiKey,
            baseURL: gatewayUrl,
        });
        console.log(`Testing gateway at: ${gatewayUrl}, model: ${model}`);
    }

    describe('Basic Connectivity', () => {
        testFn('should connect and get response', async () => {
            const result = await executeStatic('Say hello', {
                client,
                model
            });

            console.log('Response:', result.content);
            expect(result.content).toBeTruthy();
            expect(result.content.length).toBeGreaterThan(0);
        }, 30000);

        testFn('should handle system instructions', async () => {
            const result = await executeStatic('What is 2+2?', {
                client,
                instructions: 'Respond with only the number, no explanation',
                model
            });

            console.log('Math response:', result.content);
            expect(result.content.trim()).toMatch(/4/);
        }, 30000);

        testFn('should handle context prompts', async () => {
            const result = await executeStatic('What fruit did I mention?', {
                client,
                prompts: 'My favorite fruit is apple',
                model
            });

            console.log('Context response:', result.content);
            expect(result.content.toLowerCase()).toContain('apple');
        }, 30000);
    });

    describe('Conversation with Persistence', () => {
        testFn('should maintain conversation context', async () => {
            const persistence = new InMemoryPersistence();

            const result1 = await executeStatic('My favorite color is blue', {
                client,
                conversation: true,
                conversationPersistence: persistence,
                model
            });

            console.log('First message response:', result1.content);
            expect(result1.conversationID).toBeDefined();

            const result2 = await executeStatic('What is my favorite color?', {
                client,
                conversation: true,
                conversationID: result1.conversationID,
                conversationPersistence: persistence,
                model
            });

            console.log('Recall response:', result2.content);
            expect(result2.content.toLowerCase()).toContain('blue');
        }, 60000);

        testFn('should handle multiple conversations', async () => {
            const persistence = new InMemoryPersistence();

            const conv1 = await executeStatic('My name is Alice', {
                client,
                conversation: true,
                conversationPersistence: persistence,
                model
            });

            const conv2 = await executeStatic('My name is Bob', {
                client,
                conversation: true,
                conversationPersistence: persistence,
                model
            });

            expect(conv1.conversationID).not.toBe(conv2.conversationID);

            const check1 = await executeStatic('What is my name?', {
                client,
                conversation: true,
                conversationID: conv1.conversationID,
                conversationPersistence: persistence,
                model
            });

            const check2 = await executeStatic('What is my name?', {
                client,
                conversation: true,
                conversationID: conv2.conversationID,
                conversationPersistence: persistence,
                model
            });

            console.log('Alice check:', check1.content);
            console.log('Bob check:', check2.content);
            expect(check1.content.toLowerCase()).toContain('alice');
            expect(check2.content.toLowerCase()).toContain('bob');
        }, 90000);
    });

    describe('Streaming', () => {
        testFn('should stream responses', async () => {
            const chunks = [];

            const result = await executeStatic('Count from 1 to 5', {
                client,
                model,
                stream: true,
                streamCallback: (chunk) => {
                    chunks.push(chunk);
                }
            });

            console.log(`Received ${chunks.length} chunks`);
            console.log('Streamed content:', chunks.join(''));

            expect(result.content).toBe('');
            expect(chunks.length).toBeGreaterThan(1);
        }, 30000);

        testFn('should stream with conversation persistence', async () => {
            const persistence = new InMemoryPersistence();
            const chunks = [];

            const result1 = await executeStatic('My favorite number is 42', {
                client,
                conversation: true,
                conversationPersistence: persistence,
                model,
                stream: true,
                streamCallback: (chunk) => chunks.push(chunk)
            });

            console.log('Streamed acknowledgment:', chunks.join(''));

            chunks.length = 0;

            const result2 = await executeStatic('What is my favorite number?', {
                client,
                conversation: true,
                conversationID: result1.conversationID,
                conversationPersistence: persistence,
                model,
                stream: true,
                streamCallback: (chunk) => chunks.push(chunk)
            });

            const fullResponse = chunks.join('');
            console.log('Streamed recall:', fullResponse);
            expect(fullResponse.toLowerCase()).toContain('42');
        }, 60000);
    });

    describe('Performance', () => {
        testFn('should measure response latency', async () => {
            const start = Date.now();

            await executeStatic('Say hi', {
                client,
                model
            });

            const latency = Date.now() - start;
            console.log(`Response latency: ${latency}ms`);
            expect(latency).toBeLessThan(60000);
        }, 60000);

        testFn('should measure streaming latency', async () => {
            const timestamps = [];
            const start = Date.now();

            await executeStatic('Count to 10', {
                client,
                model,
                stream: true,
                streamCallback: () => {
                    timestamps.push(Date.now() - start);
                }
            });

            console.log(`Time to first chunk: ${timestamps[0]}ms`);
            console.log(`Total time: ${timestamps[timestamps.length - 1]}ms`);
            console.log(`Chunks: ${timestamps.length}`);
        }, 60000);
    });
});
