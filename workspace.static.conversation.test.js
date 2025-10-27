import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createWorkspace, InMemoryPersistence, FileSystemPersistence, initializeClient } from './index.js';

describe('Workspace Static Mode - Multi-turn Conversations', () => {
    let workspace;
    let testDir;
    const apiKey = process.env.OPENAI_API_KEY;

    beforeEach(async () => {
        // Initialize client if API key is available
        if (apiKey) {
            initializeClient(apiKey);
        }


        // Create test workspace with initial files
        testDir = path.join(os.tmpdir(), `sigrid-static-conv-${Date.now()}`);
        await fs.mkdir(testDir, { recursive: true });

        // Create a simple initial structure
        await fs.mkdir(path.join(testDir, 'src'), { recursive: true });
        await fs.writeFile(
            path.join(testDir, 'src', 'index.js'),
            'console.log("Hello World");'
        );

        workspace = await createWorkspace();
        await fs.rm(workspace.path, { recursive: true, force: true });
        workspace.path = testDir;
        workspace._populated = true;
    });

    afterEach(async () => {
        if (testDir && !process.env.KEEP_TEST_DIR) {
            try {
                await fs.rm(testDir, { recursive: true, force: true });
            } catch (error) {
                // Ignore cleanup errors
            }
        }
    });

    const requiresAPIKey = apiKey ? it : it.skip;

    requiresAPIKey('multi-turn conversation with InMemoryPersistence', async () => {
        const persistence = new InMemoryPersistence();

        // Turn 1: Create a file
        const r1 = await workspace.execute(
            'Create a file src/utils.js with a single function "add(a, b)" that returns a + b',
            {
                mode: 'static',
                model: 'gpt-5-mini',
                conversation: true,
                conversationPersistence: persistence
            }
        );

        expect(r1.conversationID).toBeDefined();
        expect(r1.filesWritten).toBeDefined();
        expect(r1.filesWritten.length).toBeGreaterThan(0);

        // Verify file was created
        const utilsContent = await fs.readFile(path.join(testDir, 'src', 'utils.js'), 'utf-8');
        expect(utilsContent).toContain('add');

        // Turn 2: Reference previous turn
        const r2 = await workspace.execute(
            'Add another function "subtract(a, b)" to the utils.js file',
            {
                mode: 'static',
                model: 'gpt-5-mini',
                conversation: true,
                conversationID: r1.conversationID,
                conversationPersistence: persistence
            }
        );

        expect(r2.conversationID).toBe(r1.conversationID);
        expect(r2.filesWritten).toBeDefined();

        // Verify both functions exist
        const updatedContent = await fs.readFile(path.join(testDir, 'src', 'utils.js'), 'utf-8');
        expect(updatedContent).toContain('add');
        expect(updatedContent).toContain('subtract');

        // Turn 3: Reference even earlier context
        const r3 = await workspace.execute(
            'Create a file src/test.js that imports and tests both functions from utils.js',
            {
                mode: 'static',
                model: 'gpt-5-mini',
                conversation: true,
                conversationID: r1.conversationID,
                conversationPersistence: persistence
            }
        );

        expect(r3.conversationID).toBe(r1.conversationID);

        // Verify test file was created and references both functions
        const testContent = await fs.readFile(path.join(testDir, 'src', 'test.js'), 'utf-8');
        expect(testContent).toMatch(/add|subtract/);

        // Verify persistence stored all messages
        const history = await persistence.get(r1.conversationID);
        expect(history).toBeDefined();
        expect(history.length).toBe(6); // 3 user messages + 3 assistant messages
    }, 60000);

    requiresAPIKey('multi-turn conversation with FileSystemPersistence', async () => {
        const persistenceDir = path.join(testDir, '.conversations');
        const persistence = new FileSystemPersistence(persistenceDir);

        // Turn 1: Create initial files
        const r1 = await workspace.execute(
            'Create a simple React component src/Button.jsx that takes children and onClick props',
            {
                mode: 'static',
                model: 'gpt-5-mini',
                conversation: true,
                conversationPersistence: persistence
            }
        );

        expect(r1.conversationID).toBeDefined();
        expect(r1.filesWritten.length).toBeGreaterThan(0);

        // Verify conversation file was created
        const conversationFiles = await fs.readdir(persistenceDir);
        expect(conversationFiles.length).toBe(1);
        expect(conversationFiles[0]).toMatch(/\.jsonl$/);

        // Turn 2: Add to the component
        const r2 = await workspace.execute(
            'Add a disabled prop to the Button component',
            {
                mode: 'static',
                model: 'gpt-5-mini',
                conversation: true,
                conversationID: r1.conversationID,
                conversationPersistence: persistence
            }
        );

        expect(r2.conversationID).toBe(r1.conversationID);

        // Verify updated component
        const buttonContent = await fs.readFile(path.join(testDir, 'src', 'Button.jsx'), 'utf-8');
        expect(buttonContent).toMatch(/disabled/i);

        // Verify conversation history in filesystem
        const conversationFile = path.join(persistenceDir, conversationFiles[0]);
        const conversationContent = await fs.readFile(conversationFile, 'utf-8');
        const lines = conversationContent.trim().split('\n');
        expect(lines.length).toBe(4); // 2 user + 2 assistant messages

        // Each line should be valid JSON
        lines.forEach(line => {
            const message = JSON.parse(line);
            expect(message.role).toMatch(/user|assistant/);
            expect(message.content).toBeDefined();
        });
    }, 60000);

    requiresAPIKey('snapshot regeneration includes files from previous turns', async () => {
        const persistence = new InMemoryPersistence();

        // Turn 1: Create file A
        const r1 = await workspace.execute(
            'Create src/fileA.js with a constant: export const VALUE_A = 42;',
            {
                mode: 'static',
                model: 'gpt-5-mini',
                conversation: true,
                conversationPersistence: persistence
            }
        );

        expect(r1.filesWritten.some(f => f.path.includes('fileA'))).toBe(true);

        // Turn 2: Create file B that references A
        // This tests that the snapshot includes fileA from turn 1
        const r2 = await workspace.execute(
            'Create src/fileB.js that imports VALUE_A from fileA.js and uses it',
            {
                mode: 'static',
                model: 'gpt-5-mini',
                conversation: true,
                conversationID: r1.conversationID,
                conversationPersistence: persistence
            }
        );

        // Verify fileB imports from fileA
        const fileBContent = await fs.readFile(path.join(testDir, 'src', 'fileB.js'), 'utf-8');
        expect(fileBContent).toMatch(/import.*VALUE_A.*fileA/s);
    }, 60000);

    requiresAPIKey('conversation without persistence throws error', async () => {
        // Static mode requires conversationPersistence when conversation mode is enabled
        await expect(workspace.execute(
            'Create src/example.js with a hello function',
            {
                mode: 'static',
                model: 'gpt-5-mini',
                conversation: true  // Without persistence should error
            }
        )).rejects.toThrow('Static mode requires conversationPersistence');
    });

    it('InMemoryPersistence - CRUD operations', async () => {
        const persistence = new InMemoryPersistence();
        const convID = 'test-conv-123';

        // Initially empty
        expect(await persistence.get(convID)).toBeNull();

        // Append messages
        await persistence.append(convID, JSON.stringify({ role: 'user', content: 'Hello' }));
        await persistence.append(convID, JSON.stringify({ role: 'assistant', content: 'Hi' }));

        // Retrieve
        const history = await persistence.get(convID);
        expect(history).toBeDefined();
        expect(history.length).toBe(2);
        expect(history[0].role).toBe('user');
        expect(history[1].role).toBe('assistant');

        // Delete
        await persistence.delete(convID);
        expect(await persistence.get(convID)).toBeNull();
    });

    it('FileSystemPersistence - CRUD operations', async () => {
        const persistenceDir = path.join(testDir, '.test-persistence');
        const persistence = new FileSystemPersistence(persistenceDir);
        const convID = 'test-conv-456';

        // Initially empty
        expect(await persistence.get(convID)).toBeNull();

        // Append messages (JSONL format)
        await persistence.append(convID, JSON.stringify({ role: 'user', content: 'Hello' }));
        await persistence.append(convID, JSON.stringify({ role: 'assistant', content: 'Hi' }));

        // Verify file was created
        const files = await fs.readdir(persistenceDir);
        expect(files.length).toBe(1);
        expect(files[0]).toMatch(/test-conv-456.*\.jsonl$/);

        // Retrieve and verify
        const history = await persistence.get(convID);
        expect(history).toBeDefined();
        expect(history.length).toBe(2);
        expect(history[0].content).toBe('Hello');
        expect(history[1].content).toBe('Hi');

        // Append more (test JSONL append efficiency)
        await persistence.append(convID, JSON.stringify({ role: 'user', content: 'How are you?' }));

        const updated = await persistence.get(convID);
        expect(updated.length).toBe(3);

        // Delete
        await persistence.delete(convID);
        expect(await persistence.get(convID)).toBeNull();

        // Verify file was deleted
        const filesAfterDelete = await fs.readdir(persistenceDir);
        expect(filesAfterDelete.length).toBe(0);
    });

    it('FileSystemPersistence - sanitizes conversation IDs', async () => {
        const persistenceDir = path.join(testDir, '.test-persistence');
        const persistence = new FileSystemPersistence(persistenceDir);

        // Dangerous conversation ID with path traversal attempt
        const dangerousID = '../../../etc/passwd';

        await persistence.append(dangerousID, JSON.stringify({ role: 'user', content: 'test' }));

        // Should be sanitized to safe filename
        const files = await fs.readdir(persistenceDir);
        expect(files.length).toBe(1);
        expect(files[0]).not.toContain('..');
        expect(files[0]).toMatch(/^[a-zA-Z0-9_-]+\.jsonl$/);
    });
});
