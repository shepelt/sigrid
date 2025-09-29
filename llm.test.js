import { jest, describe, test, expect, afterEach } from '@jest/globals';
import {
    initializeClient,
    getClient,
    execute,
    extractToolCalls,
    extractText
} from './llm.js';

describe('LLM Module', () => {
    const testApiKey = 'test-api-key-12345';

    afterEach(() => {
        // Tests should not have side effects on each other
        // If we add a resetClient function, call it here
    });

    describe('Client Initialization', () => {
        test('initializeClient should accept API key', () => {
            expect(() => initializeClient(testApiKey)).not.toThrow();
        });

        test('initializeClient should throw error without API key', () => {
            expect(() => initializeClient()).toThrow('OpenAI API key is required');
            expect(() => initializeClient(null)).toThrow('OpenAI API key is required');
            expect(() => initializeClient('')).toThrow('OpenAI API key is required');
        });

        test('getClient should return initialized client', () => {
            initializeClient(testApiKey);
            const client = getClient();
            expect(client).toBeDefined();
            expect(client).toHaveProperty('responses');
        });

        test('getClient should throw error if client not initialized', () => {
            // This test needs a way to reset the client
            // For now, we'll skip or implement resetClient function
        });
    });

    describe('Execute Function Signature', () => {
        test('execute should be a function', () => {
            expect(execute).toBeDefined();
            expect(typeof execute).toBe('function');
        });

        test('execute should be async', () => {
            // Check if it returns a Promise
            const result = execute('test', { client: { responses: { create: jest.fn() } } });
            expect(result).toBeInstanceOf(Promise);
            // Clean up the promise to avoid unhandled rejection
            result.catch(() => {});
        });
    });

    describe('Helper Functions', () => {
        describe('extractToolCalls', () => {
            test('should extract function calls from response output', () => {
                const mockResponse = {
                    output: [
                        {
                            type: 'function_call',
                            name: 'read_file',
                            call_id: 'call_123',
                            arguments: '{"filepath": "test.txt"}'
                        }
                    ]
                };

                const calls = extractToolCalls(mockResponse);
                expect(calls).toHaveLength(1);
                expect(calls[0]).toEqual({
                    id: 'call_123',
                    name: 'read_file',
                    arguments: '{"filepath": "test.txt"}'
                });
            });

            test('should extract tool calls from nested content', () => {
                const mockResponse = {
                    output: [
                        {
                            type: 'message',
                            content: [
                                {
                                    type: 'tool_call',
                                    name: 'list_dir',
                                    id: 'call_456',
                                    arguments: '{"dir": "."}'
                                }
                            ]
                        }
                    ]
                };

                const calls = extractToolCalls(mockResponse);
                expect(calls).toHaveLength(1);
                expect(calls[0]).toEqual({
                    id: 'call_456',
                    name: 'list_dir',
                    arguments: '{"dir": "."}'
                });
            });

            test('should return empty array if no tool calls', () => {
                const mockResponse = {
                    output: [
                        {
                            type: 'message',
                            content: [
                                { type: 'text', text: 'Hello' }
                            ]
                        }
                    ]
                };

                const calls = extractToolCalls(mockResponse);
                expect(calls).toEqual([]);
            });

            test('should handle empty output', () => {
                const mockResponse = { output: [] };
                const calls = extractToolCalls(mockResponse);
                expect(calls).toEqual([]);
            });

            test('should handle undefined output', () => {
                const mockResponse = {};
                const calls = extractToolCalls(mockResponse);
                expect(calls).toEqual([]);
            });
        });

        describe('extractText', () => {
            test('should extract output_text from response', () => {
                const mockResponse = {
                    output: [
                        {
                            type: 'message',
                            content: [
                                {
                                    type: 'output_text',
                                    text: 'Hello, world!'
                                }
                            ]
                        }
                    ]
                };

                const text = extractText(mockResponse);
                expect(text).toBe('Hello, world!');
            });

            test('should concatenate multiple text outputs', () => {
                const mockResponse = {
                    output: [
                        {
                            type: 'message',
                            content: [
                                { type: 'output_text', text: 'Hello' },
                                { type: 'output_text', text: ' world' }
                            ]
                        }
                    ]
                };

                const text = extractText(mockResponse);
                expect(text).toBe('Hello world');
            });

            test('should return empty string if no text', () => {
                const mockResponse = {
                    output: [
                        {
                            type: 'message',
                            content: [
                                { type: 'tool_call', name: 'test' }
                            ]
                        }
                    ]
                };

                const text = extractText(mockResponse);
                expect(text).toBe('');
            });

            test('should trim whitespace', () => {
                const mockResponse = {
                    output: [
                        {
                            type: 'message',
                            content: [
                                { type: 'output_text', text: '  Hello  ' }
                            ]
                        }
                    ]
                };

                const text = extractText(mockResponse);
                expect(text).toBe('Hello');
            });

            test('should handle empty output', () => {
                const mockResponse = { output: [] };
                const text = extractText(mockResponse);
                expect(text).toBe('');
            });
        });
    });
});
