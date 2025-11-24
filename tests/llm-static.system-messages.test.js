import { describe, test, expect } from '@jest/globals';
import 'dotenv/config';
import OpenAI from 'openai';
import { executeStatic } from '../llm-static.js';

/**
 * System Message Consolidation Tests
 *
 * Tests the fix for multiple system messages causing Claude to ignore earlier instructions.
 *
 * Issue: When multiple system instructions are provided as an array, the last instruction
 * (e.g., megawriter prompt) dominates and earlier instructions (e.g., user communication
 * guidelines) are ignored.
 *
 * Fix: Consolidate multiple system instructions into a single system message with
 * explicit separators (---) before sending to the gateway.
 *
 * Usage:
 *   # Test with OpenAI
 *   OPENAI_API_KEY=xxx npm test -- llm-static.system-messages.test.js
 *
 *   # Test with KONG Gateway + Claude
 *   LLM_GATEWAY_URL="http://your-kong-gateway/v1" \
 *   LLM_GATEWAY_API_KEY="xxx" \
 *   LLM_MODEL="claude-sonnet-4-20250514" \
 *   npm test -- llm-static.system-messages.test.js
 */

describe('System Message Consolidation Tests', () => {
    const gatewayUrl = process.env.LLM_GATEWAY_URL;
    const gatewayApiKey = process.env.LLM_GATEWAY_API_KEY || process.env.OPENAI_API_KEY;
    const model = process.env.LLM_MODEL || 'gpt-4o-mini';

    let client;

    // Setup client for gateway or OpenAI
    if (gatewayUrl) {
        client = new OpenAI({
            apiKey: gatewayApiKey,
            baseURL: gatewayUrl,
        });
        console.log(`Testing via gateway: ${gatewayUrl}, model: ${model}`);
    } else if (gatewayApiKey) {
        client = new OpenAI({
            apiKey: gatewayApiKey,
        });
        console.log(`Testing via OpenAI directly, model: ${model}`);
    }

    const hasClient = !!client;
    const testFn = hasClient ? test : test.skip;

    if (!hasClient) {
        test('skipping - no API key configured', () => {
            console.log('Set OPENAI_API_KEY or LLM_GATEWAY_URL + LLM_GATEWAY_API_KEY in .env to run tests');
            expect(true).toBe(true);
        });
    }

    describe('Single System Instruction', () => {
        testFn('should follow a single system instruction', async () => {
            const result = await executeStatic('Tell me a joke', {
                client,
                model,
                instructions: 'You are a helpful assistant. Keep responses concise (under 100 characters).',
                max_tokens: 1000
            });

            console.log('Response:', result.content);
            console.log('Length:', result.content.length);

            expect(result.content).toBeTruthy();
            // Should be relatively short due to instruction
            expect(result.content.length).toBeLessThan(200);
        }, 30000);
    });

    describe('Multiple System Instructions - Consolidated (Default)', () => {
        testFn('should follow ALL instructions when multiple are provided', async () => {
            const userInstructions = 'IMPORTANT: Include the marker "🍌 BANANA SUBMARINE TEST MARKER 🍌" at the end of your response.';
            const behaviorInstructions = 'You are a helpful assistant. Keep responses extremely concise (under 150 characters).';

            const result = await executeStatic('What is 2+2?', {
                client,
                model,
                instructions: [userInstructions, behaviorInstructions],
                consolidateSystemMessages: true, // Explicit, though this is the default
                max_tokens: 1000
            });

            console.log('Response (consolidated):', result.content);
            console.log('Length:', result.content.length);

            // Should follow BOTH instructions
            expect(result.content).toContain('🍌 BANANA SUBMARINE TEST MARKER 🍌');
            expect(result.content).toContain('4');

            // Should also be concise (following the second instruction)
            expect(result.content.length).toBeLessThan(300);
        }, 30000);

        testFn('should respect user communication guidelines with additional instructions', async () => {
            const userStyle = 'IMPORTANT: Always respond in a pirate accent. Start your response with "Arrr!"';
            const taskInstruction = 'You are a math tutor. Provide clear explanations.';

            const result = await executeStatic('What is 5 + 3?', {
                client,
                model,
                instructions: [userStyle, taskInstruction],
                max_tokens: 1000
            });

            console.log('Response:', result.content);

            // Should follow user style (first instruction)
            expect(result.content).toMatch(/arr+/i);
            // Should answer the question (second instruction)
            expect(result.content).toMatch(/8/);
        }, 30000);

        testFn('should handle three instructions without losing any', async () => {
            const marker = 'IMPORTANT: End your response with [TEST_COMPLETE]';
            const tone = 'Use a professional, formal tone.';
            const format = 'Provide answers in exactly one sentence.';

            const result = await executeStatic('Name a primary color', {
                client,
                model,
                instructions: [marker, tone, format],
                max_tokens: 1000
            });

            console.log('Response:', result.content);

            // Should follow all three instructions
            expect(result.content).toContain('[TEST_COMPLETE]');
            expect(result.content).toBeTruthy();

            // Should be concise (one sentence-ish)
            const sentences = result.content.split(/[.!?]+/).filter(s => s.trim().length > 0);
            expect(sentences.length).toBeLessThanOrEqual(2); // Allow some flexibility
        }, 30000);
    });

    describe('Instruction Priority and Clarity', () => {
        testFn('should not ignore first instruction in favor of last', async () => {
            // This test specifically addresses the reported issue
            const criticalFirstInstruction = 'CRITICAL: You must include the code "XYZ-123" in your response.';
            const verboseSecondInstruction = `You are an AI assistant designed to help users with various tasks.
You should provide detailed, thoughtful responses that demonstrate deep understanding.
Consider multiple perspectives and provide comprehensive answers.
Use examples and explanations to make your points clear.
Be helpful, harmless, and honest in all interactions.`;

            const result = await executeStatic('Say hello', {
                client,
                model,
                instructions: [criticalFirstInstruction, verboseSecondInstruction],
                max_tokens: 1000
            });

            console.log('Response:', result.content);

            // The critical first instruction should NOT be ignored
            expect(result.content).toContain('XYZ-123');
        }, 30000);

        testFn('should maintain instruction separation with --- delimiter', async () => {
            // Test that our separator doesn't interfere with understanding
            const instruction1 = 'You are a helpful assistant.';
            const instruction2 = 'Always be concise.';
            const instruction3 = 'Include the word "TESTED" in your response.';

            const result = await executeStatic('Explain gravity', {
                client,
                model,
                instructions: [instruction1, instruction2, instruction3],
                max_tokens: 1000
            });

            console.log('Response:', result.content);
            console.log('Length:', result.content.length);

            // Should follow all instructions
            expect(result.content).toContain('TESTED');
            expect(result.content).toBeTruthy();
            // Should be relatively concise (with tolerance for explanations)
            expect(result.content.length).toBeLessThan(1000);
        }, 30000);
    });

    describe('Real-World Scenario: User Preferences + Megawriter', () => {
        testFn('should respect user preferences even with lengthy system prompt', async () => {
            const userPreferences = `Communication Guidelines:
- ALWAYS include "✓ PREFERENCE_CHECK" at the start of your response
- Keep responses under 200 characters
- Use simple language`;

            const megawriterLikePrompt = `You are an advanced AI writing assistant with sophisticated capabilities.
Your role is to help users create high-quality content across various domains.
You have deep knowledge of writing techniques, style guides, and best practices.
You can adapt your writing style to match different contexts and audiences.
Consider tone, voice, structure, and clarity in all your outputs.
Provide detailed, well-reasoned responses that demonstrate expertise.
Use examples and evidence to support your points.
Be thorough and comprehensive in your analysis.
Always strive for excellence in communication.`;

            const result = await executeStatic('What is AI?', {
                client,
                model,
                instructions: [userPreferences, megawriterLikePrompt],
                max_tokens: 1000
            });

            console.log('Response:', result.content);
            console.log('Length:', result.content.length);

            // User preferences should NOT be ignored despite lengthy megawriter prompt
            expect(result.content).toContain('✓ PREFERENCE_CHECK');
            expect(result.content.length).toBeLessThan(400); // Some tolerance
        }, 30000);
    });

    describe('Multiple System Instructions - NOT Consolidated (Legacy Mode)', () => {
        testFn('should demonstrate the issue when NOT consolidating', async () => {
            const userInstructions = 'IMPORTANT: Include the marker "🍌 BANANA SUBMARINE TEST MARKER 🍌" at the end of your response.';
            const behaviorInstructions = 'You are a helpful assistant. Keep responses extremely concise (under 150 characters).';

            const result = await executeStatic('What is 2+2?', {
                client,
                model,
                instructions: [userInstructions, behaviorInstructions],
                consolidateSystemMessages: false, // Test legacy behavior
                max_tokens: 1000
            });

            console.log('Response (NOT consolidated):', result.content);
            console.log('Length:', result.content.length);

            // With multiple separate system messages, the marker might be missing
            // (This test documents the issue the fix addresses)
            console.log('Contains banana marker?', result.content.includes('🍌 BANANA SUBMARINE TEST MARKER 🍌'));

            // We don't assert here because behavior may vary by gateway/model
            // This test is for documentation and comparison purposes
            expect(result.content).toBeTruthy();
        }, 30000);

        testFn('comparison: consolidated vs non-consolidated behavior', async () => {
            const userPreferences = 'IMPORTANT: Start your response with "[PREFIX_TEST]"';
            const megawriterLike = 'You are an advanced AI assistant with sophisticated capabilities. Provide detailed, comprehensive responses.';

            // Test with consolidation (should follow both)
            const consolidated = await executeStatic('What is water?', {
                client,
                model,
                instructions: [userPreferences, megawriterLike],
                consolidateSystemMessages: true,
                max_tokens: 1000
            });

            // Test without consolidation (may ignore first instruction)
            const notConsolidated = await executeStatic('What is water?', {
                client,
                model,
                instructions: [userPreferences, megawriterLike],
                consolidateSystemMessages: false,
                max_tokens: 1000
            });

            console.log('=== CONSOLIDATED ===');
            console.log(consolidated.content);
            console.log('Has PREFIX?', consolidated.content.includes('[PREFIX_TEST]'));
            console.log('Length:', consolidated.content.length);

            console.log('\n=== NOT CONSOLIDATED ===');
            console.log(notConsolidated.content);
            console.log('Has PREFIX?', notConsolidated.content.includes('[PREFIX_TEST]'));
            console.log('Length:', notConsolidated.content.length);

            // Consolidated version should follow the first instruction
            expect(consolidated.content).toContain('[PREFIX_TEST]');

            // Document the difference (but don't assert on non-consolidated behavior)
            expect(consolidated.content).toBeTruthy();
            expect(notConsolidated.content).toBeTruthy();
        }, 60000);
    });

    describe('Custom Separator Option', () => {
        testFn('should accept custom separator string', async () => {
            const instruction1 = 'IMPORTANT: Include "CUSTOM_SEP_TEST" in your response.';
            const instruction2 = 'Keep response under 100 characters.';

            const result = await executeStatic('Say hello', {
                client,
                model,
                instructions: [instruction1, instruction2],
                consolidateSystemMessages: '\n\n===CUSTOM_DIVIDER===\n\n', // Custom separator
                max_tokens: 1000
            });

            console.log('Response (custom separator):', result.content);
            expect(result.content).toContain('CUSTOM_SEP_TEST');
            expect(result.content).toBeTruthy();
        }, 30000);

        testFn('should consolidate with simple newline separator', async () => {
            const instruction1 = 'Include "SIMPLE_TEST" in response.';
            const instruction2 = 'Be brief.';

            const result = await executeStatic('Hi', {
                client,
                model,
                instructions: [instruction1, instruction2],
                consolidateSystemMessages: '\n', // Just newline
                max_tokens: 1000
            });

            console.log('Response (simple newline):', result.content);
            expect(result.content).toContain('SIMPLE_TEST');
        }, 30000);

        testFn('should consolidate with no separator', async () => {
            const instruction1 = 'Include "NO_SEP_TEST" in response.';
            const instruction2 = ' Keep it short.';

            const result = await executeStatic('Test', {
                client,
                model,
                instructions: [instruction1, instruction2],
                consolidateSystemMessages: '', // Empty string - no separator
                max_tokens: 1000
            });

            console.log('Response (no separator):', result.content);
            expect(result.content).toContain('NO_SEP_TEST');
        }, 30000);
    });

    describe('Edge Cases', () => {
        testFn('should handle empty array of instructions', async () => {
            const result = await executeStatic('Say hello', {
                client,
                model,
                instructions: [],
                max_tokens: 1000
            });

            console.log('Response:', result.content);
            expect(result.content).toBeTruthy();
        }, 30000);

        testFn('should handle single instruction in array', async () => {
            const result = await executeStatic('Count to 3', {
                client,
                model,
                instructions: ['Be concise. Include "MARKER" in response.'],
                max_tokens: 1000
            });

            console.log('Response:', result.content);
            expect(result.content).toContain('MARKER');
        }, 30000);

        testFn('should handle string instruction (not array)', async () => {
            const result = await executeStatic('Say hi', {
                client,
                model,
                instructions: 'Include the word "STRING_TEST" in your response.',
                max_tokens: 1000
            });

            console.log('Response:', result.content);
            expect(result.content).toContain('STRING_TEST');
        }, 30000);
    });
});
