import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
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
 * Code Generation Benchmark Tests
 *
 * Measures performance of Sigrid's code generation capabilities.
 * These tests require OPENAI_API_KEY environment variable.
 */
describe('Code Generation Benchmark Tests', () => {
    const hasApiKey = !!process.env.OPENAI_API_KEY;
    const testFn = hasApiKey ? test : test.skip;

    let workspace;
    let aiRules;
    let codegenPrompts;
    let tarballBuffer;
    const scaffoldPath = path.join(__dirname, 'test-fixtures', 'react-scaffold.tar.gz');

    beforeAll(async () => {
        if (hasApiKey) {
            initializeClient(process.env.OPENAI_API_KEY);

            // Load scaffold tarball once (reused for each test)
            console.log(`Loading scaffold from: ${scaffoldPath}`);
            tarballBuffer = await fs.readFile(scaffoldPath);
            console.log('✓ Scaffold tarball loaded');

            // Read CODEGEN_PROMPTS.md from project root
            const codegenPromptsPath = path.join(__dirname, 'CODEGEN_PROMPTS.md');
            codegenPrompts = await fs.readFile(codegenPromptsPath, 'utf-8');
            console.log('✓ CODEGEN_PROMPTS.md loaded');
        }
    }, 60000); // 60 second timeout for setup

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
    }, 120000); // 2 minute timeout for each workspace setup

    afterEach(async () => {
        // Cleanup workspace after each test
        if (workspace) {
            if (process.env.KEEP_TEST_DIR) {
                console.log(`\n⚠️  Test directory preserved at: ${workspace.path}`);
                console.log(`To run the app manually:`);
                console.log(`  cd ${workspace.path}`);
                console.log(`  npm run dev`);
                console.log(`\nTo clean up later:`);
                console.log(`  rm -rf ${workspace.path}\n`);
            } else {
                console.log(`Cleaning up workspace: ${workspace.path}`);
                await workspace.delete();
            }
            workspace = null;
        }
    });

    if (!hasApiKey) {
        test('skipping benchmark tests - no OPENAI_API_KEY', () => {
            console.log('ℹ️  Set OPENAI_API_KEY to run benchmark tests');
            expect(true).toBe(true);
        });
    }

    describe('Simple Todo App Benchmark', () => {
        testFn('should measure time to generate todo app (default reasoning)', async () => {
            console.log('\n=== Todo App Benchmark (Default Reasoning) ===\n');
            const startTime = Date.now();

            const prompt = 'Build a simple todo app with add, complete, and delete functionality';

            const result = await workspace.execute(prompt, {
                instructions: [aiRules],
                model: 'gpt-5-mini',
                conversation: true
            });

            const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

            console.log(`\n📊 Benchmark Results:`);
            console.log(`   Model: gpt-5-mini (default reasoning)`);
            console.log(`   Total time: ${totalTime}s`);
            console.log(`   Prompt: "${prompt}"`);

            // Verify the todo app was created
            const todoPath = path.join(workspace.path, 'src', 'components', 'TodoApp.tsx');
            const todoExists = await fs.access(todoPath).then(() => true).catch(() => false);

            if (!todoExists) {
                console.log('⚠️  TodoApp.tsx not found, checking for other todo-related files...');
                const srcComponents = path.join(workspace.path, 'src', 'components');
                try {
                    const files = await fs.readdir(srcComponents, { recursive: true });
                    const todoFiles = files.filter(f => f.toLowerCase().includes('todo'));
                    console.log(`   Found files: ${todoFiles.join(', ') || 'none'}`);
                } catch (err) {
                    // Directory might not exist
                }
            } else {
                const content = await fs.readFile(todoPath, 'utf-8');
                console.log(`   Generated file size: ${content.length} chars`);
                console.log(`✓ Todo app component created`);
            }

            console.log(`\n=== Benchmark Complete ===\n`);

            // Basic assertion - just make sure it completed
            expect(result).toBeDefined();
            expect(totalTime).toBeDefined();

        }, 180000); // 3 minute timeout

        testFn('should measure time to generate todo app (minimal reasoning)', async () => {
            console.log('\n=== Todo App Benchmark (Minimal Reasoning) ===\n');
            const startTime = Date.now();

            const prompt = 'Build a simple todo app with add, complete, and delete functionality';

            const result = await workspace.execute(prompt, {
                instructions: [aiRules],
                model: 'gpt-5-mini',
                reasoningEffort: 'minimal',
                conversation: true
            });

            const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

            console.log(`\n📊 Benchmark Results:`);
            console.log(`   Model: gpt-5-mini (minimal reasoning)`);
            console.log(`   Total time: ${totalTime}s`);
            console.log(`   Prompt: "${prompt}"`);

            // Verify the todo app was created
            const srcComponents = path.join(workspace.path, 'src', 'components');
            let foundFiles = [];
            try {
                const files = await fs.readdir(srcComponents, { recursive: true });
                foundFiles = files.filter(f => f.toLowerCase().includes('todo'));
                console.log(`   Found files: ${foundFiles.join(', ') || 'none'}`);

                if (foundFiles.length > 0) {
                    const firstTodoFile = path.join(srcComponents, foundFiles[0]);
                    const content = await fs.readFile(firstTodoFile, 'utf-8');
                    console.log(`   Generated file size: ${content.length} chars`);
                    console.log(`✓ Todo app component created`);
                }
            } catch (err) {
                console.log('⚠️  Could not read components directory');
            }

            console.log(`\n=== Benchmark Complete ===\n`);

            // Basic assertion - just make sure it completed
            expect(result).toBeDefined();
            expect(totalTime).toBeDefined();

        }, 120000); // 2 minute timeout

        testFn('should measure time with AI_RULES + CODEGEN_PROMPTS (default reasoning)', async () => {
            console.log('\n=== Todo App Benchmark (AI_RULES + CODEGEN_PROMPTS, Default Reasoning) ===\n');
            const startTime = Date.now();

            const prompt = 'Build a simple todo app with add, complete, and delete functionality';

            const result = await workspace.execute(prompt, {
                instructions: [aiRules, codegenPrompts],
                model: 'gpt-5-mini',
                conversation: true
            });

            const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

            console.log(`\n📊 Benchmark Results:`);
            console.log(`   Model: gpt-5-mini (default reasoning + codegen prompts)`);
            console.log(`   Total time: ${totalTime}s`);
            console.log(`   Prompt: "${prompt}"`);

            // Verify the todo app was created
            const srcComponents = path.join(workspace.path, 'src', 'components');
            let foundFiles = [];
            try {
                const files = await fs.readdir(srcComponents, { recursive: true });
                foundFiles = files.filter(f => f.toLowerCase().includes('todo'));
                console.log(`   Found files: ${foundFiles.join(', ') || 'none'}`);

                if (foundFiles.length > 0) {
                    const firstTodoFile = path.join(srcComponents, foundFiles[0]);
                    const content = await fs.readFile(firstTodoFile, 'utf-8');
                    console.log(`   Generated file size: ${content.length} chars`);
                    console.log(`✓ Todo app component created`);
                }
            } catch (err) {
                console.log('⚠️  Could not read components directory');
            }

            console.log(`\n=== Benchmark Complete ===\n`);

            // Basic assertion - just make sure it completed
            expect(result).toBeDefined();
            expect(totalTime).toBeDefined();

        }, 180000); // 3 minute timeout

        testFn('should measure time with AI_RULES + CODEGEN_PROMPTS (minimal reasoning)', async () => {
            console.log('\n=== Todo App Benchmark (AI_RULES + CODEGEN_PROMPTS, Minimal Reasoning) ===\n');
            const startTime = Date.now();

            const prompt = 'Build a simple todo app with add, complete, and delete functionality';

            const result = await workspace.execute(prompt, {
                instructions: [aiRules, codegenPrompts],
                model: 'gpt-5-mini',
                reasoningEffort: 'minimal',
                conversation: true
            });

            const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

            console.log(`\n📊 Benchmark Results:`);
            console.log(`   Model: gpt-5-mini (minimal reasoning + codegen prompts)`);
            console.log(`   Total time: ${totalTime}s`);
            console.log(`   Prompt: "${prompt}"`);

            // Verify the todo app was created
            const srcComponents = path.join(workspace.path, 'src', 'components');
            let foundFiles = [];
            try {
                const files = await fs.readdir(srcComponents, { recursive: true });
                foundFiles = files.filter(f => f.toLowerCase().includes('todo'));
                console.log(`   Found files: ${foundFiles.join(', ') || 'none'}`);

                if (foundFiles.length > 0) {
                    const firstTodoFile = path.join(srcComponents, foundFiles[0]);
                    const content = await fs.readFile(firstTodoFile, 'utf-8');
                    console.log(`   Generated file size: ${content.length} chars`);
                    console.log(`✓ Todo app component created`);
                }
            } catch (err) {
                console.log('⚠️  Could not read components directory');
            }

            console.log(`\n=== Benchmark Complete ===\n`);

            // Basic assertion - just make sure it completed
            expect(result).toBeDefined();
            expect(totalTime).toBeDefined();

        }, 120000); // 2 minute timeout
    });
});
