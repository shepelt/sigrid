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

// Reasoning effort (for GPT-5 models)
const result = await sigrid()
  .model('gpt-5-mini')
  .reasoningEffort('high')
  .execute('Solve this complex algorithm problem');

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

#### Using an LLM Gateway

Sigrid can route requests through a custom LLM gateway instead of OpenAI's API directly. This is useful for:
- Using local LLMs (Ollama, LM Studio, etc.)
- Adding middleware for logging, caching, or rate limiting
- Testing against custom endpoints
- Using OpenAI-compatible APIs (Azure OpenAI, Together.ai, etc.)

**Auto-detection via Environment Variables:**

Set these in your `.env` file:
```bash
LLM_GATEWAY_URL=http://localhost:3000/v1
LLM_GATEWAY_API_KEY=your-gateway-key  # Optional if gateway doesn't require auth
```

Then initialize normally:
```javascript
import sigrid from 'sigrid';

// If LLM_GATEWAY_URL is set, it will be used automatically
sigrid.initializeClient(process.env.OPENAI_API_KEY);

const result = await sigrid()
  .execute('Hello');  // Routes through gateway
```

**Explicit Gateway Configuration:**

Override environment variables by providing options:
```javascript
// Use specific gateway (ignores environment variables)
sigrid.initializeClient({
  apiKey: 'your-api-key',
  baseURL: 'http://localhost:3000/v1'
});

// Force OpenAI API even if gateway is in environment
sigrid.initializeClient({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://api.openai.com/v1'  // Explicit baseURL prevents auto-detection
});

// Additional options
sigrid.initializeClient({
  apiKey: 'your-api-key',
  baseURL: 'http://localhost:3000/v1',
  timeout: 60000  // Custom timeout (milliseconds)
});
```

**Backward Compatibility:**

The string format is still supported:
```javascript
// Old format (still works)
sigrid.initializeClient('your-api-key');
```

**Precedence:**
1. Explicit `baseURL` in options (highest priority)
2. `LLM_GATEWAY_URL` environment variable
3. OpenAI default API endpoint (lowest priority)

#### API Reference

**Fluent Builder Methods:**
- `.model(name)` - Set the model (e.g., 'gpt-5-mini', 'gpt-4o-mini')
- `.instruction(text)` - Add a single instruction (chainable)
- `.instructions(array|string)` - Set instructions (string or array)
- `.pure()` - Enable pure output mode (no explanations)
- `.conversation()` - Enable conversation mode
- `.workspace(path)` - Set workspace directory (overrides global sandbox)
- `.reasoningEffort(level)` - Set reasoning effort level: "minimal", "low", "medium", or "high" (GPT-5 models only)
- `.progress(callback)` - Set progress callback
- `.execute(prompt, opts?)` - Execute the prompt

**Traditional Functions:**
- `initializeClient(apiKey | options)` - Initialize OpenAI client
  - String: `initializeClient('api-key')`
  - Object: `initializeClient({ apiKey, baseURL?, timeout? })`
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
  reasoningEffort: null,        // Reasoning effort: "minimal", "low", "medium", "high" (GPT-5 only)
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

  // Standard OpenAI API parameters (passed through to LLM)
  max_tokens: 16000,            // Maximum output tokens
  temperature: 0.7,             // LLM temperature (0.0-2.0)
  top_p: 1.0,                   // Nucleus sampling threshold
  frequency_penalty: 0.0,       // Frequency penalty (-2.0 to 2.0)
  presence_penalty: 0.0,        // Presence penalty (-2.0 to 2.0)
  stop: ['###'],                // Stop sequences (string or array)

  reasoningEffort: 'medium',    // Reasoning effort for GPT-5 models (optional)

  // Multi-turn conversation (highly recommended for static mode)
  conversation: true,           // Enable conversation mode (required for persistence)
  conversationID: null,         // Continue existing conversation (optional)
  conversationPersistence: null,// Persistence provider (optional, enables internal tracking)

  // Streaming
  stream: false,                // Enable streaming output
  streamCallback: (chunk) => {} // Callback for streaming chunks
}
```

**Return Value:**
```javascript
{
  content: "...",              // LLM response text
  conversationID: "...",       // Conversation ID (for multi-turn)
  tokenCount: {                // Token usage (when available)
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    estimated: false           // true if estimated, false/undefined if actual
  }
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
  ],
  tokenCount: {                // Token usage (when available)
    promptTokens: 2367,
    completionTokens: 668,
    totalTokens: 3035,
    estimated: false
  }
}
```

### Token Counting

Sigrid automatically tracks token usage for all LLM requests, helping you monitor costs and optimize prompts.

#### Token Count Availability

Token counts are returned in the `tokenCount` field of the response:

| Mode | Provider | Non-Streaming | Streaming | Notes |
|------|----------|---------------|-----------|-------|
| Static | OpenAI | ✅ Actual | ✅ Actual | Via `stream_options` |
| Static | Claude | ✅ Actual | ⚠️ Estimated* | Gateway limitation |
| Dynamic | Any | ⚠️ Estimated | ⚠️ Estimated | Server-side conversations |

*Claude's API returns usage in streaming, but it's lost when translated to OpenAI format by the gateway

#### Basic Usage

```javascript
const result = await sigrid()
  .model('gpt-5-mini')
  .execute('Explain quantum computing');

console.log('Token usage:');
console.log(`  Prompt: ${result.tokenCount.promptTokens}`);
console.log(`  Completion: ${result.tokenCount.completionTokens}`);
console.log(`  Total: ${result.tokenCount.totalTokens}`);

if (result.tokenCount.estimated) {
  console.log('  (estimated ~4 chars/token)');
}
```

#### Workspace Token Tracking

```javascript
import { createWorkspace } from 'sigrid';

const workspace = await createWorkspace();

const result = await workspace.execute(
  'Create a React component',
  {
    mode: 'static',
    model: 'gpt-5-mini'
  }
);

console.log(`Generated ${result.filesWritten.length} files`);
console.log(`Used ${result.tokenCount.totalTokens} tokens`);
```

#### Snapshot Token Estimation

Estimate how many tokens a snapshot will use before executing:

```javascript
import { createSnapshot, estimateSnapshotTokens } from 'sigrid';

// Get snapshot with metadata
const result = await createSnapshot('./my-project', {
  include: ['src/**/*'],
  includeMetadata: true
});

console.log(`Files: ${result.metadata.fileCount}`);
console.log(`Estimated tokens: ${result.metadata.estimatedTokens}`);

// Or estimate any snapshot string
const snapshot = await workspace.snapshot();
const tokens = estimateSnapshotTokens(snapshot);
console.log(`Snapshot size: ${tokens} tokens`);
```

#### Cost Tracking

Track cumulative costs across multiple requests:

```javascript
import { accumulateTokenUsage } from 'sigrid';

const usages = [];

// Execute multiple requests
for (const task of tasks) {
  const result = await sigrid().execute(task.prompt);
  usages.push(result.tokenCount);
}

// Calculate totals
const total = accumulateTokenUsage(usages);
console.log(`Total tokens: ${total.totalTokens}`);

// Calculate cost (example: GPT-5-mini pricing)
const inputCost = total.promptTokens * 0.00000125;
const outputCost = total.completionTokens * 0.00001;
console.log(`Total cost: $${(inputCost + outputCost).toFixed(4)}`);
```

#### Token Counting Utilities

```javascript
import { estimateTokens, extractTokenUsage, accumulateTokenUsage } from 'sigrid';

// Estimate tokens for any text (~4 chars/token)
const tokens = estimateTokens('Hello, world!');
console.log(`Estimated: ${tokens} tokens`);

// Extract usage from OpenAI API response
const usage = extractTokenUsage(response);
console.log(usage); // { promptTokens, completionTokens, totalTokens }

// Accumulate multiple usages
const total = accumulateTokenUsage([usage1, usage2, usage3]);
console.log(`Total: ${total.totalTokens} tokens`);
```

#### Token Count Fields

```javascript
{
  promptTokens: 2367,      // Input tokens (prompt + context)
  completionTokens: 668,   // Output tokens (LLM response)
  totalTokens: 3035,       // Sum of prompt + completion
  estimated: false         // true if estimated, false/undefined if actual from API
}
```

The `estimated` flag indicates:
- `undefined` or `false`: Actual counts from the API
- `true`: Estimated using ~4 chars/token approximation

**Notes:**
- Static mode with OpenAI: Always returns actual counts (streaming and non-streaming)
- Static mode with Claude: Actual for non-streaming, estimated for streaming (gateway limitation)
- Dynamic mode: Always estimated (OpenAI's conversation API doesn't return usage)
- Estimation is conservative and slightly overestimates

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
  // Retrieve all messages as array of message objects
  async get(conversationID: string): Promise<Array | null>;

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

    // Return array of parsed message objects
    return messages.map(m => JSON.parse(m));
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
    max_tokens: 16000,  // Control output length
    temperature: 0.7,   // Control randomness
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

#### API Parameters

All standard OpenAI API parameters (`max_tokens`, `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`, `stop`) are passed through to the LLM API. This allows precise control over model behavior:

```javascript
const result = await workspace.execute(
  'Create a utility module',
  {
    mode: 'static',
    model: 'gpt-5-mini',
    max_tokens: 16000,        // Limit output length
    temperature: 0.7,         // Control randomness (0.0 = deterministic, 2.0 = very random)
    top_p: 0.9,               // Nucleus sampling threshold
    frequency_penalty: 0.0,   // Penalize frequent tokens
    presence_penalty: 0.0,    // Penalize any repeated tokens
    stop: ['###', 'END']      // Stop sequences
  }
);
```

**Note:** Prior to recent fixes, these parameters were silently dropped. They are now properly passed to the API in both streaming and non-streaming modes.

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

#### HTML Entity Decoding (Optional)

By default, Sigrid follows DYAD's proven few-shot prompting approach and writes LLM output as-is without decoding HTML entities. However, if your LLM encodes special characters (like `=>` becoming `=&gt;`), you can enable defensive HTML entity decoding:

```javascript
const result = await workspace.execute(
  'Add a React component',
  {
    mode: 'static',
    model: 'gpt-5',
    decodeHtmlEntities: true  // Enable HTML entity decoding
  }
);
```

**When to enable:**
- Your LLM encodes `<`, `>`, `&`, `"`, or `'` as HTML entities
- Build failures with syntax errors like `Expected "=>" but found "="`
- Code contains literal `&lt;`, `&gt;`, `&amp;`, etc. instead of actual characters

**Default behavior (recommended):**
- `decodeHtmlEntities: false` - Follows DYAD's approach with few-shot prompting
- Proven to work reliably across ChatGPT, Claude, and other LLMs
- Avoids complexity of double-encoding for literal HTML entity strings

**Decoded entities (when enabled):**
- `&lt;` → `<`
- `&gt;` → `>`
- `&amp;` → `&`
- `&quot;` → `"`
- `&apos;` → `'`

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

#### Progress Callbacks and Streaming

Static mode supports progress callbacks for tracking execution status and real-time file generation preview. This is especially useful for building interactive UIs that show live updates as files are being generated.

**Progress Events:**

```javascript
import { ProgressEvents } from 'sigrid';

// Workflow events
ProgressEvents.SNAPSHOT_GENERATING  // Snapshot generation started
ProgressEvents.SNAPSHOT_GENERATED   // Snapshot generation completed
ProgressEvents.RESPONSE_WAITING     // Waiting for LLM response (non-streaming)
ProgressEvents.RESPONSE_RECEIVED    // LLM response received (non-streaming)
ProgressEvents.RESPONSE_STREAMING   // LLM response streaming started
ProgressEvents.RESPONSE_STREAMED    // LLM response streaming completed
ProgressEvents.FILES_WRITING        // File writing started
ProgressEvents.FILES_WRITTEN        // File writing completed

// File streaming events (streaming mode only)
ProgressEvents.FILE_STREAMING_START   // File generation started
ProgressEvents.FILE_STREAMING_CONTENT // File content chunk received
ProgressEvents.FILE_STREAMING_END     // File generation completed
```

**Basic Progress Tracking:**

```javascript
const result = await workspace.execute(
  'Create a Button component',
  {
    mode: 'static',
    model: 'gpt-5',
    progressCallback: (event, data) => {
      console.log(`Event: ${event}`, data);

      if (event === ProgressEvents.FILES_WRITTEN) {
        console.log(`Wrote ${data.count} files`);
      }
    }
  }
);

// Output:
// Event: SNAPSHOT_GENERATING undefined
// Event: SNAPSHOT_GENERATED undefined
// Event: RESPONSE_WAITING undefined
// Event: RESPONSE_RECEIVED undefined
// Event: FILES_WRITING undefined
// Event: FILES_WRITTEN { count: 2 }
```

**Streaming with File Preview:**

Enable streaming mode to get real-time updates as files are being generated:

```javascript
const result = await workspace.execute(
  'Create Button and Card components',
  {
    mode: 'static',
    model: 'gpt-5',
    stream: true,  // Enable streaming
    streamCallback: (chunk) => {
      // Raw LLM output chunks
      process.stdout.write(chunk);
    },
    progressCallback: (event, data) => {
      // File streaming events for UI
      if (event === ProgressEvents.FILE_STREAMING_START) {
        const summary = data.summary ? ` - ${data.summary}` : '';
        console.log(`📄 Starting: ${data.path}${summary}`);
        ui.createFileTab(data.path, data.summary);
      }

      if (event === ProgressEvents.FILE_STREAMING_CONTENT) {
        console.log(`  ✍️  Writing: ${data.path}`);
        ui.appendContent(data.path, data.content);
      }

      if (event === ProgressEvents.FILE_STREAMING_END) {
        console.log(`✅ Completed: ${data.path}`);
        ui.markComplete(data.path);
      }
    }
  }
);

// Output:
// Event: SNAPSHOT_GENERATING
// Event: SNAPSHOT_GENERATED
// Event: RESPONSE_STREAMING
// 📄 Starting: src/components/Button.tsx
//   ✍️  Writing: src/components/Button.tsx
//   ✍️  Writing: src/components/Button.tsx
//   ...
// ✅ Completed: src/components/Button.tsx
// 📄 Starting: src/components/Card.tsx
//   ✍️  Writing: src/components/Card.tsx
//   ...
// ✅ Completed: src/components/Card.tsx
// Event: RESPONSE_STREAMED
// Event: FILES_WRITING
// Event: FILES_WRITTEN { count: 2 }
```

**File Streaming Event Data:**

```javascript
// FILE_STREAMING_START
{
  path: 'src/components/Button.tsx',
  action: 'write',  // or 'delete', 'append'
  summary: 'Created reusable button component with variants'  // Optional: describes work done on file
}

// FILE_STREAMING_CONTENT
{
  path: 'src/components/Button.tsx',
  content: 'import React from "react";\n\nexport default...',
  isIncremental: true
}

// FILE_STREAMING_END
{
  path: 'src/components/Button.tsx',
  action: 'write',
  fullContent: '...'  // Complete file content
}
```

**Important Notes:**

- **File streaming is best-effort**: The incremental XML parser is optimized for UI preview and may occasionally miss content if chunks split tags in unusual ways
- **Atomic file writing**: Files are always written atomically at the end using the robust parser, regardless of streaming preview accuracy
- **UI only**: File streaming events are purely for real-time UI updates - the actual file operations rely on the proven final parse
- **No impact on correctness**: Even if streaming parser fails, files are correctly written at the end

**Complete Streaming Example:**

```javascript
import { createWorkspace, ProgressEvents } from 'sigrid';

const workspace = await createWorkspace();

// Track progress in real-time
const fileStates = new Map();

await workspace.execute(
  'Create a todo list with multiple components',
  {
    mode: 'static',
    model: 'gpt-5',
    stream: true,
    progressCallback: (event, data) => {
      switch (event) {
        case ProgressEvents.SNAPSHOT_GENERATING:
          console.log('⏳ Generating snapshot...');
          break;

        case ProgressEvents.RESPONSE_STREAMING:
          console.log('🤖 AI is generating code...');
          break;

        case ProgressEvents.FILE_STREAMING_START:
          fileStates.set(data.path, { started: Date.now(), content: '' });
          const summary = data.summary ? `\n   ${data.summary}` : '';
          console.log(`\n📄 ${data.path}${summary}`);
          break;

        case ProgressEvents.FILE_STREAMING_CONTENT:
          const state = fileStates.get(data.path);
          state.content += data.content;
          // Update UI with incremental content
          updateEditor(data.path, state.content);
          break;

        case ProgressEvents.FILE_STREAMING_END:
          const duration = Date.now() - fileStates.get(data.path).started;
          console.log(`✅ ${data.path} (${duration}ms)`);
          break;

        case ProgressEvents.FILES_WRITTEN:
          console.log(`\n🎉 Successfully wrote ${data.count} files`);
          break;
      }
    }
  }
);
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

### Addon System

The addon system provides a modular way to add functionality to workspaces. Addons can include files, dependencies, API documentation, and context optimization - making it easy to give LLMs access to pre-built features like databases, authentication, or UI components.

#### What are Addons?

Addons are JavaScript objects that bundle:
- **Files**: Implementation code, documentation, examples
- **Dependencies**: npm packages to install
- **API Definition**: Structured interface for LLMs (auto-generates AI rules)
- **Internal Files**: Implementation details hidden from LLM context (context optimization)

**Key Benefits:**
- ✅ **Context Optimization**: Hide implementation (~300 lines), show only API docs (~50 lines)
- ✅ **Auto-generated Documentation**: Structured API definitions become LLM instructions
- ✅ **Validation**: Automatic verification that exports exist in files (<1ms overhead)
- ✅ **Reusable**: Share addons across projects
- ✅ **Type-safe**: Structured API format prevents errors

#### Quick Start

```javascript
import { createWorkspace, applyAddon } from 'sigrid';
import sqliteAddon from './addons/sqlite.js';

// Create workspace and apply addon
const workspace = await createWorkspace();
await applyAddon(workspace, sqliteAddon);

// LLM can now use the database API
const result = await workspace.execute(
  'Create a todo app with persistent storage',
  {
    mode: 'static',
    model: 'gpt-5',
    instructions: [await workspace.getAIRules()]
  }
);

console.log(`Generated ${result.filesWritten.length} files`);
```

#### Built-in Addons

**SQLite Addon** - Browser-based database using sql.js + IndexedDB:

```javascript
import sqliteAddon from 'sigrid/addons/sqlite.js';

await applyAddon(workspace, sqliteAddon);

// LLM will automatically:
// - Import: import { createDatabase } from '@/lib/database'
// - Use: await db.query('SELECT * FROM todos')
// - Follow patterns from docs/database-api.md
```

The SQLite addon provides:
- Database abstraction layer (hides sql.js complexity)
- IndexedDB persistence (data survives page refresh)
- Transaction support for atomic operations
- Comprehensive API documentation for LLMs
- ~280 lines hidden from context (only ~50 lines of API docs shown)

#### Creating Custom Addons

Addons are just JavaScript objects. You can define them inline, load from files, or generate programmatically.

**Simple Inline Addon:**

```javascript
const configAddon = {
  name: 'api-config',
  files: {
    'src/lib/config.ts': `
      export const API_URL = "https://api.example.com";
      export const API_TIMEOUT = 30000;
    `
  }
};

await applyAddon(workspace, configAddon);
```

**Addon with Structured API:**

```javascript
const authAddon = {
  name: 'authentication',
  description: 'User authentication with JWT',

  // Structured API definition (auto-generates AI rules)
  api: {
    '@/lib/auth': {
      exports: {
        'login': 'Authenticate user with email and password',
        'logout': 'Log out current user',
        'getUser': 'Get current user info'
      },
      methods: {
        'login(email, password)': 'Returns JWT token and user data',
        'logout()': 'Clears session and redirects to login',
        'getUser()': 'Returns current user or null'
      }
    }
  },

  docs: 'docs/auth-api.md',
  technology: 'JWT with secure httpOnly cookies',
  useCases: 'Login, signup, protected routes, user sessions',

  dependencies: {
    'jsonwebtoken': '^9.0.0',
    'bcryptjs': '^2.4.3'
  },

  files: {
    'src/lib/auth.ts': `...implementation...`,
    'docs/auth-api.md': `...documentation...`
  },

  // Hide implementation from LLM context
  internal: ['src/lib/auth.ts']
};

await applyAddon(workspace, authAddon);
```

**Programmatic Addon Generation:**

```javascript
function createServerAddon(apiUrl, features = []) {
  const files = {};
  const api = {};

  // Base API config
  files['src/lib/api.ts'] = `export const API_URL = "${apiUrl}";`;

  // Add features dynamically
  if (features.includes('auth')) {
    files['src/lib/auth.ts'] = `...auth code...`;
    api['@/lib/auth'] = {
      exports: {
        'login': 'Authenticate user',
        'logout': 'Log out user'
      }
    };
  }

  if (features.includes('database')) {
    files['src/lib/db.ts'] = `...database code...`;
    api['@/lib/db'] = {
      exports: {
        'query': 'Execute database query'
      }
    };
  }

  return {
    name: 'server-addon',
    description: `Connect to server API at ${apiUrl}`,
    api,
    files
  };
}

// Generate and apply
const addon = createServerAddon('https://api.myapp.com', ['auth', 'database']);
await applyAddon(workspace, addon);
```

#### Addon Structure

```javascript
{
  // Required
  name: string,              // Addon identifier
  files: {                   // Files to write to workspace
    'path/to/file.js': 'content...'
  },

  // Optional - Structured API (recommended)
  api: {
    '@/lib/module': {        // Import path
      exports: {             // Named exports
        'funcName': 'Description for LLM'
      },
      methods: {             // Method signatures and descriptions
        'funcName(arg1, arg2)': 'What it returns'
      }
    }
  },

  // Optional - Manual AI rules (overrides auto-generated)
  aiRulesAddition: string,   // Text to append to AI_RULES.md

  // Optional - Additional metadata
  version: string,           // Version number
  description: string,       // Human-readable description
  docs: string,              // Path to main documentation file
  technology: string,        // Technology used (e.g., "sql.js with IndexedDB")
  useCases: string,          // Use cases description

  // Optional - Context optimization
  internal: string[],        // Paths to exclude from LLM snapshots

  // Optional - Dependencies
  dependencies: {            // npm packages to add to package.json
    'package-name': '^1.0.0'
  }
}
```

#### How It Works

**1. Apply Addon:**
```javascript
const result = await applyAddon(workspace, addon);
```

**2. Automatic Processing:**
- Writes all files to workspace
- Updates package.json with dependencies
- Registers internal paths for snapshot exclusion
- Auto-generates AI rules from `api` field (or uses manual `aiRulesAddition`)
- Validates that API exports exist in files

**3. LLM Access:**
```javascript
// Get AI rules (includes addon documentation)
const aiRules = await workspace.getAIRules();

// LLM now knows about addon API
const result = await workspace.execute(
  'Build a feature using the addon',
  {
    mode: 'static',
    model: 'gpt-5',
    instructions: [aiRules]
  }
);
```

#### API Validation

Addons are automatically validated when applied (<1ms overhead):

```javascript
// This will throw an error if 'myFunc' doesn't exist in the file
const addon = {
  name: 'invalid',
  api: {
    '@/lib/example': {
      exports: {
        'myFunc': 'A function that does not exist'
      }
    }
  },
  files: {
    'src/lib/example.js': 'export function wrongName() {}'
  }
};

await applyAddon(workspace, addon);
// Error: Addon API validation failed:
//   - API defines export "myFunc" but it does not exist in src/lib/example.js
```

Validation checks:
- Import paths map to actual files
- Exported functions exist in files
- Supports various export patterns (function, const, async)

#### Context Optimization

Use the `internal` array to hide implementation files from LLM snapshots while keeping API docs visible:

```javascript
{
  files: {
    'docs/api.md': '...API documentation...',      // Visible to LLM
    'src/lib/implementation.js': '...500 lines...', // Hidden from LLM
  },
  internal: ['src/lib/implementation.js']
}
```

**Benefits:**
- Saves context tokens (~280 lines for SQLite addon)
- LLM sees clean API docs instead of implementation details
- Generated code still works (implementation bundled at build time)

#### Testing Addons

Sigrid includes comprehensive addon tests:

**Unit Tests** (addon.test.js):
```bash
npm test -- addon.test.js
```
Tests API validation, rules generation, and addon application.

**Integration Tests** (addon.integration.test.js):
```bash
# Test with OpenAI
OPENAI_API_KEY=xxx npm test -- addon.integration.test.js

# Test with LLM Gateway
LLM_GATEWAY_URL="http://localhost:8000/v1" \
LLM_GATEWAY_API_KEY="xxx" \
LLM_MODEL="gpt-oss:120b" \
npm test -- addon.integration.test.js
```
Tests full workflow including LLM usage:
- Addon files copied correctly
- Internal files excluded from snapshots
- LLM uses addon API (not reimplemented)
- LLM follows documentation patterns
- Multiple database scenarios work

**Stress Tests** (addon.stress.test.js):
```bash
npm test -- addon.stress.test.js
```
Tests edge cases: Unicode, deep nesting, many modules, etc.

#### Example: SQLite Addon

The SQLite addon demonstrates best practices:

```javascript
{
  name: 'sqlite',
  description: 'This project includes a SQLite database that runs in the browser',

  dependencies: {
    'sql.js': '^1.10.3'
  },

  // Structured API definition
  api: {
    '@/lib/database': {
      exports: {
        'createDatabase': 'Creates a new SQLite database instance with IndexedDB persistence'
      },
      methods: {
        'query(sql, params)': 'Execute SELECT queries and return results',
        'execute(sql, params)': 'Execute INSERT/UPDATE/DELETE statements',
        'transaction(statements)': 'Run multiple statements atomically',
        'close()': 'Close the database connection'
      }
    }
  },

  docs: 'docs/database-api.md',
  technology: 'sql.js (SQLite compiled to WebAssembly) with IndexedDB persistence',
  useCases: 'Perfect for todo apps, notes, forms, offline-first apps, and local data storage',

  files: {
    'docs/database-api.md': databaseApiMd,      // ~50 lines - shown to LLM
    'src/lib/database.js': databaseJs,          // ~80 lines - hidden
    'src/lib/client-database.js': clientDatabaseJs  // ~250 lines - hidden
  },

  internal: [
    'src/lib/database.js',
    'src/lib/client-database.js'
  ]
}
```

**Usage:**
```javascript
import { createWorkspace, applyAddon } from 'sigrid';
import sqliteAddon from 'sigrid/addons/sqlite.js';

const workspace = await createWorkspace(tarballBuffer);
await applyAddon(workspace, sqliteAddon);

const result = await workspace.execute(
  'Create a todo list app with database storage',
  {
    mode: 'static',
    model: 'gpt-5',
    instructions: [await workspace.getAIRules()]
  }
);

// LLM generates code like:
// import { createDatabase } from '@/lib/database';
// const db = await createDatabase();
// await db.execute('CREATE TABLE todos (...)');
```

#### Best Practices

**1. Use Structured API Definitions:**
```javascript
// Good: Auto-generated, validated, type-safe
api: {
  '@/lib/module': {
    exports: { 'funcName': 'Description' }
  }
}

// Avoid: Manual text, error-prone
aiRulesAddition: "Import funcName from @/lib/module..."
```

**2. Hide Implementation Details:**
```javascript
internal: ['src/lib/implementation.js']  // Saves context tokens
```

**3. Provide Documentation:**
```javascript
files: {
  'docs/api.md': '...comprehensive examples...'
}
```

**4. Use Context Optimization:**
- Keep docs concise (~50 lines)
- Hide implementation (~300+ lines)
- Net savings: ~250 lines per addon

**5. Validate During Development:**
```javascript
// Validation runs automatically - fix errors immediately
await applyAddon(workspace, addon);
```

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

### Running Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests (requires OPENAI_API_KEY)
OPENAI_API_KEY=xxx npm run test:integration

# Run all static tests (llm-static.*, workspace.static.*)
OPENAI_API_KEY=xxx npm run test:static:only

# Run only static integration tests
OPENAI_API_KEY=xxx npm run test:static:integration

# Run only static stress tests
OPENAI_API_KEY=xxx npm run test:static:stress

# Run all static mode tests (integration + stress - legacy)
OPENAI_API_KEY=xxx npm run test:static

# Keep test workspace for inspection
KEEP_TEST_DIR=1 npm test -- workspace.static.stress.test.js

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

### Testing with Local LLM Gateway

All static mode tests support configurable LLM providers via environment variables. You can test against OpenAI or any local LLM gateway (Ollama, LM Studio, etc.):

**Test against OpenAI:**
```bash
OPENAI_API_KEY=xxx npm test -- llm-static.integration.test.js
```

**Test against local LLM gateway:**
```bash
LLM_GATEWAY_URL="http://localhost:8000/local-llm/v1" \
LLM_GATEWAY_API_KEY="your-gateway-key" \
LLM_MODEL="gpt-oss:120b" \
npm test -- llm-static.integration.test.js
```

**Test against remote gateway:**
```bash
LLM_GATEWAY_URL="https://your-gateway.com/v1" \
LLM_GATEWAY_API_KEY="your-gateway-key" \
LLM_MODEL="your-model" \
npm test -- llm-static.integration.test.js
```

**Environment Variables:**
- `OPENAI_API_KEY` - OpenAI API key (for OpenAI testing)
- `LLM_GATEWAY_URL` - Custom LLM gateway URL (for local/custom LLM testing)
- `LLM_GATEWAY_API_KEY` - Gateway API key (if required)
- `LLM_MODEL` - Model name to use (defaults: `gpt-4o-mini` for OpenAI, `gpt-5-mini` for gateway)

**Supported Test Files:**
- `llm-static.gateway.test.js` - Basic LLM gateway connectivity tests
- `llm-static.integration.test.js` - LLM static mode integration tests
- `workspace.static.integration.test.js` - Workspace static mode integration tests
- `workspace.static.callback.integration.test.js` - Progress callback tests
- `workspace.static.conversation.test.js` - Conversation persistence tests
- `workspace.static.stress.test.js` - Static mode stress tests
- `workspace.static.conversation.stress.test.js` - Conversation stress tests

**Examples:**

```bash
# Run all static tests against local LLM
LLM_GATEWAY_URL="http://localhost:8000/local-llm/v1" \
LLM_GATEWAY_API_KEY="xxx" \
LLM_MODEL="gpt-oss:120b" \
npm run test:static:only

# Run only static integration tests against local LLM
LLM_GATEWAY_URL="http://localhost:8000/local-llm/v1" \
LLM_GATEWAY_API_KEY="xxx" \
LLM_MODEL="gpt-oss:120b" \
npm run test:static:integration

# Run only static stress tests against local LLM
LLM_GATEWAY_URL="http://localhost:8000/local-llm/v1" \
LLM_GATEWAY_API_KEY="xxx" \
LLM_MODEL="gpt-oss:120b" \
npm run test:static:stress

# Run specific test file
LLM_GATEWAY_URL="http://localhost:8000/local-llm/v1" \
LLM_GATEWAY_API_KEY="xxx" \
LLM_MODEL="gpt-oss:120b" \
npm test -- llm-static.gateway.test.js

# Workspace integration tests with local LLM
LLM_GATEWAY_URL="http://localhost:8000/local-llm/v1" \
LLM_GATEWAY_API_KEY="xxx" \
LLM_MODEL="gpt-oss:120b" \
npm test -- workspace.static.integration.test.js

# Conversation tests with local LLM
LLM_GATEWAY_URL="http://localhost:8000/local-llm/v1" \
LLM_GATEWAY_API_KEY="xxx" \
LLM_MODEL="gpt-oss:120b" \
npm test -- workspace.static.conversation.test.js
```

### Test Suites

- **Unit Tests**: Fast, no API calls, test core logic
- **Integration Tests**: Test static mode and conversation persistence with real LLM API
  - Basic conversation functionality
  - Multi-turn conversations
  - Snapshot regeneration with conversations
  - Provider-managed vs internal tracking
- **Gateway Tests**: Test llm-static module against custom LLM gateway
  - Basic connectivity and responses
  - System instructions and context prompts
  - Conversation persistence through gateway
  - Streaming responses
  - Performance metrics (latency measurement)
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