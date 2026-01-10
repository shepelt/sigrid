/**
 * Token counting utilities for tracking LLM usage
 */

/**
 * Simple token estimation based on character count
 * Uses rough approximation: ~4 characters per token for English text
 * This is less accurate than tiktoken but doesn't require dependencies
 *
 * @param {string} text - Text to estimate tokens for
 * @returns {number} Estimated token count
 */
export function estimateTokens(text) {
    if (!text) return 0;
    // Rough approximation: 1 token ≈ 4 characters for English
    // This is conservative and will slightly overestimate
    return Math.ceil(text.length / 4);
}

/**
 * Extract token usage from LLM API response
 * Supports both OpenAI format (prompt_tokens) and Claude format (input_tokens)
 * Also extracts cache metrics when available
 *
 * @param {Object} response - API response object
 * @returns {Object|null} Token usage object with promptTokens, completionTokens, totalTokens, and optional cache metrics
 */
export function extractTokenUsage(response) {
    if (!response?.usage) {
        return null;
    }

    const usage = response.usage;

    // Handle both OpenAI and Claude formats
    // OpenAI: prompt_tokens, completion_tokens, total_tokens
    // Claude: input_tokens, output_tokens (no total)
    const promptTokens = usage.prompt_tokens || usage.input_tokens || 0;
    const completionTokens = usage.completion_tokens || usage.output_tokens || 0;
    const totalTokens = usage.total_tokens || (promptTokens + completionTokens);

    const result = {
        promptTokens,
        completionTokens,
        totalTokens
    };

    // Extract cache metrics if available
    // Anthropic format: cache_creation_input_tokens, cache_read_input_tokens
    if (usage.cache_creation_input_tokens !== undefined) {
        result.cacheCreationInputTokens = usage.cache_creation_input_tokens;
    }
    if (usage.cache_read_input_tokens !== undefined) {
        result.cacheReadInputTokens = usage.cache_read_input_tokens;
    }

    // OpenAI format: prompt_tokens_details.cached_tokens
    if (usage.prompt_tokens_details?.cached_tokens !== undefined) {
        result.cachedTokens = usage.prompt_tokens_details.cached_tokens;
    }

    return result;
}

/**
 * Accumulate token counts from multiple responses
 *
 * @param {Array<Object>} usages - Array of token usage objects
 * @returns {Object} Accumulated token usage (including cache metrics if present)
 */
export function accumulateTokenUsage(usages) {
    return usages.reduce((acc, usage) => {
        if (!usage) return acc;

        const result = {
            promptTokens: (acc.promptTokens || 0) + (usage.promptTokens || 0),
            completionTokens: (acc.completionTokens || 0) + (usage.completionTokens || 0),
            totalTokens: (acc.totalTokens || 0) + (usage.totalTokens || 0)
        };

        // Accumulate cache metrics if present
        if (usage.cacheCreationInputTokens !== undefined) {
            result.cacheCreationInputTokens = (acc.cacheCreationInputTokens || 0) + usage.cacheCreationInputTokens;
        }
        if (usage.cacheReadInputTokens !== undefined) {
            result.cacheReadInputTokens = (acc.cacheReadInputTokens || 0) + usage.cacheReadInputTokens;
        }
        if (usage.cachedTokens !== undefined) {
            result.cachedTokens = (acc.cachedTokens || 0) + usage.cachedTokens;
        }

        return result;
    }, {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
    });
}
