import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { initializeClient, getClient } from './llm-client.js';

describe('LLM Client', () => {
    // Store original env vars
    const originalGatewayUrl = process.env.LLM_GATEWAY_URL;
    const originalGatewayKey = process.env.LLM_GATEWAY_API_KEY;

    beforeEach(() => {
        // Reset env vars before each test
        delete process.env.LLM_GATEWAY_URL;
        delete process.env.LLM_GATEWAY_API_KEY;
    });

    afterAll(() => {
        // Restore original env vars
        if (originalGatewayUrl) process.env.LLM_GATEWAY_URL = originalGatewayUrl;
        if (originalGatewayKey) process.env.LLM_GATEWAY_API_KEY = originalGatewayKey;
    });

    test('should initialize with string API key (backward compatibility)', () => {
        expect(() => {
            initializeClient('test-api-key');
        }).not.toThrow();

        const client = getClient();
        expect(client).toBeDefined();
    });

    test('should initialize with options object', () => {
        expect(() => {
            initializeClient({
                apiKey: 'test-api-key',
                baseURL: 'http://localhost:3000/v1'
            });
        }).not.toThrow();

        const client = getClient();
        expect(client).toBeDefined();
    });

    test('should throw error if no API key provided', () => {
        expect(() => {
            initializeClient({});
        }).toThrow('OpenAI API key is required');
    });

    test('should auto-detect gateway URL from environment', () => {
        process.env.LLM_GATEWAY_URL = 'http://localhost:5000/v1';

        // Mock console.log to verify the message
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        initializeClient({ apiKey: 'test-key' });

        expect(consoleSpy).toHaveBeenCalledWith('Using LLM gateway: http://localhost:5000/v1');

        consoleSpy.mockRestore();
    });

    test('should not override explicitly provided baseURL', () => {
        process.env.LLM_GATEWAY_URL = 'http://localhost:5000/v1';

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

        initializeClient({
            apiKey: 'test-key',
            baseURL: 'http://custom:8000/v1'
        });

        // Should not log gateway message since baseURL was explicitly provided
        expect(consoleSpy).not.toHaveBeenCalled();

        consoleSpy.mockRestore();
    });
});
