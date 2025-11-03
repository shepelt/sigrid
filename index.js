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
} from './llm-dynamic.js';

import {
    fileTools,
    setSandboxRoot,
    getSandboxRoot,
    executeFileTool
} from './filetooling.js';

import {
    createWorkspace,
    openWorkspace,
    Workspace,
    ProgressEvents
} from './workspace.js';

import {
    InMemoryPersistence,
    FileSystemPersistence,
    getSigridPersistence,
    setSigridPersistence
} from './persistence.js';

import {
    applyAddon,
    generateAIRulesFromAPI,
    getAddonInternalPaths,
    isAddonApplied
} from './addon.js';

import {
    createSnapshot,
    collectFiles,
    formatAsXML,
    DEFAULT_EXCLUDES,
    DEFAULT_EXTENSIONS
} from './snapshot.js';

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
sigrid.createWorkspace = createWorkspace;
sigrid.openWorkspace = openWorkspace;
sigrid.Workspace = Workspace;
sigrid.ProgressEvents = ProgressEvents;
sigrid.InMemoryPersistence = InMemoryPersistence;
sigrid.FileSystemPersistence = FileSystemPersistence;
sigrid.getSigridPersistence = getSigridPersistence;
sigrid.setSigridPersistence = setSigridPersistence;
sigrid.applyAddon = applyAddon;
sigrid.generateAIRulesFromAPI = generateAIRulesFromAPI;
sigrid.getAddonInternalPaths = getAddonInternalPaths;
sigrid.isAddonApplied = isAddonApplied;
sigrid.createSnapshot = createSnapshot;
sigrid.collectFiles = collectFiles;
sigrid.formatAsXML = formatAsXML;
sigrid.DEFAULT_EXCLUDES = DEFAULT_EXCLUDES;
sigrid.DEFAULT_EXTENSIONS = DEFAULT_EXTENSIONS;

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
    executeFileTool,
    createWorkspace,
    openWorkspace,
    Workspace,
    ProgressEvents,
    InMemoryPersistence,
    FileSystemPersistence,
    getSigridPersistence,
    setSigridPersistence,
    applyAddon,
    generateAIRulesFromAPI,
    getAddonInternalPaths,
    isAddonApplied,
    createSnapshot,
    collectFiles,
    formatAsXML,
    DEFAULT_EXCLUDES,
    DEFAULT_EXTENSIONS
};
