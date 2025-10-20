# Sigrid

LLM CLI agent with file tooling support and high-performance static context mode. Sigrid can execute prompts, read/write files, maintain conversations, and perform fast batch code generation.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
  - [CLI Mode](#cli-mode)
  - [Library Mode](#library-mode)
  - [File Tools](#file-tools)
  - [Static Context Mode (Workspaces)](#static-context-mode-workspaces)
- [Examples](#examples)
- [Testing](#testing)

## Installation

```bash
npm install sigrid
```

Set your OpenAI API key:
```bash
export OPENAI_API_KEY=your_api_key_here
```

## Usage

### CLI Mode

Run Sigrid from the command line:

```bash
# Single prompt
sigrid "What is 2+2?"

# Interactive mode (no prompt)
sigrid

# Pure output mode (no explanations)
sigrid -p "Write a Python for loop that prints 0 to 4"

# Custom model
sigrid -m gpt-4o-mini "Explain recursion"

# Custom instruction
sigrid -i "Be very brief" "What is JavaScript?"

# Change sandbox directory
sigrid -e /path/to/directory "List files here"

# Pipe input
echo "Hello world" | sigrid "Translate to Spanish"
```

#### CLI Options

- `-p, --pure` - Pure output mode (no explanations or markdown)
- `-m, --model <text>` - Model to use (default: gpt-5-mini)
- `-i, --instruction <text>` - Add custom system instruction
- `-e, --environment <text>` - Change sandbox directory
- `-s, --stream` - Stream output (planned)
- `-b, --bootstrapping` - Self-improvement mode

#### Interactive Mode

When run without a prompt, Sigrid enters interactive mode:

```bash
$ sigrid
Running in interactive mode (type 'exit' or 'quit' to quit)
You: What is the capital of France?
Sigrid: The capital of France is Paris.
You: exit
```

### Library Mode

Use Sigrid programmatically in your Node.js projects.

#### Fluent Builder API (Recommended)

```javascript
import sigrid from 'sigrid';

// Initialize the client
sigrid.initializeClient(process.env.OPENAI_API_KEY);

// Simple execution
const result = await sigrid()
  .execute('What is 2+2?');
console.log(result.content);

// With model selection
const result = await sigrid()
  .model('gpt-4o-mini')
  .execute('Explain quantum computing');

// With instructions
const result = await sigrid()
  .instruction('Be concise')
  .instruction('Use simple language')
  .model('gpt-4o-mini')
  .execute('What is recursion?');

// Multiple instructions at once
const result = await sigrid()
  .instructions(['Be brief', 'Use examples'])
  .execute('Explain async/await');

// Pure mode (no explanations)
const result = await sigrid()
  .pure()
  .execute('Write a Python function to calculate factorial');

// Workspace directory (for file operations)
const result = await sigrid()
  .workspace('./my-project')
  .model('gpt-4o-mini')
  .execute('List all JavaScript files');

// Conversation mode
const result1 = await sigrid()
  .conversation()
  .model('gpt-4o-mini')
  .execute('My favorite color is blue');

const result2 = await sigrid()
  .model('gpt-4o-mini')
  .execute('What is my favorite color?', {
    conversationID: result1.conversationID
  });

// Combine everything
const result = await sigrid()
  .pure()
  .workspace('./src')
  .model('gpt-4o-mini')
  .instruction('Output only code')
  .execute('Write a hello world in Python');
```

#### Traditional API (Backward Compatible)

```javascript
import { initializeClient, execute, setSandboxRoot } from 'sigrid';

// Initialize
initializeClient(process.env.OPENAI_API_KEY);
setSandboxRoot('./workspace');

// Execute with options
const result = await execute('What is 2+2?', {
  model: 'gpt-4o-mini',
  instructions: ['Be brief', 'Be accurate'],
  pure: false,
  workspace: './custom-workspace'  // overrides setSandboxRoot
});

console.log(result.content);
console.log(result.conversationID);
```

#### API Reference

**Fluent Builder Methods:**
- `.model(name)` - Set the model (e.g., 'gpt-5-mini', 'gpt-4o-mini')
- `.instruction(text)` - Add a single instruction (chainable)
- `.instructions(array|string)` - Set instructions (string or array)
- `.pure()` - Enable pure output mode (no explanations)
- `.conversation()` - Enable conversation mode
- `.workspace(path)` - Set workspace directory (overrides global sandbox)
- `.progress(callback)` - Set progress callback
- `.execute(prompt, opts?)` - Execute the prompt

**Traditional Functions:**
- `initializeClient(apiKey)` - Initialize OpenAI client
- `setSandboxRoot(path)` - Set default sandbox directory for file operations
- `execute(prompt, options)` - Execute a prompt with options

**Workspace Functions:**
- `createWorkspace(tarballBuffer?)` - Create new workspace (optionally from tarball)
- `workspace.execute(prompt, options)` - Execute with static mode support
- `workspace.snapshot(config?)` - Generate XML snapshot of workspace
- `workspace.deserializeXmlOutput(content)` - Parse `<sg-file>` tags from LLM output
- `workspace.export()` - Export workspace as tar.gz Buffer
- `workspace.delete()` - Delete workspace directory

**Execute Options:**
```javascript
{
  model: 'gpt-5-mini',          // Model name
  instructions: [],             // Array or string of instructions
  pure: false,                  // Pure output mode
  conversation: false,          // Enable conversation mode
  conversationID: null,         // Existing conversation ID
  conversationPersistence: null,// Persistence provider (enables internal tracking)
  workspace: null,              // Workspace directory (overrides setSandboxRoot)
  progressCallback: null,       // Progress callback function
  client: null                  // Custom OpenAI client
}
```

**Workspace Execute Options:**
```javascript
{
  mode: 'static',               // Enable static context mode (required)
  model: 'gpt-5-mini',          // Model name
  instructions: [],             // Array or string of instructions
  snapshot: {                   // Snapshot configuration (optional)
    include: ['**/*'],          //   Glob patterns to include
    exclude: [],                //   Glob patterns to exclude
    extensions: [],             //   File extensions filter
    maxFileSize: 1000000        //   Max file size in bytes (1MB default)
  },
  // Or provide pre-computed snapshot:
  snapshot: '<xml>...</xml>',   // Pre-computed snapshot string

  temperature: 0.7,             // LLM temperature (optional)
  reasoningEffort: 'medium',    // Reasoning effort (optional)

  // Multi-turn conversation (highly recommended for static mode)
  conversation: true,           // Enable conversation mode (required for persistence)
  conversationID: null,         // Continue existing conversation (optional)
  conversationPersistence: null // Persistence provider (optional, enables internal tracking)
}
```

**Return Value:**
```javascript
{
  content: "...",              // LLM response text
  conversationID: "..."        // Conversation ID (for multi-turn)
}
```

**Workspace Return Value (Static Mode):**
```javascript
{
  content: "...",              // LLM response text (includes <sg-file> tags)
  conversationID: "...",       // Conversation ID
  filesWritten: [              // Automatically deserialized files
    { path: "src/App.tsx", size: 1234 },
    { path: "src/components/Button.tsx", size: 567 }
  ]
}
```

### File Tools

Sigrid has built-in file tools that the LLM can use:

- `list_dir` - List files in the workspace directory
- `read_file` - Read file contents
- `write_file` - Write files (disabled in pure mode)

These tools operate within the workspace directory:
- Set via `.workspace()` in fluent API (per-request, concurrency-safe)
- Set via `setSandboxRoot()` in traditional API (global default)

**Concurrency:**
```javascript
// Safe: each request uses its own workspace
await Promise.all([
  sigrid().workspace('./project1').execute('List files'),
  sigrid().workspace('./project2').execute('List files')
]);

// Unsafe: global state race condition
setSandboxRoot('./project1');
await Promise.all([
  execute('List files'),
  setSandboxRoot('./project2')  // Race!
]);
```

### Conversation Persistence

Sigrid supports multi-turn conversations with pluggable persistence providers. You can choose between **internal conversation tracking** (using your own storage) or **provider-managed conversations** (using OpenAI's conversation API).

#### Two Modes

**Internal Tracking** (with `conversationPersistence`):
- You provide a persistence provider
- Conversation history stored in your storage (in-memory, filesystem, Redis, etc.)
- Efficient for static mode (avoids snapshot duplication)
- Required for local LLMs
- Requires both `conversation: true` AND `conversationPersistence`

**Provider-Managed** (without `conversationPersistence`):
- Uses OpenAI's conversation API
- No local storage needed
- Simpler for basic use cases
- Requires only `conversation: true`

#### Persistence Interface

All persistence providers must implement three methods:

```javascript
/**
 * ConversationPersistence Interface
 */
interface ConversationPersistence {
  // Retrieve all messages as JSON array string
  async get(conversationID: string): Promise<string | null>;

  // Append a single message (JSON string)
  async append(conversationID: string, messageJson: string): Promise<void>;

  // Delete conversation data
  async delete(conversationID: string): Promise<void>;
}
```

#### Built-in Providers

**InMemoryPersistence** - Fast ephemeral storage (lost on restart):
```javascript
import { InMemoryPersistence } from 'sigrid';

const persistence = new InMemoryPersistence();

// Use with execute
const r1 = await sigrid()
  .model('gpt-5-mini')
  .execute('My favorite color is blue', {
    conversation: true,
    conversationPersistence: persistence
  });

const r2 = await sigrid()
  .model('gpt-5-mini')
  .execute('What is my favorite color?', {
    conversationID: r1.conversationID,
    conversationPersistence: persistence
  });
```

**FileSystemPersistence** - Persistent storage as JSONL files:
```javascript
import { FileSystemPersistence } from 'sigrid';

const persistence = new FileSystemPersistence('./conversations');

const r1 = await sigrid()
  .model('gpt-5-mini')
  .execute('Remember: my API key is xyz123', {
    conversation: true,
    conversationPersistence: persistence
  });

// Later, even after restart
const r2 = await sigrid()
  .model('gpt-5-mini')
  .execute('What is my API key?', {
    conversationID: r1.conversationID,
    conversationPersistence: persistence
  });
```

#### Provider-Managed Conversations

For simpler use cases, use OpenAI's conversation API directly:

```javascript
// No persistence provider needed
const r1 = await sigrid()
  .conversation()  // Enables conversation mode
  .execute('My name is Alice');

const r2 = await sigrid()
  .execute('What is my name?', {
    conversationID: r1.conversationID
  });
```

#### Static Mode Multi-turn Conversations

In static mode, conversation persistence is **highly recommended** because it avoids duplicating large snapshots in conversation history:

```javascript
import { createWorkspace, InMemoryPersistence } from 'sigrid';

const workspace = await createWorkspace();
const persistence = new InMemoryPersistence();

// Turn 1: Create initial files
const r1 = await workspace.execute(
  'Create a Button component',
  {
    mode: 'static',
    model: 'gpt-5-mini',
    conversation: true,
    conversationPersistence: persistence
  }
);

// Turn 2: Build on previous turn
// Snapshot is regenerated to include files from turn 1
const r2 = await workspace.execute(
  'Add a disabled prop to the Button',
  {
    mode: 'static',
    model: 'gpt-5-mini',
    conversationID: r1.conversationID,
    conversationPersistence: persistence
  }
);

// Turn 3: Reference even earlier context
const r3 = await workspace.execute(
  'Create an App component that uses Button',
  {
    mode: 'static',
    model: 'gpt-5-mini',
    conversationID: r1.conversationID,
    conversationPersistence: persistence
  }
);

console.log(`Generated ${r3.filesWritten.length} files across 3 turns`);
```

**How Static Mode Conversations Work:**
1. **Fresh Snapshots**: Snapshot regenerated on each turn to include files from previous turns
2. **Separate History**: Conversation history tracked separately (not in snapshot)
3. **Efficient**: Avoids context bloat from repeated snapshots
4. **Contextual**: LLM has full conversation history + current workspace state

#### Custom Persistence Providers

Implement your own providers for Redis, MongoDB, etc.:

```javascript
class RedisPersistence {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async get(conversationID) {
    const messages = await this.redis.lrange(`conv:${conversationID}`, 0, -1);
    if (messages.length === 0) return null;

    const parsed = messages.map(m => JSON.parse(m));
    return JSON.stringify(parsed);
  }

  async append(conversationID, messageJson) {
    await this.redis.rpush(`conv:${conversationID}`, messageJson);
  }

  async delete(conversationID) {
    await this.redis.del(`conv:${conversationID}`);
  }
}

// Use custom provider
const persistence = new RedisPersistence(redisClient);
const result = await sigrid()
  .execute('Hello', {
    conversation: true,
    conversationPersistence: persistence
  });
```

### Static Context Mode (Workspaces)

Static mode enables high-performance code generation by loading the entire codebase into the LLM's context upfront, instead of using dynamic file tool calls. This approach is **2-3x faster** than dynamic mode and ideal for batch operations.

#### Overview

**Dynamic Mode (default):**
- LLM calls `read_file` and `write_file` tools as needed
- Interactive and exploratory
- Works well for small changes

**Static Mode:**
- Entire codebase loaded as XML snapshot upfront
- LLM outputs all changes as `<sg-file>` tags
- Files automatically written to workspace
- **2-3x faster** for code generation tasks

#### How It Works

1. **Snapshot Generation**: Creates XML representation of your codebase
2. **Context Loading**: Entire snapshot provided to LLM in initial prompt
3. **XML Output**: LLM outputs file changes using `<sg-file>` tags
4. **Automatic Deserialization**: Files automatically written to workspace

#### Workspace API

```javascript
import { createWorkspace } from 'sigrid';

// Create a workspace
const workspace = await createWorkspace();

// Execute in static mode
const result = await workspace.execute(
  'Add a Button component with TypeScript',
  {
    mode: 'static',
    model: 'gpt-5-mini',
    instructions: ['Use React and TypeScript', 'Follow best practices']
  }
);

console.log(`Wrote ${result.filesWritten.length} files`);
result.filesWritten.forEach(file => {
  console.log(`  - ${file.path} (${file.size} bytes)`);
});

// Clean up
await workspace.delete();
```

#### Snapshot Configuration

Customize which files are included in the snapshot:

```javascript
const result = await workspace.execute(
  'Refactor the authentication module',
  {
    mode: 'static',
    model: 'gpt-5',
    snapshot: {
      include: ['src/**/*'],           // Glob patterns to include
      exclude: ['**/*.test.ts'],        // Glob patterns to exclude
      extensions: ['.ts', '.tsx'],      // File extensions to include
      maxFileSize: 1000 * 1024          // Max file size (1MB default)
    }
  }
);
```

#### Pre-computed Snapshots

Generate snapshot once and reuse for multiple operations:

```javascript
// Generate snapshot
const snapshot = await workspace.snapshot({
  include: ['src/**/*'],
  extensions: ['.ts', '.tsx']
});

console.log(`Snapshot size: ${snapshot.length} chars`);

// Reuse snapshot for multiple operations
const results = await Promise.all([
  workspace.execute('Add error handling', {
    mode: 'static',
    model: 'gpt-5-mini',
    snapshot: snapshot  // Reuse pre-computed snapshot
  }),
  workspace.execute('Add input validation', {
    mode: 'static',
    model: 'gpt-5-mini',
    snapshot: snapshot  // Same snapshot
  })
]);
```

#### Workspace from Tarball

Create workspaces from existing project templates:

```javascript
import fs from 'fs/promises';

// Load tarball
const tarballBuffer = await fs.readFile('./template.tar.gz');

// Create workspace from tarball
const workspace = await createWorkspace(tarballBuffer);

// Execute operations
const result = await workspace.execute('Add a navbar', {
  mode: 'static',
  model: 'gpt-5'
});

// Export modified workspace
const outputTarball = await workspace.export();
await fs.writeFile('./output.tar.gz', outputTarball);
```

#### Performance Characteristics

**Snapshot Generation:**
- Small project (10 files): ~10ms
- Medium project (50 files): ~30ms
- Large project (200+ files): ~50-100ms

**Static Execution:**
- Typical: 8-30 seconds with gpt-5-mini
- Complex: 30-60 seconds with gpt-5
- 2-3x faster than dynamic mode for batch operations

**Memory:**
- ~0.8MB per execution
- No memory leaks in repeated operations
- Efficient snapshot caching

#### When to Use Static Mode

**✅ Best for:**
- Code generation tasks
- Batch refactoring
- Multi-file features
- Template processing
- Agent workflows
- Automated testing

**❌ Not ideal for:**
- Exploratory questions ("What does this code do?")
- Interactive debugging
- Very large codebases (>5MB snapshot)

#### Complete Example

```javascript
import { createWorkspace } from 'sigrid';
import fs from 'fs/promises';

async function generateFeature() {
  // Load template
  const template = await fs.readFile('./react-template.tar.gz');
  const workspace = await createWorkspace(template);

  // Load AI rules
  const aiRules = await fs.readFile('./AI_RULES.md', 'utf-8');

  // Generate snapshot
  const snapshot = await workspace.snapshot({
    include: ['src/**/*'],
    extensions: ['.ts', '.tsx', '.css']
  });

  // Generate feature
  const result = await workspace.execute(
    'Create a todo list component with add, delete, and mark complete functionality',
    {
      mode: 'static',
      model: 'gpt-5',
      instructions: [aiRules],
      snapshot: snapshot,
      temperature: 0.7
    }
  );

  console.log(`✓ Generated ${result.filesWritten.length} files:`);
  result.filesWritten.forEach(file => {
    console.log(`  - ${file.path} (${file.size} bytes)`);
  });

  // Export result
  const output = await workspace.export();
  await fs.writeFile('./output.tar.gz', output);

  // Cleanup
  await workspace.delete();
}
```

#### XML Output Format

When using static mode, the LLM outputs files using `<sg-file>` tags:

```xml
<sg-file path="src/components/Button.tsx">
import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
}

export default function Button({ children, onClick }: ButtonProps) {
  return (
    <button onClick={onClick} className="btn">
      {children}
    </button>
  );
}
</sg-file>

<sg-file path="src/App.tsx">
import React from 'react';
import Button from './components/Button';

export default function App() {
  return <Button onClick={() => alert('Clicked!')}>Click me</Button>;
}
</sg-file>
```

Files are automatically deserialized and written to the workspace.

## Examples

### Code Generation

```javascript
const result = await sigrid()
  .pure()
  .model('gpt-4o-mini')
  .execute('Write a JavaScript function to reverse a string');

// Save to file
import fs from 'fs/promises';
await fs.writeFile('reverse.js', result.content);
```

### Multi-turn Conversation

```javascript
const q1 = await sigrid()
  .conversation()
  .execute('I have a list of numbers: [1, 2, 3, 4, 5]');

const q2 = await sigrid()
  .execute('What is the sum?', {
    conversationID: q1.conversationID
  });

const q3 = await sigrid()
  .execute('What is the average?', {
    conversationID: q1.conversationID
  });
```

### File Operations

```javascript
import sigrid from 'sigrid';

sigrid.initializeClient(process.env.OPENAI_API_KEY);

// LLM can read/write files in ./workspace
const result = await sigrid()
  .workspace('./workspace')
  .model('gpt-4o-mini')
  .execute('Read config.json and tell me the version number');
```

### Concurrent Workspaces

```javascript
// Process multiple projects concurrently
const results = await Promise.all([
  sigrid()
    .workspace('./frontend')
    .execute('Count all TypeScript files'),

  sigrid()
    .workspace('./backend')
    .execute('List all API endpoints'),

  sigrid()
    .workspace('./docs')
    .execute('Find all markdown files')
]);
```

## Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests (requires OPENAI_API_KEY)
OPENAI_API_KEY=xxx npm run test:integration

# Run non-conversation stress tests (requires OPENAI_API_KEY)
OPENAI_API_KEY=xxx npm test -- workspace.static.stress.test.js

# Run conversation stress tests (requires OPENAI_API_KEY)
OPENAI_API_KEY=xxx npm test -- workspace.static.conversation.stress.test.js

# Run LLM rate limit stress tests (requires OPENAI_API_KEY, will trigger 429 errors)
OPENAI_API_KEY=xxx npm test -- llm.stress.test.js

# Run all static mode tests (integration + stress)
OPENAI_API_KEY=xxx npm run test:static

# Keep test workspace for inspection
KEEP_TEST_DIR=1 npm test -- workspace.static.stress.test.js

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

### Test Suites

- **Unit Tests**: Fast, no API calls, test core logic
- **Integration Tests**: Test static mode and conversation persistence with real LLM API
  - Basic conversation functionality
  - Multi-turn conversations
  - Snapshot regeneration with conversations
  - Provider-managed vs internal tracking
- **Static Mode Stress Tests**: Test reliability, performance, edge cases
  - Large snapshots (50+ files)
  - Repeated executions (memory leak detection)
  - Randomized prompts (XML output reliability)
  - Edge cases (special characters, XML in content)
  - Concurrent snapshot generations
- **Conversation Stress Tests**: Test conversation persistence under stress
  - Repeated multi-turn conversations (memory leak detection)
  - Large conversation history with recall (10+ turns)
  - Concurrent conversations with different persistence providers
  - InMemoryPersistence and FileSystemPersistence providers
- **LLM Rate Limit Stress Tests**: Intentionally trigger OpenAI API rate limits
  - Rapid sequential API calls to exceed 500k tokens-per-minute limit
  - Validates 429 error handling and error message details
  - Useful for testing rate limit detection and recovery mechanisms
  - ⚠️ Warning: Will consume API quota and trigger rate limit errors

## License

ISC