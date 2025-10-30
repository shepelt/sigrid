# Test Addons

This directory contains addon test fixtures for Sigrid's addon system tests.

The SQLite addon here is used by `addon.integration.test.js` to verify the addon system works end-to-end.

## What are Addons?

Addons are JavaScript objects that add functionality to workspaces. They can:
- Add files to workspaces
- Install npm dependencies
- Update AI instructions
- Hide implementation from LLM context (context optimization)

## SQLite Example

The `sqlite.js` addon demonstrates:
- Loading files from disk
- Hiding implementation code from LLM snapshots
- Providing API documentation to the LLM
- Installing dependencies

**Usage:**
```javascript
import sqliteAddon from './examples/addons/sqlite.js';
import { applyAddon } from './addon.js';

await applyAddon(workspace, sqliteAddon);
```

## Creating Custom Addons

Addons can be defined anywhere - they're just JavaScript objects:

### Inline Definition
```javascript
const myAddon = {
  name: 'my-feature',
  version: '1.0.0',
  dependencies: {
    'some-package': '^1.0.0'
  },
  files: {
    'src/lib/feature.ts': 'export function myFeature() { ... }'
  },
  aiRulesAddition: '\n## My Feature\n\nUse myFeature() for...\n'
};

await applyAddon(workspace, myAddon);
```

### From Files
```javascript
import fs from 'fs/promises';

const code = await fs.readFile('./my-feature.ts', 'utf-8');

const myAddon = {
  name: 'my-feature',
  files: {
    'src/lib/feature.ts': code
  }
};
```

### Programmatically Generated
```javascript
function createServerAddon(apiUrl) {
  return {
    name: 'server-api',
    files: {
      'src/lib/api.ts': `export const API_URL = "${apiUrl}";`
    }
  };
}

await applyAddon(workspace, createServerAddon('https://api.example.com'));
```

## Context Optimization

Use the `internal` array to hide implementation files from LLM snapshots:

```javascript
{
  files: {
    'docs/api.md': '...',           // LLM sees this
    'src/lib/impl.ts': '...',       // LLM doesn't see this
  },
  internal: ['src/lib/impl.ts']     // Excluded from snapshots
}
```

This keeps context lean while providing working code.

## For Nobi and Other Projects

You don't need this directory! Addons can be defined anywhere:

```javascript
// In nobi
const nobiAddons = {
  serverAuth: {
    name: 'server-auth',
    files: { ... }
  },
  serverDatabase: {
    name: 'server-database',
    files: { ... }
  }
};

await applyAddon(workspace, nobiAddons.serverAuth);
```

The addon system is decoupled - define addons however you want!
