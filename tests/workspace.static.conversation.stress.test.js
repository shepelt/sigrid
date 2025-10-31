import { describe, test, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import 'dotenv/config';
import { initializeClient } from '../llm-dynamic.js';
import { createWorkspace } from '../workspace.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Static Mode Conversation Stress Tests
 *
 * Tests conversation persistence feature under stress conditions:
 * - Repeated multi-turn conversations (memory leaks)
 * - Large conversation history with recall (scalability)
 * - Concurrent conversations with different persistence providers
 *
 * Run with OpenAI: OPENAI_API_KEY=xxx npm test
 * Run with gateway: LLM_GATEWAY_URL=http://localhost:8000/local-llm/v1 LLM_GATEWAY_API_KEY=xxx LLM_MODEL=gpt-oss:120b npm test
 */
describe('Static Mode Conversation Stress Tests', () => {
    const hasApiKey = !!process.env.OPENAI_API_KEY || !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);
    const testFn = hasApiKey ? test : test.skip;
    const model = process.env.LLM_MODEL || 'gpt-5-mini';

    let workspace;
    let aiRules;
    let tarballBuffer;
    const scaffoldPath = path.join(__dirname, '..', 'test-fixtures', 'react-scaffold.tar.gz');

    beforeAll(async () => {
        if (hasApiKey) {
            const baseURL = process.env.LLM_GATEWAY_URL;
            const apiKey = baseURL ? process.env.LLM_GATEWAY_API_KEY : process.env.OPENAI_API_KEY;

            if (baseURL) {
                console.log(`Testing with gateway: ${baseURL}, model: ${model}`);
                initializeClient({ apiKey, baseURL });
            } else {
                console.log(`Testing with OpenAI, model: ${model}`);
                initializeClient(apiKey);
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

            // Read AI_RULES.md from workspace
            const aiRulesPath = path.join(workspace.path, 'AI_RULES.md');
            aiRules = await fs.readFile(aiRulesPath, 'utf-8');
            console.log('✓ AI_RULES.md loaded');
        }
    }, 30000);

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
        test('skipping conversation stress tests - no OPENAI_API_KEY', () => {
            console.log('ℹ️  Set OPENAI_API_KEY to run conversation stress tests');
            expect(true).toBe(true);
        });
    }

    testFn('stress test: repeated multi-turn conversations (memory leak detection)', async () => {
        console.log('\n=== Stress Test: Repeated Multi-turn Conversations ===\n');

        const { InMemoryPersistence } = await import('./persistence.js');
        const persistence = new InMemoryPersistence();

        const iterations = 5; // 5 conversations, 3 turns each = 15 LLM calls
        const results = {
            total: 0,
            successful: 0,
            failed: 0,
            memoryUsage: []
        };

        for (let i = 0; i < iterations; i++) {
            console.log(`\n--- Conversation ${i + 1}/${iterations} ---`);

            try {
                // Turn 1: Create initial file
                const r1 = await workspace.execute(
                    `Create a utility function called util${i}`,
                    {
                        instructions: [aiRules],
                        mode: 'static',
                        model,
                        conversation: true,
                        conversationPersistence: persistence
                    }
                );
                results.total++;
                expect(r1.conversationID).toBeDefined();
                expect(r1.filesWritten).toBeDefined();
                console.log(`  Turn 1: ✓ (${r1.filesWritten.length} files)`);

                // Turn 2: Modify the file
                const r2 = await workspace.execute(
                    `Add error handling to the util${i} function`,
                    {
                        instructions: [aiRules],
                        mode: 'static',
                        model,
                        conversation: true,
                        conversationID: r1.conversationID,
                        conversationPersistence: persistence
                    }
                );
                results.total++;
                expect(r2.conversationID).toBe(r1.conversationID);
                console.log(`  Turn 2: ✓ (${r2.filesWritten.length} files)`);

                // Turn 3: Create related file
                const r3 = await workspace.execute(
                    `Create a test file for util${i}`,
                    {
                        instructions: [aiRules],
                        mode: 'static',
                        model,
                        conversation: true,
                        conversationID: r1.conversationID,
                        conversationPersistence: persistence
                    }
                );
                results.total++;
                expect(r3.conversationID).toBe(r1.conversationID);
                console.log(`  Turn 3: ✓ (${r3.filesWritten.length} files)`);

                results.successful += 3;

                // Check memory usage
                const memUsage = process.memoryUsage();
                results.memoryUsage.push({
                    iteration: i + 1,
                    heapUsed: memUsage.heapUsed,
                    heapTotal: memUsage.heapTotal,
                    rss: memUsage.rss
                });

            } catch (error) {
                console.log(`  ✗ Failed: ${error.message}`);
                results.failed++;
            }
        }

        console.log('\n=== Memory Usage Analysis ===');
        results.memoryUsage.forEach((mem, idx) => {
            const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(2);
            const rssMB = (mem.rss / 1024 / 1024).toFixed(2);
            console.log(`  Conversation ${mem.iteration}: Heap=${heapMB}MB, RSS=${rssMB}MB`);
        });

        // Check for memory leaks (heap should not grow >2x)
        if (results.memoryUsage.length > 1) {
            const firstHeap = results.memoryUsage[0].heapUsed;
            const lastHeap = results.memoryUsage[results.memoryUsage.length - 1].heapUsed;
            const growthFactor = lastHeap / firstHeap;
            console.log(`\nMemory growth factor: ${growthFactor.toFixed(2)}x`);
            expect(growthFactor).toBeLessThan(3); // Should not grow more than 3x
        }

        // Check persistence stored all conversations
        const conversationCount = await persistence.size();
        console.log(`\nTotal conversations stored: ${conversationCount}`);
        expect(conversationCount).toBe(iterations);

        console.log('\n=== Multi-turn Conversation Stress Test Complete ===\n');
        console.log(`Success rate: ${results.successful}/${results.total} (${(results.successful / results.total * 100).toFixed(1)}%)`);

        // Should have high success rate
        expect(results.successful / results.total).toBeGreaterThanOrEqual(0.8);
    }, 600000);

    testFn('stress test: large conversation history with recall (scalability)', async () => {
        console.log('\n=== Stress Test: Large Conversation History with Recall ===\n');

        const { InMemoryPersistence } = await import('./persistence.js');
        const persistence = new InMemoryPersistence();

        let conversationID = null;

        // Turn 1: Establish something to remember
        console.log('Turn 1: Setting context...');
        const r1 = await workspace.execute(
            'Create a utility file src/utils/magic.js with a constant MAGIC_NUMBER = 42',
            {
                instructions: [aiRules],
                mode: 'static',
                model,
                conversation: true,
                conversationPersistence: persistence
            }
        );
        conversationID = r1.conversationID;
        expect(r1.filesWritten).toBeDefined();
        console.log('  ✓ Created magic.js');

        // Turns 2-9: Add noise to conversation history
        console.log('\nTurns 2-9: Adding noise to conversation...');
        for (let i = 2; i <= 9; i++) {
            const result = await workspace.execute(
                `Add a comment to any file: "Comment ${i}"`,
                {
                    instructions: [aiRules],
                    mode: 'static',
                    model,
                    conversation: true,
                    conversationID: conversationID,
                    conversationPersistence: persistence
                }
            );
            expect(result.conversationID).toBe(conversationID);
            console.log(`  Turn ${i}/9: ✓`);
        }

        // Turn 10: Test recall of turn 1
        console.log('\nTurn 10: Testing recall from turn 1...');
        const r10 = await workspace.execute(
            'What was the MAGIC_NUMBER I asked you to use in the first turn?',
            {
                instructions: [aiRules],
                mode: 'static',
                model,
                conversation: true,
                conversationID: conversationID,
                conversationPersistence: persistence
            }
        );

        expect(r10.conversationID).toBe(conversationID);

        // Verify LLM recalls the magic number
        const recall = r10.content.toLowerCase();
        const remembered = recall.includes('42') || recall.includes('forty-two') || recall.includes('forty two');
        console.log(`  Response: "${r10.content.substring(0, 100)}..."`);
        console.log(`  ✓ Recall successful: ${remembered}`);
        expect(remembered).toBe(true);

        // Verify conversation history size
        const history = await persistence.get(conversationID);
        expect(history).toBeDefined();

        console.log(`\nConversation history: ${history.length} messages`);

        // Should have 2 messages per turn (user + assistant)
        expect(history.length).toBe(10 * 2); // 10 turns = 20 messages

        // Verify history is ordered correctly
        expect(history[0].role).toBe('user');
        expect(history[1].role).toBe('assistant');

        // Verify the first turn is still in history
        expect(history[0].content).toContain('MAGIC_NUMBER');

        console.log('\n=== Large Conversation History with Recall Test Complete ===\n');
    }, 600000);

    testFn('stress test: concurrent conversations with persistence', async () => {
        console.log('\n=== Stress Test: Concurrent Conversations ===\n');

        const { InMemoryPersistence, FileSystemPersistence } = await import('./persistence.js');
        const path = await import('path');
        const os = await import('os');

        const inMemPersistence = new InMemoryPersistence();
        const fsPersistence = new FileSystemPersistence(
            path.join(os.tmpdir(), `sigrid-stress-${Date.now()}`)
        );

        // Create multiple workspaces and run concurrent conversations
        const workspace2 = await createWorkspace(tarballBuffer);
        const workspace3 = await createWorkspace(tarballBuffer);

        try {
            console.log('Running 3 concurrent conversations...\n');

            const results = await Promise.all([
                // Conversation 1: InMemory persistence
                workspace.execute(
                    'Create a Button component',
                    {
                        instructions: [aiRules],
                        mode: 'static',
                        model,
                        conversation: true,
                        conversationPersistence: inMemPersistence
                    }
                ),

                // Conversation 2: FileSystem persistence
                workspace2.execute(
                    'Create a Card component',
                    {
                        instructions: [aiRules],
                        mode: 'static',
                        model,
                        conversation: true,
                        conversationPersistence: fsPersistence
                    }
                ),

                // Conversation 3: InMemory persistence (different conversation)
                workspace3.execute(
                    'Create a Header component',
                    {
                        instructions: [aiRules],
                        mode: 'static',
                        model,
                        conversation: true,
                        conversationPersistence: inMemPersistence
                    }
                )
            ]);

            // Verify all succeeded
            results.forEach((result, idx) => {
                expect(result.conversationID).toBeDefined();
                expect(result.filesWritten).toBeDefined();
                expect(result.filesWritten.length).toBeGreaterThan(0);
                console.log(`  Conversation ${idx + 1}: ✓ (${result.filesWritten.length} files, ID: ${result.conversationID})`);
            });

            // Verify different conversation IDs
            const ids = results.map(r => r.conversationID);
            const uniqueIds = new Set(ids);
            expect(uniqueIds.size).toBe(3);
            console.log('\n✓ All conversations have unique IDs');

            // Verify persistence providers work correctly
            const inMemCount = await inMemPersistence.size();
            expect(inMemCount).toBe(2); // Conversations 1 and 3
            console.log(`✓ InMemory persistence: ${inMemCount} conversations`);

            // FS persistence should have files
            const fsHistory = await fsPersistence.get(results[1].conversationID);
            expect(fsHistory).toBeDefined();
            console.log('✓ FileSystem persistence: conversation stored');

            console.log('\n=== Concurrent Conversations Test Complete ===\n');

        } finally {
            // Cleanup
            await workspace2.delete();
            await workspace3.delete();
        }
    }, 600000);
});
