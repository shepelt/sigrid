# Database API Reference

This project includes a SQLite database that runs entirely in the browser using sql.js and IndexedDB.

## Quick Start

```javascript
import { createDatabase } from '@/lib/database';

// Initialize database
const db = await createDatabase();

// Create table
await db.execute(`
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);

// Insert data
await db.execute(
  'INSERT INTO todos (text, completed) VALUES (?, ?)',
  ['Buy groceries', 0]
);

// Query data
const todos = await db.query('SELECT * FROM todos WHERE completed = ?', [0]);
console.log(todos); // [{ id: 1, text: 'Buy groceries', completed: 0, ... }]
```

## API Methods

### `createDatabase()`

Factory function that creates and initializes a database instance.

```javascript
const db = await createDatabase();
```

Returns: `Promise<Database>`

### `db.query(sql, params)`

Execute a SELECT query and return results.

```javascript
const users = await db.query('SELECT * FROM users WHERE age > ?', [18]);
// Returns: Array of objects, e.g., [{ id: 1, name: 'Alice', age: 25 }, ...]
```

Parameters:
- `sql` (string): SQL SELECT query with `?` placeholders
- `params` (Array): Values to bind to placeholders

Returns: `Promise<Array<Object>>`

### `db.execute(sql, params)`

Execute INSERT, UPDATE, or DELETE statements.

```javascript
const result = await db.execute(
  'INSERT INTO users (name, age) VALUES (?, ?)',
  ['Bob', 30]
);
console.log(result.lastInsertId); // ID of inserted row
console.log(result.changes); // Number of rows affected
```

Parameters:
- `sql` (string): SQL statement with `?` placeholders
- `params` (Array): Values to bind to placeholders

Returns: `Promise<{ changes: number, lastInsertId: number }>`

### `db.transaction(statements)`

Execute multiple statements atomically. All succeed or all fail.

```javascript
await db.transaction([
  { sql: 'INSERT INTO users (name) VALUES (?)', params: ['Alice'] },
  { sql: 'INSERT INTO users (name) VALUES (?)', params: ['Bob'] },
  { sql: 'UPDATE stats SET count = count + 2' }
]);
```

Parameters:
- `statements` (Array): Array of `{ sql, params }` objects

Returns: `Promise<void>`

### `db.close()`

Close the database connection and save to IndexedDB.

```javascript
await db.close();
```

Returns: `Promise<void>`

## Common Patterns

### Schema Creation

Always use `CREATE TABLE IF NOT EXISTS` to avoid errors:

```javascript
await db.execute(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  )
`);
```

### CRUD Operations

```javascript
// Create
const { lastInsertId } = await db.execute(
  'INSERT INTO users (name, email) VALUES (?, ?)',
  ['Alice', 'alice@example.com']
);

// Read
const users = await db.query('SELECT * FROM users WHERE id = ?', [lastInsertId]);

// Update
await db.execute('UPDATE users SET email = ? WHERE id = ?', ['new@example.com', lastInsertId]);

// Delete
await db.execute('DELETE FROM users WHERE id = ?', [lastInsertId]);
```

### Using in React Components

```javascript
import { createDatabase } from '@/lib/database';
import { useEffect, useState } from 'react';

function TodoList() {
  const [todos, setTodos] = useState([]);
  const [db, setDb] = useState(null);

  useEffect(() => {
    async function init() {
      const database = await createDatabase();

      // Create schema
      await database.execute(`
        CREATE TABLE IF NOT EXISTS todos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          text TEXT NOT NULL,
          completed INTEGER DEFAULT 0
        )
      `);

      setDb(database);
      loadTodos(database);
    }
    init();
  }, []);

  async function loadTodos(database) {
    const rows = await database.query('SELECT * FROM todos ORDER BY id DESC');
    setTodos(rows);
  }

  async function addTodo(text) {
    await db.execute('INSERT INTO todos (text) VALUES (?)', [text]);
    loadTodos(db);
  }

  async function toggleTodo(id) {
    await db.execute(
      'UPDATE todos SET completed = NOT completed WHERE id = ?',
      [id]
    );
    loadTodos(db);
  }

  async function deleteTodo(id) {
    await db.execute('DELETE FROM todos WHERE id = ?', [id]);
    loadTodos(db);
  }

  // ... render UI
}
```

## Notes

- **Boolean Values**: SQLite doesn't have a boolean type. Use `INTEGER` with 0 (false) or 1 (true).
- **Timestamps**: Use `INTEGER` to store Unix timestamps, or `TEXT` for ISO strings.
- **Auto-save**: Database automatically saves to IndexedDB after every `execute()` or `transaction()`.
- **Persistence**: Data survives page refreshes via IndexedDB.
- **Browser Only**: This implementation uses sql.js and only works in browsers, not Node.js.

## SQLite Features

All standard SQLite features are available:

- Indexes: `CREATE INDEX idx_name ON users(name)`
- Full-text search: `CREATE VIRTUAL TABLE search USING fts5(content)`
- Triggers: `CREATE TRIGGER ...`
- Views: `CREATE VIEW active_users AS SELECT ...`
- JSON functions: `json_extract()`, `json_array()`, etc.

For full SQLite documentation, see: https://www.sqlite.org/docs.html
