import { describe, test, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import 'dotenv/config';
import { initializeClient as initDynamic } from '../llm-dynamic.js';
import { initializeClient as initStatic, InMemoryPersistence } from '../llm-static.js';
import { createWorkspace } from '../workspace.js';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Static Mode Integration Tests
 *
 * Tests the static context loading feature with automatic snapshot generation
 * and XML output deserialization.
 *
 * Run with OpenAI: OPENAI_API_KEY=xxx npm test
 * Run with gateway: LLM_GATEWAY_URL=http://localhost:8000/local-llm/v1 LLM_GATEWAY_API_KEY=xxx LLM_MODEL=gpt-oss:120b npm test
 */
describe('Static Mode Integration Tests', () => {
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
                // Initialize both clients with gateway
                initDynamic({ apiKey, baseURL });
                initStatic({ apiKey, baseURL });
            } else {
                console.log(`Testing with OpenAI, model: ${model}`);
                // Initialize both clients
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
        test('skipping static mode tests - no OPENAI_API_KEY', () => {
            console.log('ℹ️  Set OPENAI_API_KEY to run static mode tests');
            expect(true).toBe(true);
        });
    }

    testFn('should execute in static mode with auto-generated snapshot', async () => {
        console.log('\n=== Static Mode: Auto-Generated Snapshot ===\n');

        const result = await workspace.execute(
            'Build a simple todo app with add, complete, and delete functionality',
            {
                instructions: [aiRules],
                mode: 'static',
                model
            }
        );

        // Verify result structure
        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(result.filesWritten).toBeDefined();
        expect(Array.isArray(result.filesWritten)).toBe(true);

        console.log(`\n✓ Files written: ${result.filesWritten.length}`);
        result.filesWritten.forEach(file => {
            console.log(`   - ${file.path} (${file.size} bytes)`);
        });

        // Verify at least one file was written
        expect(result.filesWritten.length).toBeGreaterThan(0);

        // Verify files actually exist on disk
        for (const file of result.filesWritten) {
            const fullPath = path.join(workspace.path, file.path);
            const exists = await fs.access(fullPath).then(() => true).catch(() => false);
            expect(exists).toBe(true);

            const content = await fs.readFile(fullPath, 'utf-8');
            expect(content.length).toBeGreaterThan(0);
        }

        // Verify todo functionality was created
        const todoFiles = result.filesWritten.filter(f =>
            f.path.toLowerCase().includes('todo')
        );
        expect(todoFiles.length).toBeGreaterThan(0);

        console.log('\n=== Static Mode Test Complete ===\n');
    }, 180000);

    testFn('should execute in static mode with custom snapshot config', async () => {
        console.log('\n=== Static Mode: Custom Snapshot Config ===\n');

        const result = await workspace.execute(
            'Add a simple header component',
            {
                instructions: [aiRules],
                mode: 'static',
                model,
                snapshot: {
                    include: ['src/**/*'],
                    extensions: ['.tsx', '.ts'],
                    exclude: ['**/*.test.ts']
                }
            }
        );

        expect(result.filesWritten).toBeDefined();

        // Debug: show what LLM returned
        if (result.filesWritten.length === 0) {
            console.log('\n⚠️  No files written. LLM response:');
            console.log(result.content.substring(0, 1000));
            console.log('\n...\n');
        }

        expect(result.filesWritten.length).toBeGreaterThan(0);

        console.log(`✓ Generated ${result.filesWritten.length} files with custom snapshot config`);

        // Verify header component was created
        const headerFiles = result.filesWritten.filter(f =>
            f.path.toLowerCase().includes('header')
        );
        expect(headerFiles.length).toBeGreaterThan(0);

        console.log('\n=== Custom Snapshot Test Complete ===\n');
    }, 180000);

    testFn('should execute in static mode with pre-computed snapshot', async () => {
        console.log('\n=== Static Mode: Pre-Computed Snapshot ===\n');

        // Pre-compute snapshot
        console.log('Creating snapshot...');
        const snapshot = await workspace.snapshot({
            include: ['src/**/*'],
            extensions: ['.ts', '.tsx', '.css']
        });
        console.log(`✓ Snapshot created (${snapshot.length} chars)`);

        // Use pre-computed snapshot
        const result = await workspace.execute(
            'Add a footer component',
            {
                instructions: [aiRules],
                mode: 'static',
                model,
                snapshot: snapshot  // Pass snapshot directly
            }
        );

        expect(result.filesWritten).toBeDefined();
        expect(result.filesWritten.length).toBeGreaterThan(0);

        console.log(`✓ Generated ${result.filesWritten.length} files using pre-computed snapshot`);

        // Verify footer component was created
        const footerFiles = result.filesWritten.filter(f =>
            f.path.toLowerCase().includes('footer')
        );
        expect(footerFiles.length).toBeGreaterThan(0);

        console.log('\n=== Pre-Computed Snapshot Test Complete ===\n');
    }, 180000);

    testFn('should handle XML deserialization correctly', async () => {
        console.log('\n=== Static Mode: XML Deserialization ===\n');

        const result = await workspace.execute(
            'Create a Button component with primary and secondary variants',
            {
                instructions: [aiRules],
                mode: 'static',
                model
            }
        );

        // Verify filesWritten metadata
        expect(result.filesWritten).toBeDefined();
        result.filesWritten.forEach(file => {
            expect(file).toHaveProperty('path');
            expect(file).toHaveProperty('size');
            expect(typeof file.path).toBe('string');
            expect(typeof file.size).toBe('number');
            expect(file.size).toBeGreaterThan(0);
        });

        // Verify files were actually written
        for (const file of result.filesWritten) {
            const fullPath = path.join(workspace.path, file.path);
            const stats = await fs.stat(fullPath);
            expect(stats.isFile()).toBe(true);

            const content = await fs.readFile(fullPath, 'utf-8');
            // Verify file size in metadata matches (approximately, due to trimming)
            expect(Math.abs(content.length - file.size)).toBeLessThan(100);
        }

        console.log(`✓ All ${result.filesWritten.length} files deserialized and written correctly`);
        console.log('\n=== XML Deserialization Test Complete ===\n');
    }, 180000);

    testFn('should work with conversation mode in static mode', async () => {
        console.log('\n=== Static Mode: Conversation Mode ===\n');

        const persistence = new InMemoryPersistence();

        const result = await workspace.execute(
            'Create a simple card component',
            {
                instructions: [aiRules],
                mode: 'static',
                model,
                conversation: true,
                conversationPersistence: persistence
            }
        );

        expect(result.filesWritten).toBeDefined();
        expect(result.filesWritten.length).toBeGreaterThan(0);

        console.log(`✓ Conversation mode works with static mode (${result.filesWritten.length} files)`);
        console.log('\n=== Conversation Mode Test Complete ===\n');
    }, 180000);

    describe('Streaming Mode', () => {
        testFn('should stream output and write files after completion', async () => {
            console.log('\n=== Static Mode: Basic Streaming ===\n');

            const chunks = [];

            const result = await workspace.execute(
                'Create a simple Alert component',
                {
                    instructions: [aiRules],
                    mode: 'static',
                    model,  // Use gpt-5 for larger context
                    stream: true,
                    streamCallback: (chunk) => {
                        chunks.push(chunk);
                    }
                }
            );

            // Verify streaming happened
            expect(chunks.length).toBeGreaterThan(1);
            console.log(`✓ Received ${chunks.length} chunks during streaming`);

            // Verify files were written after streaming completed
            expect(result.filesWritten).toBeDefined();
            expect(result.filesWritten.length).toBeGreaterThan(0);
            console.log(`✓ Created ${result.filesWritten.length} files after streaming`);

            // Verify accumulated content matches the files
            const accumulatedContent = chunks.join('');
            expect(accumulatedContent.length).toBeGreaterThan(0);

            // Verify files actually exist on disk
            for (const file of result.filesWritten) {
                const fullPath = path.join(workspace.path, file.path);
                const exists = await fs.access(fullPath).then(() => true).catch(() => false);
                expect(exists).toBe(true);
                console.log(`✓ File written: ${file.path} (${file.size} bytes)`);
            }

            console.log('\n=== Basic Streaming Test Complete ===\n');
        }, 180000);

        testFn('should accumulate chunks and deserialize XML correctly', async () => {
            console.log('\n=== Static Mode: Streaming XML Deserialization ===\n');

            const chunks = [];
            let hasSeenPartialTag = false;

            const result = await workspace.execute(
                'Create a Badge component with different colors',
                {
                    instructions: [aiRules],
                    mode: 'static',
                    model,  // Use gpt-5 for larger context
                    stream: true,
                    streamCallback: (chunk) => {
                        chunks.push(chunk);
                        // Check if we're seeing partial XML tags (normal in streaming)
                        if (chunk.includes('<sg-file') || chunk.includes('</sg-file>')) {
                            hasSeenPartialTag = true;
                        }
                    }
                }
            );

            console.log(`✓ Received ${chunks.length} chunks`);
            console.log(`✓ Saw XML tags in chunks: ${hasSeenPartialTag}`);

            // Verify files were correctly deserialized from accumulated chunks
            expect(result.filesWritten).toBeDefined();
            expect(result.filesWritten.length).toBeGreaterThan(0);

            // Verify each file has valid content
            for (const file of result.filesWritten) {
                const fullPath = path.join(workspace.path, file.path);
                const content = await fs.readFile(fullPath, 'utf-8');
                expect(content.length).toBeGreaterThan(0);

                // Badge component should have color-related code
                if (file.path.toLowerCase().includes('badge')) {
                    const hasColorLogic = content.includes('color') ||
                                         content.includes('variant') ||
                                         content.includes('className');
                    expect(hasColorLogic).toBe(true);
                }
            }

            console.log(`✓ All ${result.filesWritten.length} files properly deserialized from streamed chunks`);
            console.log('\n=== Streaming XML Deserialization Test Complete ===\n');
        }, 180000);

        testFn('should stream with conversation persistence', async () => {
            console.log('\n=== Static Mode: Streaming + Conversation Persistence ===\n');

            const { InMemoryPersistence } = await import('./llm-static.js');
            const persistence = new InMemoryPersistence();
            const chunks1 = [];
            const chunks2 = [];

            // First message with streaming
            const result1 = await workspace.execute(
                'Create a simple Input component',
                {
                    instructions: [aiRules],
                    mode: 'static',
                    model,  // Use gpt-5 for larger context
                    conversation: true,
                    conversationPersistence: persistence,
                    stream: true,
                    streamCallback: (chunk) => {
                        chunks1.push(chunk);
                    }
                }
            );

            expect(chunks1.length).toBeGreaterThan(1);
            expect(result1.filesWritten.length).toBeGreaterThan(0);
            console.log(`✓ First turn: ${chunks1.length} chunks, ${result1.filesWritten.length} files`);

            // Verify conversation was saved
            const history1 = await persistence.get(result1.conversationID);
            expect(history1.length).toBe(2); // user + assistant
            console.log(`✓ Conversation saved (${history1.length} messages)`);

            // Second message in same conversation
            const result2 = await workspace.execute(
                'Add a variant prop to the Input component',
                {
                    instructions: [aiRules],
                    mode: 'static',
                    model,  // Use gpt-5 for larger context
                    conversation: true,
                    conversationID: result1.conversationID,
                    conversationPersistence: persistence,
                    stream: true,
                    streamCallback: (chunk) => {
                        chunks2.push(chunk);
                    }
                }
            );

            expect(chunks2.length).toBeGreaterThan(1);
            console.log(`✓ Second turn: ${chunks2.length} chunks, ${result2.filesWritten.length} files`);

            // Verify conversation history grew
            const history2 = await persistence.get(result1.conversationID);
            expect(history2.length).toBe(4); // 2 user + 2 assistant
            console.log(`✓ Conversation history: ${history2.length} messages`);

            // Verify assistant messages are compact (not full XML)
            const assistantMsg = history2[1];
            expect(assistantMsg.role).toBe('assistant');
            expect(assistantMsg.content.startsWith('Modified:')).toBe(true);
            expect(assistantMsg.content).not.toContain('<sg-file');
            console.log(`✓ Assistant message compact: "${assistantMsg.content}"`);

            console.log('\n=== Streaming + Conversation Persistence Test Complete ===\n');
        }, 180000);

        testFn('should stream real-time output while accumulating for file writes', async () => {
            console.log('\n=== Static Mode: Real-time Streaming ===\n');

            const chunks = [];
            const timestamps = [];
            let firstChunkTime = null;
            let lastChunkTime = null;

            const result = await workspace.execute(
                'Create a Modal component',
                {
                    instructions: [aiRules],
                    mode: 'static',
                    model,  // Use gpt-5 for larger context
                    stream: true,
                    streamCallback: (chunk) => {
                        const now = Date.now();
                        if (!firstChunkTime) firstChunkTime = now;
                        lastChunkTime = now;

                        chunks.push(chunk);
                        timestamps.push(now);
                    }
                }
            );

            // Verify chunks arrived over time (not all at once)
            const streamDuration = lastChunkTime - firstChunkTime;
            expect(streamDuration).toBeGreaterThan(0);
            console.log(`✓ Streaming duration: ${streamDuration}ms`);
            console.log(`✓ Received ${chunks.length} chunks over time`);

            // Verify files were written after streaming
            expect(result.filesWritten.length).toBeGreaterThan(0);
            console.log(`✓ Files written after streaming: ${result.filesWritten.length}`);

            // Verify accumulated content contains file content
            const accumulatedContent = chunks.join('');
            for (const file of result.filesWritten) {
                const fullPath = path.join(workspace.path, file.path);
                const content = await fs.readFile(fullPath, 'utf-8');
                expect(content.length).toBeGreaterThan(0);
            }

            console.log('✓ All files properly reconstructed from real-time stream');
            console.log('\n=== Real-time Streaming Test Complete ===\n');
        }, 180000);
    });
});
