import os from "os";
import OpenAI from "openai";
import {
    fileTools,
    executeFileTool
} from "./filetooling.js";
import { getSigridPersistence } from "./persistence.js";
import { randomBytes } from "crypto";

let client = null;

// System prompt constants
const PURE_MODE_INSTRUCTIONS = [
    "Respond with only the requested content, no explanations or commentary.",
    "Generate content appropriate for the current operating system.",
    "Do not add any preamble or postamble.",
    "Do not include markdown code fences (```) or formatting.",
    "Output should be raw content, ready to use directly."
];

const TOOLING_INSTRUCTION = 
    "You can call tools `list_dir` (browse), `read_file` (preview), and `write_file` (save). " +
    "Stay within the sandbox. Write only small UTF-8 text files. For large edits, ask for a narrower scope.";

const PURE_MODE_TOOLING_INSTRUCTION =
    "You can call tools `list_dir` (browse) and `read_file` (preview) to inspect files. " +
    "Do not write any files - output content directly to chat.";

const DEFAULT_MODEL = "gpt-5-mini";

/**
 * Initialize OpenAI client
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

/**
 * Extract tool calls from OpenAI response
 * @param {Object} response - OpenAI response object
 * @returns {Array} Array of tool calls
 */
export function extractToolCalls(r) {
    const calls = [];
    for (const item of r.output ?? []) {
        if (item.type === "function_call" && item.name && item.call_id) {
            calls.push({
                id: item.call_id,
                name: item.name,
                arguments: item.arguments ?? "{}"
            });
        }
    }
    for (const item of r.output ?? []) {
        for (const part of item.content ?? []) {
            if (part.type === "tool_call" && part.name && part.id) {
                calls.push({
                    id: part.id,
                    name: part.name,
                    arguments: part.arguments ?? "{}"
                });
            }
        }
    }
    return calls;
}

/**
 * Extract text content from OpenAI response
 * @param {Object} response - OpenAI response object
 * @returns {string} Extracted text
 */
export function extractText(r) {
    let out = "";
    for (const item of r.output ?? []) {
        for (const part of item.content ?? []) {
            if (part.type === "output_text") out += part.text;
        }
    }
    return out.trim();
}

/**
 * Generate a unique conversation ID
 * @returns {string} Conversation ID
 */
function generateConversationID() {
    return `conv_${randomBytes(16).toString('hex')}`;
}

/**
 * Execute LLM inference with tool calling support
 * @param {string} prompt - User prompt
 * @param {Object} opts - Options
 * @param {OpenAI} opts.client - Custom OpenAI client (optional, uses initialized client by default)
 * @param {string} opts.model - Model name (default: "gpt-5-mini")
 * @param {string|string[]} opts.instructions - System instruction(s)
 * @param {string|string[]} opts.prompts - Additional user prompts inserted before main prompt
 * @param {boolean} opts.conversation - Enable conversation mode
 * @param {string} opts.conversationID - Existing conversation ID
 * @param {boolean} opts.pure - Pure output mode (no explanations)
 * @param {string} opts.reasoningEffort - Reasoning effort level: "minimal", "low", "medium", "high" (GPT-5 only)
 * @param {string[]} opts.disableTools - Array of tool names to disable (e.g., ['read_file', 'write_file'])
 * @param {Function} opts.progressCallback - Progress callback (action, message)
 * @param {ConversationPersistence} opts.conversationPersistence - Persistence provider (if provided, enables internal conversation tracking; otherwise uses provider-managed conversations)
 * @returns {Promise<{content: string, conversationID: string}>}
 */
export async function execute(prompt, opts = {}) {
    const apiClient = opts.client || getClient();

    // Use internal conversation tracking if user provides BOTH conversation: true AND a persistence provider
    // Otherwise use provider-managed conversations (e.g., OpenAI's conversation API)
    const useInternalConversations = opts.conversation && opts.conversationPersistence !== undefined;

    const persistence = opts.conversationPersistence;  // Only use if provided
    let conversationID = opts.conversationID;
    let previousMessages = [];

    // Load previous conversation history if using internal tracking
    if (useInternalConversations && conversationID) {
        const historyJson = await persistence.get(conversationID);
        if (historyJson) {
            previousMessages = JSON.parse(historyJson);
        }
    }

    const messages = [];

    // Prepare conversation for provider-managed conversations (OpenAI)
    if (!useInternalConversations && opts.conversation && !conversationID) {
        const conv = await apiClient.conversations.create();
        conversationID = conv.id;
    }

    // Generate conversationID for internal tracking if needed
    if (useInternalConversations && !conversationID) {
        conversationID = generateConversationID();
    }

    // Track new messages for persistence (only user and assistant messages)
    const newMessages = [];

    // Add system instructions
    if (opts.instructions) {
        const instructions = Array.isArray(opts.instructions) 
            ? opts.instructions 
            : [opts.instructions];
        
        for (const inst of instructions) {
            messages.push({ role: "system", content: inst });
        }
    }
    
    // Pure mode instructions
    if (opts.pure) {
        for (const inst of PURE_MODE_INSTRUCTIONS) {
            messages.push({ role: "system", content: inst });
        }
    }
    
    // Add tooling instruction
    const toolingInstruction = opts.pure ? PURE_MODE_TOOLING_INSTRUCTION : TOOLING_INSTRUCTION;
    messages.push({ role: "system", content: toolingInstruction });

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
    
    // Progress callback
    if (opts.progressCallback) {
        opts.progressCallback('start', 'Waiting for response...');
    }
    
    // Initial API call
    const model = opts.model || DEFAULT_MODEL;
    
    // Select tools based on pure mode and disabled tools
    let availableTools = opts.pure
        ? fileTools.filter(tool => tool.name !== 'write_file')
        : fileTools;

    // Filter out disabled tools
    if (opts.disableTools && Array.isArray(opts.disableTools)) {
        availableTools = availableTools.filter(tool => !opts.disableTools.includes(tool.name));
    }
    
    const requestParams = {
        model,
        input: messages,
        conversation: useInternalConversations ? undefined : conversationID,  // Use provider conversation only if not internal
        tools: availableTools,
        tool_choice: "auto"
    };

    // Add reasoning effort if specified (GPT-5 models only)
    if (opts.reasoningEffort) {
        requestParams.reasoning = {
            effort: opts.reasoningEffort
        };
    }

    let response = await apiClient.responses.create(requestParams);
    
    if (opts.progressCallback) {
        opts.progressCallback('succeed', 'Response received');
    }
    
    // Tool calling loop
    while (true) {
        const toolCalls = extractToolCalls(response);
        if (toolCalls.length === 0) break;
        
        for (const fc of toolCalls) {
            try {
                const args = JSON.parse(fc.arguments || "{}");
                const toolResult = await executeFileTool(fc.name, args, opts.progressCallback, opts.workspace);

                messages.push({
                    type: "function_call",
                    name: fc.name,
                    arguments: fc.arguments,
                    call_id: fc.id
                });
                messages.push({
                    type: "function_call_output",
                    call_id: fc.id,
                    output: JSON.stringify(toolResult)
                });
            } catch (err) {
                messages.push({
                    type: "function_call",
                    name: fc.name,
                    arguments: fc.arguments,
                    call_id: fc.id
                });
                messages.push({
                    type: "function_call_output",
                    call_id: fc.id,
                    output: JSON.stringify({ ok: false, error: String(err?.message || err) })
                });
            }
        }
        
        if (opts.progressCallback) {
            opts.progressCallback('start', 'Processing...');
        }
        
        const followupParams = {
            model,
            input: messages,
            conversation: useInternalConversations ? undefined : response.conversation,  // Use provider conversation only if not internal
            tools: availableTools,
            tool_choice: "auto"
        };

        // Add reasoning effort if specified
        if (opts.reasoningEffort) {
            followupParams.reasoning = {
                effort: opts.reasoningEffort
            };
        }

        response = await apiClient.responses.create(followupParams);
        
        if (opts.progressCallback) {
            opts.progressCallback('succeed', 'Processing complete');
        }
    }

    // Save assistant response to persistence for internal tracking
    if (useInternalConversations) {
        const assistantMessage = { role: "assistant", content: response.output_text };
        newMessages.push(assistantMessage);

        // Append new messages to persistence
        for (const message of newMessages) {
            await persistence.append(conversationID, JSON.stringify(message));
        }
    }

    return {
        content: response.output_text,
        conversationID: useInternalConversations ? conversationID : response.conversation?.id
    };
}

// Re-export filetooling and persistence for convenience
export { fileTools, setSandboxRoot, getSandboxRoot } from "./filetooling.js";
export {
    InMemoryPersistence,
    FileSystemPersistence,
    getSigridPersistence,
    setSigridPersistence
} from "./persistence.js";
