import { describe, test, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import 'dotenv/config';
import { initializeClient as initDynamic } from './llm-dynamic.js';
import { initializeClient as initStatic } from './llm-static.js';
import { createWorkspace, ProgressEvents } from './workspace.js';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Static Mode Progress Callback Integration Tests
 *
 * Tests progress callback functionality in static mode with both
 * streaming and non-streaming modes.
 */
describe('Static Mode Progress Callback Tests', () => {
    const hasApiKey = !!process.env.OPENAI_API_KEY;
    const testFn = hasApiKey ? test : test.skip;

    let workspace;
    let aiRules;
    let tarballBuffer;
    const scaffoldPath = path.join(__dirname, 'test-fixtures', 'react-scaffold.tar.gz');

    beforeAll(async () => {
        if (hasApiKey) {
            // Initialize both clients
            initDynamic(process.env.OPENAI_API_KEY);
            initStatic(process.env.OPENAI_API_KEY);

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
                stdio: 'inherit'
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
        test('skipping callback tests - no OPENAI_API_KEY', () => {
            console.log('ℹ️  Set OPENAI_API_KEY to run callback tests');
            expect(true).toBe(true);
        });
    }

    describe('Progress Callbacks', () => {
        testFn('should emit all progress events correctly', async () => {
            console.log('\n=== Progress Callbacks Test ===\n');

            const events = [];

            const result = await workspace.execute(
                'Create a Button component',
                {
                    instructions: [aiRules],
                    mode: 'static',
                    model: 'gpt-5',
                    progressCallback: (event, data) => {
                        events.push({ event, data, timestamp: Date.now() });
                        console.log(`[${event}]${data ? ' ' + JSON.stringify(data) : ''}`);
                    }
                }
            );

            // Verify all 6 events were emitted
            expect(events.length).toBe(6);

            // Verify event order and types
            expect(events[0].event).toBe(ProgressEvents.SNAPSHOT_GENERATING);
            expect(events[1].event).toBe(ProgressEvents.SNAPSHOT_GENERATED);
            expect(events[2].event).toBe(ProgressEvents.RESPONSE_WAITING);
            expect(events[3].event).toBe(ProgressEvents.RESPONSE_RECEIVED);
            expect(events[4].event).toBe(ProgressEvents.FILES_WRITING);
            expect(events[5].event).toBe(ProgressEvents.FILES_WRITTEN);

            // Verify FILES_WRITTEN has count data
            expect(events[5].data).toBeDefined();
            expect(events[5].data.count).toBe(result.filesWritten.length);

            console.log(`✓ All 6 events received in correct order`);
            console.log(`✓ Created ${result.filesWritten.length} files`);
            console.log('\n=== Test Complete ===\n');
        }, 180000);
    });

    describe('Streaming Mode', () => {
        testFn('should emit streaming events correctly', async () => {
            console.log('\n=== Streaming Mode Test ===\n');

            const events = [];
            const chunks = [];

            await workspace.execute(
                'Add a Badge component',
                {
                    instructions: [aiRules],
                    mode: 'static',
                    model: 'gpt-5',
                    stream: true,
                    streamCallback: (chunk) => {
                        chunks.push(chunk);
                    },
                    progressCallback: (event, data) => {
                        events.push({ event, data });
                        console.log(`[${event}]${data ? ' ' + JSON.stringify(data) : ''}`);
                    }
                }
            );

            // Verify all 6 events
            expect(events.length).toBe(6);

            // Verify streaming events (not waiting events)
            expect(events[2].event).toBe(ProgressEvents.RESPONSE_STREAMING);
            expect(events[3].event).toBe(ProgressEvents.RESPONSE_STREAMED);

            console.log(`✓ Streaming events verified`);
            console.log(`✓ Received ${chunks.length} chunks`);
            console.log('\n=== Test Complete ===\n');
        }, 180000);
    });

    describe('Edge Cases', () => {
        testFn('should work without progressCallback', async () => {
            console.log('\n=== Edge Cases Test ===\n');

            const result = await workspace.execute(
                'Add an Input component',
                {
                    instructions: [aiRules],
                    mode: 'static',
                    model: 'gpt-5'
                }
            );

            expect(result.filesWritten.length).toBeGreaterThan(0);
            console.log(`✓ Works without callback (${result.filesWritten.length} files)`);
            console.log('\n=== Test Complete ===\n');
        }, 180000);
    });
});
