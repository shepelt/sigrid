import { randomBytes } from "crypto";
import { getClient } from "./llm-client.js";

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
 * @returns {Promise<{content: string, conversationID: string}>} - content is empty string if streaming enabled
 */
export async function executeStatic(prompt, opts = {}) {
    const apiClient = opts.client || getClient();
    const model = opts.model || DEFAULT_MODEL;

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
        const response = await apiClient.chat.completions.create({
            model,
            messages
        });

        const content = response.choices[0]?.message?.content || "";

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

        return {
            content,
            conversationID
        };
    }

    // Streaming mode
    const stream = await apiClient.chat.completions.create({
        model,
        messages,
        stream: true
    });

    // Only accumulate chunks if persistence is enabled
    let fullContent = useInternalConversations ? "" : null;

    for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content || '';

        if (text) {
            // Accumulate for persistence if needed
            if (fullContent !== null) {
                fullContent += text;
            }

            // Stream to callback
            if (opts.streamCallback) {
                opts.streamCallback(text);
            }
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

    // Return empty content for streaming mode
    return {
        content: "",
        conversationID
    };
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
