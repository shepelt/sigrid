/**
 * React Scaffold Benchmark
 *
 * Tests file tools vs snapshot mode on a real React project
 * Uses actual snapshot.js implementation which excludes node_modules, dist, etc.
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createWorkspace, initializeClient } from '../index.js';
import { clearFileReadTracking } from '../filetooling.js';
import { execSync } from 'node:child_process';

const hasApiKey = !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);
if (!hasApiKey) {
    console.error('Error: No gateway config found.');
    process.exit(1);
}

initializeClient({
    apiKey: process.env.LLM_GATEWAY_API_KEY,
    baseURL: process.env.LLM_GATEWAY_URL
});

const model = process.env.LLM_MODEL || 'anthropic/claude-haiku-4-5-20251001';
const scaffoldPath = path.join(import.meta.dirname, '..', 'test-fixtures', 'react-scaffold.tar.gz');

// Edit tasks targeting different file sizes
const EDIT_TASKS = [
    {
        name: 'Small file edit (button.tsx)',
        prompt: 'In src/components/ui/button.tsx, add a new variant called "ghost-primary" that combines ghost styling with primary color',
        file: 'src/components/ui/button.tsx'
    },
    {
        name: 'Medium file edit (form.tsx)',
        prompt: 'In src/components/ui/form.tsx, add a FormSuccess component similar to FormMessage but for success states with green styling',
        file: 'src/components/ui/form.tsx'
    },
    {
        name: 'Large file edit (sidebar.tsx)',
        prompt: 'In src/components/ui/sidebar.tsx, add a new SidebarBadge component that can be used to show notification counts next to menu items',
        file: 'src/components/ui/sidebar.tsx'
    }
];

async function setupWorkspace() {
    const workspace = await createWorkspace();
    execSync(`tar -xzf ${scaffoldPath} -C ${workspace.path}`);
    return workspace;
}

async function runTest(taskName, prompt, mode, options) {
    const workspace = await setupWorkspace();
    clearFileReadTracking();

    // Debug: show snapshot size for snapshot mode
    if (mode === 'snapshot') {
        const snapshot = await workspace.snapshot();
        console.log(`    [Snapshot size: ${snapshot.length} chars, ~${Math.ceil(snapshot.length/4)} tokens]`);
    }

    const toolCalls = [];
    const progressCallback = (event, data) => {
        if (event === 'TOOL_CALL_START' && data.tools) {
            toolCalls.push(...data.tools.map(t => t.name));
        }
    };

    const start = performance.now();

    try {
        const result = await workspace.execute(prompt, {
            mode: 'static',
            model,
            max_tokens: 8192,
            ...options,
            progressCallback
        });

        const elapsed = performance.now() - start;
        const tokens = result.tokenCount?.totalTokens || 0;

        await workspace.delete();

        return {
            task: taskName,
            mode,
            tokens,
            time: elapsed,
            toolCalls,
            iterations: toolCalls.length > 0 ? Math.ceil(toolCalls.length / 2) + 1 : 1
        };
    } catch (error) {
        await workspace.delete();
        return {
            task: taskName,
            mode,
            error: error.message,
            toolCalls
        };
    }
}

async function runBenchmark() {
    console.log('='.repeat(70));
    console.log('REACT SCAFFOLD BENCHMARK');
    console.log('='.repeat(70));
    console.log(`Model: ${model}`);
    console.log();

    // Get file sizes
    const workspace = await setupWorkspace();
    for (const task of EDIT_TASKS) {
        const filePath = path.join(workspace.path, task.file);
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n').length;
            console.log(`${task.file}: ${lines} lines (~${Math.ceil(lines * 2.5)} tokens)`);
        } catch {
            console.log(`${task.file}: NOT FOUND`);
        }
    }
    await workspace.delete();
    console.log();

    const results = [];

    for (const task of EDIT_TASKS) {
        console.log('-'.repeat(70));
        console.log(task.name);
        console.log('-'.repeat(70));

        // Test 1: File Tools (megaeditor)
        console.log('\n  FILE TOOLS (read + edit_multiple_files):');
        const fileToolsResult = await runTest(task.name, task.prompt, 'file-tools', {
            enableFileTools: true,
            tool_choice: { type: 'auto' }
        });
        if (fileToolsResult.error) {
            console.log(`    ERROR: ${fileToolsResult.error}`);
        } else {
            console.log(`    Tokens: ${fileToolsResult.tokens}`);
            console.log(`    Time: ${(fileToolsResult.time/1000).toFixed(1)}s`);
            console.log(`    Tools: ${fileToolsResult.toolCalls.join(' -> ')}`);
        }
        results.push(fileToolsResult);

        // Test 2: Snapshot + Megawriter
        console.log('\n  SNAPSHOT (write_multiple_files):');
        const snapshotResult = await runTest(task.name, task.prompt, 'snapshot', {
            enableMegawriter: true
        });
        if (snapshotResult.error) {
            console.log(`    ERROR: ${snapshotResult.error}`);
        } else {
            console.log(`    Tokens: ${snapshotResult.tokens}`);
            console.log(`    Time: ${(snapshotResult.time/1000).toFixed(1)}s`);
            console.log(`    Tools: ${snapshotResult.toolCalls.join(' -> ')}`);
        }
        results.push(snapshotResult);

        // Compare
        if (!fileToolsResult.error && !snapshotResult.error) {
            const diff = fileToolsResult.tokens - snapshotResult.tokens;
            const pct = ((diff / snapshotResult.tokens) * 100).toFixed(1);
            console.log(`\n  COMPARISON: File tools uses ${diff > 0 ? '+' : ''}${diff} tokens (${pct}%)`);
        }
        console.log();
    }

    // Summary
    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));

    const fileToolsTotal = results.filter(r => r.mode === 'file-tools' && !r.error)
        .reduce((sum, r) => sum + r.tokens, 0);
    const snapshotTotal = results.filter(r => r.mode === 'snapshot' && !r.error)
        .reduce((sum, r) => sum + r.tokens, 0);

    console.log(`File Tools Total: ${fileToolsTotal} tokens`);
    console.log(`Snapshot Total:   ${snapshotTotal} tokens`);

    if (fileToolsTotal && snapshotTotal) {
        const diff = fileToolsTotal - snapshotTotal;
        const pct = ((diff / snapshotTotal) * 100).toFixed(1);
        console.log(`Difference: ${diff > 0 ? '+' : ''}${diff} tokens (${pct}%)`);
    }
}

runBenchmark().catch(console.error);
