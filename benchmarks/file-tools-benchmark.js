/**
 * Benchmark: File Tools Token Usage Comparison
 *
 * Compares token usage between:
 * - Old approach: read_file + write_file (full file rewrites)
 * - New approach: read_file + edit_file (targeted edits)
 *
 * Simulates iterative editing like a coding assistant would do.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
    setSandboxRoot,
    handleReadFile,
    handleWriteFile,
    handleEditFile,
    clearFileReadTracking
} from '../filetooling.js';

// Simple token estimation (4 chars per token, like OpenCode)
function estimateTokens(str) {
    return Math.ceil((str || '').length / 4);
}

// Sample code files of varying sizes
const SAMPLE_FILES = {
    'small.js': `// Small file (~50 lines)
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
    if (b === 0) throw new Error('Division by zero');
    return a / b;
}

export class Calculator {
    constructor() {
        this.result = 0;
    }

    add(n) {
        this.result += n;
        return this;
    }

    subtract(n) {
        this.result -= n;
        return this;
    }

    multiply(n) {
        this.result *= n;
        return this;
    }

    divide(n) {
        if (n === 0) throw new Error('Division by zero');
        this.result /= n;
        return this;
    }

    getResult() {
        return this.result;
    }

    reset() {
        this.result = 0;
        return this;
    }
}
`,

    'medium.js': generateMediumFile(),
    'large.js': generateLargeFile(),
};

function generateMediumFile() {
    // ~200 lines
    let code = `// Medium file (~200 lines)
import { EventEmitter } from 'events';

export class DataProcessor extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = options;
        this.data = [];
        this.processed = [];
        this.errors = [];
    }

`;
    for (let i = 0; i < 20; i++) {
        code += `
    process${i}(input) {
        const result = input.map(x => x * ${i + 1});
        this.emit('processed', { step: ${i}, result });
        return result;
    }
`;
    }
    code += `
    async run(data) {
        this.data = data;
        try {
`;
    for (let i = 0; i < 20; i++) {
        code += `            this.processed.push(this.process${i}(data));\n`;
    }
    code += `        } catch (error) {
            this.errors.push(error);
            this.emit('error', error);
        }
        return this.processed;
    }
}
`;
    return code;
}

function generateLargeFile() {
    // ~500 lines
    let code = `// Large file (~500 lines)
import { createServer } from 'http';
import { EventEmitter } from 'events';

export class APIServer extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = config;
        this.routes = new Map();
        this.middleware = [];
        this.server = null;
    }

`;
    // Generate 50 route handlers
    for (let i = 0; i < 50; i++) {
        code += `
    handleRoute${i}(req, res) {
        const data = { route: ${i}, timestamp: Date.now() };
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } else if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                const parsed = JSON.parse(body);
                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ...data, received: parsed }));
            });
        }
    }
`;
    }
    code += `
    registerRoutes() {
`;
    for (let i = 0; i < 50; i++) {
        code += `        this.routes.set('/api/route${i}', this.handleRoute${i}.bind(this));\n`;
    }
    code += `    }

    start(port = 3000) {
        this.registerRoutes();
        this.server = createServer((req, res) => {
            const handler = this.routes.get(req.url);
            if (handler) {
                handler(req, res);
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });
        this.server.listen(port);
        this.emit('started', { port });
    }
}
`;
    return code;
}

// Simulate iterative edits that a coding assistant would make
const EDIT_SCENARIOS = [
    {
        name: 'Fix bug (single line)',
        file: 'small.js',
        old_string: "if (b === 0) throw new Error('Division by zero');",
        new_string: "if (b === 0) throw new TypeError('Cannot divide by zero');",
    },
    {
        name: 'Add logging (multiple occurrences)',
        file: 'small.js',
        old_string: 'return this;',
        new_string: 'console.log("Operation complete");\n        return this;',
        replace_all: true,
    },
    {
        name: 'Rename method (medium file)',
        file: 'medium.js',
        old_string: 'process0',
        new_string: 'processInitial',
        replace_all: true,
    },
    {
        name: 'Update error handling (large file)',
        file: 'large.js',
        old_string: "res.writeHead(404);\n                res.end('Not Found');",
        new_string: "res.writeHead(404, { 'Content-Type': 'application/json' });\n                res.end(JSON.stringify({ error: 'Not Found' }));",
    },
];

async function runBenchmark() {
    console.log('='.repeat(70));
    console.log('FILE TOOLS TOKEN USAGE BENCHMARK');
    console.log('Comparing: Full File Rewrite vs Targeted Edit');
    console.log('='.repeat(70));
    console.log();

    // Setup temp directory
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sigrid-benchmark-'));
    setSandboxRoot(tempDir);

    // Create sample files
    for (const [filename, content] of Object.entries(SAMPLE_FILES)) {
        await fs.writeFile(path.join(tempDir, filename), content);
    }

    console.log('Sample Files Created:');
    for (const [filename, content] of Object.entries(SAMPLE_FILES)) {
        const lines = content.split('\n').length;
        const tokens = estimateTokens(content);
        console.log(`  ${filename}: ${lines} lines, ~${tokens} tokens`);
    }
    console.log();

    const results = [];
    let totalOldTokens = 0;
    let totalNewTokens = 0;
    let totalOldTime = 0;
    let totalNewTime = 0;

    // Run each edit scenario
    for (const scenario of EDIT_SCENARIOS) {
        console.log('-'.repeat(70));
        console.log(`Scenario: ${scenario.name}`);
        console.log(`File: ${scenario.file}`);
        console.log();

        // Get file content
        const filePath = path.join(tempDir, scenario.file);
        const originalContent = await fs.readFile(filePath, 'utf-8');

        // === OLD APPROACH: read_file + write_file ===
        clearFileReadTracking();
        await fs.writeFile(filePath, originalContent); // Reset file

        const oldStart = performance.now();

        // Step 1: Read file
        const readResult = await handleReadFile({ filepath: scenario.file });
        const readTokens = estimateTokens(JSON.stringify(readResult));

        // Step 2: Simulate LLM generating new content (full file rewrite)
        let newContent;
        if (scenario.replace_all) {
            newContent = originalContent.split(scenario.old_string).join(scenario.new_string);
        } else {
            newContent = originalContent.replace(scenario.old_string, scenario.new_string);
        }

        // Step 3: Write entire file
        await handleWriteFile({ filepath: scenario.file, content: newContent });

        const oldEnd = performance.now();
        const oldTime = oldEnd - oldStart;

        // Token cost for write_file = content being sent
        const writeTokens = estimateTokens(newContent);
        const oldTotalTokens = readTokens + writeTokens;

        // Verify old approach worked
        const oldVerify = await fs.readFile(filePath, 'utf-8');
        const oldSuccess = oldVerify === newContent;

        // === NEW APPROACH: read_file + edit_file ===
        clearFileReadTracking();
        await fs.writeFile(filePath, originalContent); // Reset file

        const newStart = performance.now();

        // Step 1: Read file (required for staleness tracking)
        const readResult2 = await handleReadFile({ filepath: scenario.file });

        // Step 2: Use edit_file with targeted replacement
        const editResult = await handleEditFile({
            filepath: scenario.file,
            old_string: scenario.old_string,
            new_string: scenario.new_string,
            replace_all: scenario.replace_all || false,
        });

        const newEnd = performance.now();
        const newTime = newEnd - newStart;

        // edit_file tokens = old_string + new_string (much smaller!)
        const editInputTokens = estimateTokens(scenario.old_string) + estimateTokens(scenario.new_string);
        const newTotalTokens = readTokens + editInputTokens;

        // Verify new approach worked
        const newVerify = await fs.readFile(filePath, 'utf-8');
        const newSuccess = newVerify === newContent;

        // Calculate savings
        const tokenSavings = oldTotalTokens - newTotalTokens;
        const tokenSavingsPercent = ((tokenSavings / oldTotalTokens) * 100).toFixed(1);

        console.log('OLD APPROACH (read_file + write_file):');
        console.log(`  Read tokens:  ${readTokens}`);
        console.log(`  Write tokens: ${writeTokens}`);
        console.log(`  Total:        ${oldTotalTokens} tokens`);
        console.log(`  Time:         ${oldTime.toFixed(2)}ms`);
        console.log(`  Verified:     ${oldSuccess ? '✓' : '✗'}`);
        console.log();
        console.log('NEW APPROACH (read_file + edit_file):');
        console.log(`  Read tokens:  ${readTokens}`);
        console.log(`  Edit tokens:  ${editInputTokens}`);
        console.log(`  Total:        ${newTotalTokens} tokens`);
        console.log(`  Time:         ${newTime.toFixed(2)}ms`);
        console.log(`  Verified:     ${newSuccess ? '✓'  : '✗'}`);
        console.log(`  Match strat:  ${editResult.matchStrategy}`);
        console.log();
        console.log(`SAVINGS: ${tokenSavings} tokens (${tokenSavingsPercent}% reduction)`);

        totalOldTokens += oldTotalTokens;
        totalNewTokens += newTotalTokens;
        totalOldTime += oldTime;
        totalNewTime += newTime;

        results.push({
            scenario: scenario.name,
            file: scenario.file,
            oldTokens: oldTotalTokens,
            newTokens: newTotalTokens,
            oldTime,
            newTime,
            savings: tokenSavings,
            savingsPercent: parseFloat(tokenSavingsPercent),
            matchStrategy: editResult.matchStrategy,
            verified: oldSuccess && newSuccess,
        });

        // Reset file for next scenario
        await fs.writeFile(filePath, originalContent);
    }

    // Summary
    console.log();
    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log();

    console.log('Per-Scenario Results:');
    console.log('| Scenario                         | Old Tokens | New Tokens | Savings  | Strategy | Verified |');
    console.log('|----------------------------------|------------|------------|----------|----------|----------|');
    for (const r of results) {
        console.log(`| ${r.scenario.padEnd(32)} | ${String(r.oldTokens).padStart(10)} | ${String(r.newTokens).padStart(10)} | ${(r.savingsPercent + '%').padStart(8)} | ${r.matchStrategy.padEnd(8)} | ${r.verified ? '   ✓    ' : '   ✗    '} |`);
    }
    console.log();

    const totalSavings = totalOldTokens - totalNewTokens;
    const totalSavingsPercent = ((totalSavings / totalOldTokens) * 100).toFixed(1);

    console.log('TOTALS:');
    console.log(`  Tokens - Old: ${totalOldTokens}, New: ${totalNewTokens}, Savings: ${totalSavings} (${totalSavingsPercent}%)`);
    console.log(`  Time   - Old: ${totalOldTime.toFixed(2)}ms, New: ${totalNewTime.toFixed(2)}ms`);
    console.log();

    // Simulate iterative editing session (4 edits like NOBI test)
    console.log('='.repeat(70));
    console.log('ITERATIVE SESSION SIMULATION (4 consecutive edits on large file)');
    console.log('='.repeat(70));
    console.log();

    // Define 4 sequential edits (using unique strings)
    const iterativeEdits = [
        { old_string: 'handleRoute0(req, res) {', new_string: 'handleFirstRoute(req, res) {' },
        { old_string: "const data = { route: 0, timestamp: Date.now() };", new_string: "const data = { route: 'zero', timestamp: Date.now() };" },
        { old_string: "this.routes.set('/api/route49', this.handleRoute49.bind(this));", new_string: "this.routes.set('/api/route49', this.handleRoute49.bind(this)); // last route" },
        { old_string: 'port = 3000', new_string: 'port = 8080' },
    ];

    // Reset large file
    const largeFilePath = path.join(tempDir, 'large.js');
    await fs.writeFile(largeFilePath, SAMPLE_FILES['large.js']);
    const largeContent = SAMPLE_FILES['large.js'];
    const largeTokens = estimateTokens(largeContent);

    // === OLD APPROACH: read + 4x full rewrites ===
    clearFileReadTracking();
    await fs.writeFile(largeFilePath, SAMPLE_FILES['large.js']);

    const iterOldStart = performance.now();
    let iterOldTokens = 0;
    let currentContent = SAMPLE_FILES['large.js'];

    // Initial read
    const iterReadResult = await handleReadFile({ filepath: 'large.js' });
    iterOldTokens += estimateTokens(JSON.stringify(iterReadResult));

    // 4 full rewrites
    for (const edit of iterativeEdits) {
        currentContent = currentContent.replace(edit.old_string, edit.new_string);
        await handleWriteFile({ filepath: 'large.js', content: currentContent });
        iterOldTokens += estimateTokens(currentContent);
    }

    const iterOldEnd = performance.now();
    const iterOldTime = iterOldEnd - iterOldStart;
    const iterOldFinalContent = await fs.readFile(largeFilePath, 'utf-8');

    // === NEW APPROACH: read + 4x targeted edits ===
    clearFileReadTracking();
    await fs.writeFile(largeFilePath, SAMPLE_FILES['large.js']);

    const iterNewStart = performance.now();
    let iterNewTokens = 0;

    // Initial read
    const iterReadResult2 = await handleReadFile({ filepath: 'large.js' });
    iterNewTokens += estimateTokens(JSON.stringify(iterReadResult2));

    // 4 targeted edits
    for (const edit of iterativeEdits) {
        await handleEditFile({
            filepath: 'large.js',
            old_string: edit.old_string,
            new_string: edit.new_string,
        });
        iterNewTokens += estimateTokens(edit.old_string) + estimateTokens(edit.new_string);
    }

    const iterNewEnd = performance.now();
    const iterNewTime = iterNewEnd - iterNewStart;
    const iterNewFinalContent = await fs.readFile(largeFilePath, 'utf-8');

    // Verify both approaches produce same result
    const iterVerified = iterOldFinalContent === iterNewFinalContent;

    const iterSavings = iterOldTokens - iterNewTokens;
    const iterSavingsPercent = ((iterSavings / iterOldTokens) * 100).toFixed(1);

    console.log('OLD APPROACH (read + 4 full rewrites):');
    console.log(`  Total tokens: ${iterOldTokens}`);
    console.log(`  Time:         ${iterOldTime.toFixed(2)}ms`);
    console.log();
    console.log('NEW APPROACH (read + 4 targeted edits):');
    console.log(`  Total tokens: ${iterNewTokens}`);
    console.log(`  Time:         ${iterNewTime.toFixed(2)}ms`);
    console.log();
    console.log(`SAVINGS: ${iterSavings} tokens (${iterSavingsPercent}% reduction)`);
    console.log(`Results match: ${iterVerified ? '✓' : '✗'}`);
    console.log();

    // Cleanup
    await fs.rm(tempDir, { recursive: true });

    console.log('='.repeat(70));
    console.log('BENCHMARK COMPLETE');
    console.log('='.repeat(70));
}

runBenchmark().catch(console.error);
