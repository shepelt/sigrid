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
    estimateSnapshotTokens,
    estimateWorkspaceTokens,
    DEFAULT_EXCLUDES,
    DEFAULT_EXTENSIONS
} from './snapshot.js';

import {
    estimateTokens,
    extractTokenUsage,
    accumulateTokenUsage
} from './token-utils.js';

import {
    SUPPORTED_MIME_TYPES,
    getAttachmentInfo
} from './model-config.js';

import {
    validateAttachment,
    formatMessageWithAttachments,
    formatMessagesWithAttachments,
    attachmentsRequireVision
} from './attachments.js';

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
sigrid.estimateSnapshotTokens = estimateSnapshotTokens;
sigrid.estimateWorkspaceTokens = estimateWorkspaceTokens;
sigrid.DEFAULT_EXCLUDES = DEFAULT_EXCLUDES;
sigrid.DEFAULT_EXTENSIONS = DEFAULT_EXTENSIONS;
sigrid.estimateTokens = estimateTokens;
sigrid.extractTokenUsage = extractTokenUsage;
sigrid.accumulateTokenUsage = accumulateTokenUsage;

// Attachment utilities
sigrid.SUPPORTED_MIME_TYPES = SUPPORTED_MIME_TYPES;
sigrid.getAttachmentInfo = getAttachmentInfo;
sigrid.validateAttachment = validateAttachment;
sigrid.formatMessageWithAttachments = formatMessageWithAttachments;
sigrid.formatMessagesWithAttachments = formatMessagesWithAttachments;
sigrid.attachmentsRequireVision = attachmentsRequireVision;

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
    estimateSnapshotTokens,
    estimateWorkspaceTokens,
    DEFAULT_EXCLUDES,
    DEFAULT_EXTENSIONS,
    estimateTokens,
    extractTokenUsage,
    accumulateTokenUsage,
    // Attachment utilities
    SUPPORTED_MIME_TYPES,
    getAttachmentInfo,
    validateAttachment,
    formatMessageWithAttachments,
    formatMessagesWithAttachments,
    attachmentsRequireVision
};
