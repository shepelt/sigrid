/**
 * Client-side SQLite Database Implementation
 *
 * Uses sql.js (SQLite compiled to WebAssembly) with IndexedDB persistence.
 * This implementation runs entirely in the browser.
 *
 * Features:
 * - SQLite database in browser via sql.js
 * - Persistent storage via IndexedDB
 * - Automatic save on modifications
 * - Transaction support
 */

import initSqlJs from 'sql.js';
import { Database } from './database.js';

const DB_NAME = 'app_database';
const DB_STORE = 'sqlitedb';
const DB_KEY = 'db';

/**
 * Client-side database using sql.js and IndexedDB
 */
export class ClientDatabase extends Database {
  constructor() {
    super();
    this.SQL = null;
    this.db = null;
  }

  /**
   * Initialize sql.js and load database from IndexedDB
   */
  async init() {
    // Initialize sql.js with WASM file from CDN
    this.SQL = await initSqlJs({
      locateFile: (file) => `https://sql.js.org/dist/${file}`
    });

    // Load existing database from IndexedDB or create new one
    const data = await this._loadFromIndexedDB();

    if (data) {
      this.db = new this.SQL.Database(data);
    } else {
      this.db = new this.SQL.Database();
    }
  }

  /**
   * Execute a SELECT query
   * @param {string} sql - SQL query with ? placeholders
   * @param {Array} params - Parameter values
   * @returns {Promise<Array>} Array of result objects
   */
  async query(sql, params = []) {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const stmt = this.db.prepare(sql);
    stmt.bind(params);

    const results = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push(row);
    }

    stmt.free();
    return results;
  }

  /**
   * Execute INSERT, UPDATE, DELETE statements
   * @param {string} sql - SQL statement with ? placeholders
   * @param {Array} params - Parameter values
   * @returns {Promise<{changes: number, lastInsertId: number}>}
   */
  async execute(sql, params = []) {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    this.db.run(sql, params);

    // Save to IndexedDB after modifications
    await this._saveToIndexedDB();

    return {
      changes: this.db.getRowsModified(),
      lastInsertId: this._getLastInsertId()
    };
  }

  /**
   * Execute multiple statements in a transaction
   * @param {Array<{sql: string, params: Array}>} statements
   * @returns {Promise<void>}
   */
  async transaction(statements) {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    try {
      this.db.run('BEGIN TRANSACTION');

      for (const { sql, params = [] } of statements) {
        this.db.run(sql, params);
      }

      this.db.run('COMMIT');

      // Save to IndexedDB after successful transaction
      await this._saveToIndexedDB();
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  /**
   * Close the database
   */
  async close() {
    if (this.db) {
      await this._saveToIndexedDB();
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Get the last inserted row ID
   * @private
   */
  _getLastInsertId() {
    const result = this.db.exec('SELECT last_insert_rowid() as id');
    return result[0]?.values[0]?.[0] || null;
  }

  /**
   * Load database from IndexedDB
   * @private
   * @returns {Promise<Uint8Array|null>}
   */
  async _loadFromIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(DB_STORE)) {
          resolve(null);
          return;
        }

        const transaction = db.transaction([DB_STORE], 'readonly');
        const store = transaction.objectStore(DB_STORE);
        const getRequest = store.get(DB_KEY);

        getRequest.onsuccess = () => {
          resolve(getRequest.result || null);
        };

        getRequest.onerror = () => reject(getRequest.error);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE);
        }
      };
    });
  }

  /**
   * Save database to IndexedDB
   * @private
   * @returns {Promise<void>}
   */
  async _saveToIndexedDB() {
    if (!this.db) return;

    const data = this.db.export();

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction([DB_STORE], 'readwrite');
        const store = transaction.objectStore(DB_STORE);
        const putRequest = store.put(data, DB_KEY);

        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE);
        }
      };
    });
  }

  /**
   * Clear the database (useful for testing)
   * @returns {Promise<void>}
   */
  async clear() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
