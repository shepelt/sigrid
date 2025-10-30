# Addon Example

Working example showing how to use Sigrid's addon system.

## Running the Example

```bash
node examples/addons/example.js
```

This demonstrates:
- Creating a workspace
- Programmatically generating an addon
- Applying it to the workspace
- Dynamic feature composition

## Creating Your Own Addons

Addons are just JavaScript objects:

```javascript
import { applyAddon } from 'sigrid/addon.js';
import { createWorkspace } from 'sigrid/workspace.js';

const myAddon = {
  name: 'my-addon',
  files: {
    'src/lib/feature.ts': 'export function myFeature() { ... }'
  }
};

const workspace = await createWorkspace();
await applyAddon(workspace, myAddon);
```

## Full Example

See `test-fixtures/addons/sqlite.js` for a production-ready addon that:
- Loads files from disk
- Uses context optimization (hides implementation from LLM)
- Includes comprehensive documentation
- Passes integration tests

## Documentation

- Core API: `addon.js`
- Integration tests: `addon.integration.test.js`
