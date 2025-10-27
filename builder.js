import { execute as executeDynamic } from './llm-dynamic.js';
import { executeStatic } from './llm-static.js';

/**
 * Fluent builder for Sigrid LLM execution
 *
 * @example
 * const result = await sigrid()
 *   .instruction('Be brief')
 *   .model('gpt-4o-mini')
 *   .execute('What is 2+2?');
 *
 * @example
 * // Using reasoning effort with GPT-5
 * const result = await sigrid()
 *   .model('gpt-5-mini')
 *   .reasoningEffort('high')
 *   .execute('Solve this complex problem...');
 *
 * @example
 * // Using static mode (default) with streaming
 * const result = await sigrid()
 *   .static()
 *   .stream((chunk) => process.stdout.write(chunk))
 *   .execute('Hello');
 *
 * @example
 * // Using dynamic mode with tool calling
 * const result = await sigrid()
 *   .dynamic()
 *   .execute('Create a file called test.txt');
 */
export class SigridBuilder {
    constructor() {
        this.options = {};
        this.mode = 'static';  // Default to static mode
    }

    /**
     * Set the model to use
     * @param {string} modelName - Model name (e.g., 'gpt-4o', 'gpt-4o-mini')
     * @returns {SigridBuilder} this for chaining
     */
    model(modelName) {
        this.options.model = modelName;
        return this;
    }

    /**
     * Add a single instruction
     * @param {string} text - Instruction text
     * @returns {SigridBuilder} this for chaining
     */
    instruction(text) {
        if (!this.options.instructions) {
            this.options.instructions = [];
        } else if (!Array.isArray(this.options.instructions)) {
            this.options.instructions = [this.options.instructions];
        }
        this.options.instructions.push(text);
        return this;
    }

    /**
     * Set instructions (replaces existing)
     * @param {string|string[]} instructionsInput - Single instruction or array
     * @returns {SigridBuilder} this for chaining
     */
    instructions(instructionsInput) {
        this.options.instructions = instructionsInput;
        return this;
    }

    /**
     * Add a single prompt (user message before main prompt)
     * @param {string} text - Prompt text
     * @returns {SigridBuilder} this for chaining
     */
    prompt(text) {
        if (!this.options.prompts) {
            this.options.prompts = [];
        } else if (!Array.isArray(this.options.prompts)) {
            this.options.prompts = [this.options.prompts];
        }
        this.options.prompts.push(text);
        return this;
    }

    /**
     * Set prompts (replaces existing)
     * @param {string|string[]} promptsInput - Single prompt or array
     * @returns {SigridBuilder} this for chaining
     */
    prompts(promptsInput) {
        this.options.prompts = promptsInput;
        return this;
    }

    /**
     * Enable conversation mode
     * @returns {SigridBuilder} this for chaining
     */
    conversation() {
        this.options.conversation = true;
        return this;
    }

    /**
     * Enable pure output mode (no explanations, read-only tools)
     * Only works in dynamic mode
     * @returns {SigridBuilder} this for chaining
     */
    pure() {
        this.options.pure = true;
        return this;
    }

    /**
     * Set progress callback
     * @param {Function} callback - Progress callback function
     * @returns {SigridBuilder} this for chaining
     */
    progress(callback) {
        this.options.progressCallback = callback;
        return this;
    }

    /**
     * Set workspace directory (overrides global sandboxRoot)
     * @param {string} path - Workspace directory path
     * @returns {SigridBuilder} this for chaining
     */
    workspace(path) {
        this.options.workspace = path;
        return this;
    }

    /**
     * Disable specific tools
     * @param {string[]} toolNames - Array of tool names to disable (e.g., ['read_file', 'write_file'])
     * @returns {SigridBuilder} this for chaining
     */
    disableTools(toolNames) {
        this.options.disableTools = toolNames;
        return this;
    }

    /**
     * Set reasoning effort level (for reasoning models like GPT-5)
     * @param {string} level - Reasoning effort level: "minimal", "low", "medium", or "high"
     * @returns {SigridBuilder} this for chaining
     */
    reasoningEffort(level) {
        this.options.reasoningEffort = level;
        return this;
    }

    /**
     * Use static mode (no tooling, uses chat.completions API)
     * Static mode is the default. Supports streaming.
     * @returns {SigridBuilder} this for chaining
     */
    static() {
        this.mode = 'static';
        return this;
    }

    /**
     * Use dynamic mode (supports tooling and server-side conversations)
     * Dynamic mode uses the conversation API and supports tool calling.
     * @returns {SigridBuilder} this for chaining
     */
    dynamic() {
        this.mode = 'dynamic';
        return this;
    }

    /**
     * Enable streaming output (static mode only)
     * @param {Function} callback - Callback for streaming chunks: (chunk: string) => void
     * @returns {SigridBuilder} this for chaining
     */
    stream(callback) {
        this.options.stream = true;
        this.options.streamCallback = callback;
        return this;
    }

    /**
     * Execute the prompt with accumulated options
     * @param {string} prompt - User prompt
     * @param {Object} additionalOpts - Additional options to merge
     * @returns {Promise<{content: string, conversationID: string}>}
     */
    async execute(prompt, additionalOpts = {}) {
        const finalOptions = { ...this.options, ...additionalOpts };

        if (this.mode === 'static') {
            return executeStatic(prompt, finalOptions);
        } else {
            return executeDynamic(prompt, finalOptions);
        }
    }
}