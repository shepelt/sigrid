import { randomBytes } from "crypto";
import { getClient } from "./llm-client.js";
import { extractTokenUsage, estimateTokens } from "./token-utils.js";
import { executeFileTool } from "./filetooling.js";
import { formatMessageWithAttachments, formatMessagesWithAttachments, prepareMessageForPersistence } from "./attachments.js";

const DEFAULT_MODEL = "gpt-5-mini";

/**
 * Convert tool definition to OpenAI chat.completions format
 * Handles both formats:
 * - Already wrapped: {type: "function", function: {name, description, parameters}}
 * - Unwrapped: {type: "function", name, description, parameters}
 * @param {Object} tool - Tool definition
 * @returns {Object} Tool in OpenAI format
 */
function normalizeToolFormat(tool) {
    // Already in correct format
    if (tool.function && tool.function.name) {
        return tool;
    }

    // Convert from filetooling.js format to chat.completions format
    if (tool.name && tool.parameters) {
        return {
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters
            }
        };
    }

    // Unknown format, return as-is
    return tool;
}

/**
 * Generate a unique conversation ID
 * @returns {string} Conversation ID
 */
function generateConversationID() {
    return `conv_${randomBytes(16).toString('hex')}`;
}

/**
 * Execute static LLM inference with optional tool calling
 * Uses OpenAI chat completions API with optional internal conversation tracking
 *
 * @param {string} prompt - User prompt
 * @param {Object} opts - Options
 * @param {OpenAI} opts.client - Custom OpenAI client (optional, uses initialized client by default)
 * @param {string} opts.model - Model name (default: "gpt-5-mini")
 * @param {string|string[]} opts.instructions - System instruction(s)
 * @param {boolean|string} opts.consolidateSystemMessages - Controls system message consolidation. true = consolidate with default separator '\n\n---\n\n', false = separate messages (default), string = consolidate with custom separator. Enable when using Claude via gateways to prevent instruction priority issues.
 * @param {string|string[]} opts.prompts - Additional user prompts inserted before main prompt
 * @param {boolean} opts.conversation - Enable internal conversation mode
 * @param {string} opts.conversationID - Existing conversation ID
 * @param {ConversationPersistence} opts.conversationPersistence - Persistence provider for internal conversation tracking
 * @param {boolean} opts.saveAssistantMessage - Whether to save assistant message to persistence (default: true)
 * @param {boolean} opts.stream - Enable streaming output (default: false, not supported with tools)
 * @param {Function} opts.streamCallback - Callback for streaming chunks: (chunk: string) => void
 * @param {Array} opts.tools - Array of tool definitions (OpenAI format)
 * @param {Object|string} opts.tool_choice - Tool choice: "auto", "none", "required", or {type: "auto"} (Claude format)
 * @param {Function} opts.toolExecutor - Custom tool executor function (toolName, args) => Promise<result>. Defaults to executeFileTool for file tools.
 * @param {string} opts.workspace - Workspace path for tool execution (passed to toolExecutor)
 * @param {Function} opts.progressCallback - Progress callback for tool execution
 * @param {Object} opts.responseFormat - Response format for structured outputs (e.g., { type: "json_object" } or { type: "json_schema", json_schema: {...} })
 * @param {Array} opts.attachments - Array of file attachments for the current message. Each attachment: { id?, filename, mimeType, data (base64) }
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

        // Consolidation is opt-in to preserve existing behavior across all LLM providers
        // Enable for Claude via gateways to fix instruction priority issues
        // Accepts: true (default separator), false (no consolidation - default), or string (custom separator)
        const consolidate = opts.consolidateSystemMessages ?? false;

        if (consolidate === false) {
            // Legacy behavior: separate system message for each instruction
            for (const inst of instructions) {
                messages.push({ role: "system", content: inst });
            }
        } else {
            // Consolidate into single system message
            // Multiple system messages cause Claude to ignore earlier instructions
            const separator = typeof consolidate === 'string' ? consolidate : '\n\n---\n\n';
            const combinedInstructions = instructions.join(separator);
            messages.push({ role: "system", content: combinedInstructions });
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
    // Format messages with attachments for the target model
    if (useInternalConversations && previousMessages.length > 0) {
        const formattedHistory = formatMessagesWithAttachments(previousMessages, model);
        messages.push(...formattedHistory);
    }

    // Build current user message with optional attachments
    const userMessageForPersistence = {
        role: "user",
        content: prompt,
        ...(opts.attachments && opts.attachments.length > 0 ? { attachments: opts.attachments } : {})
    };

    // Format user message for API (adapts to vision/non-vision model)
    const userMessageForAPI = formatMessageWithAttachments(userMessageForPersistence, model);
    messages.push(userMessageForAPI);

    // Track original message (with attachments) for persistence
    if (useInternalConversations) {
        newMessages.push(prepareMessageForPersistence(userMessageForPersistence));
    }

    // Non-streaming mode (with optional tool calling)
    if (!opts.stream) {
        const requestParams = {
            model,
            messages
        };

        // Pass through additional API parameters
        if (opts.max_tokens !== undefined) requestParams.max_tokens = opts.max_tokens;
        if (opts.temperature !== undefined) requestParams.temperature = opts.temperature;
        if (opts.top_p !== undefined) requestParams.top_p = opts.top_p;
        if (opts.frequency_penalty !== undefined) requestParams.frequency_penalty = opts.frequency_penalty;
        if (opts.presence_penalty !== undefined) requestParams.presence_penalty = opts.presence_penalty;
        if (opts.stop !== undefined) requestParams.stop = opts.stop;

        // Add tools if provided (normalize format)
        if (opts.tools && opts.tools.length > 0) {
            requestParams.tools = opts.tools.map(normalizeToolFormat);
            if (opts.tool_choice !== undefined) {
                requestParams.tool_choice = opts.tool_choice;
            }
        }

        // Add responseFormat if provided (not compatible with tools)
        if (opts.responseFormat) {
            requestParams.response_format = opts.responseFormat;
        }

        let response = await callWithRetry(apiClient, requestParams, retryConfig);
        let totalTokenCount = extractTokenUsage(response);

        // Tool calling loop
        const toolExecutor = opts.toolExecutor || executeFileTool;
        const maxToolIterations = 10; // Prevent infinite loops
        let toolIterations = 0;

        while (toolIterations < maxToolIterations) {
            const message = response.choices[0]?.message;
            const toolCalls = message?.tool_calls;

            if (!toolCalls || toolCalls.length === 0) {
                // No more tool calls, we're done
                break;
            }

            toolIterations++;

            // Emit tool call start event
            if (opts.progressCallback) {
                opts.progressCallback('TOOL_CALL_START', {
                    iteration: toolIterations,
                    toolCount: toolCalls.length
                });
            }

            // Add assistant message with tool calls to history
            messages.push(message);

            // Execute each tool call
            for (const toolCall of toolCalls) {
                try {
                    const toolName = toolCall.function.name;
                    const toolArgs = JSON.parse(toolCall.function.arguments || "{}");

                    // Execute tool
                    const toolResult = await toolExecutor(
                        toolName,
                        toolArgs,
                        opts.progressCallback,
                        opts.workspace
                    );

                    // Add tool result to messages
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: JSON.stringify(toolResult)
                    });
                } catch (err) {
                    // Add error result
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({
                            ok: false,
                            error: String(err?.message || err)
                        })
                    });
                }
            }

            // Make follow-up request with tool results
            const followupParams = {
                model,
                messages,
                ...requestParams  // Preserve other params (tools, max_tokens, etc.)
            };

            // Remove tool_choice from follow-up requests to allow LLM to decide whether to continue
            // This prevents infinite loops where tool_choice forces the same tool to be called repeatedly
            delete followupParams.tool_choice;

            // Emit tool call end event
            if (opts.progressCallback) {
                opts.progressCallback('TOOL_CALL_END', {
                    iteration: toolIterations
                });
            }

            response = await callWithRetry(apiClient, followupParams, retryConfig);

            // Accumulate token usage
            const followupTokens = extractTokenUsage(response);
            if (totalTokenCount && followupTokens) {
                totalTokenCount.promptTokens += followupTokens.promptTokens;
                totalTokenCount.completionTokens += followupTokens.completionTokens;
                totalTokenCount.totalTokens += followupTokens.totalTokens;
            }
        }

        const content = response.choices[0]?.message?.content || "";

        // Simulate streaming for non-streaming mode with tools (e.g., megawriter)
        // This provides consistent UX regardless of whether tools are used
        // Call streamCallback with the final content if provided
        if (opts.streamCallback && content) {
            opts.streamCallback(content);
        }

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
        if (totalTokenCount) {
            result.tokenCount = totalTokenCount;
        }

        // Pass through simulated streaming flag for event emission
        if (opts._simulateStreaming) {
            result._simulateStreaming = true;
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

    // Pass through additional API parameters
    if (opts.max_tokens !== undefined) streamParams.max_tokens = opts.max_tokens;
    if (opts.temperature !== undefined) streamParams.temperature = opts.temperature;
    if (opts.top_p !== undefined) streamParams.top_p = opts.top_p;
    if (opts.frequency_penalty !== undefined) streamParams.frequency_penalty = opts.frequency_penalty;
    if (opts.presence_penalty !== undefined) streamParams.presence_penalty = opts.presence_penalty;
    if (opts.stop !== undefined) streamParams.stop = opts.stop;

    // Add tools if provided (normalize format) - IMPORTANT: Also needed for streaming!
    if (opts.tools && opts.tools.length > 0) {
        streamParams.tools = opts.tools.map(normalizeToolFormat);
        if (opts.tool_choice !== undefined) {
            streamParams.tool_choice = opts.tool_choice;
        }
    }

    // Add responseFormat if provided
    if (opts.responseFormat) {
        streamParams.response_format = opts.responseFormat;
    }

    const stream = await callWithRetry(apiClient, streamParams, retryConfig);

    // Always accumulate chunks for token estimation and optional persistence
    let fullContent = "";
    let usageData = null;
    let toolCalls = [];
    let currentToolCall = null;

    for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        const text = delta?.content || '';

        if (text) {
            // Accumulate all content (needed for token estimation)
            fullContent += text;

            // Stream to callback
            if (opts.streamCallback) {
                opts.streamCallback(text);
            }
        }

        // Handle tool calls in streaming mode
        if (delta?.tool_calls) {
            for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.index;

                // Start new tool call or continue existing one
                if (!toolCalls[index]) {
                    toolCalls[index] = {
                        id: toolCallDelta.id || '',
                        type: toolCallDelta.type || 'function',
                        function: {
                            name: toolCallDelta.function?.name || '',
                            arguments: toolCallDelta.function?.arguments || ''
                        }
                    };
                } else {
                    // Accumulate function arguments
                    if (toolCallDelta.function?.arguments) {
                        toolCalls[index].function.arguments += toolCallDelta.function.arguments;
                    }
                    if (toolCallDelta.function?.name) {
                        toolCalls[index].function.name += toolCallDelta.function.name;
                    }
                }
            }
        }

        // Extract usage data from final chunk (OpenAI streaming)
        if (chunk.usage) {
            usageData = chunk.usage;
        }
    }

    // If we got tool calls in streaming mode, execute them
    // This converts streaming to non-streaming for tool execution
    const toolExecutor = opts.toolExecutor || executeFileTool;
    if (toolCalls.length > 0 && toolExecutor) {
        // Add assistant message with tool calls to conversation
        const assistantMessage = {
            role: "assistant",
            content: fullContent,
            tool_calls: toolCalls
        };
        messages.push(assistantMessage);

        // Execute each tool call
        for (const toolCall of toolCalls) {
            try {
                const toolName = toolCall.function.name;
                const toolArgs = JSON.parse(toolCall.function.arguments || "{}");

                // Execute tool
                const toolResult = await toolExecutor(
                    toolName,
                    toolArgs,
                    opts.progressCallback,
                    opts.workspace
                );

                // Add tool result to messages
                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(toolResult)
                });
            } catch (err) {
                // Add error result
                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({
                        ok: false,
                        error: String(err?.message || err)
                    })
                });
            }
        }

        // After tool execution, make a non-streaming follow-up request for the final response
        const followupParams = {
            model,
            messages,
            stream: false
        };

        // Pass through API parameters but remove tools to avoid infinite loops
        if (opts.max_tokens !== undefined) followupParams.max_tokens = opts.max_tokens;
        if (opts.temperature !== undefined) followupParams.temperature = opts.temperature;

        const followupResponse = await callWithRetry(apiClient, followupParams, retryConfig);
        const followupContent = followupResponse.choices[0]?.message?.content || '';

        // Stream the followup content if callback provided
        if (opts.streamCallback && followupContent) {
            opts.streamCallback(followupContent);
        }

        // Update fullContent with followup
        fullContent = followupContent;

        // Update usage data
        const followupUsage = extractTokenUsage(followupResponse);
        if (usageData && followupUsage) {
            usageData.prompt_tokens += followupUsage.promptTokens;
            usageData.completion_tokens += followupUsage.completionTokens;
            usageData.total_tokens += followupUsage.totalTokens;
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
