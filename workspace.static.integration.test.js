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
 * Static Mode Integration Tests
 *
 * Tests the static context loading feature with automatic snapshot generation
 * and XML output deserialization.
 */
describe('Static Mode Integration Tests', () => {
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
                model: 'gpt-5'
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
                model: 'gpt-5',
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
                model: 'gpt-5',
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
                model: 'gpt-5-mini'
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

        const result = await workspace.execute(
            'Create a simple card component',
            {
                instructions: [aiRules],
                mode: 'static',
                model: 'gpt-5',
                conversation: true
            }
        );

        expect(result.filesWritten).toBeDefined();
        expect(result.filesWritten.length).toBeGreaterThan(0);

        console.log(`✓ Conversation mode works with static mode (${result.filesWritten.length} files)`);
        console.log('\n=== Conversation Mode Test Complete ===\n');
    }, 180000);
});
