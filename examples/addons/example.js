/**
 * Example 3: Programmatically Generated Addon
 *
 * Generate addons dynamically based on configuration.
 * Useful for server-specific settings, environment-based configs, etc.
 */

import { applyAddon } from '../../addon.js';
import { createWorkspace } from '../../workspace.js';

// Factory function that generates addons with structured API definitions
function createServerAddon(apiUrl, features = []) {
  const files = {
    'src/lib/api.ts': `export const API_URL = "${apiUrl}";
export const API_TIMEOUT = 30000;
`
  };

  // Structured API definition (auto-generates AI rules)
  const api = {};

  // Add features dynamically
  if (features.includes('auth')) {
    files['src/lib/auth.ts'] = `import { API_URL } from './api';

export async function login(username: string, password: string) {
  const res = await fetch(\`\${API_URL}/auth/login\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  if (!res.ok) throw new Error('Login failed');
  return res.json();
}

export async function logout() {
  await fetch(\`\${API_URL}/auth/logout\`, { method: 'POST' });
}
`;
    api['@/lib/auth'] = {
      exports: {
        'login': 'Authenticate user with username and password',
        'logout': 'Log out current user'
      },
      methods: {
        'login(username, password)': 'Returns user session data',
        'logout()': 'Clears user session'
      }
    };
  }

  if (features.includes('database')) {
    files['src/lib/db.ts'] = `import { API_URL } from './api';

export async function query(sql: string, params: any[] = []) {
  const res = await fetch(\`\${API_URL}/query\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params })
  });

  if (!res.ok) throw new Error('Query failed');
  return res.json();
}
`;
    api['@/lib/db'] = {
      exports: {
        'query': 'Execute SQL queries against remote database'
      },
      methods: {
        'query(sql, params)': 'Execute SQL and return results'
      }
    };
  }

  return {
    name: 'server-addon',
    version: '1.0.0',
    description: `Connect to server API at ${apiUrl}`,
    technology: 'RESTful API',
    useCases: 'Server-side authentication and database queries',
    api,  // Structured API - auto-generates aiRulesAddition
    files
  };
}

// Create workspace
const workspace = await createWorkspace();

// Generate addon with specific config
const addon = createServerAddon('https://api.myapp.com', ['auth', 'database']);

// Apply it
const result = await applyAddon(workspace, addon);

console.log('✓ Applied addon:', result.addon);
console.log('✓ Files added:', result.filesAdded);
console.log('\nGenerated files:');
result.filesAdded.forEach(file => {
  console.log(`  - ${file}`);
});

// Cleanup
await workspace.delete();
console.log('\n✓ Workspace cleaned up');
