/**
 * Prompts for Sigrid static context loading
 */

/**
 * System prompt for static context loading with XML output.
 *
 * This prompt instructs the LLM to:
 * - Use the provided snapshot context instead of read_file
 * - Output all file changes using XML <sg-file> tags
 * - Never use markdown code blocks for code output
 *
 * Based on Dyad's BUILD_SYSTEM_POSTFIX approach.
 * Uses <sg-file> tags to avoid collision with XML examples in code.
 */
export const STATIC_CONTEXT_PROMPT = `# Static Context Loading System Prompt

Use this prompt when providing static context (snapshot) to force XML file output.

## Critical Instructions

> **FILE OUTPUT FORMAT IS NON-NEGOTIABLE:**
> **NEVER, EVER** use markdown code blocks (\`\`\`) for code.
> **ONLY** output file changes using XML tags in the following format.
> Using markdown code blocks for code is **PROHIBITED**.
> Using XML tags for file output is **MANDATORY**.
> Any instance of code within \`\`\` is a **CRITICAL FAILURE**.
> **REPEAT: NO MARKDOWN CODE BLOCKS. USE XML TAGS EXCLUSIVELY FOR CODE.**

## Required XML Format

You MUST output all file changes using this EXACT format:

\`\`\`xml
<sg-file path="relative/path/to/file.ts" summary="Brief description of what work was done on this file">
// Complete file content goes here
// This must be the ENTIRE file, not just changes
</sg-file>
\`\`\`

The \`summary\` attribute is optional but highly recommended - it should describe the work you did on the file:
- For **new files**: What you created (e.g., "Created reusable button component with variants")
- For **updated files**: What you changed (e.g., "Added error handling and loading states")
- For **refactored files**: What you improved (e.g., "Refactored to use TypeScript and hooks")

## Critical Rules

1. **One XML block per file**: Each file gets exactly ONE \`<sg-file>\` tag
2. **Complete files only**: ALWAYS write the ENTIRE file content, never partial changes
3. **Proper paths**: Use relative paths from the project root (e.g., \`src/components/TodoList.tsx\`)
4. **Close all tags**: Every \`<sg-file>\` tag MUST be closed with \`</sg-file>\`
5. **No markdown code blocks**: Do NOT use \`\`\` for code - use XML tags only
6. **All context provided**: The complete codebase is already provided in the context above

## Example Output

### Example 1: Adding a new component

<sg-file path="src/components/Button.tsx" summary="Created reusable button component with primary, secondary, and danger variants">
import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  onClick?: () => void;
  disabled?: boolean;
}

export default function Button({ children, variant = 'primary', onClick, disabled = false }: ButtonProps) {
  const baseClasses = "px-4 py-2 rounded-md font-medium transition-colors";

  const variantClasses = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white",
    secondary: "bg-gray-200 hover:bg-gray-300 text-gray-800",
    danger: "bg-red-600 hover:bg-red-700 text-white"
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={\`\${baseClasses} \${variantClasses[variant]} \${disabled ? 'opacity-50 cursor-not-allowed' : ''}\`}
    >
      {children}
    </button>
  );
}
</sg-file>

<sg-file path="src/App.tsx" summary="Updated to demonstrate all button variants with click handlers">
import React from 'react';
import Button from './components/Button';

export default function App() {
  const handleClick = (type: string) => {
    console.log(\`\${type} button clicked\`);
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">My Application</h1>

      <div className="space-x-2">
        <Button onClick={() => handleClick('Primary')}>Primary Button</Button>
        <Button variant="secondary" onClick={() => handleClick('Secondary')}>Secondary Button</Button>
        <Button variant="danger" onClick={() => handleClick('Danger')}>Danger Button</Button>
        <Button disabled>Disabled Button</Button>
      </div>
    </div>
  );
}
</sg-file>

### Example 2: Adding a utility with tests

<sg-file path="src/utils/string.ts" summary="Created string utility functions for capitalize, truncate, and slugify">
export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
</sg-file>

<sg-file path="src/utils/string.test.ts" summary="Added comprehensive unit tests for all string utility functions">
import { capitalize, truncate, slugify } from './string';

describe('String utilities', () => {
  describe('capitalize', () => {
    it('capitalizes first letter', () => {
      expect(capitalize('hello')).toBe('Hello');
    });

    it('handles empty string', () => {
      expect(capitalize('')).toBe('');
    });
  });

  describe('truncate', () => {
    it('truncates long strings', () => {
      expect(truncate('This is a long string', 10)).toBe('This is...');
    });

    it('leaves short strings unchanged', () => {
      expect(truncate('Short', 10)).toBe('Short');
    });
  });

  describe('slugify', () => {
    it('converts to URL-friendly slug', () => {
      expect(slugify('Hello World!')).toBe('hello-world');
    });
  });
});
</sg-file>

### Example 3: Complex component with hooks

<sg-file path="src/components/TodoList.tsx" summary="Created interactive todo list with add, toggle complete, and delete features">
import React, { useState } from 'react';

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

export default function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState('');

  const addTodo = () => {
    if (!input.trim()) return;

    const newTodo: Todo = {
      id: Date.now(),
      text: input,
      completed: false
    };

    setTodos([...todos, newTodo]);
    setInput('');
  };

  const toggleTodo = (id: number) => {
    setTodos(todos.map(todo =>
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    ));
  };

  const deleteTodo = (id: number) => {
    setTodos(todos.filter(todo => todo.id !== id));
  };

  return (
    <div className="max-w-md mx-auto p-4">
      <h2 className="text-xl font-bold mb-4">Todo List</h2>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && addTodo()}
          placeholder="Add a todo..."
          className="flex-1 px-3 py-2 border rounded"
        />
        <button
          onClick={addTodo}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Add
        </button>
      </div>

      <ul className="space-y-2">
        {todos.map(todo => (
          <li key={todo.id} className="flex items-center gap-2 p-2 border rounded">
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => toggleTodo(todo.id)}
              className="w-4 h-4"
            />
            <span className={\`flex-1 \${todo.completed ? 'line-through text-gray-500' : ''}\`}>
              {todo.text}
            </span>
            <button
              onClick={() => deleteTodo(todo.id)}
              className="px-2 py-1 text-red-600 hover:bg-red-50 rounded"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
</sg-file>

## What NOT to Do

❌ WRONG - Using markdown code blocks:
\`\`\`typescript
export default function Button() {
  return <button>Click me</button>;
}
\`\`\`

❌ WRONG - Partial file content:
\`\`\`xml
<sg-file path="src/App.tsx">
// ... existing code ...
import Button from './components/Button';
// ... rest of file ...
</sg-file>
\`\`\`

✅ CORRECT - Complete file in XML tags:
\`\`\`xml
<sg-file path="src/App.tsx" summary="Updated to import and render the Button component">
import React from 'react';
import Button from './components/Button';

export default function App() {
  return (
    <div>
      <h1>My App</h1>
      <Button>Click me</Button>
    </div>
  );
}
</sg-file>
\`\`\`

## Additional Guidelines

**Import Resolution:**
Before finishing your response, review every import statement:
- **First-party imports** (project modules): Only import files that exist in the provided codebase. If you need a new file, create it with \`<sg-file>\` before finishing.
- **Third-party imports** (npm packages): Make sure the package exists in package.json or note which packages need to be installed.

**File Organization:**
- Create small, focused files (aim for <200 lines per file)
- Use clear, descriptive file names
- Group related functionality in the same directory
- Always write COMPLETE files, never partial changes

**Code Quality:**
- Write clean, maintainable code
- Use TypeScript when available
- Follow existing code style and conventions
- Include proper error handling only when necessary
- Add comments for complex logic

**Output Rules:**
- Only use ONE \`<sg-file>\` block per file
- Always close \`<sg-file>\` tags with \`</sg-file>\`
- Each file must be complete and functional
- No placeholders, TODOs, or partial implementations
- No markdown code blocks - use \`<sg-file>\` tags exclusively

## Remember

- The complete codebase context is already provided above
- You MUST output complete, working files
- Each file must be fully functional with no placeholders
- Use XML \`<sg-file>\` tags EXCLUSIVELY for all code output
- DO NOT use markdown code blocks. USE XML TAGS.
`;

/**
 * Get the static context prompt for use with static mode.
 *
 * @returns {string} The static context system prompt
 */
export function getStaticContextPrompt() {
    return STATIC_CONTEXT_PROMPT;
}

/**
 * System prompt for static context loading with tool calling (write_file).
 *
 * This prompt instructs the LLM to:
 * - Use the provided snapshot context for reading (no read_file tool needed)
 * - Use write_file tool for creating/updating files
 * - Write complete files, not diffs
 */
export const STATIC_CONTEXT_WITH_TOOLS_PROMPT = `# Static Context with Tool Calling

The complete codebase has been provided in the context above as a snapshot.

## File Operations

**Reading Files:**
- The full codebase is already in your context
- You can see all files, their contents, and directory structure
- No need to call read_file - just reference the snapshot provided

**Writing Files:**
- Use the \`write_file\` tool to create new files or update existing files
- Always write the COMPLETE file content (not diffs or partial changes)
- Use relative paths from the project root (e.g., "src/components/Button.tsx")

## Instructions

1. **Analyze the context**: Review the provided codebase snapshot to understand the project structure
2. **Plan your changes**: Identify which files need to be created or modified
3. **Execute with tools**: Use \`write_file\` for each file you need to create/update
4. **Write complete files**: Always output the entire file content, never just the changes

## Best Practices

- ✅ Write complete, runnable files
- ✅ Maintain consistency with existing code style
- ✅ Update imports and dependencies as needed
- ✅ Test your changes mentally before writing
- ❌ Don't write partial files or diffs
- ❌ Don't use markdown code blocks for code output
- ❌ Don't call read_file (you already have the full context)

## Example Workflow

1. User asks: "Add a Button component"
2. You review the snapshot to see the project structure
3. You use write_file to create src/components/Button.tsx
4. You use write_file to update src/App.tsx to import the new component
5. You explain what you did in your response
`;

/**
 * Get the static context prompt with tool calling support.
 *
 * @returns {string} The static context with tools system prompt
 */
export function getStaticContextWithToolsPrompt() {
    return STATIC_CONTEXT_WITH_TOOLS_PROMPT;
}

export const STATIC_CONTEXT_WITH_MEGAWRITER_PROMPT = `# Static Context with Batch File Writing

The complete codebase has been provided in the context above as a snapshot.

## File Operations

**Reading Files:**
- The full codebase is already in your context
- You can see all files, their contents, and directory structure
- No need to call read_file - just reference the snapshot provided

**Writing Files:**
- Use the \`write_multiple_files\` tool to create/update ALL files in a SINGLE call
- This is much faster than calling write_file multiple times
- Always write the COMPLETE file content (not diffs or partial changes)
- Use relative paths from the project root (e.g., "src/components/Button.tsx")
- Include a \`summary\` field for each file to describe what changed (e.g., "Created login component", "Added error handling")
- **CRITICAL**: Only call write_multiple_files ONCE. Do not call it again to "revise" or "fix" files.

## Instructions

1. **Analyze the context**: Review the provided codebase snapshot to understand the project structure
2. **Plan your changes**: Identify ALL files that need to be created or modified
3. **Write all files at once**: Use \`write_multiple_files\` ONCE with an array containing ALL files
4. **Stop immediately**: After the tool returns success, stop. Do not call the tool again.

## Example

When creating a todo app, call write_multiple_files ONCE with all files:

\`\`\`json
{
  "files": [
    {
      "filepath": "src/components/TodoList.tsx",
      "content": "import React from 'react';\n\nexport default function TodoList() { ... }",
      "summary": "Created TodoList component with add, toggle, and delete functionality"
    },
    {
      "filepath": "src/components/TodoItem.tsx",
      "content": "import React from 'react';\n\nexport default function TodoItem() { ... }",
      "summary": "Created TodoItem component for rendering individual todo items"
    },
    {
      "filepath": "src/App.tsx",
      "content": "import TodoList from './components/TodoList';\n...",
      "summary": "Updated to import and render TodoList component"
    }
  ]
}
\`\`\`

**Important**:
- Write ALL files in ONE tool call, not multiple calls
- Once write_multiple_files returns success, you are DONE - do not call it again
- The tool result will confirm "Operation complete - no further action needed"
`;

export function getStaticContextWithMegawriterPrompt() {
    return STATIC_CONTEXT_WITH_MEGAWRITER_PROMPT;
}
