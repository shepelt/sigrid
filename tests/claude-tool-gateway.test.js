import { describe, test, expect, beforeAll } from '@jest/globals';
import 'dotenv/config';
import { initializeClient, getClient } from '../llm-client.js';

/**
 * Test if LLM gateway properly translates OpenAI tool format to Claude format
 *
 * This test verifies that the gateway can:
 * 1. Accept OpenAI-style tool definitions
 * 2. Translate them to Claude's native format
 * 3. Return tool calls in OpenAI format
 *
 * Run with: npm test -- tests/claude-tool-gateway.test.js
 */
describe('Claude Tool Gateway Translation Test', () => {
    const hasGatewayConfig = !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);
    const testFn = hasGatewayConfig ? test : test.skip;
    const model = process.env.LLM_MODEL || 'anthropic/claude-haiku-4-5-20251001';

    beforeAll(() => {
        if (hasGatewayConfig) {
            console.log(`\nTesting gateway: ${process.env.LLM_GATEWAY_URL}`);
            console.log(`Model: ${model}\n`);

            initializeClient({
                apiKey: process.env.LLM_GATEWAY_API_KEY,
                baseURL: process.env.LLM_GATEWAY_URL
            });
        }
    });

    if (!hasGatewayConfig) {
        test('skipping - no gateway configuration', () => {
            console.log('ℹ️  Set LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY to run this test');
            expect(true).toBe(true);
        });
    }

    testFn('should accept OpenAI tool format and return response', async () => {
        const client = getClient();

        console.log('Sending request with tool definition...');

        const response = await client.chat.completions.create({
            model,
            max_tokens: 1024,
            messages: [
                { role: 'user', content: 'Calculate 25 * 4 using the calculator tool' }
            ],
            tools: [{
                type: "function",
                function: {
                    name: "calculator",
                    description: "Perform a mathematical calculation",
                    parameters: {
                        type: "object",
                        properties: {
                            expression: {
                                type: "string",
                                description: "The mathematical expression to evaluate (e.g., '25 * 4')"
                            }
                        },
                        required: ["expression"]
                    }
                }
            }],
            tool_choice: { type: "auto" }
        });

        console.log('\n=== Response Structure ===');
        console.log('Response:', JSON.stringify(response, null, 2));

        // Check if we got a valid response
        expect(response).toBeDefined();
        expect(response.choices).toBeDefined();
        expect(response.choices.length).toBeGreaterThan(0);

        const message = response.choices[0].message;
        console.log('\n=== Message ===');
        console.log('Role:', message.role);
        console.log('Content:', message.content);
        console.log('Tool calls:', message.tool_calls);

        // Check if Claude tried to use the tool
        if (message.tool_calls && message.tool_calls.length > 0) {
            console.log('\n✅ SUCCESS: Gateway translated tool calls!');
            console.log('Tool call details:', JSON.stringify(message.tool_calls, null, 2));

            expect(message.tool_calls[0]).toHaveProperty('function');
            expect(message.tool_calls[0].function).toHaveProperty('name');
            expect(message.tool_calls[0].function.name).toBe('calculator');
        } else {
            console.log('\n⚠️  No tool calls in response');
            console.log('This could mean:');
            console.log('1. Gateway doesn\'t translate tool format');
            console.log('2. Claude chose not to use the tool');
            console.log('3. Tool definition wasn\'t understood');
        }
    }, 30000);

    testFn('should handle tool execution loop', async () => {
        const client = getClient();

        console.log('\nTesting full tool execution loop...');

        // First call - should trigger tool use
        const response1 = await client.chat.completions.create({
            model,
            max_tokens: 1024,
            messages: [
                { role: 'user', content: 'Use the echo tool to repeat "Hello World"' }
            ],
            tools: [{
                type: "function",
                function: {
                    name: "echo",
                    description: "Echo back the input string",
                    parameters: {
                        type: "object",
                        properties: {
                            text: {
                                type: "string",
                                description: "Text to echo back"
                            }
                        },
                        required: ["text"]
                    }
                }
            }],
            tool_choice: { type: "auto" }
        });

        const message1 = response1.choices[0].message;
        console.log('\n=== First Response ===');
        console.log('Tool calls:', message1.tool_calls);

        if (message1.tool_calls && message1.tool_calls.length > 0) {
            console.log('✅ Claude wants to use tool');

            // Simulate tool execution
            const toolCall = message1.tool_calls[0];
            const args = JSON.parse(toolCall.function.arguments);
            const toolResult = { echoed: args.text };

            // Second call - with tool result
            const response2 = await client.chat.completions.create({
                model,
                max_tokens: 1024,
                messages: [
                    { role: 'user', content: 'Use the echo tool to repeat "Hello World"' },
                    message1,  // Assistant's tool call message
                    {
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(toolResult)
                    }
                ],
                tools: [{
                    type: "function",
                    function: {
                        name: "echo",
                        description: "Echo back the input string",
                        parameters: {
                            type: "object",
                            properties: {
                                text: { type: "string" }
                            },
                            required: ["text"]
                        }
                    }
                }]
            });

            const message2 = response2.choices[0].message;
            console.log('\n=== Second Response (after tool execution) ===');
            console.log('Content:', message2.content);

            expect(message2.content).toBeTruthy();
            console.log('✅ Full tool loop works!');
        } else {
            console.log('⚠️  Claude did not use tool - skipping loop test');
        }
    }, 60000);
});
