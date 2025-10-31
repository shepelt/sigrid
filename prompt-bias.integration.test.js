import { describe, it, expect, beforeAll, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execSync } from 'child_process';
import { createWorkspace, InMemoryPersistence, initializeClient } from './index.js';
import { applyAddon } from './addon.js';
import sqliteAddon from './test-fixtures/addons/sqlite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Test to reproduce the "aggressive file regeneration" problem described in suggestion.md
 *
 * Problem: The STATIC_CONTEXT_PROMPT instruction "ALWAYS write the ENTIRE file content"
 * is being interpreted as "output all files completely" instead of "when you output a file,
 * write it completely (not partial diffs)".
 *
 * Expected behavior on iterative changes:
 * - Only output files that need changes for the user's request
 * - When outputting a file, write the complete content (not diffs)
 *
 * Actual behavior (before fix):
 * - LLM regenerates ALL existing files, even ones that don't need changes
 *
 * This test uses:
 * - Real React scaffold (react-scaffold.tar.gz)
 * - SQLite addon with AI_RULES.md
 * - Multi-turn conversation to test iterative changes
 * - Same pattern as production (generationOrchestration.js)
 */
describe('Prompt Bias - Minimal File Regeneration', () => {
    let workspace;
    let tarballBuffer;
    const hasApiKey = !!process.env.OPENAI_API_KEY || !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);
    const model = process.env.LLM_MODEL || 'gpt-5-mini';
    const scaffoldPath = path.join(__dirname, 'test-fixtures', 'react-scaffold.tar.gz');

    /**
     * Load AI_RULES.md from workspace (mimics production pattern)
     */
    async function loadAIRules(workspaceDir) {
        const aiRulesPath = path.join(workspaceDir, 'AI_RULES.md');
        try {
            const aiRules = await fs.readFile(aiRulesPath, 'utf-8');
            console.log('✅ AI_RULES.md loaded from workspace');
            return [aiRules];
        } catch (err) {
            console.log('⚠️  AI_RULES.md not found in workspace');
            return [];
        }
    }

    beforeAll(async () => {
        // Initialize client if API key is available
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
            tarballBuffer = await fs.readFile(scaffoldPath);
        }
    }, 60000);

    afterEach(async () => {
        if (workspace) {
            if (process.env.KEEP_TEST_DIR) {
                console.log(`\n⚠️  Test directory preserved at: ${workspace.path}`);
            } else {
                await workspace.delete();
            }
            workspace = null;
        }
    });

    const requiresAPIKey = hasApiKey ? it : it.skip;

    requiresAPIKey('should only regenerate changed files on iterative requests', async () => {
        console.log('\n=== SETUP: Create workspace with SQLite addon ===\n');

        // Create workspace from scaffold
        workspace = await createWorkspace(tarballBuffer);
        console.log(`✓ Workspace created: ${workspace.path}`);

        // Apply SQLite addon (creates AI_RULES.md, database files, etc.)
        const addonResult = await applyAddon(workspace, sqliteAddon);
        console.log(`✓ SQLite addon applied: ${addonResult.filesAdded.length} files added`);

        // Install dependencies
        console.log('Installing dependencies...');
        execSync('npm install', { cwd: workspace.path, stdio: 'ignore' });
        console.log('✓ Dependencies installed');

        // Load AI_RULES.md as instructions (mimics production)
        const aiRulesInstructions = await loadAIRules(workspace.path);

        // Create persistence for conversation
        const persistence = new InMemoryPersistence();

        console.log('\n=== STEP 1: Initial generation (database analytics app) ===\n');

        // Step 1: Create initial database analytics app
        const prompt1 = 'Create a database analytics app that queries the SALES table and shows results in a table and bar chart. Include proper components for data display.';

        const result1 = await workspace.execute(prompt1, {
            mode: 'static',
            model,
            instructions: aiRulesInstructions,
            conversation: true,
            conversationPersistence: persistence
        });

        const gen1Files = result1.filesWritten.map(f => f.path);
        console.log(`Generation 1 created: ${gen1Files.length} files`);
        gen1Files.forEach(f => console.log(`  - ${f}`));

        // Verify initial files were created
        expect(gen1Files.length).toBeGreaterThanOrEqual(3);
        expect(result1.conversationID).toBeDefined();

        // Verify we're using the database API from addon
        let usesAddonAPI = false;
        for (const file of result1.filesWritten) {
            if (file.path.match(/\.(tsx?|jsx?)$/)) {
                const content = await fs.readFile(path.join(workspace.path, file.path), 'utf-8');
                if (content.includes('createDatabase') || content.includes('@/lib/database')) {
                    usesAddonAPI = true;
                    console.log(`✓ ${file.path} uses addon database API`);
                }
            }
        }
        expect(usesAddonAPI).toBe(true);

        console.log('\n=== STEP 2: Iterative change (add SQL editor) ===\n');
        console.log('Adding SQL editor - should only modify 2-3 files...\n');

        // Step 2: Add SQL editor (should only modify 2-3 files)
        const prompt2 = 'Add a SQL editor component where users can type and execute custom SQL queries. Update the existing page to include this editor.';

        const result2 = await workspace.execute(prompt2, {
            mode: 'static',
            model,
            instructions: aiRulesInstructions,
            conversation: true,
            conversationID: result1.conversationID,
            conversationPersistence: persistence
        });

        const gen2Files = result2.filesWritten.map(f => f.path);
        const gen2FileNames = gen2Files.map(p => path.basename(p));

        console.log(`Generation 2 modified: ${gen2Files.length} files`);
        gen2Files.forEach(f => console.log(`  - ${f}`));

        // === ANALYSIS ===

        console.log('\n=== ANALYSIS ===');

        // Identify what components exist from first generation
        const gen1ComponentFiles = gen1Files.filter(f =>
            f.includes('/components/') && f.match(/\.(tsx?|jsx?)$/)
        );
        console.log(`\nGeneration 1 created ${gen1ComponentFiles.length} component files:`);
        gen1ComponentFiles.forEach(f => console.log(`  - ${path.basename(f)}`));

        // Check for unnecessary regenerations
        const unnecessaryRegenerations = [];
        for (const gen1File of gen1ComponentFiles) {
            const gen1FileName = path.basename(gen1File);
            // Skip if it's likely the editor itself
            if (gen1FileName.toLowerCase().includes('editor')) continue;

            if (gen2FileNames.includes(gen1FileName)) {
                unnecessaryRegenerations.push(gen1FileName);
                console.log(`❌ UNNECESSARY: ${gen1FileName} was regenerated but not requested`);
            } else {
                console.log(`✅ NOT REGENERATED: ${gen1FileName}`);
            }
        }

        // Check if SQL editor was created
        const hasEditor = gen2FileNames.some(f =>
            f.toLowerCase().includes('editor') || f.toLowerCase().includes('sql')
        );
        if (hasEditor) {
            console.log(`✅ CORRECT: SQL editor component was created`);
        } else {
            console.log(`❌ MISSING: SQL editor component was not created`);
        }

        // Report results
        console.log('\n=== TEST RESULTS ===');
        console.log(`Expected: <= 3 files modified (SqlEditor + page that imports it, maybe App)`);
        console.log(`Actual: ${gen2Files.length} files modified`);
        console.log(`Unnecessary regenerations: ${unnecessaryRegenerations.length}`);

        if (unnecessaryRegenerations.length === 0 && gen2Files.length <= 3) {
            console.log('\n✅ PASSED: LLM made minimal, surgical changes');
            console.log(`   Only ${gen2Files.length} file(s) modified as expected`);
        } else {
            console.log('\n❌ FAILED: LLM regenerated unnecessary files');
            console.log(`   Unnecessary: ${unnecessaryRegenerations.join(', ')}`);
        }

        // Assertions
        expect(hasEditor).toBe(true); // Must have created the editor
        expect(gen2Files.length).toBeLessThanOrEqual(4); // At most 4 files (editor + page + maybe 2 others)
        expect(unnecessaryRegenerations.length).toBe(0); // No unnecessary regenerations

    }, 240000); // 4 minute timeout

    requiresAPIKey('should not regenerate unchanged components when styling one component', async () => {
        console.log('\n=== SETUP: Create workspace with SQLite addon ===\n');

        workspace = await createWorkspace(tarballBuffer);
        await applyAddon(workspace, sqliteAddon);
        execSync('npm install', { cwd: workspace.path, stdio: 'ignore' });

        const aiRulesInstructions = await loadAIRules(workspace.path);
        const persistence = new InMemoryPersistence();

        console.log('\n=== STEP 1: Create app with multiple components ===\n');

        const prompt1 = 'Create a simple app with a Header, Footer, and main content area that shows a welcome message.';

        const result1 = await workspace.execute(prompt1, {
            mode: 'static',
            model,
            instructions: aiRulesInstructions,
            conversation: true,
            conversationPersistence: persistence
        });

        const gen1Files = result1.filesWritten.map(f => f.path);
        console.log(`Generation 1 created: ${gen1Files.length} files`);
        gen1Files.forEach(f => console.log(`  - ${f}`));

        expect(gen1Files.length).toBeGreaterThanOrEqual(3);

        console.log('\n=== STEP 2: Style only the Header ===\n');

        const prompt2 = 'Update the Header component to have a nice gradient background and better styling. Do not modify any other components.';

        const result2 = await workspace.execute(prompt2, {
            mode: 'static',
            model,
            instructions: aiRulesInstructions,
            conversation: true,
            conversationID: result1.conversationID,
            conversationPersistence: persistence
        });

        const gen2Files = result2.filesWritten.map(f => f.path);
        const gen2FileNames = gen2Files.map(p => path.basename(p));

        console.log(`Generation 2 modified: ${gen2Files.length} files`);
        gen2Files.forEach(f => console.log(`  - ${f}`));

        console.log('\n=== ANALYSIS ===');

        // Should only modify Header
        const hasHeader = gen2FileNames.some(f => f.toLowerCase().includes('header'));
        const hasFooter = gen2FileNames.some(f => f.toLowerCase().includes('footer'));

        if (hasHeader) {
            console.log('✅ CORRECT: Header was modified');
        } else {
            console.log('❌ MISSING: Header was not modified');
        }

        if (hasFooter) {
            console.log('❌ UNNECESSARY: Footer was regenerated');
        } else {
            console.log('✅ CORRECT: Footer was not regenerated');
        }

        console.log('\n=== TEST RESULTS ===');
        if (!hasFooter && gen2Files.length <= 2) {
            console.log('✅ PASSED: Only Header (and possibly App) modified');
        } else {
            console.log('❌ FAILED: Unnecessary file regeneration detected');
        }

        expect(hasHeader).toBe(true);
        expect(hasFooter).toBe(false);
        expect(gen2Files.length).toBeLessThanOrEqual(2);

    }, 180000);
});
