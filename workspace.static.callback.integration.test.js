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
 *
 * Run with OpenAI: OPENAI_API_KEY=xxx npm test
 * Run with gateway: LLM_GATEWAY_URL=http://localhost:8000/local-llm/v1 LLM_GATEWAY_API_KEY=xxx LLM_MODEL=gpt-oss:120b npm test
 */
describe('Static Mode Progress Callback Tests', () => {
    const hasApiKey = !!process.env.OPENAI_API_KEY || !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);
    const testFn = hasApiKey ? test : test.skip;
    const model = process.env.LLM_MODEL || 'gpt-5';

    let workspace;
    let aiRules;
    let tarballBuffer;
    const scaffoldPath = path.join(__dirname, 'test-fixtures', 'react-scaffold.tar.gz');

    beforeAll(async () => {
        if (hasApiKey) {
            const baseURL = process.env.LLM_GATEWAY_URL;
            const apiKey = baseURL ? process.env.LLM_GATEWAY_API_KEY : process.env.OPENAI_API_KEY;

            if (baseURL) {
                console.log(`Testing with gateway: ${baseURL}, model: ${model}`);
                initDynamic({ apiKey, baseURL });
                initStatic({ apiKey, baseURL });
            } else {
                console.log(`Testing with OpenAI, model: ${model}`);
                initDynamic(apiKey);
                initStatic(apiKey);
            }

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
                    model,
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
        testFn('should emit streaming and file events', async () => {
            console.log('\n=== Streaming Mode Test ===\n');

            const events = [];
            const chunks = [];
            const fileEvents = [];

            await workspace.execute(
                'Add a Badge component',
                {
                    instructions: [aiRules],
                    mode: 'static',
                    model,
                    stream: true,
                    streamCallback: (chunk) => {
                        chunks.push(chunk);
                    },
                    progressCallback: (event, data) => {
                        events.push({ event, data });

                        // Track file streaming events
                        if (event === ProgressEvents.FILE_STREAMING_START ||
                            event === ProgressEvents.FILE_STREAMING_CONTENT ||
                            event === ProgressEvents.FILE_STREAMING_END) {
                            fileEvents.push({ event, data });
                            console.log(`  [FILE] ${event} - ${data.path || 'unknown'}`);
                        } else {
                            console.log(`[${event}]${data ? ' ' + JSON.stringify(data) : ''}`);
                        }
                    }
                }
            );

            // Verify basic streaming events
            const responseEvents = events.filter(e =>
                e.event === ProgressEvents.RESPONSE_STREAMING ||
                e.event === ProgressEvents.RESPONSE_STREAMED
            );
            expect(responseEvents.length).toBe(2);
            expect(responseEvents[0].event).toBe(ProgressEvents.RESPONSE_STREAMING);
            expect(responseEvents[1].event).toBe(ProgressEvents.RESPONSE_STREAMED);

            // Verify file streaming events were emitted
            const fileStarts = fileEvents.filter(e => e.event === ProgressEvents.FILE_STREAMING_START);
            const fileEnds = fileEvents.filter(e => e.event === ProgressEvents.FILE_STREAMING_END);
            const fileContents = fileEvents.filter(e => e.event === ProgressEvents.FILE_STREAMING_CONTENT);

            expect(fileStarts.length).toBeGreaterThan(0);
            expect(fileEnds.length).toBe(fileStarts.length); // Same number of starts and ends
            expect(fileContents.length).toBeGreaterThan(0);

            // Verify file events have proper structure
            if (fileStarts.length > 0) {
                expect(fileStarts[0].data).toHaveProperty('path');
                expect(fileStarts[0].data).toHaveProperty('action');
            }
            if (fileEnds.length > 0) {
                expect(fileEnds[0].data).toHaveProperty('path');
                expect(fileEnds[0].data).toHaveProperty('fullContent');
            }

            console.log(`✓ Streaming events verified`);
            console.log(`✓ Received ${chunks.length} chunks`);
            console.log(`✓ File events: ${fileStarts.length} files streamed`);
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
                    model
                }
            );

            expect(result.filesWritten.length).toBeGreaterThan(0);
            console.log(`✓ Works without callback (${result.filesWritten.length} files)`);
            console.log('\n=== Test Complete ===\n');
        }, 180000);
    });
});
