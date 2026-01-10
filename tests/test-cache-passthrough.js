#!/usr/bin/env node
/**
 * Test script to verify prompt caching works through noosphererouter (Kong gateway)
 *
 * Tests:
 * 1. Whether cache_control markers are passed through to Anthropic
 * 2. Whether cache metrics are returned in the response
 * 3. Whether sigrid's executeStatic works with enablePromptCaching
 *
 * Usage:
 *   LLM_GATEWAY_URL=http://localhost:8000/anthropic LLM_GATEWAY_API_KEY=xxx node tests/test-cache-passthrough.js
 */

import 'dotenv/config';
import { initializeClient, executeStatic } from '../llm-static.js';

const gatewayUrl = process.env.LLM_GATEWAY_URL;
const apiKey = process.env.LLM_GATEWAY_API_KEY;
const model = process.env.LLM_MODEL || 'claude-sonnet-4-20250514';

if (!gatewayUrl || !apiKey) {
    console.error('Error: Set LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY');
    process.exit(1);
}

console.log(`Testing cache passthrough at: ${gatewayUrl}`);
console.log(`Model: ${model}\n`);

// Large system prompt to make caching worthwhile (needs to be ~4000+ tokens for reliable Anthropic caching)
const LARGE_SYSTEM_PROMPT = `You are a helpful coding assistant. Here are your detailed instructions:

${Array(500).fill('This is padding text to ensure the system prompt exceeds the minimum token threshold for Anthropic prompt caching. ').join('')}

Important rules:
1. Always be concise
2. Provide code examples when helpful
3. Explain your reasoning`;

// Large tool definitions to test tool caching (~8K+ tokens)
// Haiku 4.5 requires >5000 tokens for caching to kick in
// Each tool has verbose description and parameters to add token weight
const LARGE_TOOLS = Array(25).fill(null).map((_, i) => ({
    type: "function",
    function: {
        name: `tool_${i}_with_long_name_for_tokens`,
        description: `This is tool number ${i}. It performs a complex operation that requires detailed documentation. ` +
            `The tool accepts multiple parameters and returns structured data. ` +
            `Use this tool when you need to perform operation type ${i}. ` +
            `This description is intentionally verbose to add token weight for cache testing. ` +
            `Additional context: this tool is part of a comprehensive toolkit for testing prompt caching with tool definitions. ` +
            `The tool supports various input formats including JSON, XML, and plain text. ` +
            `It can process data synchronously or asynchronously depending on the configuration. ` +
            `Error handling is built-in with detailed error messages and stack traces. ` +
            `The tool integrates with external services and APIs for enhanced functionality.`,
        parameters: {
            type: "object",
            properties: {
                input_data: {
                    type: "string",
                    description: `The primary input data for tool ${i}. This should be a well-formatted string containing the necessary information for processing.`
                },
                options: {
                    type: "object",
                    description: `Configuration options for tool ${i}. These options control the behavior of the operation.`,
                    properties: {
                        verbose: { type: "boolean", description: "Enable verbose output mode" },
                        format: { type: "string", description: "Output format (json, text, xml)" },
                        max_results: { type: "number", description: "Maximum number of results to return" }
                    }
                },
                metadata: {
                    type: "object",
                    description: `Additional metadata for tool ${i} execution context.`,
                    properties: {
                        request_id: { type: "string", description: "Unique request identifier" },
                        timestamp: { type: "string", description: "ISO timestamp of the request" }
                    }
                }
            },
            required: ["input_data"]
        }
    }
}));

async function makeRequest(userMessage, requestNum) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Request #${requestNum}: "${userMessage}"`);
    console.log('='.repeat(60));

    // OpenAI SDK format with cache_control extension
    const payload = {
        model,
        max_tokens: 100,
        messages: [
            {
                role: 'system',
                content: LARGE_SYSTEM_PROMPT,
                // Anthropic cache control marker
                cache_control: { type: 'ephemeral' }
            },
            {
                role: 'user',
                content: userMessage
            }
        ]
    };

    console.log('\nRequest payload (system message truncated):');
    console.log(JSON.stringify({
        ...payload,
        messages: payload.messages.map(m => ({
            ...m,
            content: m.content.substring(0, 100) + '...'
        }))
    }, null, 2));

    const start = Date.now();

    try {
        const response = await fetch(`${gatewayUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        const latency = Date.now() - start;
        const data = await response.json();

        console.log(`\nResponse (${latency}ms):`);
        console.log(`Status: ${response.status}`);

        if (!response.ok) {
            console.log('Error:', JSON.stringify(data, null, 2));
            return null;
        }

        // Check for cache metrics in usage
        console.log('\nUsage:', JSON.stringify(data.usage, null, 2));

        // Check for cache metrics - different providers use different fields
        const anthropicCacheFields = ['cache_creation_input_tokens', 'cache_read_input_tokens'];
        const openaiCacheFields = ['cached_tokens'];

        const foundAnthropicFields = anthropicCacheFields.filter(f => data.usage?.[f] !== undefined);
        const openaiCachedTokens = data.usage?.prompt_tokens_details?.cached_tokens;

        if (foundAnthropicFields.length > 0) {
            console.log('\n✅ ANTHROPIC CACHE METRICS:', foundAnthropicFields);
        } else if (openaiCachedTokens !== undefined) {
            console.log(`\n✅ OPENAI CACHE METRICS: cached_tokens = ${openaiCachedTokens}`);
            if (openaiCachedTokens > 0) {
                console.log('   🎉 CACHE HIT!');
            }
        } else {
            console.log('\n❌ No cache metrics in response');
        }

        // Show full prompt_tokens_details if available
        if (data.usage?.prompt_tokens_details) {
            console.log('prompt_tokens_details:', JSON.stringify(data.usage.prompt_tokens_details, null, 2));
        }

        console.log('\nAssistant response:', data.choices?.[0]?.message?.content?.substring(0, 200));

        return data;
    } catch (error) {
        console.error('Request failed:', error.message);
        return null;
    }
}

async function testNativeAnthropicEndpoint(userMessage, requestNum) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Request #${requestNum} (Native Anthropic format): "${userMessage}"`);
    console.log('='.repeat(60));

    // Native Anthropic format
    const payload = {
        model,
        max_tokens: 100,
        system: [
            {
                type: 'text',
                text: LARGE_SYSTEM_PROMPT,
                cache_control: { type: 'ephemeral' }
            }
        ],
        messages: [
            {
                role: 'user',
                content: userMessage
            }
        ]
    };

    console.log('\nRequest payload (system truncated):');
    console.log(JSON.stringify({
        ...payload,
        system: [{ ...payload.system[0], text: payload.system[0].text.substring(0, 100) + '...' }]
    }, null, 2));

    const start = Date.now();

    // Try native Anthropic endpoint (usually /v1/messages)
    const nativeUrl = gatewayUrl.replace(/\/v1$/, '') + '/anthropic/v1/messages';
    console.log(`\nTrying native endpoint: ${nativeUrl}`);

    try {
        const response = await fetch(nativeUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(payload)
        });

        const latency = Date.now() - start;
        const data = await response.json();

        console.log(`\nResponse (${latency}ms):`);
        console.log(`Status: ${response.status}`);

        if (!response.ok) {
            console.log('Error:', JSON.stringify(data, null, 2));
            return null;
        }

        console.log('\nUsage:', JSON.stringify(data.usage, null, 2));

        const cacheFields = ['cache_creation_input_tokens', 'cache_read_input_tokens'];
        const foundCacheFields = cacheFields.filter(f => data.usage?.[f] !== undefined);

        if (foundCacheFields.length > 0) {
            console.log('\n✅ CACHE METRICS FOUND:', foundCacheFields);
        } else {
            console.log('\n❌ No cache metrics in response');
        }

        console.log('\nAssistant response:', data.content?.[0]?.text?.substring(0, 200));

        return data;
    } catch (error) {
        console.error('Request failed:', error.message);
        return null;
    }
}

async function main() {
    console.log('Testing prompt caching through gateway\n');
    console.log('System prompt length:', LARGE_SYSTEM_PROMPT.length, 'chars');

    // Test 1: OpenAI SDK format (what sigrid currently uses)
    console.log('\n' + '█'.repeat(60));
    console.log('TEST 1: OpenAI SDK format with cache_control');
    console.log('█'.repeat(60));

    const result1 = await makeRequest('What is 2+2?', 1);

    // Wait a moment, then make identical request to test cache hit
    if (result1) {
        console.log('\nWaiting 2s before second request...');
        await new Promise(r => setTimeout(r, 2000));
        await makeRequest('What is 3+3?', 2);
    }

    // Test 2: Native Anthropic format (if gateway supports it)
    console.log('\n' + '█'.repeat(60));
    console.log('TEST 2: Native Anthropic format');
    console.log('█'.repeat(60));

    const result3 = await testNativeAnthropicEndpoint('What is 4+4?', 3);

    if (result3) {
        console.log('\nWaiting 2s before second request...');
        await new Promise(r => setTimeout(r, 2000));
        await testNativeAnthropicEndpoint('What is 5+5?', 4);
    }

    // Test 3: Sigrid executeStatic with enablePromptCaching
    console.log('\n' + '█'.repeat(60));
    console.log('TEST 3: Sigrid executeStatic with enablePromptCaching');
    console.log('█'.repeat(60));

    await testSigridCaching();

    // Test 4: Tool caching
    console.log('\n' + '█'.repeat(60));
    console.log('TEST 4: Sigrid executeStatic with TOOL caching');
    console.log('█'.repeat(60));

    await testToolCaching();

    console.log('\n' + '█'.repeat(60));
    console.log('SUMMARY');
    console.log('█'.repeat(60));
    console.log(`
Next steps based on results:
- If cache metrics found in OpenAI format: Gateway passes through cache_control ✅
- If cache metrics only in native format: Need to use /v1/messages endpoint for Anthropic
- If no cache metrics: Gateway may be stripping cache_control or not configured for caching
`);
}

async function testSigridCaching() {
    // Initialize sigrid client with gateway
    initializeClient({
        apiKey,
        baseURL: gatewayUrl
    });

    // Test both Anthropic and OpenAI models
    const testModels = [
        { name: 'Anthropic', model: 'anthropic/claude-haiku-4-5-20251001' },
        { name: 'OpenAI', model: 'openai/gpt-4o-mini' }
    ];

    for (const { name, model: testModel } of testModels) {
        console.log(`\n--- Testing ${name} (${testModel}) ---\n`);

        let cacheHitCount = 0;

        for (let i = 1; i <= 3; i++) {
            console.log(`Request ${i}:`);
            const start = Date.now();

            try {
                const result = await executeStatic(`What is ${i}+${i}?`, {
                    model: testModel,
                    instructions: LARGE_SYSTEM_PROMPT,
                    enablePromptCaching: true,
                    max_tokens: 100
                });

                const latency = Date.now() - start;
                const tc = result.tokenCount || {};

                // Check for cache metrics based on provider
                if (name === 'Anthropic') {
                    const created = tc.cacheCreationInputTokens || 0;
                    const read = tc.cacheReadInputTokens || 0;
                    console.log(`  ${latency}ms | cache_create: ${created}, cache_read: ${read}`);
                    if (read > 0) {
                        console.log('  🎉 CACHE HIT!');
                        cacheHitCount++;
                    } else if (created > 0) {
                        console.log('  📝 Cache created');
                    }
                } else {
                    // OpenAI
                    const cached = tc.cachedTokens || 0;
                    console.log(`  ${latency}ms | cached_tokens: ${cached}, prompt_tokens: ${tc.promptTokens}`);
                    if (cached > 0) {
                        console.log('  🎉 CACHE HIT!');
                        cacheHitCount++;
                    }
                }
            } catch (error) {
                console.error(`  ❌ Failed: ${error.message}`);
            }

            if (i < 3) await new Promise(r => setTimeout(r, 2000));
        }

        // Summary for this provider
        if (cacheHitCount > 0) {
            console.log(`\n✅ ${name}: ${cacheHitCount}/2 cache hits (expected)`);
        } else {
            console.log(`\n⚠️ ${name}: No cache hits detected`);
        }
    }
}

async function testToolCaching() {
    // Initialize sigrid client with gateway
    initializeClient({
        apiKey,
        baseURL: gatewayUrl
    });

    // Estimate tool tokens
    const toolsJson = JSON.stringify(LARGE_TOOLS);
    const estimatedToolTokens = Math.ceil(toolsJson.length / 4); // rough estimate
    console.log(`\nTool definitions: ${LARGE_TOOLS.length} tools, ~${estimatedToolTokens} tokens (estimated)`);

    // Use small system prompt to isolate tool caching effect
    const SMALL_SYSTEM_PROMPT = 'You are a helpful assistant. Answer briefly.';

    // Test with Anthropic model (tool caching most relevant here)
    const testModel = 'anthropic/claude-haiku-4-5-20251001';
    console.log(`\n--- Testing Tool Caching with ${testModel} ---\n`);

    let cacheHitCount = 0;
    const results = [];

    for (let i = 1; i <= 3; i++) {
        console.log(`Request ${i}:`);
        const start = Date.now();

        try {
            const result = await executeStatic(`What is ${i * 10} + ${i * 10}? Answer with just the number.`, {
                model: testModel,
                instructions: SMALL_SYSTEM_PROMPT,
                tools: LARGE_TOOLS,
                // Don't actually call tools, just include them (Anthropic requires object format)
                enablePromptCaching: true,
                max_tokens: 50
            });

            const latency = Date.now() - start;
            const tc = result.tokenCount || {};

            const created = tc.cacheCreationInputTokens || 0;
            const read = tc.cacheReadInputTokens || 0;
            const promptTokens = tc.promptTokens || 0;

            results.push({ created, read, promptTokens, latency });

            console.log(`  ${latency}ms | prompt: ${promptTokens}, cache_create: ${created}, cache_read: ${read}`);

            if (read > 0) {
                console.log('  🎉 CACHE HIT!');
                cacheHitCount++;
            } else if (created > 0) {
                console.log('  📝 Cache created');
            }

            console.log(`  Response: ${result.content.trim()}`);
        } catch (error) {
            console.error(`  ❌ Failed: ${error.message}`);
        }

        if (i < 3) await new Promise(r => setTimeout(r, 2000));
    }

    // Analysis
    console.log('\n--- Tool Caching Analysis ---');

    if (results.length >= 2) {
        const firstCreated = results[0]?.created || 0;
        const secondRead = results[1]?.read || 0;

        if (firstCreated > 0 && secondRead > 0) {
            console.log(`✅ Tool caching working!`);
            console.log(`   First request cached ${firstCreated} tokens`);
            console.log(`   Second request read ${secondRead} tokens from cache`);

            // Calculate savings
            const savingsPercent = ((secondRead / (results[1]?.promptTokens + secondRead)) * 100).toFixed(1);
            console.log(`   Cache hit rate: ~${savingsPercent}% of input tokens`);
        } else if (firstCreated > 0) {
            console.log(`⚠️ Cache created but no cache hits on subsequent requests`);
            console.log(`   This may indicate tool cache_control is not being passed through`);
        } else {
            console.log(`❌ No cache metrics detected - caching may not be enabled`);
        }
    }

    if (cacheHitCount > 0) {
        console.log(`\n✅ Tool caching: ${cacheHitCount}/2 cache hits`);
    } else {
        console.log(`\n⚠️ Tool caching: No cache hits detected`);
    }
}

main().catch(console.error);
