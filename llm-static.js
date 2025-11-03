import { randomBytes } from "crypto";
import { getClient } from "./llm-client.js";
import { extractTokenUsage, estimateTokens } from "./token-utils.js";

const DEFAULT_MODEL = "gpt-5-mini";

/**
 * Generate a unique conversation ID
 * @returns {string} Conversation ID
 */
function generateConversationID() {
    return `conv_${randomBytes(16).toString('hex')}`;
}

/**
 * Execute static LLM inference (no tooling, no server-side conversation API)
 * Uses OpenAI chat completions API with optional internal conversation tracking
 *
 * @param {string} prompt - User prompt
 * @param {Object} opts - Options
 * @param {OpenAI} opts.client - Custom OpenAI client (optional, uses initialized client by default)
 * @param {string} opts.model - Model name (default: "gpt-5-mini")
 * @param {string|string[]} opts.instructions - System instruction(s)
 * @param {string|string[]} opts.prompts - Additional user prompts inserted before main prompt
 * @param {boolean} opts.conversation - Enable internal conversation mode
 * @param {string} opts.conversationID - Existing conversation ID
 * @param {ConversationPersistence} opts.conversationPersistence - Persistence provider for internal conversation tracking
 * @param {boolean} opts.saveAssistantMessage - Whether to save assistant message to persistence (default: true)
 * @param {boolean} opts.stream - Enable streaming output (default: false)
 * @param {Function} opts.streamCallback - Callback for streaming chunks: (chunk: string) => void
 * @param {Object} opts.responseFormat - Response format for structured outputs (e.g., { type: "json_object" } or { type: "json_schema", json_schema: {...} })
 * @param {boolean} opts.retry - Enable retry on rate limit errors (default: true)
 * @param {number} opts.maxRetries - Maximum number of retry attempts (default: 2)
 * @param {number} opts.retryBaseDelay - Base delay in seconds for exponential backoff (default: 5)
 * @param {number} opts.retryMaxDelay - Maximum delay in seconds (default: 60)
 * @param {Function} opts.onRetry - Callback for retry attempts: (info: {attempt, delay, error, remainingTokens, resetTime}) => void
 * @returns {Promise<{content: string, conversationID: string, tokenCount?: Object}>} - content is empty string if streaming enabled, tokenCount contains usage stats if available
 */
export async function executeStatic(prompt, opts = {}) {
    const apiClient = opts.client || getClient();
    const model = opts.model || DEFAULT_MODEL;

    // Build retry config
    const retryConfig = {
        enabled: opts.retry ?? true,
        maxRetries: opts.maxRetries ?? 2,
        baseDelay: opts.retryBaseDelay ?? 5,
        maxDelay: opts.retryMaxDelay ?? 60,
        onRetry: opts.onRetry
    };

    // Static mode only supports conversation through internal tracking with conversationPersistence
    if (opts.conversation && !opts.conversationPersistence) {
        throw new Error('Static mode requires conversationPersistence when conversation mode is enabled. Provide a persistence provider (e.g., InMemoryPersistence or FileSystemPersistence) or disable conversation mode.');
    }

    // Use internal conversation tracking if user provides BOTH conversation: true AND a persistence provider
    const useInternalConversations = opts.conversation && opts.conversationPersistence !== undefined;

    const persistence = opts.conversationPersistence;
    let conversationID = opts.conversationID;
    let previousMessages = [];

    // Load previous conversation history if using internal tracking
    if (useInternalConversations && conversationID) {
        const history = await persistence.get(conversationID);
        if (history) {
            previousMessages = history;
        }
    }

    // Generate conversationID for internal tracking if needed
    if (useInternalConversations && !conversationID) {
        conversationID = generateConversationID();
    }

    // Track new messages for persistence (only user and assistant messages)
    const newMessages = [];

    const messages = [];

    // Add system instructions
    if (opts.instructions) {
        const instructions = Array.isArray(opts.instructions)
            ? opts.instructions
            : [opts.instructions];

        for (const inst of instructions) {
            messages.push({ role: "system", content: inst });
        }
    }

    // Add additional user prompts before main prompt
    if (opts.prompts) {
        const prompts = Array.isArray(opts.prompts)
            ? opts.prompts
            : [opts.prompts];

        for (const p of prompts) {
            messages.push({ role: "user", content: p });
        }
    }

    // Add previous conversation history (for internal tracking)
    if (useInternalConversations && previousMessages.length > 0) {
        messages.push(...previousMessages);
    }

    // Add current user prompt
    const userMessage = { role: "user", content: prompt };
    messages.push(userMessage);

    // Track new message for persistence
    if (useInternalConversations) {
        newMessages.push(userMessage);
    }

    // Non-streaming mode
    if (!opts.stream) {
        const requestParams = {
            model,
            messages
        };

        // Add responseFormat if provided
        if (opts.responseFormat) {
            requestParams.response_format = opts.responseFormat;
        }

        const response = await callWithRetry(apiClient, requestParams, retryConfig);

        const content = response.choices[0]?.message?.content || "";

        // Extract token usage from response
        const tokenCount = extractTokenUsage(response);

        // Save assistant response to persistence for internal tracking
        if (useInternalConversations) {
            const saveAssistant = opts.saveAssistantMessage !== false; // Default to true

            if (saveAssistant) {
                const assistantMessage = { role: "assistant", content };
                newMessages.push(assistantMessage);
            }

            // Append new messages to persistence
            for (const message of newMessages) {
                await persistence.append(conversationID, JSON.stringify(message));
            }
        }

        const result = {
            content,
            conversationID
        };

        // Add token count if available
        if (tokenCount) {
            result.tokenCount = tokenCount;
        }

        return result;
    }

    // Streaming mode
    const streamParams = {
        model,
        messages,
        stream: true,
        // Request usage data in final stream chunk
        // Works with OpenAI and OpenAI-compatible gateways
        stream_options: {
            include_usage: true
        }
    };

    // Add responseFormat if provided
    if (opts.responseFormat) {
        streamParams.response_format = opts.responseFormat;
    }

    const stream = await callWithRetry(apiClient, streamParams, retryConfig);

    // Always accumulate chunks for token estimation and optional persistence
    let fullContent = "";
    let usageData = null;

    for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';

        if (text) {
            // Accumulate all content (needed for token estimation)
            fullContent += text;

            // Stream to callback
            if (opts.streamCallback) {
                opts.streamCallback(text);
            }
        }

        // Extract usage data from final chunk (OpenAI streaming)
        if (chunk.usage) {
            usageData = chunk.usage;
        }
    }

    // Save assistant response to persistence for internal tracking
    if (useInternalConversations) {
        const saveAssistant = opts.saveAssistantMessage !== false; // Default to true

        if (saveAssistant) {
            const assistantMessage = { role: "assistant", content: fullContent };
            newMessages.push(assistantMessage);
        }

        // Append new messages to persistence
        for (const message of newMessages) {
            await persistence.append(conversationID, JSON.stringify(message));
        }
    }

    // Return token counts for streaming mode
    // If we got actual usage data from the stream, use it
    // Otherwise, estimate based on content
    let tokenCount;
    if (usageData) {
        tokenCount = extractTokenUsage({ usage: usageData });
    } else {
        // Fallback to estimation if no usage data available
        let estimatedPromptTokens = 0;
        for (const msg of messages) {
            estimatedPromptTokens += estimateTokens(msg.content || '');
        }
        const estimatedCompletionTokens = estimateTokens(fullContent || '');

        tokenCount = {
            promptTokens: estimatedPromptTokens,
            completionTokens: estimatedCompletionTokens,
            totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
            estimated: true  // Flag to indicate these are estimates, not exact counts from API
        };
    }

    // Return empty content for streaming mode with token counts
    return {
        content: "",
        conversationID,
        tokenCount
    };
}

/**
 * Retry wrapper for OpenAI API calls with smart 429 handling
 *
 * Strategy:
 * 1. Try to parse x-ratelimit-reset-tokens header (e.g., "3m0.088s")
 * 2. Fall back to exponential backoff with jitter
 * 3. Only retry 429 rate limit errors
 */
async function callWithRetry(apiClient, params, retryConfig = {}) {
    const config = {
        enabled: retryConfig.enabled ?? true,
        maxRetries: retryConfig.maxRetries ?? 2,
        baseDelay: retryConfig.baseDelay ?? 5,
        maxDelay: retryConfig.maxDelay ?? 60,
        onRetry: retryConfig.onRetry
    };

    return _retry(apiClient, params, config, 1);
}

async function _retry(apiClient, params, config, attempt) {
    try {
        return await apiClient.chat.completions.create(params);

    } catch (error) {
        // Only retry 429 errors
        if (error.status !== 429 || !config.enabled || attempt > config.maxRetries) {
            throw error;
        }

        // Try to parse delay from x-ratelimit-reset-tokens header
        let delay = parseResetHeader(error.headers?.get('x-ratelimit-reset-tokens'));

        if (!delay) {
            // Fall back to exponential backoff with jitter
            const exponentialMultiplier = Math.pow(2, attempt - 1);
            const jitter = 1 + (Math.random() * 0.25);
            delay = config.baseDelay * exponentialMultiplier * jitter;
        }

        const cappedDelay = Math.min(delay, config.maxDelay);

        // Call retry callback if provided (for logging/metrics)
        if (config.onRetry) {
            config.onRetry({
                attempt,
                delay: cappedDelay,
                error: error.message,
                remainingTokens: error.headers?.get('x-ratelimit-remaining-tokens'),
                resetTime: error.headers?.get('x-ratelimit-reset-tokens')
            });
        }

        await sleep(cappedDelay * 1000);

        return _retry(apiClient, params, config, attempt + 1);
    }
}

/**
 * Parse x-ratelimit-reset-tokens header
 * Format: "3m0.088s" or "45.5s"
 * Returns: number of seconds, or null if cannot parse
 */
function parseResetHeader(resetValue) {
    if (!resetValue) return null;

    try {
        const match = resetValue.match(/(?:(\d+)m)?(\d+(?:\.\d+)?)s/);
        if (match) {
            const minutes = parseInt(match[1] || '0');
            const seconds = parseFloat(match[2] || '0');
            const totalSeconds = (minutes * 60) + seconds;

            // Sanity check: delay should be reasonable (0-300s = 5 minutes)
            if (totalSeconds > 0 && totalSeconds < 300) {
                return totalSeconds;
            }
        }
    } catch (e) {
        return null;
    }

    return null;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Re-export shared client functions
export { initializeClient, getClient } from "./llm-client.js";

// Re-export persistence for convenience
export {
    InMemoryPersistence,
    FileSystemPersistence,
    getSigridPersistence,
    setSigridPersistence
} from "./persistence.js";
