import { describe, test, expect, beforeAll, beforeEach, afterEach } from '@jest/globals';
import 'dotenv/config';
import { createWorkspace, InMemoryPersistence, initializeClient } from '../index.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Integration tests for workspace.chat()
 * Tests chat functionality with lightweight workspace context
 */

describe('workspace.chat()', () => {
    let workspace = null;
    let model = null;

    beforeAll(async () => {
        // Initialize client from environment
        const baseURL = process.env.LLM_GATEWAY_URL;
        const apiKey = baseURL ? process.env.LLM_GATEWAY_API_KEY : process.env.OPENAI_API_KEY;

        if (!apiKey) {
            throw new Error('No API key found. Set OPENAI_API_KEY or LLM_GATEWAY_API_KEY');
        }

        // Use environment model or defaults based on provider
        model = process.env.LLM_MODEL || (baseURL ? 'gpt-5-mini' : 'gpt-4o-mini');

        if (baseURL) {
            initializeClient({ apiKey, baseURL });
        } else {
            initializeClient(apiKey);
        }
    });

    beforeEach(async () => {
        workspace = await createWorkspace();
    });

    afterEach(async () => {
        if (workspace && !process.env.KEEP_TEST_DIR) {
            await workspace.delete();
        }
    });

    test('basic chat without workspace context', async () => {
        const result = await workspace.chat('What is 2 + 2?', {
            model,
            includeWorkspace: {
                aiRules: false,
                fileStructure: false,
                files: false
            }
        });

        expect(result.content).toBeTruthy();
        expect(result.content).toMatch(/4/);
    });

    test('chat with file structure context', async () => {
        // Create some files in workspace
        await fs.writeFile(path.join(workspace.path, 'README.md'), '# Test Project');
        await fs.mkdir(path.join(workspace.path, 'src'), { recursive: true });
        await fs.writeFile(path.join(workspace.path, 'src/index.js'), 'console.log("hello")');
        await fs.writeFile(path.join(workspace.path, 'src/utils.js'), 'export function add() {}');

        const result = await workspace.chat('What files are in this project?', {
            model,
            includeWorkspace: {
                aiRules: false,
                fileStructure: true,
                files: false
            }
        });

        expect(result.content).toBeTruthy();
        // Should mention the files (paths only, not contents)
        const content = result.content.toLowerCase();
        expect(
            content.includes('readme') || content.includes('index') || content.includes('utils')
        ).toBe(true);
    });

    test('chat with AI_RULES.md context', async () => {
        // Create AI_RULES.md
        await fs.writeFile(
            path.join(workspace.path, 'AI_RULES.md'),
            '# Project Rules\n\nAlways use TypeScript, never JavaScript.'
        );

        const result = await workspace.chat('What programming language should I use?', {
            model,
            includeWorkspace: {
                aiRules: true,
                fileStructure: false,
                files: false
            }
        });

        expect(result.content).toBeTruthy();
        // Should be aware of the AI rules
        const content = result.content.toLowerCase();
        expect(content).toMatch(/typescript/);
    });

    test('multi-turn conversation with persistence', async () => {
        const persistence = new InMemoryPersistence();
        const conversationID = 'test-chat-123';

        // First turn
        const r1 = await workspace.chat('My favorite color is blue.', {
            model,
            conversation: true,
            conversationPersistence: persistence,
            conversationID,
            includeWorkspace: {
                aiRules: false,
                fileStructure: false,
                files: false
            }
        });

        expect(r1.content).toBeTruthy();
        expect(r1.conversationID).toBe(conversationID);

        // Second turn - should remember previous context
        const r2 = await workspace.chat('What is my favorite color?', {
            model,
            conversationID,
            conversationPersistence: persistence,
            includeWorkspace: {
                aiRules: false,
                fileStructure: false,
                files: false
            }
        });

        expect(r2.content).toBeTruthy();
        expect(r2.content.toLowerCase()).toMatch(/blue/);
    });

    test('conversation ID separation from execute()', async () => {
        const persistence = new InMemoryPersistence();

        // Chat conversation
        const chat1 = await workspace.chat('My name is Alice.', {
            model,
            conversation: true,
            conversationPersistence: persistence,
            conversationID: 'project-123-chat',
            includeWorkspace: {
                aiRules: false,
                fileStructure: false,
                files: false
            }
        });

        // Verify chat conversation is stored
        const chatHistory = await persistence.get('project-123-chat');
        expect(chatHistory).toBeTruthy();
        expect(chatHistory.length).toBeGreaterThan(0);

        // Code generation conversation with different ID
        // (We can't easily test execute() here, but we verify the ID is different)
        expect(chat1.conversationID).toBe('project-123-chat');
    });

    test('full file contents when requested', async () => {
        // Create a file with specific content
        await fs.writeFile(
            path.join(workspace.path, 'test.js'),
            'const SECRET_VALUE = "xyz123";'
        );

        const result = await workspace.chat('What is the SECRET_VALUE?', {
            model,
            includeWorkspace: {
                aiRules: false,
                fileStructure: false,
                files: true  // Include full file contents
            }
        });

        expect(result.content).toBeTruthy();
        // Should be able to read the file contents
        expect(result.content).toMatch(/xyz123/);
    });

    test('defaults to conversation mode enabled', async () => {
        const persistence = new InMemoryPersistence();

        // Call without explicit conversation: true
        const result = await workspace.chat('Hello', {
            model,
            conversationPersistence: persistence,
            includeWorkspace: {
                aiRules: false,
                fileStructure: false,
                files: false
            }
        });

        expect(result.conversationID).toBeTruthy();

        // Verify conversation was persisted
        const history = await persistence.get(result.conversationID);
        expect(history).toBeTruthy();
    });

    test('progress callbacks', async () => {
        const events = [];

        await workspace.chat('Hello', {
            model,
            includeWorkspace: {
                aiRules: false,
                fileStructure: true,
                files: false
            },
            progressCallback: (event, data) => {
                events.push({ event, data });
            }
        });

        // Check that we got the expected events
        const eventNames = events.map(e => e.event);
        expect(eventNames).toContain('SNAPSHOT_GENERATING');
        expect(eventNames).toContain('SNAPSHOT_GENERATED');
        expect(eventNames).toContain('RESPONSE_WAITING');
        expect(eventNames).toContain('RESPONSE_RECEIVED');
    });

    test('custom instructions with instruction parameter', async () => {
        const customInstruction = 'When describing code, always mention the programming language being used.';

        const result = await workspace.chat('Describe what a function is', {
            model,
            instruction: customInstruction,
            includeWorkspace: {
                aiRules: false,
                fileStructure: false,
                files: false
            }
        });

        expect(result.content).toBeTruthy();
        // LLM should follow the instruction and mention programming languages
        const content = result.content.toLowerCase();
        expect(
            content.includes('javascript') ||
            content.includes('python') ||
            content.includes('language')
        ).toBe(true);
    });

    test('custom instructions with instructions array', async () => {
        const instruction1 = 'You are a database expert.';
        const instruction2 = 'When asked about databases, mention PostgreSQL and MongoDB.';

        const result = await workspace.chat('What databases should I use?', {
            model,
            instructions: [instruction1, instruction2],
            includeWorkspace: {
                aiRules: false,
                fileStructure: false,
                files: false
            }
        });

        expect(result.content).toBeTruthy();
        const content = result.content.toLowerCase();
        // Should mention the databases from instructions
        expect(
            content.includes('postgresql') || content.includes('postgres') || content.includes('mongodb') || content.includes('mongo')
        ).toBe(true);
    });

    test('instructions combined with workspace context', async () => {
        // Create a test file
        await fs.writeFile(path.join(workspace.path, 'app.js'), 'function hello() { return "hi"; }');

        const customInstruction = 'When listing files, also describe their purpose.';

        const result = await workspace.chat('What files are in this project?', {
            model,
            instruction: customInstruction,
            includeWorkspace: {
                aiRules: false,
                fileStructure: true,
                files: false
            }
        });

        expect(result.content).toBeTruthy();
        const content = result.content.toLowerCase();
        // Should mention the file
        expect(content.includes('app.js') || content.includes('app')).toBe(true);
    });

    test('addon documentation use case', async () => {
        // Simulate addon documentation
        const dbAddonDocs = `
# Database Addon API

## query(sql, params)
Execute a SQL query against the database.

Example:
const results = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
`;

        const result = await workspace.chat('How do I query the database for a user by ID?', {
            model,
            instructions: [dbAddonDocs],
            includeWorkspace: {
                aiRules: false,
                fileStructure: false,
                files: false
            }
        });

        expect(result.content).toBeTruthy();
        const content = result.content.toLowerCase();
        // Should reference the addon API
        expect(
            content.includes('db.query') ||
            content.includes('query') ||
            content.includes('select')
        ).toBe(true);
    });
});
