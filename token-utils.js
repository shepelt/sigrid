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
 *
 * @param {Object} response - API response object
 * @returns {Object|null} Token usage object with promptTokens, completionTokens, totalTokens
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

    return {
        promptTokens,
        completionTokens,
        totalTokens
    };
}

/**
 * Accumulate token counts from multiple responses
 *
 * @param {Array<Object>} usages - Array of token usage objects
 * @returns {Object} Accumulated token usage
 */
export function accumulateTokenUsage(usages) {
    return usages.reduce((acc, usage) => {
        if (!usage) return acc;

        return {
            promptTokens: (acc.promptTokens || 0) + (usage.promptTokens || 0),
            completionTokens: (acc.completionTokens || 0) + (usage.completionTokens || 0),
            totalTokens: (acc.totalTokens || 0) + (usage.totalTokens || 0)
        };
    }, {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0
    });
}
