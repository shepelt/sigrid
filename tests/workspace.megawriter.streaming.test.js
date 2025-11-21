import { describe, test, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import dotenv from 'dotenv';
import { initializeClient as initDynamic } from '../llm-dynamic.js';
import { initializeClient as initStatic } from '../llm-static.js';

// Load .env file
dotenv.config();
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as tar from 'tar';
import { createWorkspace } from '../workspace.js';

describe('Workspace Megawriter Streaming Mode', () => {
    const hasApiKey = !!process.env.OPENAI_API_KEY || !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);
    const testFn = hasApiKey ? test : test.skip;
    const model = process.env.LLM_MODEL || 'gpt-4o';

    let tempDir;
    let testTarGz;

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
        }
    }, 60000);

    beforeEach(async () => {
        // Create temporary directory for tests
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sigrid-megawriter-streaming-test-'));

        // Create a simple test scaffold
        const scaffoldDir = path.join(tempDir, 'scaffold');
        await fs.mkdir(scaffoldDir);
        await fs.writeFile(path.join(scaffoldDir, 'README.md'), '# Test Project');
        await fs.mkdir(path.join(scaffoldDir, 'src'));
        await fs.writeFile(path.join(scaffoldDir, 'src', 'index.js'), 'console.log("hello");');

        // Create tar.gz from scaffold
        const tarPath = path.join(tempDir, 'test-scaffold.tar.gz');
        await tar.create(
            {
                gzip: true,
                file: tarPath,
                cwd: scaffoldDir
            },
            ['.']
        );

        testTarGz = await fs.readFile(tarPath);
    });

    afterEach(async () => {
        // Clean up temporary directory
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors in tests
        }
    });

    if (!hasApiKey) {
        test('skipping megawriter streaming test - no API key', () => {
            console.log('ℹ️  Set OPENAI_API_KEY or LLM_GATEWAY_URL to run this test');
            expect(true).toBe(true);
        });
    }

    testFn('workspace.execute with megawriter WITHOUT streaming returns filesWritten', async () => {
        const workspace = await createWorkspace(testTarGz);

        // Track progress events
        const progressEvents = [];

        const result = await workspace.execute(
            'Create two new files: src/hello.js with a hello function and src/world.js with a world function',
            {
                mode: 'static',
                model,
                enableMegawriter: true,
                stream: false,
                max_tokens: 8192,
                progressCallback: (event, data) => {
                    progressEvents.push({ event, data });
                }
            }
        );

        // Log results for confirmation
        console.log('\n=== Test Results (No Streaming) ===');
        console.log('Result keys:', Object.keys(result));
        console.log('filesWritten:', result.filesWritten);
        console.log('Number of files written:', result.filesWritten?.length);
        console.log('Files:', result.filesWritten?.map(f => f.path));
        console.log('\nResult content:');
        console.log(result.content);

        console.log('\nProgress events:');
        progressEvents.forEach(({ event, data }) => {
            console.log(`  - ${event}`, data ? JSON.stringify(data) : '');
        });

        // Assertions
        expect(result).toBeDefined();
        expect(result.filesWritten).toBeDefined();
        expect(Array.isArray(result.filesWritten)).toBe(true);

        // Should have at least 2 files written (hello.js and world.js)
        expect(result.filesWritten.length).toBeGreaterThanOrEqual(2);

        // Verify files exist on filesystem
        for (const fileInfo of result.filesWritten) {
            const filePath = path.join(workspace.path, fileInfo.path);
            const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
            expect(fileExists).toBe(true);
            console.log(`✓ File exists: ${fileInfo.path}`);
        }

        await workspace.delete();
    }, 60000);

    testFn('workspace.execute with megawriter and streaming returns filesWritten', async () => {
        const workspace = await createWorkspace(testTarGz);

        // Track progress events
        const progressEvents = [];
        const streamedChunks = [];

        const result = await workspace.execute(
            'Create two new files: src/hello.js with a hello function and src/world.js with a world function',
            {
                mode: 'static',
                model,
                enableMegawriter: true,
                stream: true,
                max_tokens: 8192,
                streamCallback: (chunk) => {
                    streamedChunks.push(chunk);
                },
                progressCallback: (event, data) => {
                    progressEvents.push({ event, data });
                }
            }
        );

        // Log results for confirmation
        console.log('\n=== Test Results ===');
        console.log('Result keys:', Object.keys(result));
        console.log('filesWritten:', result.filesWritten);
        console.log('Number of files written:', result.filesWritten?.length);
        console.log('Files:', result.filesWritten?.map(f => f.path));
        console.log('\nStreamed content:');
        console.log(streamedChunks.join(''));
        console.log('\nResult content:');
        console.log(result.content);

        console.log('\nProgress events:');
        progressEvents.forEach(({ event, data }) => {
            console.log(`  - ${event}`, data ? JSON.stringify(data) : '');
        });

        console.log('\nStreamed chunks:', streamedChunks.length);
        console.log('Total streamed content length:', streamedChunks.join('').length);

        // Assertions
        expect(result).toBeDefined();
        expect(result.filesWritten).toBeDefined();
        expect(Array.isArray(result.filesWritten)).toBe(true);

        // Should have at least 2 files written (hello.js and world.js)
        expect(result.filesWritten.length).toBeGreaterThanOrEqual(2);

        // Verify files exist on filesystem
        for (const fileInfo of result.filesWritten) {
            const filePath = path.join(workspace.path, fileInfo.path);
            const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
            expect(fileExists).toBe(true);
            console.log(`✓ File exists: ${fileInfo.path}`);
        }

        // Verify streaming occurred
        expect(streamedChunks.length).toBeGreaterThan(0);

        // Verify progress events
        const hasSnapshotGenerated = progressEvents.some(e => e.event === 'SNAPSHOT_GENERATED');
        const hasResponseStreaming = progressEvents.some(e => e.event === 'RESPONSE_STREAMING');
        const hasResponseStreamed = progressEvents.some(e => e.event === 'RESPONSE_STREAMED');
        const hasFilesWritten = progressEvents.some(e => e.event === 'FILES_WRITTEN');

        expect(hasSnapshotGenerated).toBe(true);
        expect(hasResponseStreaming).toBe(true);
        expect(hasResponseStreamed).toBe(true);
        expect(hasFilesWritten).toBe(true);

        await workspace.delete();
    }, 60000); // 60 second timeout for API call
});
