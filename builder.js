import { execute as executeCore } from './llm.js';

/**
 * Fluent builder for Sigrid LLM execution
 *
 * @example
 * const result = await sigrid()
 *   .instruction('Be brief')
 *   .model('gpt-4o-mini')
 *   .execute('What is 2+2?');
 */
export class SigridBuilder {
    constructor() {
        this.options = {};
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
     * Enable pure output mode (no explanations)
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
     * Execute the prompt with accumulated options
     * @param {string} prompt - User prompt
     * @param {Object} additionalOpts - Additional options to merge
     * @returns {Promise<{content: string, conversationID: string}>}
     */
    async execute(prompt, additionalOpts = {}) {
        const finalOptions = { ...this.options, ...additionalOpts };
        return executeCore(prompt, finalOptions);
    }
}