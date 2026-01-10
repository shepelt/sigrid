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

main().catch(console.error);
