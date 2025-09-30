/**
 * Sigrid - LLM CLI agent with file tooling
 *
 * Main exports for library usage
 */

import { SigridBuilder } from './builder.js';
import {
    initializeClient,
    getClient,
    execute,
    extractToolCalls,
    extractText
} from './llm.js';

import {
    fileTools,
    setSandboxRoot,
    getSandboxRoot,
    executeFileTool
} from './filetooling.js';

// Factory function that creates a new builder instance
function sigrid() {
    return new SigridBuilder();
}

// Attach original functions for backward compatibility
sigrid.initializeClient = initializeClient;
sigrid.getClient = getClient;
sigrid.execute = execute;
sigrid.extractToolCalls = extractToolCalls;
sigrid.extractText = extractText;
sigrid.setSandboxRoot = setSandboxRoot;
sigrid.getSandboxRoot = getSandboxRoot;
sigrid.executeFileTool = executeFileTool;
sigrid.fileTools = fileTools;

// Default export: factory function with attached methods
export default sigrid;

// Named exports for backward compatibility
export {
    initializeClient,
    getClient,
    execute,
    extractToolCalls,
    extractText,
    fileTools,
    setSandboxRoot,
    getSandboxRoot,
    executeFileTool
};
