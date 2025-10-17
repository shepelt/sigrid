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
    let tarballBuffer;
    let staticContextPrompt;
    let hybridContextPrompt;
    let hybrid2ContextPrompt;
    const scaffoldPath = path.join(__dirname, 'test-fixtures', 'react-scaffold.tar.gz');

    beforeAll(async () => {
        if (hasApiKey) {
            initializeClient(process.env.OPENAI_API_KEY);

            // Load scaffold tarball once (reused for each test)
            console.log(`Loading scaffold from: ${scaffoldPath}`);
            tarballBuffer = await fs.readFile(scaffoldPath);
            console.log('✓ Scaffold tarball loaded');

            // Load static context prompt
            const staticPromptPath = path.join(__dirname, 'STATIC_CONTEXT_PROMPT.md');
            staticContextPrompt = await fs.readFile(staticPromptPath, 'utf-8');
            console.log('✓ Static context prompt loaded');

            // Load hybrid context prompt
            const hybridPromptPath = path.join(__dirname, 'HYBRID_CONTEXT_PROMPT.md');
            hybridContextPrompt = await fs.readFile(hybridPromptPath, 'utf-8');
            console.log('✓ Hybrid context prompt loaded');

            // Load hybrid2 context prompt
            const hybrid2PromptPath = path.join(__dirname, 'HYBRID_CONTEXT_PROMPT_2.md');
            hybrid2ContextPrompt = await fs.readFile(hybrid2PromptPath, 'utf-8');
            console.log('✓ Hybrid2 context prompt loaded');
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
    });

    describe('Static vs Dynamic Context Loading Benchmark', () => {
        testFn('should measure static context loading (snapshot)', async () => {
            console.log('\n=== Static Context Loading Benchmark ===\n');

            // Step 1: Create snapshot of existing scaffold
            console.log('[Step 1/2] Creating workspace snapshot...');
            const snapshotStart = Date.now();
            const snapshot = await workspace.snapshot({
                include: ['src/**/*'],
                extensions: ['.ts', '.tsx', '.css']
            });
            const snapshotTime = ((Date.now() - snapshotStart) / 1000).toFixed(1);
            console.log(`✓ Snapshot created (${snapshot.length} chars) [${snapshotTime}s]`);

            // Step 2: Execute with static context
            console.log('[Step 2/2] Executing with static context...');
            const executeStart = Date.now();

            const result = await workspace.execute(
                'Build a simple todo app with add, complete, and delete functionality',
                {
                    instructions: [
                        aiRules,
                        staticContextPrompt  // Add instructions for XML output
                    ],
                    prompts: [
                        'Here is the full codebase for context:',
                        snapshot
                    ],
                    model: 'gpt-5-mini',
                    conversation: true,
                    disableTools: ['read_file', 'write_file']  // Disable read/write to force XML output
                }
            );

            const executeTime = ((Date.now() - executeStart) / 1000).toFixed(1);
            const totalTime = ((Date.now() - snapshotStart) / 1000).toFixed(1);

            console.log('\n📊 Benchmark Results (Static Loading):');
            console.log(`   Snapshot creation: ${snapshotTime}s`);
            console.log(`   Execution time: ${executeTime}s`);
            console.log(`   Total time: ${totalTime}s`);
            console.log(`   Snapshot size: ${snapshot.length} chars`);

            // Parse XML output and write files
            console.log('\n[Parsing XML output and writing files...]');
            const fileRegex = /<file path="([^"]+)">\s*([\s\S]*?)\s*<\/file>/g;
            let match;
            let filesWritten = 0;

            while ((match = fileRegex.exec(result.content)) !== null) {
                const [_, filePath, content] = match;
                const fullPath = path.join(workspace.path, filePath);

                // Create directory if needed
                await fs.mkdir(path.dirname(fullPath), { recursive: true });

                // Write file
                await fs.writeFile(fullPath, content.trim());
                filesWritten++;
                console.log(`   ✓ Wrote: ${filePath} (${content.length} chars)`);
            }

            console.log(`\n   Total files written: ${filesWritten}`);

            // Verify todo app was created
            const srcDir = path.join(workspace.path, 'src');
            const allFiles = await fs.readdir(srcDir, { recursive: true });
            const todoFiles = allFiles.filter(f =>
                f.toLowerCase().includes('todo') &&
                (f.endsWith('.tsx') || f.endsWith('.ts'))
            );

            // Also check if Index.tsx was modified to include todo functionality
            const indexPath = path.join(workspace.path, 'src', 'pages', 'Index.tsx');
            const indexContent = await fs.readFile(indexPath, 'utf-8');
            const indexHasTodo = indexContent.toLowerCase().includes('todo');

            if (todoFiles.length > 0) {
                console.log(`\n   Found todo-related files: ${todoFiles.join(', ')}`);
                const firstTodoFile = path.join(srcDir, todoFiles[0]);
                const content = await fs.readFile(firstTodoFile, 'utf-8');
                console.log(`   Generated file: ${content.length} chars`);
                console.log('   ✓ Todo component created');
            } else if (indexHasTodo) {
                console.log('\n   Todo app added to Index.tsx');
                console.log(`   Modified Index.tsx: ${indexContent.length} chars`);
                console.log('   ✓ Todo app integrated into Index page');
            } else {
                console.log('\n   ⚠️  No todo functionality found');
                console.log('   LLM Response:', result.content.substring(0, 500));
            }

            console.log('\n=== Static Context Benchmark Complete ===\n');

            expect(filesWritten).toBeGreaterThan(0);
            expect(todoFiles.length > 0 || indexHasTodo).toBe(true);
            expect(result).toBeDefined();
        }, 90000); // 90 second timeout

        testFn('should measure dynamic context loading (read_file)', async () => {
            console.log('\n=== Dynamic Context Loading Benchmark ===\n');

            // Execute with dynamic context (LLM will call read_file)
            console.log('[Step 1/1] Executing with dynamic context (LLM will use read_file)...');
            const executeStart = Date.now();

            const result = await workspace.execute(
                'Build a simple todo app with add, complete, and delete functionality',
                {
                    instructions: [aiRules],
                    model: 'gpt-5-mini',
                    conversation: true
                }
            );

            const executeTime = ((Date.now() - executeStart) / 1000).toFixed(1);

            console.log('\n📊 Benchmark Results (Dynamic Loading):');
            console.log(`   Execution time: ${executeTime}s`);
            console.log(`   (includes read_file tool calls)`);

            // Verify todo app was created (check components or pages)
            const srcDir = path.join(workspace.path, 'src');
            const allFiles = await fs.readdir(srcDir, { recursive: true });
            const todoFiles = allFiles.filter(f =>
                f.toLowerCase().includes('todo') &&
                (f.endsWith('.tsx') || f.endsWith('.ts'))
            );

            // Also check if Index.tsx was modified to include todo functionality
            const indexPath = path.join(workspace.path, 'src', 'pages', 'Index.tsx');
            const indexContent = await fs.readFile(indexPath, 'utf-8');
            const indexHasTodo = indexContent.toLowerCase().includes('todo');

            if (todoFiles.length > 0) {
                console.log(`   Found todo-related files: ${todoFiles.join(', ')}`);
                const firstTodoFile = path.join(srcDir, todoFiles[0]);
                const content = await fs.readFile(firstTodoFile, 'utf-8');
                console.log(`   Generated file: ${content.length} chars`);
                console.log('✓ Todo component created');
            } else if (indexHasTodo) {
                console.log('   Todo app added to Index.tsx');
                console.log(`   Modified Index.tsx: ${indexContent.length} chars`);
                console.log('✓ Todo app integrated into Index page');
            } else {
                console.log('⚠️  No todo functionality found');
                console.log('LLM Response:', result.content.substring(0, 500));
            }

            console.log('\n=== Dynamic Context Benchmark Complete ===\n');

            expect(todoFiles.length > 0 || indexHasTodo).toBe(true);
            expect(result).toBeDefined();
        }, 180000); // 3 minute timeout

        testFn('should measure hybrid context loading (static read, dynamic write)', async () => {
            console.log('\n=== Hybrid Context Loading Benchmark ===\n');

            // Step 1: Create snapshot
            console.log('[Step 1/2] Creating workspace snapshot...');
            const snapshotStart = Date.now();
            const snapshot = await workspace.snapshot({
                include: ['src/**/*'],
                extensions: ['.ts', '.tsx', '.css']
            });
            const snapshotTime = ((Date.now() - snapshotStart) / 1000).toFixed(1);
            console.log(`✓ Snapshot created (${snapshot.length} chars) [${snapshotTime}s]`);

            // Step 2: Execute with hybrid context (snapshot + write_file)
            console.log('[Step 2/2] Executing with hybrid context...');
            const executeStart = Date.now();

            const result = await workspace.execute(
                'Build a simple todo app with add, complete, and delete functionality',
                {
                    instructions: [
                        aiRules,
                        hybridContextPrompt  // Add instructions for hybrid approach
                    ],
                    prompts: [
                        'Here is the full codebase for context:',
                        snapshot
                    ],
                    model: 'gpt-5-mini',
                    conversation: true,
                    disableTools: ['read_file']  // Disable only read_file, allow write_file
                }
            );

            const executeTime = ((Date.now() - executeStart) / 1000).toFixed(1);
            const totalTime = ((Date.now() - snapshotStart) / 1000).toFixed(1);

            console.log('\n📊 Benchmark Results (Hybrid Loading):');
            console.log(`   Snapshot creation: ${snapshotTime}s`);
            console.log(`   Execution time: ${executeTime}s`);
            console.log(`   Total time: ${totalTime}s`);
            console.log(`   Snapshot size: ${snapshot.length} chars`);
            console.log(`   (Static context for reading, write_file tool for output)`);

            // Verify todo app was created
            const srcDir = path.join(workspace.path, 'src');
            const allFiles = await fs.readdir(srcDir, { recursive: true });
            const todoFiles = allFiles.filter(f =>
                f.toLowerCase().includes('todo') &&
                (f.endsWith('.tsx') || f.endsWith('.ts'))
            );

            // Also check if Index.tsx was modified to include todo functionality
            const indexPath = path.join(workspace.path, 'src', 'pages', 'Index.tsx');
            const indexContent = await fs.readFile(indexPath, 'utf-8');
            const indexHasTodo = indexContent.toLowerCase().includes('todo');

            if (todoFiles.length > 0) {
                console.log(`\n   Found todo-related files: ${todoFiles.join(', ')}`);
                const firstTodoFile = path.join(srcDir, todoFiles[0]);
                const content = await fs.readFile(firstTodoFile, 'utf-8');
                console.log(`   Generated file: ${content.length} chars`);
                console.log('   ✓ Todo component created');
            } else if (indexHasTodo) {
                console.log('\n   Todo app added to Index.tsx');
                console.log(`   Modified Index.tsx: ${indexContent.length} chars`);
                console.log('   ✓ Todo app integrated into Index page');
            } else {
                console.log('\n   ⚠️  No todo functionality found');
                console.log('   LLM Response:', result.content.substring(0, 500));
            }

            console.log('\n=== Hybrid Context Benchmark Complete ===\n');

            expect(todoFiles.length > 0 || indexHasTodo).toBe(true);
            expect(result).toBeDefined();
        }, 180000); // 3 minute timeout

        testFn('should measure hybrid context 2 loading (dynamic read, static write)', async () => {
            console.log('\n=== Hybrid Context 2 Loading Benchmark ===\n');

            // Execute with hybrid2 context (read_file allowed, XML output required)
            console.log('[Step 1/1] Executing with hybrid context 2 (read_file allowed, XML output)...');
            const executeStart = Date.now();

            const result = await workspace.execute(
                'Build a simple todo app with add, complete, and delete functionality',
                {
                    instructions: [
                        aiRules,
                        hybrid2ContextPrompt  // Add instructions for hybrid2 approach
                    ],
                    model: 'gpt-5-mini',
                    conversation: true,
                    disableTools: ['write_file']  // Disable only write_file, allow read_file
                }
            );

            const executeTime = ((Date.now() - executeStart) / 1000).toFixed(1);

            console.log('\n📊 Benchmark Results (Hybrid2 Loading):');
            console.log(`   Execution time: ${executeTime}s`);
            console.log(`   (Dynamic read_file calls, XML output)`);

            // Parse XML output and write files
            console.log('\n[Parsing XML output and writing files...]');
            const fileRegex = /<file path="([^"]+)">\s*([\s\S]*?)\s*<\/file>/g;
            let match;
            let filesWritten = 0;

            while ((match = fileRegex.exec(result.content)) !== null) {
                const [_, filePath, content] = match;
                const fullPath = path.join(workspace.path, filePath);

                // Create directory if needed
                await fs.mkdir(path.dirname(fullPath), { recursive: true });

                // Write file
                await fs.writeFile(fullPath, content.trim());
                filesWritten++;
                console.log(`   ✓ Wrote: ${filePath} (${content.length} chars)`);
            }

            console.log(`\n   Total files written: ${filesWritten}`);

            // Verify todo app was created
            const srcDir = path.join(workspace.path, 'src');
            const allFiles = await fs.readdir(srcDir, { recursive: true });
            const todoFiles = allFiles.filter(f =>
                f.toLowerCase().includes('todo') &&
                (f.endsWith('.tsx') || f.endsWith('.ts'))
            );

            // Also check if Index.tsx was modified to include todo functionality
            const indexPath = path.join(workspace.path, 'src', 'pages', 'Index.tsx');
            const indexContent = await fs.readFile(indexPath, 'utf-8');
            const indexHasTodo = indexContent.toLowerCase().includes('todo');

            if (todoFiles.length > 0) {
                console.log(`\n   Found todo-related files: ${todoFiles.join(', ')}`);
                const firstTodoFile = path.join(srcDir, todoFiles[0]);
                const content = await fs.readFile(firstTodoFile, 'utf-8');
                console.log(`   Generated file: ${content.length} chars`);
                console.log('   ✓ Todo component created');
            } else if (indexHasTodo) {
                console.log('\n   Todo app added to Index.tsx');
                console.log(`   Modified Index.tsx: ${indexContent.length} chars`);
                console.log('   ✓ Todo app integrated into Index page');
            } else {
                console.log('\n   ⚠️  No todo functionality found');
                console.log('   LLM Response:', result.content.substring(0, 500));
            }

            console.log('\n=== Hybrid Context 2 Benchmark Complete ===\n');

            expect(filesWritten).toBeGreaterThan(0);
            expect(todoFiles.length > 0 || indexHasTodo).toBe(true);
            expect(result).toBeDefined();
        }, 180000); // 3 minute timeout
    });
});
