/**
 * File Tools Iterative Scenario Test
 *
 * Tests the file tools mode with iterative edits to validate:
 * 1. Token count stays reasonable across iterations (not accumulating)
 * 2. Tool calls are efficient (read once, edit multiple times)
 * 3. Proper behavior vs snapshot mode baseline
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createWorkspace, initializeClient } from '../index.js';
import { clearFileReadTracking } from '../filetooling.js';

// Check for API key
const hasApiKey = !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);

if (!hasApiKey) {
    console.error('Error: No gateway config found.');
    console.error('Set LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY');
    process.exit(1);
}

// Initialize client
initializeClient({
    apiKey: process.env.LLM_GATEWAY_API_KEY,
    baseURL: process.env.LLM_GATEWAY_URL
});

const model = process.env.LLM_MODEL || 'anthropic/claude-haiku-4-5-20251001';
console.log(`Using gateway: ${process.env.LLM_GATEWAY_URL}`);
console.log(`Model: ${model}\n`);

// Test file (~50 lines)
const TEST_FILE = `// Calculator module with history tracking
export class Calculator {
    constructor() {
        this.result = 0;
        this.history = [];
    }

    add(n) {
        this.result += n;
        this.history.push({ op: 'add', value: n });
        return this;
    }

    subtract(n) {
        this.result -= n;
        this.history.push({ op: 'subtract', value: n });
        return this;
    }

    multiply(n) {
        this.result *= n;
        this.history.push({ op: 'multiply', value: n });
        return this;
    }

    divide(n) {
        if (n === 0) throw new Error('Division by zero');
        this.result /= n;
        this.history.push({ op: 'divide', value: n });
        return this;
    }

    getResult() {
        return this.result;
    }

    getHistory() {
        return [...this.history];
    }

    reset() {
        this.result = 0;
        this.history = [];
        return this;
    }
}
`;

// Iterative edit steps
const EDIT_STEPS = [
    {
        name: 'Step 1: Fix error message',
        prompt: 'In calculator.js, change the error message from "Division by zero" to "Cannot divide by zero"',
        verify: (content) => content.includes('Cannot divide by zero')
    },
    {
        name: 'Step 2: Add power method',
        prompt: 'In calculator.js, add a new method called "power(n)" that raises this.result to the power of n and records it in history',
        verify: (content) => content.includes('power(n)') && content.includes("'power'")
    },
    {
        name: 'Step 3: Rename history to operations',
        prompt: 'In calculator.js, rename all occurrences of "this.history" to "this.operations" and "getHistory" to "getOperations"',
        verify: (content) => content.includes('this.operations') && content.includes('getOperations')
    },
    {
        name: 'Step 4: Add clear method',
        prompt: 'In calculator.js, add a "clear()" method that sets result to 0 but keeps the operations history',
        verify: (content) => content.includes('clear()')
    }
];

async function runIterativeTest(mode, options, debug = false) {
    const workspace = await createWorkspace();
    await fs.writeFile(path.join(workspace.path, 'calculator.js'), TEST_FILE);

    // Debug: show what snapshot would be sent
    if (debug && options.enableFileTools) {
        const snapshot = await workspace._getFileListSnapshot();
        console.log('  DEBUG - File list snapshot:');
        console.log('  ' + snapshot.replace(/\n/g, '\n  '));
        console.log(`  DEBUG - Snapshot size: ${snapshot.length} chars (~${Math.ceil(snapshot.length/4)} tokens)`);

        // Get system prompt size
        const { getStaticContextWithFileToolsPrompt } = await import('../prompts.js');
        const sysPrompt = getStaticContextWithFileToolsPrompt();
        console.log(`  DEBUG - System prompt size: ${sysPrompt.length} chars (~${Math.ceil(sysPrompt.length/4)} tokens)`);

        // Get tool definitions size
        const { fileTools } = await import('../filetooling.js');
        const toolsJson = JSON.stringify(fileTools);
        console.log(`  DEBUG - Tool definitions size: ${toolsJson.length} chars (~${Math.ceil(toolsJson.length/4)} tokens)`);
        console.log();
    }

    const results = [];
    let conversationID = null;

    for (const step of EDIT_STEPS) {
        const toolCalls = [];
        const progressCallback = (event, data) => {
            if (event === 'TOOL_CALL_START' && data.tools) {
                toolCalls.push(...data.tools);
            }
        };

        clearFileReadTracking();
        const start = performance.now();

        try {
            const result = await workspace.execute(step.prompt, {
                mode: 'static',
                model,
                max_tokens: 4096,
                conversationID,
                ...options,
                progressCallback
            });

            conversationID = result.conversationID;
            const elapsed = performance.now() - start;
            const tokens = result.tokenCount?.totalTokens || 0;

            // Verify edit
            const content = await fs.readFile(path.join(workspace.path, 'calculator.js'), 'utf-8');
            const verified = step.verify(content);

            // Count LLM iterations (each tool call sequence = 1 iteration)
            const iterations = toolCalls.length > 0 ? Math.ceil(toolCalls.length / 2) + 1 : 1;

            results.push({
                step: step.name,
                tokens,
                time: elapsed,
                toolCalls: toolCalls.map(t => t.name),
                iterations,
                verified
            });

        } catch (error) {
            results.push({
                step: step.name,
                error: error.message,
                toolCalls: toolCalls.map(t => t.name)
            });
        }
    }

    await workspace.delete();
    return results;
}

async function runTest() {
    console.log('='.repeat(70));
    console.log('FILE TOOLS ITERATIVE SCENARIO TEST');
    console.log('='.repeat(70));
    console.log();
    console.log(`Test file: calculator.js (${TEST_FILE.split('\n').length} lines)`);
    console.log(`Steps: ${EDIT_STEPS.length} iterative edits`);
    console.log();

    // Test 1: File Tools Mode
    console.log('-'.repeat(70));
    console.log('MODE 1: FILE TOOLS (enableFileTools: true)');
    console.log('-'.repeat(70));

    const fileToolsResults = await runIterativeTest('filetools', {
        enableFileTools: true,
        tool_choice: { type: 'auto' }
    }, true);  // debug=true

    let fileToolsTotal = 0;
    for (const r of fileToolsResults) {
        if (r.error) {
            console.log(`  ${r.step}: ERROR - ${r.error}`);
        } else {
            console.log(`  ${r.step}:`);
            console.log(`    Tokens: ${r.tokens}, Time: ${(r.time/1000).toFixed(1)}s`);
            console.log(`    Tools: ${r.toolCalls.join(' -> ') || 'none'}`);
            console.log(`    Verified: ${r.verified ? '✓' : '✗'}`);
            fileToolsTotal += r.tokens;
        }
    }
    console.log(`  TOTAL: ${fileToolsTotal} tokens`);
    console.log();

    // Test 2: Hybrid Mode (snapshot + edit_file only)
    console.log('-'.repeat(70));
    console.log('MODE 2: HYBRID (snapshot + edit_file only)');
    console.log('-'.repeat(70));

    const hybridResults = await runIterativeTest('hybrid', {
        enableEditTool: true,
        tool_choice: { type: 'auto' }
    });

    let hybridTotal = 0;
    for (const r of hybridResults) {
        if (r.error) {
            console.log(`  ${r.step}: ERROR - ${r.error}`);
        } else {
            console.log(`  ${r.step}:`);
            console.log(`    Tokens: ${r.tokens}, Time: ${(r.time/1000).toFixed(1)}s`);
            console.log(`    Tools: ${r.toolCalls.join(' -> ') || 'none'}`);
            console.log(`    Verified: ${r.verified ? '✓' : '✗'}`);
            hybridTotal += r.tokens;
        }
    }
    console.log(`  TOTAL: ${hybridTotal} tokens`);
    console.log();

    // Test 3: Snapshot Mode (baseline)
    console.log('-'.repeat(70));
    console.log('MODE 3: SNAPSHOT (baseline, megawriter)');
    console.log('-'.repeat(70));

    const snapshotResults = await runIterativeTest('snapshot', {
        enableMegawriter: true
    });

    let snapshotTotal = 0;
    for (const r of snapshotResults) {
        if (r.error) {
            console.log(`  ${r.step}: ERROR - ${r.error}`);
        } else {
            console.log(`  ${r.step}:`);
            console.log(`    Tokens: ${r.tokens}, Time: ${(r.time/1000).toFixed(1)}s`);
            console.log(`    Tools: ${r.toolCalls.join(' -> ') || 'none'}`);
            console.log(`    Verified: ${r.verified ? '✓' : '✗'}`);
            snapshotTotal += r.tokens;
        }
    }
    console.log(`  TOTAL: ${snapshotTotal} tokens`);
    console.log();

    // Summary
    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log();
    console.log(`File Tools Total: ${fileToolsTotal} tokens`);
    console.log(`Hybrid Total:     ${hybridTotal} tokens`);
    console.log(`Snapshot Total:   ${snapshotTotal} tokens`);
    console.log();

    // Compare hybrid vs snapshot (should be lower)
    if (hybridTotal > 0 && snapshotTotal > 0) {
        const diff = snapshotTotal - hybridTotal;
        const pct = ((diff / snapshotTotal) * 100).toFixed(1);
        if (diff > 0) {
            console.log(`Hybrid vs Snapshot: ${diff} tokens saved (${pct}% reduction) ✓`);
        } else {
            console.log(`Hybrid vs Snapshot: ${-diff} tokens MORE (${-pct}% overhead)`);
        }
    }

    // Token growth analysis
    console.log();
    console.log('Token per Step (should stay flat):');
    console.log('  File Tools:', fileToolsResults.filter(r => !r.error).map(r => r.tokens).join(' -> '));
    console.log('  Hybrid:    ', hybridResults.filter(r => !r.error).map(r => r.tokens).join(' -> '));
    console.log('  Snapshot:  ', snapshotResults.filter(r => !r.error).map(r => r.tokens).join(' -> '));

    console.log();
    console.log('='.repeat(70));
    console.log('TEST COMPLETE');
    console.log('='.repeat(70));
}

runTest().catch(console.error);
