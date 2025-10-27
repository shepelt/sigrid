import OpenAI from "openai";

let client = null;

/**
 * Initialize OpenAI client (shared across all modules)
 * @param {string|Object} apiKeyOrOptions - OpenAI API key (string) or options object
 * @param {string} apiKeyOrOptions.apiKey - OpenAI API key
 * @param {string} apiKeyOrOptions.baseURL - Optional custom base URL (e.g., for gateway)
 * @param {number} apiKeyOrOptions.timeout - Optional timeout in milliseconds
 */
export function initializeClient(apiKeyOrOptions) {
    // Support both old string format and new options object
    const options = typeof apiKeyOrOptions === 'string'
        ? { apiKey: apiKeyOrOptions }
        : apiKeyOrOptions;

    if (!options || !options.apiKey) {
        throw new Error('OpenAI API key is required');
    }

    // Auto-detect gateway URL from environment if not provided
    if (!options.baseURL && process.env.LLM_GATEWAY_URL) {
        options.baseURL = process.env.LLM_GATEWAY_URL;
        console.log(`Using LLM gateway: ${options.baseURL}`);
    }

    // Auto-detect gateway API key from environment if not provided
    if (!options.apiKey && process.env.LLM_GATEWAY_API_KEY) {
        options.apiKey = process.env.LLM_GATEWAY_API_KEY;
    }

    client = new OpenAI(options);
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
