import { describe, test, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import 'dotenv/config';
import { initializeClient } from './llm.js';
import { createWorkspace } from './workspace.js';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Static Mode Stress Tests
 *
 * Tests the static context loading feature under stress conditions:
 * - Large snapshots and codebases
 * - Repeated executions (memory leaks)
 * - Multiple concurrent operations
 * - Edge cases and boundary conditions
 * - Performance degradation over time
 */
describe('Static Mode Stress Tests', () => {
    const hasApiKey = !!process.env.OPENAI_API_KEY;
    const testFn = hasApiKey ? test : test.skip;

    let workspace;
    let aiRules;
    let tarballBuffer;
    const scaffoldPath = path.join(__dirname, 'test-fixtures', 'react-scaffold.tar.gz');

    beforeAll(async () => {
        if (hasApiKey) {
            initializeClient(process.env.OPENAI_API_KEY);

            // Load scaffold tarball
            console.log(`Loading scaffold from: ${scaffoldPath}`);
            tarballBuffer = await fs.readFile(scaffoldPath);
            console.log('✓ Scaffold tarball loaded');
        }
    }, 60000);

    beforeEach(async () => {
        if (hasApiKey) {
            // Create fresh workspace for each test
            console.log('Creating fresh workspace...');
            workspace = await createWorkspace(tarballBuffer);
            console.log(`✓ Workspace created at: ${workspace.path}`);

            // Install dependencies
            console.log('Installing dependencies...');
            execSync('npm install', {
                cwd: workspace.path,
                stdio: 'ignore'
            });
            console.log('✓ Dependencies installed');

            // Read AI_RULES.md from workspace
            const aiRulesPath = path.join(workspace.path, 'AI_RULES.md');
            aiRules = await fs.readFile(aiRulesPath, 'utf-8');
            console.log('✓ AI_RULES.md loaded');
        }
    }, 120000);

    afterEach(async () => {
        if (workspace) {
            if (process.env.KEEP_TEST_DIR) {
                console.log(`\n⚠️  Test directory preserved at: ${workspace.path}`);
            } else {
                console.log(`Cleaning up workspace: ${workspace.path}`);
                await workspace.delete();
            }
            workspace = null;
        }
    });

    if (!hasApiKey) {
        test('skipping stress tests - no OPENAI_API_KEY', () => {
            console.log('ℹ️  Set OPENAI_API_KEY to run stress tests');
            expect(true).toBe(true);
        });
    }

    testFn('stress test: large snapshot generation', async () => {
        console.log('\n=== Stress Test: Large Snapshot ===\n');

        // Create many additional files to stress snapshot generation
        const loremIpsum = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(100);
        const filesCreated = [];

        for (let i = 0; i < 50; i++) {
            const filePath = path.join(workspace.path, 'src', 'components', `Component${i}.tsx`);
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, `
import React from 'react';

export default function Component${i}() {
    // ${loremIpsum}
    return <div>Component ${i}</div>;
}
`);
            filesCreated.push(filePath);
        }

        console.log(`✓ Created ${filesCreated.length} additional files`);

        // Generate snapshot
        const startSnapshot = Date.now();
        const snapshot = await workspace.snapshot({
            include: ['src/**/*'],
            extensions: ['.ts', '.tsx']
        });
        const snapshotTime = Date.now() - startSnapshot;

        console.log(`✓ Snapshot generated in ${snapshotTime}ms`);
        console.log(`✓ Snapshot size: ${snapshot.length} chars`);

        // Verify snapshot is reasonable size
        expect(snapshot.length).toBeGreaterThan(10000);
        expect(snapshotTime).toBeLessThan(5000); // Should complete in <5s

        // Use snapshot in execution
        const startExec = Date.now();
        const result = await workspace.execute(
            'Add a simple utility function',
            {
                instructions: [aiRules],
                mode: 'static',
                model: 'gpt-5-mini',
                snapshot: snapshot
            }
        );
        const execTime = Date.now() - startExec;

        console.log(`✓ Execution completed in ${execTime}ms`);
        console.log(`✓ Files written: ${result.filesWritten.length}`);

        expect(result.filesWritten).toBeDefined();

        console.log('\n=== Large Snapshot Test Complete ===\n');
    }, 300000); // 5 min timeout

    testFn('stress test: repeated executions (memory leak detection)', async () => {
        console.log('\n=== Stress Test: Repeated Executions ===\n');

        const iterations = 3;
        const times = [];
        const memoryUsages = [];

        // Pre-generate snapshot to isolate execution performance
        const snapshot = await workspace.snapshot({
            include: ['src/**/*'],
            extensions: ['.ts', '.tsx']
        });

        console.log(`Snapshot size: ${snapshot.length} chars\n`);

        for (let i = 0; i < iterations; i++) {
            const memBefore = process.memoryUsage().heapUsed / 1024 / 1024;

            const start = Date.now();
            const result = await workspace.execute(
                `Add a simple function called util${i}`,
                {
                    instructions: [aiRules],
                    mode: 'static',
                    model: 'gpt-5-mini',
                    snapshot: snapshot
                }
            );
            const duration = Date.now() - start;

            const memAfter = process.memoryUsage().heapUsed / 1024 / 1024;
            const memDelta = memAfter - memBefore;

            times.push(duration);
            memoryUsages.push(memDelta);

            console.log(`Iteration ${i + 1}/${iterations}:`);
            console.log(`  Time: ${duration}ms`);
            console.log(`  Memory delta: ${memDelta.toFixed(2)} MB`);
            console.log(`  Files written: ${result.filesWritten.length}`);
        }

        // Verify no significant performance degradation
        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const maxTime = Math.max(...times);
        const minTime = Math.min(...times);

        console.log(`\nPerformance Summary:`);
        console.log(`  Average time: ${avgTime.toFixed(0)}ms`);
        console.log(`  Min time: ${minTime}ms`);
        console.log(`  Max time: ${maxTime}ms`);
        console.log(`  Variance: ${(maxTime - minTime)}ms`);

        // Performance shouldn't degrade by more than 50%
        const degradation = (maxTime - minTime) / minTime;
        expect(degradation).toBeLessThan(0.5);

        console.log('\n=== Repeated Executions Test Complete ===\n');
    }, 600000); // 10 min timeout

    testFn('stress test: many files output (XML deserialization)', async () => {
        console.log('\n=== Stress Test: Many Files Output ===\n');

        const result = await workspace.execute(
            'Create 10 simple utility functions, each in their own file in src/utils/',
            {
                instructions: [aiRules],
                mode: 'static',
                model: 'gpt-5',
                snapshot: {
                    include: ['src/**/*'],
                    extensions: ['.ts', '.tsx']
                }
            }
        );

        console.log(`\n✓ Files written: ${result.filesWritten.length}`);
        result.filesWritten.forEach(file => {
            console.log(`   - ${file.path} (${file.size} bytes)`);
        });

        // Verify files were created
        expect(result.filesWritten.length).toBeGreaterThan(0);

        // Verify all files exist on disk
        for (const file of result.filesWritten) {
            const fullPath = path.join(workspace.path, file.path);
            const exists = await fs.access(fullPath).then(() => true).catch(() => false);
            expect(exists).toBe(true);

            const content = await fs.readFile(fullPath, 'utf-8');
            expect(content.length).toBeGreaterThan(0);
        }

        // Verify the generated code builds successfully
        console.log('\n✓ All files written, running build...');
        execSync('npm run build', {
            cwd: workspace.path,
            stdio: 'inherit'
        });
        console.log('✓ Build passed');

        console.log('\n=== Many Files Output Test Complete ===\n');
    }, 300000);

    testFn('stress test: edge case - empty workspace', async () => {
        console.log('\n=== Stress Test: Empty Workspace ===\n');

        // Create empty workspace
        const emptyWorkspace = await createWorkspace();

        try {
            // Create minimal structure
            await fs.mkdir(path.join(emptyWorkspace.path, 'src'), { recursive: true });
            await fs.writeFile(
                path.join(emptyWorkspace.path, 'src', 'index.ts'),
                'console.log("hello");'
            );

            const snapshot = await emptyWorkspace.snapshot();
            console.log(`Empty workspace snapshot size: ${snapshot.length} chars`);

            expect(snapshot.length).toBeGreaterThan(0);

            // Try execution on minimal workspace
            const result = await emptyWorkspace.execute(
                'Add a hello world function',
                {
                    mode: 'static',
                    model: 'gpt-5-mini',
                    snapshot: snapshot
                }
            );

            expect(result.filesWritten).toBeDefined();
            console.log(`✓ Generated ${result.filesWritten.length} files in empty workspace`);

        } finally {
            await emptyWorkspace.delete();
        }

        console.log('\n=== Empty Workspace Test Complete ===\n');
    }, 180000);

    testFn('stress test: snapshot caching and reuse', async () => {
        console.log('\n=== Stress Test: Snapshot Caching ===\n');

        // Generate snapshot once
        const startSnapshot = Date.now();
        const snapshot = await workspace.snapshot({
            include: ['src/**/*'],
            extensions: ['.ts', '.tsx']
        });
        const snapshotTime = Date.now() - startSnapshot;

        console.log(`Snapshot generation: ${snapshotTime}ms (${snapshot.length} chars)`);

        // Reuse same snapshot for multiple executions
        const prompts = [
            'Add a utility function for string manipulation',
            'Add a utility function for array operations'
        ];

        for (const [index, prompt] of prompts.entries()) {
            const start = Date.now();
            const result = await workspace.execute(prompt, {
                instructions: [aiRules],
                mode: 'static',
                model: 'gpt-5-mini',
                snapshot: snapshot // Reuse same snapshot
            });
            const duration = Date.now() - start;

            console.log(`\nExecution ${index + 1}:`);
            console.log(`  Time: ${duration}ms`);
            console.log(`  Files: ${result.filesWritten.length}`);

            expect(result.filesWritten).toBeDefined();
        }

        console.log('\n✓ Successfully reused snapshot across multiple executions');
        console.log('\n=== Snapshot Caching Test Complete ===\n');
    }, 300000);

    testFn('stress test: edge case - special characters in file paths', async () => {
        console.log('\n=== Stress Test: Special Characters ===\n');

        // Test XML deserialization with special characters
        const xmlContent = `
Here are the files:

<sg-file path="src/components/Button-Component.tsx">
import React from 'react';

export default function ButtonComponent() {
    return <button>Click me</button>;
}
</sg-file>

<sg-file path="src/utils/string_utils.ts">
export function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
</sg-file>

<sg-file path="src/components/Card (1).tsx">
export default function Card() {
    return <div>Card</div>;
}
</sg-file>
`;

        const filesWritten = await workspace.deserializeXmlOutput(xmlContent);

        console.log(`✓ Deserialized ${filesWritten.length} files with special characters`);
        filesWritten.forEach(file => {
            console.log(`   - ${file.path}`);
        });

        expect(filesWritten.length).toBe(3);

        // Verify files exist
        for (const file of filesWritten) {
            const fullPath = path.join(workspace.path, file.path);
            const exists = await fs.access(fullPath).then(() => true).catch(() => false);
            expect(exists).toBe(true);
        }

        console.log('\n=== Special Characters Test Complete ===\n');
    }, 60000);

    testFn('stress test: performance baseline comparison', async () => {
        console.log('\n=== Stress Test: Performance Baseline ===\n');

        const prompt = 'Add a simple counter component';

        // Measure snapshot generation
        const startSnapshot = Date.now();
        const snapshot = await workspace.snapshot({
            include: ['src/**/*'],
            extensions: ['.ts', '.tsx']
        });
        const snapshotTime = Date.now() - startSnapshot;

        // Measure static execution
        const startStatic = Date.now();
        const staticResult = await workspace.execute(prompt, {
            instructions: [aiRules],
            mode: 'static',
            model: 'gpt-5-mini',
            snapshot: snapshot
        });
        const staticTime = Date.now() - startStatic;

        console.log('\nPerformance Metrics:');
        console.log(`  Snapshot generation: ${snapshotTime}ms`);
        console.log(`  Snapshot size: ${snapshot.length} chars`);
        console.log(`  Static execution: ${staticTime}ms`);
        console.log(`  Total time: ${snapshotTime + staticTime}ms`);
        console.log(`  Files written: ${staticResult.filesWritten.length}`);

        // Verify reasonable performance
        expect(snapshotTime).toBeLessThan(5000); // <5s for snapshot
        expect(staticTime).toBeLessThan(60000); // <60s for execution

        console.log('\n=== Performance Baseline Test Complete ===\n');
    }, 180000);

    testFn('stress test: concurrent snapshot generations', async () => {
        console.log('\n=== Stress Test: Concurrent Snapshots ===\n');

        // Generate multiple snapshots concurrently with different configs
        const configs = [
            { include: ['src/**/*'], extensions: ['.ts', '.tsx'] },
            { include: ['src/components/**/*'], extensions: ['.tsx'] },
            { include: ['src/**/*'], extensions: ['.ts'] }
        ];

        const start = Date.now();
        const snapshots = await Promise.all(
            configs.map(config => workspace.snapshot(config))
        );
        const duration = Date.now() - start;

        console.log(`✓ Generated ${snapshots.length} snapshots concurrently in ${duration}ms`);
        snapshots.forEach((snapshot, i) => {
            console.log(`   Snapshot ${i + 1}: ${snapshot.length} chars`);
        });

        // Verify all snapshots generated
        expect(snapshots.length).toBe(3);
        snapshots.forEach(snapshot => {
            expect(snapshot.length).toBeGreaterThan(0);
        });

        console.log('\n=== Concurrent Snapshots Test Complete ===\n');
    }, 120000);

    testFn('stress test: edge case - XML in file content', async () => {
        console.log('\n=== Stress Test: XML in File Content ===\n');

        // Test deserialization when file content contains XML-like strings
        const xmlContent = `
<sg-file path="src/XmlExample.tsx">
import React from 'react';

export default function XmlExample() {
    const example = '<div>Hello</div>';
    return <div>{example}</div>;
}
</sg-file>

<sg-file path="src/utils/parser.ts">
export function parseXml(input: string): string {
    // Handle <file> tags in content
    return input.replace(/<file>/g, '&lt;file&gt;');
}
</sg-file>
`;

        const filesWritten = await workspace.deserializeXmlOutput(xmlContent);

        console.log(`✓ Deserialized ${filesWritten.length} files with XML-like content`);

        expect(filesWritten.length).toBe(2);

        // Verify content is correct
        const xmlExampleContent = await fs.readFile(
            path.join(workspace.path, 'src/XmlExample.tsx'),
            'utf-8'
        );
        expect(xmlExampleContent).toContain("const example = '<div>Hello</div>'");

        console.log('\n=== XML in Content Test Complete ===\n');
    }, 60000);

    testFn('stress test: randomized prompts (XML output reliability)', async () => {
        console.log('\n=== Stress Test: Randomized Prompts ===\n');

        // Pre-generate snapshot
        const snapshot = await workspace.snapshot({
            include: ['src/**/*'],
            extensions: ['.ts', '.tsx']
        });

        // Diverse prompt templates to test LLM's XML output consistency
        const promptTemplates = [
            // Simple, straightforward
            'Create a simple {item} component',
            'Add a {item} utility function',

            // More complex
            'Create a {item} component with TypeScript props and state management',
            'Build a reusable {item} hook that handles {detail}',

            // Potentially confusing (mentions code/XML)
            'Add a {item} component. Make sure to use proper JSX syntax with <div> tags',
            'Create a {item} utility that parses XML strings and returns objects',

            // Multiple files
            'Create a {item} feature with a component and a hook',
            'Add {item} and {detail} components',

            // Very specific technical requests
            'Implement a {item} using React.memo and useCallback for optimization',
            'Create a custom {item} hook with error handling and loading states',
        ];

        const items = [
            'Button', 'Card', 'Modal', 'Dropdown', 'Tooltip', 'Alert',
            'SearchBar', 'Navbar', 'Footer', 'Sidebar', 'Badge', 'Avatar'
        ];

        const details = [
            'async operations', 'form validation', 'local storage',
            'API calls', 'debouncing', 'caching', 'animations'
        ];

        const iterations = 10;
        const results = {
            total: iterations,
            successful: 0,
            failed: 0,
            filesWritten: [],
            errors: []
        };

        console.log(`Running ${iterations} iterations with randomized prompts...\n`);

        for (let i = 0; i < iterations; i++) {
            // Randomize prompt
            const template = promptTemplates[Math.floor(Math.random() * promptTemplates.length)];
            const item = items[Math.floor(Math.random() * items.length)];
            const detail = details[Math.floor(Math.random() * details.length)];
            const prompt = template.replace('{item}', item).replace('{detail}', detail);

            console.log(`[${i + 1}/${iterations}] Prompt: "${prompt}"`);

            try {
                const start = Date.now();
                const result = await workspace.execute(prompt, {
                    instructions: [aiRules],
                    mode: 'static',
                    model: 'gpt-5-mini',
                    snapshot: snapshot,
                    temperature: 0.7 // Add some randomness
                });
                const duration = Date.now() - start;

                const fileCount = result.filesWritten.length;

                if (fileCount > 0) {
                    // Verify files exist and have content
                    for (const file of result.filesWritten) {
                        const fullPath = path.join(workspace.path, file.path);
                        const content = await fs.readFile(fullPath, 'utf-8');
                        if (content.length === 0) {
                            throw new Error(`File ${file.path} is empty`);
                        }
                    }

                    // Verify the code is valid by running build
                    try {
                        execSync('npm run build', {
                            cwd: workspace.path,
                            stdio: 'pipe'
                        });
                        console.log(`  ✓ Success: ${fileCount} files in ${duration}ms, build passed`);
                        results.successful++;
                        results.filesWritten.push(fileCount);
                    } catch (buildError) {
                        results.failed++;
                        results.errors.push({
                            iteration: i + 1,
                            prompt,
                            reason: `Build failed: ${buildError.message}`
                        });
                        console.log(`  ✗ Failed: ${fileCount} files written but build failed`);
                    }
                } else {
                    results.failed++;
                    results.errors.push({
                        iteration: i + 1,
                        prompt,
                        reason: 'No files written (LLM likely output markdown instead of XML)'
                    });
                    console.log(`  ✗ Failed: No files written`);
                }
            } catch (error) {
                results.failed++;
                results.errors.push({
                    iteration: i + 1,
                    prompt,
                    reason: error.message
                });
                console.log(`  ✗ Error: ${error.message}`);
            }
        }

        console.log('\n=== Randomized Prompts Results ===');
        console.log(`Total iterations: ${results.total}`);
        console.log(`Successful: ${results.successful} (${(results.successful / results.total * 100).toFixed(1)}%)`);
        console.log(`Failed: ${results.failed} (${(results.failed / results.total * 100).toFixed(1)}%)`);

        if (results.filesWritten.length > 0) {
            const avgFiles = results.filesWritten.reduce((a, b) => a + b, 0) / results.filesWritten.length;
            const minFiles = Math.min(...results.filesWritten);
            const maxFiles = Math.max(...results.filesWritten);
            console.log(`Files per success: avg=${avgFiles.toFixed(1)}, min=${minFiles}, max=${maxFiles}`);
        }

        if (results.errors.length > 0) {
            console.log('\n=== Errors ===');
            results.errors.forEach(err => {
                console.log(`  [${err.iteration}] "${err.prompt}"`);
                console.log(`      → ${err.reason}`);
            });
        }

        console.log('\n=== Randomized Prompts Test Complete ===\n');

        // We want at least 70% success rate to pass
        const successRate = results.successful / results.total;
        expect(successRate).toBeGreaterThanOrEqual(0.7);

        // Verify all successful runs wrote files
        expect(results.successful).toBeGreaterThan(0);
    }, 600000); // 10 min timeout for 10 iterations
});
