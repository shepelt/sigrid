import { describe, test, expect, beforeAll, afterEach } from '@jest/globals';
import 'dotenv/config';
import { initializeClient as initStatic } from '../llm-static.js';
import { createWorkspace } from '../workspace.js';
import { applyAddon, isAddonApplied, getAddonInternalPaths } from '../addon.js';
import sqliteAddon from '../test-fixtures/addons/sqlite.js';
import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Addon System Tests
 *
 * Tests the addon application system:
 * 1. Addon files are copied correctly (docs, internal, interface)
 * 2. Internal files are excluded from snapshots
 * 3. LLM can use addon functionality in generated code
 *
 * Run with: npm test -- addon.integration.test.js
 * Run with gateway: LLM_GATEWAY_URL=xxx LLM_GATEWAY_API_KEY=xxx LLM_MODEL=xxx npm test -- addon.integration.test.js
 */
describe('Addon System Tests', () => {
    const hasApiKey = !!process.env.OPENAI_API_KEY || !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);
    const testFn = hasApiKey ? test : test.skip;
    const model = process.env.LLM_MODEL || 'gpt-5';

    let workspace;
    let tarballBuffer;
    const scaffoldPath = path.join(__dirname, '..', 'test-fixtures', 'react-scaffold.tar.gz');

    beforeAll(async () => {
        if (hasApiKey) {
            const baseURL = process.env.LLM_GATEWAY_URL;
            const apiKey = baseURL ? process.env.LLM_GATEWAY_API_KEY : process.env.OPENAI_API_KEY;

            if (baseURL) {
                console.log(`Testing with gateway: ${baseURL}, model: ${model}`);
                initStatic({ apiKey, baseURL });
            } else {
                console.log(`Testing with OpenAI, model: ${model}`);
                initStatic(apiKey);
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

    if (!hasApiKey) {
        test('skipping addon tests - no API key', () => {
            console.log('ℹ️  Set OPENAI_API_KEY or LLM_GATEWAY_URL to run addon tests');
            expect(true).toBe(true);
        });
    }

    test('should apply SQLite addon to workspace', async () => {
        console.log('\n=== Testing Addon Application ===\n');

        workspace = await createWorkspace(tarballBuffer);
        console.log(`✓ Workspace created: ${workspace.path}`);

        // Verify SQLite files don't exist initially
        const dbPath = path.join(workspace.path, 'src/lib/database.js');
        const dbExists = await fs.access(dbPath).then(() => true).catch(() => false);
        expect(dbExists).toBe(false);
        console.log('✓ Database files not in base scaffold');

        // Apply SQLite addon
        const result = await applyAddon(workspace, sqliteAddon);

        console.log('\nAddon application result:');
        console.log(`  Addon: ${result.addon} v${result.version}`);
        console.log(`  Files added: ${result.filesAdded.length}`);
        result.filesAdded.forEach(file => console.log(`    - ${file}`));

        if (result.dependenciesAdded) {
            console.log('  Dependencies added:');
            Object.entries(result.dependenciesAdded).forEach(([name, version]) => {
                console.log(`    - ${name}: ${version}`);
            });
        }

        // Verify files were added
        expect(result.filesAdded.length).toBeGreaterThan(0);

        // Verify database files now exist
        const dbExistsAfter = await fs.access(dbPath).then(() => true).catch(() => false);
        const clientDbPath = path.join(workspace.path, 'src/lib/client-database.js');
        const clientDbExists = await fs.access(clientDbPath).then(() => true).catch(() => false);
        const docsPath = path.join(workspace.path, 'docs/database-api.md');
        const docsExist = await fs.access(docsPath).then(() => true).catch(() => false);

        expect(dbExistsAfter).toBe(true);
        expect(clientDbExists).toBe(true);
        expect(docsExist).toBe(true);
        console.log('\n✓ All addon files copied successfully');

        // Verify package.json was updated
        const packageJson = JSON.parse(await fs.readFile(path.join(workspace.path, 'package.json'), 'utf-8'));
        expect(packageJson.dependencies['sql.js']).toBeDefined();
        console.log('✓ package.json updated with dependencies');

        // Verify AI_RULES.md was updated
        const aiRules = await fs.readFile(path.join(workspace.path, 'AI_RULES.md'), 'utf-8');
        expect(aiRules.includes('Sqlite')).toBe(true);  // Auto-generated title from addon.name
        expect(aiRules.includes('createDatabase')).toBe(true);  // Verify API content
        console.log('✓ AI_RULES.md updated');

        // Verify addon is detected as applied
        const isApplied = await isAddonApplied(workspace, sqliteAddon);
        expect(isApplied).toBe(true);
        console.log('✓ Addon detected as applied');

        console.log('\n=== Addon Application Test Complete ===\n');
    });

    test('should exclude internal files from snapshot', async () => {
        console.log('\n=== Testing Internal File Exclusion ===\n');

        workspace = await createWorkspace(tarballBuffer);
        await applyAddon(workspace, sqliteAddon);

        // Install dependencies first
        execSync('npm install', { cwd: workspace.path, stdio: 'ignore' });

        // Generate snapshot
        const snapshot = await workspace.snapshot();

        console.log(`Snapshot size: ${snapshot.length} characters`);

        // Internal files should NOT be in snapshot
        const hasDatabase = snapshot.includes('src/lib/database.js');
        const hasClientDatabase = snapshot.includes('src/lib/client-database.js');

        // Docs SHOULD be in snapshot
        const hasDocs = snapshot.includes('docs/database-api.md');
        const hasDocsContent = snapshot.includes('createDatabase');

        console.log(`\nSnapshot contents:`);
        console.log(`  database.js (internal): ${hasDatabase} (should be false)`);
        console.log(`  client-database.js (internal): ${hasClientDatabase} (should be false)`);
        console.log(`  database-api.md (docs): ${hasDocs} (should be true)`);
        console.log(`  API reference content: ${hasDocsContent} (should be true)`);

        expect(hasDatabase).toBe(false);
        expect(hasClientDatabase).toBe(false);
        expect(hasDocs).toBe(true);
        expect(hasDocsContent).toBe(true);

        // Verify internal paths are registered
        const internalPaths = getAddonInternalPaths();
        expect(internalPaths.length).toBeGreaterThan(0);
        console.log(`\n✓ ${internalPaths.length} internal paths registered for exclusion`);

        console.log('\n=== Exclusion Test Complete ===\n');
    }, 60000);

    testFn('should generate code using SQLite addon', async () => {
        console.log('\n=== Testing LLM Code Generation with Addon ===\n');

        workspace = await createWorkspace(tarballBuffer);
        await applyAddon(workspace, sqliteAddon);

        // Install dependencies
        console.log('Installing dependencies...');
        execSync('npm install', { cwd: workspace.path, stdio: 'inherit' });
        console.log('✓ Dependencies installed');

        // Generate todo app with database
        console.log('\nGenerating todo app with SQLite...');
        const result = await workspace.execute(
            'Build a todo app with database storage. Add todos, mark complete, delete todos. Use the available database API.',
            {
                instructions: [await workspace.getAIRules()],
                mode: 'static',
                model
            }
        );

        console.log(`\n✓ Generated ${result.filesWritten.length} files`);
        result.filesWritten.forEach(file => {
            console.log(`   - ${file.path} (${file.size} bytes)`);
        });

        // Verify database usage
        let foundDatabaseImport = false;
        let foundDatabaseInit = false;
        let foundSqlStatements = false;

        for (const file of result.filesWritten) {
            if (file.path.match(/\.(tsx?|jsx?)$/)) {
                const content = await fs.readFile(path.join(workspace.path, file.path), 'utf-8');

                if (content.includes('createDatabase') && content.includes('@/lib/database')) {
                    foundDatabaseImport = true;
                    console.log(`✓ Found database import in ${file.path}`);
                }

                if (content.includes('await createDatabase()') || content.includes('createDatabase()')) {
                    foundDatabaseInit = true;
                    console.log(`✓ Found database init in ${file.path}`);
                }

                if (content.match(/CREATE TABLE|INSERT INTO|SELECT.*FROM|UPDATE.*SET|DELETE FROM/)) {
                    foundSqlStatements = true;
                    console.log(`✓ Found SQL in ${file.path}`);
                }
            }
        }

        expect(foundDatabaseImport).toBe(true);
        expect(foundDatabaseInit).toBe(true);
        expect(foundSqlStatements).toBe(true);

        // Try to build
        console.log('\n=== Building Project ===');
        execSync('npm run build', {
            cwd: workspace.path,
            stdio: 'inherit',
            timeout: 180000
        });
        console.log('✓ Build succeeded');

        const distExists = await fs.access(path.join(workspace.path, 'dist')).then(() => true).catch(() => false);
        expect(distExists).toBe(true);

        console.log('\n=== LLM Generation Test Complete ===\n');
    }, 360000);

    testFn('should not reinvent SQLite when addon is available', async () => {
        console.log('\n=== Testing LLM Uses Addon Instead of Reimplementing ===\n');

        workspace = await createWorkspace(tarballBuffer);
        await applyAddon(workspace, sqliteAddon);

        // Install dependencies
        console.log('Installing dependencies...');
        execSync('npm install', { cwd: workspace.path, stdio: 'ignore' });
        console.log('✓ Dependencies installed');

        // Ask LLM to build a database-backed app
        console.log('\nGenerating database app...');
        const result = await workspace.execute(
            'Create a simple notes app with persistent storage. Users should be able to add, view, and delete notes.',
            {
                instructions: [await workspace.getAIRules()],
                mode: 'static',
                model
            }
        );

        console.log(`✓ Generated ${result.filesWritten.length} files`);

        // Read all generated code
        let allCode = '';
        for (const file of result.filesWritten) {
            if (file.path.match(/\.(tsx?|jsx?)$/)) {
                const content = await fs.readFile(path.join(workspace.path, file.path), 'utf-8');
                allCode += content + '\n';
            }
        }

        // Verify LLM uses the addon API instead of reimplementing
        expect(allCode).toContain('createDatabase');
        console.log('✓ Uses createDatabase from addon');

        // Verify LLM doesn't try to use sql.js directly
        expect(allCode).not.toMatch(/import.*sql\.js/i);
        expect(allCode).not.toMatch(/import.*SQL\s+from/);
        console.log('✓ Does not import sql.js directly');

        // Verify LLM doesn't try to use IndexedDB directly
        expect(allCode).not.toContain('indexedDB.open');
        expect(allCode).not.toContain('IDBDatabase');
        console.log('✓ Does not use IndexedDB directly');

        // Verify build succeeds
        console.log('\n=== Building Project ===');
        execSync('npm run build', { cwd: workspace.path, stdio: 'inherit', timeout: 180000 });
        console.log('✓ Build succeeded');

        console.log('\n=== Negative Test Complete ===\n');
    }, 360000);

    testFn('should follow patterns from addon documentation', async () => {
        console.log('\n=== Testing LLM Follows Addon Documentation ===\n');

        workspace = await createWorkspace(tarballBuffer);
        await applyAddon(workspace, sqliteAddon);

        // Install dependencies
        console.log('Installing dependencies...');
        execSync('npm install', { cwd: workspace.path, stdio: 'ignore' });
        console.log('✓ Dependencies installed');

        // Ask LLM to build something that should use transactions
        console.log('\nGenerating app with bulk operations...');
        const result = await workspace.execute(
            'Create a contacts manager. Users should be able to import multiple contacts at once from a CSV file. Use transactions to ensure all contacts are imported atomically.',
            {
                instructions: [await workspace.getAIRules()],
                mode: 'static',
                model
            }
        );

        console.log(`✓ Generated ${result.filesWritten.length} files`);

        // Verify LLM uses transaction pattern from docs
        let foundTransaction = false;
        let foundProperPattern = false;

        for (const file of result.filesWritten) {
            if (file.path.match(/\.(tsx?|jsx?)$/)) {
                const content = await fs.readFile(path.join(workspace.path, file.path), 'utf-8');

                // Check for transaction usage (documented pattern)
                if (content.includes('transaction')) {
                    foundTransaction = true;
                    console.log(`✓ Found transaction usage in ${file.path}`);
                }

                // Check for proper error handling pattern
                if (content.match(/try\s*{[\s\S]*?await.*transaction[\s\S]*?catch/)) {
                    foundProperPattern = true;
                    console.log(`✓ Found proper transaction error handling in ${file.path}`);
                }
            }
        }

        expect(foundTransaction).toBe(true);

        console.log('\n=== Documentation Pattern Test Complete ===\n');
    }, 360000);

    testFn('should use addon for various database scenarios', async () => {
        console.log('\n=== Testing LLM Handles Multiple Database Scenarios ===\n');

        workspace = await createWorkspace(tarballBuffer);
        await applyAddon(workspace, sqliteAddon);

        // Install dependencies
        console.log('Installing dependencies...');
        execSync('npm install', { cwd: workspace.path, stdio: 'ignore' });
        console.log('✓ Dependencies installed');

        const scenarios = [
            {
                prompt: 'Create a simple counter app that persists the count in a database.',
                expectedPatterns: ['createDatabase', 'execute', 'UPDATE']
            },
            {
                prompt: 'Create a search feature that queries items by name from the database.',
                expectedPatterns: ['createDatabase', 'query', 'SELECT', 'WHERE']
            },
            {
                prompt: 'Create a feature to delete old records from the database.',
                expectedPatterns: ['createDatabase', 'execute', 'DELETE']
            }
        ];

        for (let i = 0; i < scenarios.length; i++) {
            const scenario = scenarios[i];
            console.log(`\n--- Scenario ${i + 1}: ${scenario.prompt.substring(0, 50)}... ---`);

            const result = await workspace.execute(scenario.prompt, {
                instructions: [await workspace.getAIRules()],
                mode: 'static',
                model
            });

            console.log(`✓ Generated ${result.filesWritten.length} files`);

            // Read generated code
            let allCode = '';
            for (const file of result.filesWritten) {
                if (file.path.match(/\.(tsx?|jsx?)$/)) {
                    const content = await fs.readFile(path.join(workspace.path, file.path), 'utf-8');
                    allCode += content + '\n';
                }
            }

            // Verify expected patterns
            for (const pattern of scenario.expectedPatterns) {
                expect(allCode).toContain(pattern);
                console.log(`  ✓ Contains ${pattern}`);
            }

            // Clean up files for next scenario
            for (const file of result.filesWritten) {
                await fs.unlink(path.join(workspace.path, file.path)).catch(() => {});
            }
        }

        console.log('\n=== Multiple Scenarios Test Complete ===\n');
    }, 600000);
});
