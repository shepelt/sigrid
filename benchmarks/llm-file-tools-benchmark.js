/**
 * LLM Benchmark: File Tools Token Usage with Real API Calls
 *
 * Compares actual token usage between:
 * - Static mode with megawriter (full file rewrites)
 * - Dynamic mode with file tools (read_file + edit_file)
 *
 * Requires: OPENAI_API_KEY or (LLM_GATEWAY_URL + LLM_GATEWAY_API_KEY)
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createWorkspace, initializeClient } from '../index.js';
import { clearFileReadTracking, fileTools } from '../filetooling.js';

// Check for API key
const hasApiKey = !!process.env.OPENAI_API_KEY ||
    !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);

if (!hasApiKey) {
    console.error('Error: No API key found.');
    console.error('Set OPENAI_API_KEY or (LLM_GATEWAY_URL + LLM_GATEWAY_API_KEY)');
    process.exit(1);
}

// Initialize client (single unified initialization)
const baseURL = process.env.LLM_GATEWAY_URL;
const apiKey = baseURL ? process.env.LLM_GATEWAY_API_KEY : process.env.OPENAI_API_KEY;
const model = process.env.LLM_MODEL || 'anthropic/claude-haiku-4-5-20251001';

if (baseURL) {
    console.log(`Using gateway: ${baseURL}`);
    initializeClient({ apiKey, baseURL });
} else {
    console.log('Using OpenAI API');
    initializeClient(apiKey);
}
console.log(`Model: ${model}\n`);

// Sample code file for testing
const SAMPLE_CODE = `// Calculator module
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

export function add(a, b) {
    return a + b;
}

export function subtract(a, b) {
    return a - b;
}

export function multiply(a, b) {
    return a * b;
}

export function divide(a, b) {
    if (b === 0) throw new Error('Cannot divide by zero');
    return a / b;
}
`;

// Edit prompts for benchmark
const EDIT_PROMPTS = [
    {
        name: 'Simple fix',
        prompt: 'In calculator.js, change the error message in the divide method from "Division by zero" to "Cannot divide by zero".',
    },
    {
        name: 'Add method',
        prompt: 'In calculator.js, add a new method called "power(n)" to the Calculator class that raises the result to the power of n and records it in history.',
    },
    {
        name: 'Rename variable',
        prompt: 'In calculator.js, rename all occurrences of "this.history" to "this.operations".',
    },
];

async function runBenchmark() {
    console.log('='.repeat(70));
    console.log('LLM FILE TOOLS BENCHMARK - Real API Calls');
    console.log('='.repeat(70));
    console.log();

    const results = [];

    for (const editTask of EDIT_PROMPTS) {
        console.log('-'.repeat(70));
        console.log(`Task: ${editTask.name}`);
        console.log(`Prompt: ${editTask.prompt}`);
        console.log();

        // === MEGAWRITER MODE (full file rewrite via XML) ===
        console.log('Running MEGAWRITER MODE (full file rewrite)...');

        // Create fresh workspace
        const megawriterWorkspace = await createWorkspace();
        await fs.writeFile(path.join(megawriterWorkspace.path, 'calculator.js'), SAMPLE_CODE);

        const staticStart = performance.now();
        let staticResult;
        try {
            staticResult = await megawriterWorkspace.execute(editTask.prompt, {
                mode: 'static',
                model,
                max_tokens: 4096,
                enableMegawriter: true,
                instruction: 'You are a code editor. Make the requested changes to the file.',
            });
        } catch (error) {
            console.error('Megawriter mode error:', error.message);
            staticResult = { tokenCount: { totalTokens: 0, error: true } };
        }
        const staticTime = performance.now() - staticStart;

        // === FILE TOOLS MODE (read_file + edit_file via tool calls) ===
        console.log('Running FILE TOOLS MODE (read_file + edit_file)...');

        // Create fresh workspace
        const toolsWorkspace = await createWorkspace();
        await fs.writeFile(path.join(toolsWorkspace.path, 'calculator.js'), SAMPLE_CODE);
        clearFileReadTracking();

        const dynamicStart = performance.now();
        let dynamicResult;
        try {
            // Use static mode with enableWriteFileTool (enables file tools including edit_file)
            dynamicResult = await toolsWorkspace.execute(editTask.prompt, {
                mode: 'static',
                model,
                max_tokens: 4096,
                enableWriteFileTool: true,
                tool_choice: { type: 'auto' },
                instruction: 'You are a code editor. First use read_file to view the file, then use edit_file to make targeted changes. Do not rewrite the entire file - use edit_file with old_string/new_string.',
            });
        } catch (error) {
            console.error('File tools mode error:', error.message);
            dynamicResult = { tokenCount: { totalTokens: 0, error: true } };
        }
        const dynamicTime = performance.now() - dynamicStart;

        // Extract token counts
        const staticTokens = staticResult.tokenCount?.totalTokens || 0;
        const dynamicTokens = dynamicResult.tokenCount?.totalTokens || 0;
        const savings = staticTokens > 0 ? ((staticTokens - dynamicTokens) / staticTokens * 100).toFixed(1) : 'N/A';

        console.log();
        console.log('Results:');
        console.log(`  Static (megawriter):  ${staticTokens} tokens, ${staticTime.toFixed(0)}ms`);
        console.log(`  Dynamic (edit_file):  ${dynamicTokens} tokens, ${dynamicTime.toFixed(0)}ms`);
        console.log(`  Token savings:        ${savings}%`);

        results.push({
            task: editTask.name,
            staticTokens,
            dynamicTokens,
            staticTime,
            dynamicTime,
            savings,
        });

        // Cleanup
        await megawriterWorkspace.delete();
        await toolsWorkspace.delete();
    }

    // Summary
    console.log();
    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log();

    console.log('| Task              | Static Tokens | Dynamic Tokens | Savings |');
    console.log('|-------------------|---------------|----------------|---------|');
    for (const r of results) {
        console.log(`| ${r.task.padEnd(17)} | ${String(r.staticTokens).padStart(13)} | ${String(r.dynamicTokens).padStart(14)} | ${String(r.savings + '%').padStart(7)} |`);
    }
    console.log();

    const totalStatic = results.reduce((sum, r) => sum + r.staticTokens, 0);
    const totalDynamic = results.reduce((sum, r) => sum + r.dynamicTokens, 0);
    const totalSavings = totalStatic > 0 ? ((totalStatic - totalDynamic) / totalStatic * 100).toFixed(1) : 'N/A';

    console.log(`Total Static:  ${totalStatic} tokens`);
    console.log(`Total Dynamic: ${totalDynamic} tokens`);
    console.log(`Total Savings: ${totalSavings}%`);
    console.log();
    console.log('='.repeat(70));
    console.log('BENCHMARK COMPLETE');
    console.log('='.repeat(70));
}

runBenchmark().catch(error => {
    console.error('Benchmark failed:', error);
    process.exit(1);
});
