/**
 * SQLite Addon
 *
 * Provides browser-based SQLite database support using sql.js.
 * Files are loaded from the sqlite/ directory and bundled into an addon object.
 */

import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load file contents
const databaseJs = await fs.readFile(
    path.join(__dirname, 'sqlite/internal/database.js'),
    'utf-8'
);

const clientDatabaseJs = await fs.readFile(
    path.join(__dirname, 'sqlite/internal/client-database.js'),
    'utf-8'
);

const databaseApiMd = await fs.readFile(
    path.join(__dirname, 'sqlite/docs/database-api.md'),
    'utf-8'
);

// Export addon object with structured API definition
export default {
    name: 'sqlite',
    version: '1.0.0',
    description: 'This project includes a SQLite database that runs in the browser',

    dependencies: {
        'sql.js': '^1.10.3'
    },

    // Structured API definition (like an ABI)
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
        'docs/database-api.md': databaseApiMd,
        'src/lib/database.js': databaseJs,
        'src/lib/client-database.js': clientDatabaseJs
    },

    internal: [
        'src/lib/database.js',
        'src/lib/client-database.js'
    ]
};
