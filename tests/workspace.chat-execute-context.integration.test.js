import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createWorkspace, InMemoryPersistence, initializeClient } from '../index.js';

/**
 * Integration tests for chat-to-execute context continuity
 *
 * Tests that chat() and execute() share the same conversation history
 * when using the same conversationID. This ensures context is preserved
 * when users switch between modes.
 */

describe('Chat to Execute Context Continuity', () => {
    let workspace;
    let testDir;
    const hasApiKey = !!process.env.OPENAI_API_KEY || !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);
    const model = process.env.LLM_MODEL || 'gpt-5-mini';

    beforeEach(async () => {
        if (hasApiKey) {
            const baseURL = process.env.LLM_GATEWAY_URL;
            const apiKey = baseURL ? process.env.LLM_GATEWAY_API_KEY : process.env.OPENAI_API_KEY;

            if (baseURL) {
                initializeClient({ apiKey, baseURL });
            } else {
                initializeClient(apiKey);
            }
        }

        testDir = path.join(os.tmpdir(), `sigrid-chat-exec-${Date.now()}`);
        await fs.mkdir(testDir, { recursive: true });

        // Create initial workspace with a component to modify
        await fs.mkdir(path.join(testDir, 'src', 'components'), { recursive: true });
        await fs.writeFile(
            path.join(testDir, 'src', 'components', 'App.jsx'),
            `import React from 'react';
import { MadeWithDyad } from './MadeWithDyad';
import { TodoList } from './TodoList';

export function App() {
    return (
        <div>
            <h1>My Todo App</h1>
            <TodoList />
            <MadeWithDyad />
        </div>
    );
}`
        );
        await fs.writeFile(
            path.join(testDir, 'src', 'components', 'MadeWithDyad.jsx'),
            `import React from 'react';

export function MadeWithDyad() {
    return <div className="footer">Made with Dyad</div>;
}`
        );
        await fs.writeFile(
            path.join(testDir, 'src', 'components', 'TodoList.jsx'),
            `import React from 'react';

export function TodoList() {
    return <ul><li>Item 1</li></ul>;
}`
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

    const requiresAPIKey = hasApiKey ? it : it.skip;

    requiresAPIKey('execute() includes chat history for context', async () => {
        const persistence = new InMemoryPersistence();
        const conversationID = 'project-123';

        // Simulate chat history by directly adding to persistence
        // Both chat() and execute() use the same conversationID
        await persistence.append(conversationID, JSON.stringify({
            role: 'user',
            content: 'I want to remove the MadeWithDyad component from my app'
        }));
        await persistence.append(conversationID, JSON.stringify({
            role: 'assistant',
            content: 'To remove the MadeWithDyad component, you need to: 1) Remove the import from App.jsx, 2) Remove the <MadeWithDyad /> usage from the JSX'
        }));
        await persistence.append(conversationID, JSON.stringify({
            role: 'user',
            content: 'Can you explain what files need to change?'
        }));
        await persistence.append(conversationID, JSON.stringify({
            role: 'assistant',
            content: 'You only need to modify src/components/App.jsx - remove the import line and the component usage. The MadeWithDyad.jsx file can be deleted separately if you want.'
        }));

        // Verify chat history exists
        const chatHistory = await persistence.get(conversationID);
        expect(chatHistory).toBeDefined();
        expect(chatHistory.length).toBe(4);

        // Execute with just "now remove it" - should understand from chat context
        const result = await workspace.execute(
            'Now remove it as we discussed',
            {
                mode: 'static',
                model,
                conversation: true,
                conversationPersistence: persistence,
                conversationID  // Same ID used for both chat and execute
            }
        );

        expect(result.filesWritten).toBeDefined();
        expect(result.filesWritten.length).toBeGreaterThan(0);

        // Verify the MadeWithDyad was removed from App.jsx
        const appContent = await fs.readFile(path.join(testDir, 'src', 'components', 'App.jsx'), 'utf-8');
        expect(appContent).not.toMatch(/MadeWithDyad/);

        // TodoList should still be there (not removed)
        expect(appContent).toMatch(/TodoList/);
    }, 90000);

    requiresAPIKey('execute() works without chat history', async () => {
        const persistence = new InMemoryPersistence();
        const projectId = 'project-456';

        // No chat history - execute directly
        const result = await workspace.execute(
            'Remove the MadeWithDyad component from App.jsx',
            {
                mode: 'static',
                model,
                conversation: true,
                conversationPersistence: persistence,
                conversationID: projectId
            }
        );

        expect(result.filesWritten).toBeDefined();
        expect(result.filesWritten.length).toBeGreaterThan(0);

        // Should still work - just needs explicit instruction
        const appContent = await fs.readFile(path.join(testDir, 'src', 'components', 'App.jsx'), 'utf-8');
        expect(appContent).not.toMatch(/MadeWithDyad/);
    }, 60000);

    it('conversation history is loaded from persistence correctly', async () => {
        const persistence = new InMemoryPersistence();
        const conversationID = 'project-789';

        // Manually add conversation history
        await persistence.append(conversationID, JSON.stringify({
            role: 'user',
            content: 'My favorite color is purple'
        }));
        await persistence.append(conversationID, JSON.stringify({
            role: 'assistant',
            content: 'Great! Purple is a nice color.'
        }));

        // Verify history can be retrieved
        const history = await persistence.get(conversationID);
        expect(history).toBeDefined();
        expect(history.length).toBe(2);
        expect(history[0].content).toContain('purple');
    });

    requiresAPIKey('multi-turn with shared history maintains chronological order', async () => {
        const persistence = new InMemoryPersistence();
        const conversationID = 'project-multi';

        // Simulate chat turn (would be from chat())
        await persistence.append(conversationID, JSON.stringify({
            role: 'user',
            content: 'I am working on a todo app'
        }));
        await persistence.append(conversationID, JSON.stringify({
            role: 'assistant',
            content: 'Great! I can see you have a TodoList component in src/components/TodoList.jsx'
        }));

        // Execute turn 1
        const r1 = await workspace.execute(
            'Add a comment at the top of TodoList.jsx saying "Todo List Component"',
            {
                mode: 'static',
                model,
                conversation: true,
                conversationPersistence: persistence,
                conversationID
            }
        );

        expect(r1.filesWritten.length).toBeGreaterThan(0);

        // Execute turn 2 - should have full history in chronological order
        const r2 = await workspace.execute(
            'Now add another comment below it saying "Last modified today"',
            {
                mode: 'static',
                model,
                conversation: true,
                conversationPersistence: persistence,
                conversationID
            }
        );

        expect(r2.conversationID).toBe(conversationID);

        // Verify all messages in single unified history
        const history = await persistence.get(conversationID);
        expect(history).toBeDefined();
        expect(history.length).toBe(6); // 2 chat + 2 execute turn 1 + 2 execute turn 2
    }, 90000);
});
