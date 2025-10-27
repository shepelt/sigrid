import OpenAI from "openai";

let client = null;

/**
 * Initialize OpenAI client (shared across all modules)
 * @param {string} apiKey - OpenAI API key
 */
export function initializeClient(apiKey) {
    if (!apiKey) {
        throw new Error('OpenAI API key is required');
    }
    client = new OpenAI({ apiKey });
}

/**
 * Get initialized OpenAI client
 * @returns {OpenAI} OpenAI client instance
 */
export function getClient() {
    if (!client) {
        throw new Error('Client not initialized. Call initializeClient() first.');
    }
    return client;
}
