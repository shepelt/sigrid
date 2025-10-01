# Sigrid

LLM CLI agent with file tooling support. Sigrid can execute prompts, read/write files, and maintain conversations.

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

**Execute Options:**
```javascript
{
  model: 'gpt-5-mini',          // Model name
  instructions: [],             // Array or string of instructions
  pure: false,                  // Pure output mode
  conversation: false,          // Enable conversation mode
  conversationID: null,         // Existing conversation ID
  workspace: null,              // Workspace directory (overrides setSandboxRoot)
  progressCallback: null,       // Progress callback function
  client: null                  // Custom OpenAI client
}
```

**Return Value:**
```javascript
{
  content: "...",              // LLM response text
  conversationID: "..."        // Conversation ID (for multi-turn)
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

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## License

ISC