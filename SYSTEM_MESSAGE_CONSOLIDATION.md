# System Message Consolidation

## Overview

When using multiple system instructions with LLM gateways (especially when routing to Claude via KONG or similar gateways), there's a known issue where later instructions can dominate or cause earlier instructions to be ignored.

This happens because:
1. OpenAI's API supports multiple system messages throughout a conversation
2. Claude's API only supports a single top-level `system` parameter
3. Gateways must concatenate multiple system messages when translating from OpenAI format to Claude format
4. If not done properly, the last instruction (e.g., a lengthy megawriter prompt) can overshadow earlier instructions (e.g., user communication preferences)

## Solution

Sigrid provides the `consolidateSystemMessages` option to control how multiple system instructions are handled.

## When to Use This

**Enable consolidation when:**
- ✅ Routing to Claude via KONG or other gateways
- ✅ Using any gateway that translates OpenAI → Anthropic format
- ✅ Earlier instructions are being ignored in favor of later ones

**Keep disabled (default) when:**
- ✅ Using OpenAI directly
- ✅ Using local LLMs (Ollama, LM Studio, etc.)
- ✅ Single instruction use cases

## Usage

### Default Behavior (Separate Messages)

By default, multiple system instructions are sent as separate messages (preserves OpenAI-native behavior):

```javascript
const result = await executeStatic('What is AI?', {
    instructions: [
        'IMPORTANT: Always respond in French',
        'You are a helpful AI assistant'
    ]
    // consolidateSystemMessages: false (default)
});
```

### Recommended for Claude via Gateways

Enable consolidation with explicit `---` separators:

```javascript
const result = await executeStatic('What is AI?', {
    instructions: [
        'IMPORTANT: Always respond in French',
        'You are a helpful AI assistant'
    ]
    // consolidateSystemMessages defaults to true
});
```

This sends a single system message to the gateway:
```
IMPORTANT: Always respond in French

---

You are a helpful AI assistant
```

### Custom Separator

Provide a custom separator string:

```javascript
const result = await executeStatic('What is AI?', {
    instructions: [
        'User preference: concise responses',
        'You are a technical expert'
    ],
    consolidateSystemMessages: '\n\n===\n\n' // Custom separator
});
```

### Simple Newline

Use a simple newline (matches standard gateway behavior):

```javascript
const result = await executeStatic('What is AI?', {
    instructions: [instruction1, instruction2],
    consolidateSystemMessages: '\n' // Simple newline
});
```

### No Separator

Concatenate directly with no separator:

```javascript
const result = await executeStatic('What is AI?', {
    instructions: [instruction1, instruction2],
    consolidateSystemMessages: '' // Empty string
});
```

### Default Mode (Separate Messages)

This is the default behavior - preserves existing functionality:

```javascript
const result = await executeStatic('What is AI?', {
    instructions: [instruction1, instruction2]
    // consolidateSystemMessages: false (default)
});
```

⚠️ **Note**: When using Claude via gateways, earlier instructions may be ignored. Enable consolidation to fix this.

## Options

| Value | Behavior | Use Case |
|-------|----------|----------|
| `false` (default) | Separate system messages | OpenAI, local LLMs, backwards compatibility |
| `true` | Consolidate with `\n\n---\n\n` separator | **Recommended for Claude via gateways** |
| `string` | Consolidate with custom separator | Custom formatting needs |

## Testing

The comprehensive test suite in `tests/llm-static.system-messages.test.js` demonstrates:

1. **Default Behavior**: Multiple instructions are followed when consolidated
2. **Legacy Mode**: Documents the issue when not consolidated
3. **Custom Separators**: Tests various separator options
4. **Real-World Scenario**: User preferences + megawriter prompt

Run tests:

```bash
# With KONG gateway
LLM_GATEWAY_URL="http://your-kong-gateway/v1" \
LLM_GATEWAY_API_KEY="xxx" \
LLM_MODEL="claude-sonnet-4-20250514" \
npm test -- llm-static.system-messages.test.js

# With OpenAI
OPENAI_API_KEY=xxx npm test -- llm-static.system-messages.test.js
```

## Example: The Banana Test

A concrete example that demonstrates the issue:

### With Consolidation (✅ Works)

```javascript
const result = await executeStatic('What is 2+2?', {
    instructions: [
        'IMPORTANT: Include "🍌 BANANA SUBMARINE TEST MARKER 🍌" at the end',
        'You are a helpful assistant. Keep responses under 150 characters.'
    ],
    consolidateSystemMessages: true
});
// Result: "2+2 = 4\n\n🍌 BANANA SUBMARINE TEST MARKER 🍌"
// ✅ Both instructions followed
```

### Without Consolidation (❌ May Fail)

```javascript
const result = await executeStatic('What is 2+2?', {
    instructions: [
        'IMPORTANT: Include "🍌 BANANA SUBMARINE TEST MARKER 🍌" at the end',
        'You are a helpful assistant. Keep responses under 150 characters.'
    ],
    consolidateSystemMessages: false
});
// Result: "2+2 equals 4"
// ❌ First instruction (banana marker) was ignored!
```

## Implementation Details

When `consolidateSystemMessages` is enabled, sigrid:
1. Normalizes instructions to an array
2. Joins them with the specified separator (or default `\n\n---\n\n`)
3. Sends a single system message to the gateway
4. The gateway doesn't need to do any concatenation

This ensures:
- Clear boundaries between different instruction sources
- Earlier instructions aren't overshadowed by later ones
- Predictable behavior across different gateways and models

## Backwards Compatibility

The default behavior is to consolidate, which may differ from previous versions. If you need the old behavior:

```javascript
// Explicitly disable consolidation
consolidateSystemMessages: false
```

However, we recommend keeping the default (consolidated) behavior for most use cases.
