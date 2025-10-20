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
<sg-file path="relative/path/to/file.ts">
// Complete file content goes here
// This must be the ENTIRE file, not just changes
</sg-file>
\`\`\`

## Critical Rules

1. **One XML block per file**: Each file gets exactly ONE \`<sg-file>\` tag
2. **Complete files only**: ALWAYS write the ENTIRE file content, never partial changes
3. **Proper paths**: Use relative paths from the project root (e.g., \`src/components/TodoList.tsx\`)
4. **Close all tags**: Every \`<sg-file>\` tag MUST be closed with \`</sg-file>\`
5. **No markdown code blocks**: Do NOT use \`\`\` for code - use XML tags only
6. **All context provided**: The complete codebase is already provided in the context above

## Example Output

Correct format:

<sg-file path="src/components/Button.tsx">
import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
}

export default function Button({ children, onClick }: ButtonProps) {
  return (
    <button onClick={onClick} className="px-4 py-2 bg-blue-500 text-white rounded">
      {children}
    </button>
  );
}
</sg-file>

<sg-file path="src/App.tsx">
import React from 'react';
import Button from './components/Button';

export default function App() {
  return (
    <div>
      <h1>My App</h1>
      <Button onClick={() => console.log('clicked')}>Click me</Button>
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
<sg-file path="src/App.tsx">
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
