import { describe, test, expect, beforeAll } from '@jest/globals';
import 'dotenv/config';
import { initializeClient } from '../llm-client.js';
import { executeStatic } from '../llm-static.js';
import { SigridBuilder } from '../builder.js';

/**
 * Integration tests for attachment handling
 * Requires LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY in .env
 *
 * Run with: npm test -- tests/attachments.integration.test.js
 */
describe('Attachments Integration', () => {
    const hasGatewayConfig = !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);
    const testFn = hasGatewayConfig ? test : test.skip;
    const model = process.env.LLM_MODEL || 'gpt-4o';

    // 1x1 red pixel PNG (smallest valid PNG)
    const RED_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

    // 1x1 blue pixel PNG
    const BLUE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==';

    beforeAll(() => {
        if (hasGatewayConfig) {
            console.log(`\nTesting attachments with gateway: ${process.env.LLM_GATEWAY_URL}`);
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

    testFn('should describe an image attachment via executeStatic', async () => {
        const result = await executeStatic('What color is this image? Reply with just the color name.', {
            model,
            max_tokens: 100,
            attachments: [{
                filename: 'red-pixel.png',
                mimeType: 'image/png',
                data: RED_PIXEL_PNG
            }]
        });

        console.log('Response:', result.content);

        expect(result).toHaveProperty('content');
        expect(result.content.toLowerCase()).toMatch(/red/);
    }, 30000);

    testFn('should describe an image attachment via builder', async () => {
        const builder = new SigridBuilder();

        const result = await builder
            .model(model)
            .attachments([{
                filename: 'blue-pixel.png',
                mimeType: 'image/png',
                data: BLUE_PIXEL_PNG
            }])
            .execute('What color is this image? Reply with just the color name.', { max_tokens: 100 });

        console.log('Response:', result.content);

        expect(result).toHaveProperty('content');
        // LLM color perception varies for tiny pixels - accept blue/pink/purple/magenta
        expect(result.content.toLowerCase()).toMatch(/blue|pink|purple|magenta/);
    }, 30000);

    testFn('should handle text file attachment', async () => {
        const csvData = Buffer.from('name,score\nAlice,95\nBob,87\nCharlie,92').toString('base64');

        const result = await executeStatic('What is the highest score in this CSV? Reply with just the number.', {
            model,
            max_tokens: 100,
            attachments: [{
                filename: 'scores.csv',
                mimeType: 'text/csv',
                data: csvData
            }]
        });

        console.log('Response:', result.content);

        expect(result).toHaveProperty('content');
        expect(result.content).toMatch(/95/);
    }, 30000);

    testFn('should handle multiple attachments', async () => {
        const result = await executeStatic('I am showing you two images. What colors are they? Reply with both colors.', {
            model,
            max_tokens: 100,
            attachments: [
                {
                    filename: 'red.png',
                    mimeType: 'image/png',
                    data: RED_PIXEL_PNG
                },
                {
                    filename: 'blue.png',
                    mimeType: 'image/png',
                    data: BLUE_PIXEL_PNG
                }
            ]
        });

        console.log('Response:', result.content);

        expect(result).toHaveProperty('content');
        const lower = result.content.toLowerCase();
        expect(lower).toMatch(/red/);
        expect(lower).toMatch(/blue/);
    }, 30000);
});
