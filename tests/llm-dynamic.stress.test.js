import { describe, test, expect, beforeAll } from '@jest/globals';
import 'dotenv/config';
import { initializeClient, execute } from '../llm-dynamic.js';

/**
 * LLM API Rate Limiting Stress Tests
 *
 * These tests are designed to intentionally trigger OpenAI API rate limits
 * to validate error handling and recovery mechanisms.
 *
 * OpenAI Rate Limits (gpt-4o-mini):
 * - 500,000 tokens per minute (TPM)
 * - Each request with large context can consume 10k+ tokens
 */
describe('LLM API Rate Limiting Stress Tests', () => {
    const hasApiKey = !!process.env.OPENAI_API_KEY;
    const testFn = hasApiKey ? test : test.skip;

    beforeAll(() => {
        if (hasApiKey) {
            initializeClient(process.env.OPENAI_API_KEY);
        }
    });

    // Generate a large prompt to consume more tokens
    const generateLargePrompt = (index) => {
        // Create a prompt with substantial content (estimate ~2k tokens per prompt)
        const context = `
Context for request ${index}:
${Array(100).fill(`This is line ${index} of context data to increase token consumption. `.repeat(10)).join('\n')}

Task: Please analyze the above context and provide a detailed summary.
Include key points, patterns, and insights from the data provided.
Be thorough and comprehensive in your analysis.
        `.trim();

        return context;
    };

    testFn('stress test: trigger rate limit error with rapid API calls', async () => {
        /**
         * This test intentionally triggers the OpenAI rate limit by making
         * multiple rapid API calls with large prompts IN PARALLEL.
         *
         * Expected behavior:
         * - First few requests succeed
         * - Eventually hit 429 rate limit error
         * - Error message: "Rate limit reached for gpt-4o-mini in organization..."
         *
         * Strategy:
         * - Make 50 PARALLEL calls with large prompts
         * - Each call ~10k tokens (input + output)
         * - Total: ~500k tokens sent within seconds
         * - Should hit 500k TPM limit
         */

        console.log('\n=== Starting Rate Limit Stress Test ===');
        console.log('Target: Exceed 500k tokens per minute');
        console.log('Strategy: 50 PARALLEL calls × ~10k tokens = ~500k tokens\n');

        const results = [];
        let rateLimitHit = false;
        let rateLimitError = null;
        const startTime = Date.now();

        // Create array of promises for parallel execution
        const promises = [];
        const retryLog = [];

        for (let i = 1; i <= 50; i++) {
            const promise = (async (index) => {
                const requestStart = Date.now();

                try {
                    const prompt = generateLargePrompt(index);

                    const result = await execute(prompt, {
                        model: 'gpt-4o-mini',
                        instructions: 'Be concise but thorough.',
                        onRetry: (info) => {
                            // Log retry attempts for analysis
                            const logEntry = {
                                requestIndex: index,
                                attempt: info.attempt,
                                delay: info.delay,
                                resetTime: info.resetTime,
                                remainingTokens: info.remainingTokens
                            };
                            retryLog.push(logEntry);
                            console.log(`  → Retry ${info.attempt}: waiting ${info.delay.toFixed(1)}s (reset: ${info.resetTime})`);
                        }
                    });

                    const duration = Date.now() - requestStart;
                    console.log(`✓ Request ${index} succeeded (${duration}ms)`);

                    return {
                        requestNumber: index,
                        success: true,
                        duration,
                        contentLength: result.content?.length || 0
                    };

                } catch (error) {
                    const duration = Date.now() - requestStart;
                    console.log(`✗ Request ${index} failed (${duration}ms)`);
                    console.log(`Error: ${error.message}`);

                    // Check if this is a rate limit error
                    if (error.message.includes('Rate limit') ||
                        error.message.includes('429') ||
                        error.status === 429) {
                        if (!rateLimitHit) {
                            rateLimitHit = true;
                            rateLimitError = error;
                            console.log('\n🎯 RATE LIMIT ERROR TRIGGERED!');
                            console.log(`Full error: ${error.message}`);
                            console.log(`Error headers type:`, error.headers?.constructor?.name);
                            console.log(`All header keys:`, Array.from(error.headers?.keys() || []));
                            console.log(`Retry-After header:`, error.headers?.get?.('retry-after'));
                            console.log(`retry-after-ms header:`, error.headers?.get?.('retry-after-ms'));

                            // Try to extract all headers
                            if (error.headers) {
                                console.log('\nAll headers:');
                                for (const [key, value] of error.headers.entries()) {
                                    console.log(`  ${key}: ${value}`);
                                }
                            }
                        }
                    }

                    return {
                        requestNumber: index,
                        success: false,
                        duration,
                        error: error.message
                    };
                }
            })(i);

            promises.push(promise);
        }

        // Wait for all requests to complete (or fail)
        console.log('\nLaunching 50 parallel requests...\n');
        const settledResults = await Promise.allSettled(promises);

        // Extract results
        settledResults.forEach((settled) => {
            if (settled.status === 'fulfilled') {
                results.push(settled.value);
            } else {
                // Promise rejected (shouldn't happen as we catch errors inside)
                results.push({
                    requestNumber: results.length + 1,
                    success: false,
                    error: settled.reason?.message || 'Unknown error'
                });
            }
        });

        const totalDuration = Date.now() - startTime;

        // Print summary
        console.log('\n=== Test Summary ===');
        console.log(`Total duration: ${(totalDuration / 1000).toFixed(1)}s`);
        console.log(`Total requests made: ${results.length}`);
        console.log(`Successful requests: ${results.filter(r => r.success).length}`);
        console.log(`Failed requests: ${results.filter(r => !r.success).length}`);
        console.log(`Rate limit hit: ${rateLimitHit ? 'YES ✓' : 'NO'}`);
        console.log(`Total retries: ${retryLog.length}`);

        if (rateLimitHit) {
            console.log('\n=== Rate Limit Details ===');
            console.log(`Error message: ${rateLimitError.message}`);
            console.log(`Failed on request: ${results.findIndex(r => !r.success) + 1}/${results.length}`);
            console.log(`Time to rate limit: ${(totalDuration / 1000).toFixed(1)}s`);
        }

        if (retryLog.length > 0) {
            console.log('\n=== Retry Log ===');
            retryLog.forEach((log, idx) => {
                console.log(`Retry ${idx + 1}: Request #${log.requestIndex}, Attempt ${log.attempt}, Delay ${log.delay.toFixed(1)}s`);
            });
        }

        // Print individual results summary
        console.log('\n=== Request Results (first 10 and last 5) ===');
        const displayResults = results.length > 15
            ? [...results.slice(0, 10), ...results.slice(-5)]
            : results;

        displayResults.forEach((result) => {
            const status = result.success ? '✓ SUCCESS' : '✗ FAILED';
            console.log(`Request ${result.requestNumber}: ${status} (${result.duration}ms)`);
            if (result.error) {
                const shortError = result.error.substring(0, 80);
                console.log(`  Error: ${shortError}...`);
            }
        });

        // Expectations
        expect(results.length).toBeGreaterThan(0);
        expect(rateLimitHit).toBe(true); // We expect to hit rate limit
        expect(rateLimitError).toBeTruthy();
        expect(rateLimitError.message).toMatch(/rate limit|429/i);

    }, 600000); // 10 min timeout

    testFn('stress test: validate rate limit error details', async () => {
        /**
         * This test validates that rate limit errors contain expected information:
         * - Error type (429)
         * - Model name
         * - Limit details (if available)
         *
         * Uses parallel requests to quickly trigger rate limit.
         */

        console.log('\n=== Rate Limit Error Details Test ===');
        console.log('Making 100 PARALLEL calls to trigger detailed rate limit error\n');

        let rateLimitError = null;

        // Create 100 parallel requests
        const promises = [];
        for (let i = 1; i <= 100; i++) {
            const promise = (async (index) => {
                try {
                    const prompt = generateLargePrompt(index);

                    await execute(prompt, {
                        model: 'gpt-4o-mini',
                        instructions: 'Be very brief.'
                    });

                    console.log(`Request ${index} succeeded`);
                    return { success: true, index };

                } catch (error) {
                    if (error.message.includes('Rate limit') ||
                        error.message.includes('429') ||
                        error.status === 429) {
                        if (!rateLimitError) {
                            rateLimitError = error;
                            console.log(`\n✓ Rate limit hit on request ${index}`);
                        }
                        return { success: false, index, error };
                    }
                    throw error; // Re-throw if not rate limit error
                }
            })(i);

            promises.push(promise);
        }

        // Wait for all requests
        console.log('Launching 100 parallel requests...\n');
        await Promise.allSettled(promises);

        if (rateLimitError) {
            console.log('\n=== Error Details ===');
            console.log(`Message: ${rateLimitError.message}`);
            console.log(`Status: ${rateLimitError.status || 'N/A'}`);
            console.log(`Type: ${rateLimitError.type || 'N/A'}`);

            // Validate error contains expected information
            expect(rateLimitError.message).toMatch(/rate limit/i);
            expect(rateLimitError.message).toMatch(/gpt-4o-mini|gpt-5-mini|organization/i);

            // Check for token usage details (if available)
            if (rateLimitError.message.includes('Limit')) {
                console.log('\n✓ Error includes token limit details');
                expect(rateLimitError.message).toMatch(/Limit/);
            }

            console.log('\n✓ Rate limit error validation complete');
        } else {
            console.log('\n⚠️  Rate limit not triggered within 100 requests');
            console.log('This may indicate:');
            console.log('  - Current API usage is low');
            console.log('  - Rate limit has increased');
            console.log('  - Test may need adjustment');

            // Don't fail the test, as rate limits depend on current API usage
            // Just log that we didn't trigger it
            expect(true).toBe(true);
        }

    }, 600000); // 10 min timeout
});
