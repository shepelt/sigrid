/**
 * Database Abstraction Layer
 *
 * Provides a unified interface for database operations across different
 * SQLite implementations (client-side, server-side, edge).
 *
 * Import and use:
 *   import { createDatabase } from '@/lib/database';
 *   const db = await createDatabase();
 *   const users = await db.query('SELECT * FROM users WHERE id = ?', [123]);
 */

/**
 * Abstract database interface
 */
export class Database {
  /**
   * Initialize the database
   * @returns {Promise<void>}
   */
  async init() {
    throw new Error('init() must be implemented');
  }

  /**
   * Execute a SELECT query
   * @param {string} sql - SQL query with ? placeholders
   * @param {Array} params - Parameter values
   * @returns {Promise<Array>} Array of result rows
   */
  async query(sql, params = []) {
    throw new Error('query() must be implemented');
  }

  /**
   * Execute INSERT, UPDATE, DELETE statements
   * @param {string} sql - SQL statement with ? placeholders
   * @param {Array} params - Parameter values
   * @returns {Promise<{changes: number, lastInsertId: number}>}
   */
  async execute(sql, params = []) {
    throw new Error('execute() must be implemented');
  }

  /**
   * Execute a batch of statements in a transaction
   * @param {Array<{sql: string, params: Array}>} statements
   * @returns {Promise<void>}
   */
  async transaction(statements) {
    throw new Error('transaction() must be implemented');
  }

  /**
   * Close the database connection
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error('close() must be implemented');
  }
}

/**
 * Factory function to create a database instance
 * Currently returns ClientDatabase (browser-based sql.js)
 *
 * @returns {Promise<Database>}
 */
export async function createDatabase() {
  // Dynamically import to avoid bundling server code in client builds
  const { ClientDatabase } = await import('./client-database.js');
  const db = new ClientDatabase();
  await db.init();
  return db;
}
