import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createWorkspace, InMemoryPersistence, FileSystemPersistence } from './index.js';

describe('Workspace.compactHistory()', () => {
    let workspace;
    let testDir;

    beforeEach(async () => {
        // Create test workspace
        testDir = path.join(os.tmpdir(), `sigrid-compact-${Date.now()}`);
        await fs.mkdir(testDir, { recursive: true });

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

    // Helper to create mock conversation history
    function createMockHistory() {
        return [
            {
                role: 'user',
                content: 'Create a todo app component'
            },
            {
                role: 'assistant',
                content: `I've updated the TodoApp component to add drag and drop functionality. The component now uses the HTML5 drag and drop API with three main handlers:

1. handleDragStart - Captures the dragged item's index
2. handleDragOver - Prevents default to enable dropping
3. handleDrop - Reorders the todos array

Here are the files I've created:

<sg-file path="src/components/TodoApp.tsx">
import React, { useState } from 'react';

export const TodoApp = () => {
  const [todos, setTodos] = useState([]);
  const [draggedIndex, setDraggedIndex] = useState(null);

  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDrop = (index) => {
    const newTodos = [...todos];
    const draggedTodo = newTodos[draggedIndex];
    newTodos.splice(draggedIndex, 1);
    newTodos.splice(index, 0, draggedTodo);
    setTodos(newTodos);
  };

  return (
    <div>
      {todos.map((todo, index) => (
        <div
          key={index}
          draggable
          onDragStart={() => handleDragStart(index)}
          onDrop={() => handleDrop(index)}
        >
          {todo}
        </div>
      ))}
    </div>
  );
};
</sg-file>

<sg-file path="src/lib/utils.ts">
export const reorder = (list, startIndex, endIndex) => {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
};
</sg-file>

The implementation is complete and ready to use!`
            },
            {
                role: 'user',
                content: 'Add styling to the todo items'
            },
            {
                role: 'assistant',
                content: `I've added CSS styling to make the todo items look better. Here's what I changed:

<sg-file path="src/components/TodoApp.tsx">
import React, { useState } from 'react';
import './TodoApp.css';

export const TodoApp = () => {
  const [todos, setTodos] = useState([]);
  const [draggedIndex, setDraggedIndex] = useState(null);

  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDrop = (index) => {
    const newTodos = [...todos];
    const draggedTodo = newTodos[draggedIndex];
    newTodos.splice(draggedIndex, 1);
    newTodos.splice(index, 0, draggedTodo);
    setTodos(newTodos);
  };

  return (
    <div className="todo-app">
      {todos.map((todo, index) => (
        <div
          key={index}
          className="todo-item"
          draggable
          onDragStart={() => handleDragStart(index)}
          onDrop={() => handleDrop(index)}
        >
          {todo}
        </div>
      ))}
    </div>
  );
};
</sg-file>

<sg-file path="src/components/TodoApp.css">
.todo-app {
  max-width: 600px;
  margin: 0 auto;
  padding: 20px;
}

.todo-item {
  padding: 12px;
  margin: 8px 0;
  background: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  cursor: move;
}

.todo-item:hover {
  background: #f5f5f5;
}
</sg-file>

All styled and ready!`
            }
        ];
    }

    it('compacts conversation history with InMemoryPersistence', async () => {
        const persistence = new InMemoryPersistence();
        const convID = 'test-conv-123';

        // Create mock history
        const mockHistory = createMockHistory();
        for (const msg of mockHistory) {
            await persistence.append(convID, JSON.stringify(msg));
        }

        // Verify original size
        const originalHistory = await persistence.get(convID);
        expect(originalHistory.length).toBe(4);
        expect(originalHistory[1].content.length).toBeGreaterThan(500); // Long assistant message

        // Compact history
        const result = await workspace.compactHistory(convID, {
            persistence,
            mode: 'files-only'
        });

        // Verify statistics
        expect(result.originalTokens).toBeGreaterThan(0);
        expect(result.compactedTokens).toBeLessThan(result.originalTokens);
        expect(result.messagesProcessed).toBe(4);
        expect(result.messagesCompacted).toBe(2); // 2 assistant messages with files
        expect(result.reduction).toMatch(/\d+\.\d+%/);

        // Verify compacted history
        const compactedHistory = await persistence.get(convID);
        expect(compactedHistory.length).toBe(4);

        // User messages unchanged
        expect(compactedHistory[0].content).toBe('Create a todo app component');
        expect(compactedHistory[2].content).toBe('Add styling to the todo items');

        // Assistant messages compacted
        expect(compactedHistory[1].content).toBe('Modified: src/components/TodoApp.tsx, src/lib/utils.ts');
        expect(compactedHistory[3].content).toBe('Modified: src/components/TodoApp.tsx, src/components/TodoApp.css');

        // Should have metadata
        expect(compactedHistory[1]._original_length).toBeGreaterThan(500);
    });

    it('compacts conversation history with FileSystemPersistence', async () => {
        const persistenceDir = path.join(testDir, '.conversations');
        const persistence = new FileSystemPersistence(persistenceDir);
        const convID = 'test-conv-456';

        // Create mock history
        const mockHistory = createMockHistory();
        for (const msg of mockHistory) {
            await persistence.append(convID, JSON.stringify(msg));
        }

        // Compact history
        const result = await workspace.compactHistory(convID, {
            persistence,
            mode: 'files-only'
        });

        // Verify reduction
        expect(result.messagesCompacted).toBe(2);
        expect(parseFloat(result.reduction)).toBeGreaterThan(50); // Should be >50% reduction

        // Verify compacted history
        const compactedHistory = await persistence.get(convID);
        expect(compactedHistory[1].content).toContain('Modified:');
        expect(compactedHistory[1].content).toContain('src/components/TodoApp.tsx');
    });

    it('dry run mode does not modify history', async () => {
        const persistence = new InMemoryPersistence();
        const convID = 'test-conv-dryrun';

        // Create mock history
        const mockHistory = createMockHistory();
        for (const msg of mockHistory) {
            await persistence.append(convID, JSON.stringify(msg));
        }

        // Get original history for comparison
        const originalHistory = await persistence.get(convID);
        const originalContent = originalHistory[1].content;

        // Dry run
        const result = await workspace.compactHistory(convID, {
            persistence,
            mode: 'files-only',
            dryRun: true
        });

        // Should return statistics
        expect(result.originalTokens).toBeGreaterThan(0);
        expect(result.compactedTokens).toBeLessThan(result.originalTokens);
        expect(result.messagesCompacted).toBe(2);

        // History should be unchanged
        const unchangedHistory = await persistence.get(convID);
        expect(unchangedHistory[1].content).toBe(originalContent);
        expect(unchangedHistory[1].content.length).toBeGreaterThan(500);
    });

    it('handles empty conversation history', async () => {
        const persistence = new InMemoryPersistence();
        const convID = 'empty-conv';

        const result = await workspace.compactHistory(convID, {
            persistence,
            mode: 'files-only'
        });

        expect(result.originalTokens).toBe(0);
        expect(result.compactedTokens).toBe(0);
        expect(result.reduction).toBe('0%');
        expect(result.messagesProcessed).toBe(0);
        expect(result.messagesCompacted).toBe(0);
    });

    it('handles assistant messages with no files', async () => {
        const persistence = new InMemoryPersistence();
        const convID = 'no-files-conv';

        // Create history with assistant message but no files
        await persistence.append(convID, JSON.stringify({
            role: 'user',
            content: 'What is React?'
        }));
        await persistence.append(convID, JSON.stringify({
            role: 'assistant',
            content: 'React is a JavaScript library for building user interfaces. It was created by Facebook and is widely used for web development.'
        }));

        const result = await workspace.compactHistory(convID, {
            persistence,
            mode: 'files-only'
        });

        // Should process but not compact messages without files
        expect(result.messagesProcessed).toBe(2);
        expect(result.messagesCompacted).toBe(0);

        // Content should be unchanged
        const history = await persistence.get(convID);
        expect(history[1].content).toContain('React is a JavaScript library');
    });

    it('preserves user messages unchanged', async () => {
        const persistence = new InMemoryPersistence();
        const convID = 'user-msgs-conv';

        const userMessage = 'This is a very long user message that should remain exactly as it is after compaction, even if it contains keywords like <sg-file> or path="something"';

        await persistence.append(convID, JSON.stringify({
            role: 'user',
            content: userMessage
        }));
        await persistence.append(convID, JSON.stringify({
            role: 'assistant',
            content: '<sg-file path="test.js">content</sg-file>'
        }));

        await workspace.compactHistory(convID, {
            persistence,
            mode: 'files-only'
        });

        const history = await persistence.get(convID);
        expect(history[0].content).toBe(userMessage);
    });

    it('throws error if persistence not provided', async () => {
        await expect(
            workspace.compactHistory('some-id', {})
        ).rejects.toThrow('conversationPersistence required');
    });

    it('throws error if conversationID not provided', async () => {
        const persistence = new InMemoryPersistence();

        await expect(
            workspace.compactHistory('', { persistence })
        ).rejects.toThrow('conversationID required');
    });

    it('handles mixed conversations with some files and some without', async () => {
        const persistence = new InMemoryPersistence();
        const convID = 'mixed-conv';

        // Mix of assistant messages with and without files
        await persistence.append(convID, JSON.stringify({
            role: 'user',
            content: 'Create a file'
        }));
        await persistence.append(convID, JSON.stringify({
            role: 'assistant',
            content: '<sg-file path="file1.js">code</sg-file>'
        }));
        await persistence.append(convID, JSON.stringify({
            role: 'user',
            content: 'Explain how it works'
        }));
        await persistence.append(convID, JSON.stringify({
            role: 'assistant',
            content: 'This code works by doing X, Y, and Z.'
        }));
        await persistence.append(convID, JSON.stringify({
            role: 'user',
            content: 'Create another file'
        }));
        await persistence.append(convID, JSON.stringify({
            role: 'assistant',
            content: '<sg-file path="file2.js">more code</sg-file>'
        }));

        const result = await workspace.compactHistory(convID, {
            persistence,
            mode: 'files-only'
        });

        expect(result.messagesProcessed).toBe(6);
        expect(result.messagesCompacted).toBe(2); // Only 2 messages with files

        const history = await persistence.get(convID);
        expect(history[1].content).toBe('Modified: file1.js');
        expect(history[3].content).toBe('This code works by doing X, Y, and Z.'); // Unchanged
        expect(history[5].content).toBe('Modified: file2.js');
    });

    it('calculates token reduction accurately', async () => {
        const persistence = new InMemoryPersistence();
        const convID = 'token-calc-conv';

        // Create a history with known sizes
        const longContent = 'x'.repeat(4000); // ~1000 tokens
        const shortReplacement = 'Modified: file.js'; // ~5 tokens

        await persistence.append(convID, JSON.stringify({
            role: 'user',
            content: 'test'
        }));
        await persistence.append(convID, JSON.stringify({
            role: 'assistant',
            content: `${longContent}<sg-file path="file.js">content</sg-file>`
        }));

        const result = await workspace.compactHistory(convID, {
            persistence,
            mode: 'files-only'
        });

        // Should show significant reduction
        const reductionPercent = parseFloat(result.reduction);
        expect(reductionPercent).toBeGreaterThan(80); // Should be >80% reduction
    });
});
