/**
 * Conversation persistence for Sigrid
 *
 * Provides pluggable persistence for conversation history.
 * Users can implement their own providers (Redis, MongoDB, etc.)
 * or use the built-in InMemoryPersistence or FileSystemPersistence.
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * ConversationPersistence Interface
 *
 * All persistence providers must implement these three methods.
 * Messages are stored as serialized JSON strings.
 *
 * @interface ConversationPersistence
 * @method {Promise<Array|null>} get(conversationID) - Retrieve all messages as array of objects
 * @method {Promise<void>} append(conversationID, messageJson) - Append a single message (JSON string)
 * @method {Promise<void>} delete(conversationID) - Delete conversation data
 */

/**
 * In-memory conversation persistence (default)
 *
 * Simple Map-based storage. Fast but ephemeral - lost on process restart.
 * Good for development, testing, and short-lived conversations.
 *
 * @example
 * const persistence = new InMemoryPersistence();
 * await persistence.append('conv-123', JSON.stringify({ role: 'user', content: 'Hello' }));
 * const messages = await persistence.get('conv-123');
 * await persistence.delete('conv-123');
 */
export class InMemoryPersistence {
    constructor() {
        this.store = new Map();
    }

    /**
     * Retrieve all messages for a conversation
     * @param {string} conversationID - Conversation identifier
     * @returns {Promise<Array|null>} Array of message objects or null
     */
    async get(conversationID) {
        const messages = this.store.get(conversationID);
        return messages ? [...messages] : null; // Return a copy to prevent external mutations
    }

    /**
     * Append a message to the conversation
     * @param {string} conversationID - Conversation identifier
     * @param {string} messageJson - Serialized message object
     * @returns {Promise<void>}
     */
    async append(conversationID, messageJson) {
        const messages = this.store.get(conversationID) || [];
        messages.push(JSON.parse(messageJson));
        this.store.set(conversationID, messages);
    }

    /**
     * Delete conversation data
     * @param {string} conversationID - Conversation identifier
     * @returns {Promise<void>}
     */
    async delete(conversationID) {
        this.store.delete(conversationID);
    }

    /**
     * Clear all conversations (utility method)
     * @returns {Promise<void>}
     */
    async clear() {
        this.store.clear();
    }

    /**
     * Get number of stored conversations (utility method)
     * @returns {Promise<number>}
     */
    async size() {
        return this.store.size;
    }
}

/**
 * Filesystem-based conversation persistence
 *
 * Stores conversations as JSON files in a directory.
 * Survives process restarts. Good for development and single-server deployments.
 *
 * @example
 * const persistence = new FileSystemPersistence('./conversations');
 * await persistence.append('conv-123', JSON.stringify({ role: 'user', content: 'Hello' }));
 * const messages = await persistence.get('conv-123');
 * await persistence.delete('conv-123');
 */
export class FileSystemPersistence {
    /**
     * Create a filesystem persistence provider
     * Stores conversations as JSONL (JSON Lines) files for efficient appending.
     *
     * @param {string} directory - Directory to store conversation files
     */
    constructor(directory) {
        this.directory = directory;
        this._ensureDirectory();
    }

    /**
     * Ensure storage directory exists
     * @private
     */
    async _ensureDirectory() {
        try {
            await fs.mkdir(this.directory, { recursive: true });
        } catch (error) {
            // Directory might already exist, that's fine
        }
    }

    /**
     * Get file path for conversation
     * @param {string} conversationID - Conversation identifier
     * @returns {string} File path
     * @private
     */
    _getFilePath(conversationID) {
        // Sanitize conversationID to prevent directory traversal
        const sanitized = conversationID.replace(/[^a-zA-Z0-9_-]/g, '_');
        return path.join(this.directory, `${sanitized}.jsonl`);
    }

    /**
     * Retrieve all messages for a conversation
     * @param {string} conversationID - Conversation identifier
     * @returns {Promise<Array|null>} Array of message objects or null
     */
    async get(conversationID) {
        try {
            const filePath = this._getFilePath(conversationID);
            const content = await fs.readFile(filePath, 'utf-8');

            // Parse JSONL format (one JSON object per line)
            const lines = content.trim().split('\n');
            const messages = lines
                .filter(line => line.trim())
                .map(line => JSON.parse(line));

            return messages;
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null; // File doesn't exist
            }
            throw error;
        }
    }

    /**
     * Append a message to the conversation
     * Uses JSONL format for efficient appending without rewriting entire file.
     *
     * @param {string} conversationID - Conversation identifier
     * @param {string} messageJson - Serialized message object
     * @returns {Promise<void>}
     */
    async append(conversationID, messageJson) {
        await this._ensureDirectory();
        const filePath = this._getFilePath(conversationID);

        // Append as new line (JSONL format)
        await fs.appendFile(filePath, messageJson + '\n', 'utf-8');
    }

    /**
     * Delete conversation data
     * @param {string} conversationID - Conversation identifier
     * @returns {Promise<void>}
     */
    async delete(conversationID) {
        try {
            const filePath = this._getFilePath(conversationID);
            await fs.unlink(filePath);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return; // Already deleted, that's fine
            }
            throw error;
        }
    }

    /**
     * List all conversation IDs (utility method)
     * @returns {Promise<string[]>}
     */
    async list() {
        await this._ensureDirectory();
        const files = await fs.readdir(this.directory);
        return files
            .filter(f => f.endsWith('.json'))
            .map(f => f.replace(/\.json$/, ''));
    }

    /**
     * Clear all conversations (utility method)
     * @returns {Promise<void>}
     */
    async clear() {
        const conversations = await this.list();
        await Promise.all(conversations.map(id => this.delete(id)));
    }
}

/**
 * Default global persistence provider (in-memory)
 * Can be replaced with setSigridPersistence()
 */
let globalPersistence = new InMemoryPersistence();

/**
 * Get the global persistence provider
 * @returns {ConversationPersistence}
 */
export function getSigridPersistence() {
    return globalPersistence;
}

/**
 * Set the global persistence provider
 *
 * @param {ConversationPersistence} provider - Persistence provider
 * @example
 * import { setSigridPersistence, FileSystemPersistence } from 'sigrid';
 *
 * setSigridPersistence(new FileSystemPersistence('./conversations'));
 */
export function setSigridPersistence(provider) {
    if (!provider || typeof provider.get !== 'function' ||
        typeof provider.append !== 'function' ||
        typeof provider.delete !== 'function') {
        throw new Error('Persistence provider must implement get, append, and delete methods');
    }
    globalPersistence = provider;
}
