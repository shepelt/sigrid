import os from "os";
import OpenAI from "openai";
import { 
    fileTools, 
    executeFileTool 
} from "./filetooling.js";

let client = null;

// System prompt constants
const PURE_MODE_INSTRUCTIONS = [
    "Respond with only the requested content, no explanations or commentary.",
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

const DEFAULT_MODEL = "gpt-4o";

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
 * Execute LLM inference with tool calling support
 * @param {string} prompt - User prompt
 * @param {Object} opts - Options
 * @param {OpenAI} opts.client - Custom OpenAI client (optional, uses initialized client by default)
 * @param {string} opts.model - Model name (default: "gpt-4o")
 * @param {string|string[]} opts.instructions - System instruction(s)
 * @param {boolean} opts.conversation - Enable conversation mode
 * @param {string} opts.conversationID - Existing conversation ID
 * @param {boolean} opts.pure - Pure output mode (no explanations)
 * @param {Function} opts.progressCallback - Progress callback (action, message)
 * @returns {Promise<{content: string, conversationID: string}>}
 */
export async function execute(prompt, opts = {}) {
    const apiClient = opts.client || getClient();
    
    const messages = [];
    
    // Prepare conversation
    if (opts.conversation && !opts.conversationID) {
        const conv = await apiClient.conversations.create();
        opts.conversationID = conv.id;
    }
    
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
    
    messages.push({ role: "user", content: prompt });
    
    // Progress callback
    if (opts.progressCallback) {
        opts.progressCallback('start', 'Waiting for response...');
    }
    
    // Initial API call
    const model = opts.model || DEFAULT_MODEL;
    
    // Select tools based on pure mode
    const availableTools = opts.pure 
        ? fileTools.filter(tool => tool.name !== 'write_file')
        : fileTools;
    
    let response = await apiClient.responses.create({
        model,
        input: messages,
        conversation: opts.conversationID,
        tools: availableTools,
        tool_choice: "auto"
    });
    
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
                const toolResult = await executeFileTool(fc.name, args, opts.progressCallback);
                
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
        
        response = await apiClient.responses.create({
            model,
            input: messages,
            conversation: response.conversation,
            tools: availableTools,
            tool_choice: "auto"
        });
        
        if (opts.progressCallback) {
            opts.progressCallback('succeed', 'Processing complete');
        }
    }
    
    return {
        content: response.output_text,
        conversationID: response.conversation
    };
}

// Re-export filetooling for convenience
export { fileTools, setSandboxRoot, getSandboxRoot } from "./filetooling.js";
