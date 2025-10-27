import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import * as tar from 'tar';
import { SigridBuilder } from './builder.js';
import { createSnapshot } from './snapshot.js';
import { getStaticContextPrompt } from './prompts.js';

/**
 * Progress event constants for workspace operations
 */
export const ProgressEvents = {
    SNAPSHOT_GENERATING: 'SNAPSHOT_GENERATING',
    SNAPSHOT_GENERATED: 'SNAPSHOT_GENERATED',
    RESPONSE_STREAMING: 'RESPONSE_STREAMING',
    RESPONSE_STREAMED: 'RESPONSE_STREAMED',
    RESPONSE_WAITING: 'RESPONSE_WAITING',
    RESPONSE_RECEIVED: 'RESPONSE_RECEIVED',
    FILES_WRITING: 'FILES_WRITING',
    FILES_WRITTEN: 'FILES_WRITTEN',
    FILE_STREAMING_START: 'FILE_STREAMING_START',
    FILE_STREAMING_CONTENT: 'FILE_STREAMING_CONTENT',
    FILE_STREAMING_END: 'FILE_STREAMING_END'
};

/**
 * Incremental XML parser for streaming file previews (best-effort, UI only)
 * Parses <sg-file> tags as chunks arrive for real-time preview
 */
class StreamingFileParser {
    constructor(progressCallback) {
        this.progressCallback = progressCallback;
        this.buffer = '';
        this.currentFile = null;
        this.lastContentEmitted = '';
    }

    /**
     * Process a chunk of streamed content
     * @param {string} chunk - New content chunk
     */
    processChunk(chunk) {
        try {
            this.buffer += chunk;

            // Look for opening tags
            while (true) {
                if (!this.currentFile) {
                    // Not in a file, look for <sg-file> opening
                    const openMatch = this.buffer.match(/<sg-file\s+([^>]*)>/);
                    if (!openMatch) break;

                    // Extract attributes
                    const attrs = this._parseAttributes(openMatch[1]);
                    this.currentFile = {
                        path: attrs.path || 'unknown',
                        action: attrs.action || 'write',
                        summary: attrs.summary || undefined,
                        content: ''
                    };

                    // Emit start event
                    if (this.progressCallback) {
                        const eventData = {
                            path: this.currentFile.path,
                            action: this.currentFile.action
                        };
                        if (this.currentFile.summary) {
                            eventData.summary = this.currentFile.summary;
                        }
                        this.progressCallback(ProgressEvents.FILE_STREAMING_START, eventData);
                    }

                    this.lastContentEmitted = '';

                    // Remove processed part from buffer
                    this.buffer = this.buffer.slice(openMatch.index + openMatch[0].length);
                } else {
                    // In a file, look for closing tag or accumulate content
                    const closeMatch = this.buffer.match(/<\/sg-file>/);

                    if (closeMatch) {
                        // Found closing tag - emit final content
                        const finalContent = this.buffer.slice(0, closeMatch.index);
                        this.currentFile.content += finalContent;

                        // Emit any remaining content
                        if (finalContent.length > 0 && this.progressCallback) {
                            this.progressCallback(ProgressEvents.FILE_STREAMING_CONTENT, {
                                path: this.currentFile.path,
                                content: finalContent,
                                isIncremental: true
                            });
                        }

                        // Emit end event with full content
                        if (this.progressCallback) {
                            this.progressCallback(ProgressEvents.FILE_STREAMING_END, {
                                path: this.currentFile.path,
                                action: this.currentFile.action,
                                fullContent: this.currentFile.content
                            });
                        }

                        // Reset for next file
                        this.currentFile = null;
                        this.lastContentEmitted = '';
                        this.buffer = this.buffer.slice(closeMatch.index + closeMatch[0].length);
                    } else {
                        // No closing tag yet - emit accumulated content if substantial
                        // Keep last 20 chars in buffer in case tag is split
                        if (this.buffer.length > 20) {
                            const contentToEmit = this.buffer.slice(0, -20);
                            this.currentFile.content += contentToEmit;

                            if (this.progressCallback) {
                                this.progressCallback(ProgressEvents.FILE_STREAMING_CONTENT, {
                                    path: this.currentFile.path,
                                    content: contentToEmit,
                                    isIncremental: true
                                });
                            }

                            this.buffer = this.buffer.slice(-20);
                        }
                        break;
                    }
                }
            }
        } catch (error) {
            // Best-effort parser - silently fail for UI purposes
            // Actual file writing uses the robust parser at the end
        }
    }

    /**
     * Parse XML attributes from tag content
     * @param {string} attrString - Attribute string like 'path="..." action="..."'
     * @returns {Object} Parsed attributes
     */
    _parseAttributes(attrString) {
        const attrs = {};
        const attrRegex = /(\w+)="([^"]*)"/g;
        let match;
        while ((match = attrRegex.exec(attrString)) !== null) {
            attrs[match[1]] = match[2];
        }
        return attrs;
    }
}

/**
 * Workspace represents an isolated working directory for Sigrid
 * Created from a scaffold tarball, can be modified and exported
 */
export class Workspace {
    /**
     * Create a workspace instance
     * @param {string} workspaceDir - Absolute path to workspace directory
     */
    constructor(workspaceDir) {
        this.path = workspaceDir;
        this.id = path.basename(workspaceDir);
        this._populated = false;
    }

    /**
     * Execute a prompt on this workspace
     * @param {string} prompt - User prompt
     * @param {Object} options - Additional options
     * @param {string} options.model - Model to use
     * @param {string[]} options.instructions - System instructions
     * @param {string} options.instruction - Single instruction
     * @param {boolean} options.pure - Pure mode (read-only, dynamic mode only)
     * @param {boolean} options.conversation - Conversation mode
     * @param {Function} options.progressCallback - Progress callback
     * @param {string} options.mode - Execution mode ('static' for static context loading)
     * @param {Object|string} options.snapshot - Snapshot config or pre-computed snapshot string
     * @param {boolean} options.decodeHtmlEntities - Decode HTML entities in static mode output (default: false)
     * @param {boolean} options.stream - Enable streaming (static mode only)
     * @param {Function} options.streamCallback - Stream callback (static mode only): (chunk: string) => void
     * @returns {Promise<{content: string, conversationID: string, filesWritten?: Array}>}
     */
    async execute(prompt, options = {}) {
        // Handle static mode
        if (options.mode === 'static') {
            return await this._executeStatic(prompt, options);
        }

        // Standard execution (uses dynamic mode with tooling)
        const builder = new SigridBuilder();
        builder.dynamic();  // Explicitly use dynamic mode for tool calling
        builder.workspace(this.path);

        // Apply any additional options
        if (options.model) builder.model(options.model);
        if (options.instructions) builder.instructions(options.instructions);
        if (options.instruction) builder.instruction(options.instruction);
        if (options.pure) builder.pure();
        if (options.conversation) builder.conversation();
        if (options.progressCallback) builder.progress(options.progressCallback);

        return await builder.execute(prompt, options);
    }

    /**
     * Execute in static mode with automatic snapshot and XML deserialization
     * @param {string} prompt - User prompt
     * @param {Object} options - Options
     * @returns {Promise<{content: string, conversationID: string, filesWritten: Array}>}
     * @private
     */
    async _executeStatic(prompt, options) {
        const progressCallback = options.progressCallback;

        // Generate or use provided snapshot
        let snapshot;

        // For multi-turn conversations, always regenerate snapshot to include files from previous turns
        const isMultiTurn = !!options.conversationID;

        if (isMultiTurn) {
            // Always generate fresh snapshot for continuation turns
            // This ensures the LLM sees files written in previous turns
            if (progressCallback) progressCallback(ProgressEvents.SNAPSHOT_GENERATING);
            snapshot = await this.snapshot(typeof options.snapshot === 'object' ? options.snapshot : {});
            if (progressCallback) progressCallback(ProgressEvents.SNAPSHOT_GENERATED);
        } else if (typeof options.snapshot === 'string') {
            // Pre-computed snapshot provided (first turn only)
            snapshot = options.snapshot;
        } else {
            // Auto-generate snapshot (first turn)
            if (progressCallback) progressCallback(ProgressEvents.SNAPSHOT_GENERATING);
            snapshot = await this.snapshot(options.snapshot || {});
            if (progressCallback) progressCallback(ProgressEvents.SNAPSHOT_GENERATED);
        }

        // Handle streaming mode - accumulate chunks and parse for file previews
        let accumulatedContent = '';
        let streamCallback = null;

        if (options.stream) {
            // Create streaming file parser for real-time previews
            const fileParser = progressCallback ? new StreamingFileParser(progressCallback) : null;

            // Wrap user's streamCallback to accumulate chunks and parse files
            const userStreamCallback = options.streamCallback;
            streamCallback = (chunk) => {
                accumulatedContent += chunk;

                // Parse chunk for file streaming events (best-effort, UI only)
                if (fileParser) {
                    fileParser.processChunk(chunk);
                }

                if (userStreamCallback) {
                    userStreamCallback(chunk);
                }
            };
        }

        // Construct final options (merge user options with static mode requirements)
        const finalOptions = {
            ...options,  // Keep all user options (temperature, reasoningEffort, conversationID, conversationPersistence, etc.)
            workspace: this.path,
            instructions: [...(options.instructions || []), getStaticContextPrompt()],
            prompts: ['Here is the full codebase for context:', snapshot],
            saveAssistantMessage: false,  // We'll save compact version ourselves
            streamCallback  // Use wrapped callback if streaming
            // Note: conversationPersistence is optional
            // - If provided: uses internal tracking (efficient, fresh snapshots)
            // - If not provided: not supported in static mode (no server-side conversations)
        };

        // Use builder with static mode (uses llm-static.js - no tooling, supports streaming)
        const builder = new SigridBuilder();
        builder.static();  // Explicitly use static mode

        if (progressCallback) {
            progressCallback(options.stream ? ProgressEvents.RESPONSE_STREAMING : ProgressEvents.RESPONSE_WAITING);
        }

        const result = await builder.execute(prompt, finalOptions);

        if (progressCallback) {
            progressCallback(options.stream ? ProgressEvents.RESPONSE_STREAMED : ProgressEvents.RESPONSE_RECEIVED);
        }

        // Get content from either accumulated chunks (streaming) or result (non-streaming)
        const fullContent = options.stream ? accumulatedContent : result.content;

        // Deserialize XML output to filesystem
        // decodeHtmlEntities defaults to false (following DYAD's proven approach)
        const decodeEntities = options.decodeHtmlEntities === true;

        if (progressCallback) progressCallback(ProgressEvents.FILES_WRITING);
        result.filesWritten = await this.deserializeXmlOutput(fullContent, decodeEntities);
        if (progressCallback) {
            progressCallback(ProgressEvents.FILES_WRITTEN, { count: result.filesWritten.length });
        }

        // Save compact assistant message to persistence (default behavior for static mode)
        // Only save if using internal conversation tracking with persistence
        if (options.conversationPersistence && result.conversationID) {
            const compactContent = result.filesWritten.length > 0
                ? `Modified: ${result.filesWritten.map(f => f.path).join(', ')}`
                : fullContent.replace(/<sg-file[^>]*>[\s\S]*?<\/sg-file>/g, '').trim();

            await options.conversationPersistence.append(
                result.conversationID,
                JSON.stringify({
                    role: 'assistant',
                    content: compactContent
                })
            );
        }

        // Filter out <sg-file> tags from result.content for static mode
        // In streaming mode, result.content is already empty, so we set it to the filtered fullContent
        result.content = fullContent.replace(/<sg-file[^>]*>[\s\S]*?<\/sg-file>/g, '').trim();

        return result;
    }

    /**
     * Export workspace as tar.gz buffer
     * @returns {Promise<Buffer>} tar.gz buffer
     */
    async export() {
        // Create tar.gz in memory
        const chunks = [];

        return new Promise((resolve, reject) => {
            const stream = tar.create(
                {
                    gzip: true,
                    cwd: this.path,
                    portable: true
                },
                ['.'] // Include all files
            );

            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });
    }

    /**
     * Populate workspace from tar.gz buffer
     * @param {Buffer} tarGzBuffer - tar.gz buffer
     * @param {Object} options - Optional configuration
     * @param {number} options.strip - Number of leading path components to strip (default: 0)
     * @returns {Promise<void>}
     */
    async populateWithTarballBuffer(tarGzBuffer, options = {}) {
        if (this._populated) {
            throw new Error('Workspace is already populated');
        }

        if (!Buffer.isBuffer(tarGzBuffer)) {
            throw new Error('tarGzBuffer must be a Buffer');
        }

        const strip = options.strip !== undefined ? options.strip : 0;

        try {
            const bufferStream = Readable.from(tarGzBuffer);

            await new Promise((resolve, reject) => {
                bufferStream
                    .pipe(tar.extract({
                        cwd: this.path,
                        strip
                    }))
                    .on('finish', resolve)
                    .on('error', reject);
            });

            this._populated = true;
        } catch (error) {
            throw new Error(`Failed to populate workspace: ${error.message}`);
        }
    }

    /**
     * Populate workspace from tar.gz file
     * @param {string} tarballPath - Path to tar.gz file
     * @param {Object} options - Optional configuration
     * @param {number} options.strip - Number of leading path components to strip (default: 0)
     * @returns {Promise<void>}
     */
    async populateWithTarball(tarballPath, options = {}) {
        if (this._populated) {
            throw new Error('Workspace is already populated');
        }

        const strip = options.strip !== undefined ? options.strip : 0;

        try {
            await tar.extract({
                file: tarballPath,
                cwd: this.path,
                strip
            });

            this._populated = true;
        } catch (error) {
            throw new Error(`Failed to populate workspace: ${error.message}`);
        }
    }

    /**
     * Create a snapshot of the workspace for static context loading
     * @param {Object} options - Snapshot options
     * @param {string[]} options.extensions - File extensions to include
     * @param {number} options.maxFileSize - Max file size in bytes (default: 1MB)
     * @param {string[]} options.exclude - Patterns to exclude
     * @param {string[]} options.include - Patterns to include
     * @param {boolean} options.respectGitignore - Respect .gitignore patterns (default: true)
     * @param {boolean} options.includePlaceholders - Include placeholders for omitted files (default: true)
     * @returns {Promise<string>} XML formatted snapshot string
     *
     * @example
     * // Get snapshot of src directory
     * const snapshot = await workspace.snapshot({
     *   include: ['src/**\/*'],
     *   extensions: ['.ts', '.tsx']
     * });
     *
     * // Use with execute
     * await workspace.execute('Create component', {
     *   prompts: snapshot
     * });
     */
    async snapshot(options = {}) {
        return createSnapshot(this.path, options);
    }

    /**
     * Deserialize XML file output and write to workspace filesystem
     * @param {string} content - LLM response content containing XML <file> tags
     * @param {boolean} decodeHtmlEntities - Whether to decode HTML entities (default: false)
     * @returns {Promise<Array<{path: string, size: number}>>} Array of written files
     *
     * @example
     * // Without decoding (default, follows DYAD's approach)
     * const filesWritten = await workspace.deserializeXmlOutput(result.content);
     *
     * // With decoding (defensive, for LLMs that encode entities)
     * const filesWritten = await workspace.deserializeXmlOutput(result.content, true);
     * console.log(`Wrote ${filesWritten.length} files`);
     */
    async deserializeXmlOutput(content, decodeHtmlEntities = false) {
        const fileRegex = /<sg-file path="([^"]+)">\s*([\s\S]*?)\s*<\/sg-file>/g;
        const filesWritten = [];
        let match;

        while ((match = fileRegex.exec(content)) !== null) {
            const [_, filePath, fileContent] = match;
            const fullPath = path.join(this.path, filePath);

            // Create directory if needed
            await fs.mkdir(path.dirname(fullPath), { recursive: true });

            // Optionally decode HTML entities before writing
            const trimmedContent = fileContent.trim();
            const finalContent = decodeHtmlEntities
                ? this._decodeHtmlEntities(trimmedContent)
                : trimmedContent;
            await fs.writeFile(fullPath, finalContent);

            filesWritten.push({
                path: filePath,
                size: finalContent.length
            });
        }

        return filesWritten;
    }

    /**
     * Decode HTML entities in a string
     * @param {string} text - Text with HTML entities
     * @returns {string} Decoded text
     * @private
     */
    _decodeHtmlEntities(text) {
        const entities = {
            '&lt;': '<',
            '&gt;': '>',
            '&amp;': '&',
            '&quot;': '"',
            '&apos;': "'"
        };

        // Replace entities in order, handling &amp; last to avoid double-decoding
        // e.g., "&amp;lt;" should become "&lt;" not "<"
        return text
            .replace(/&lt;/g, entities['&lt;'])
            .replace(/&gt;/g, entities['&gt;'])
            .replace(/&quot;/g, entities['&quot;'])
            .replace(/&apos;/g, entities['&apos;'])
            .replace(/&amp;/g, entities['&amp;']);
    }

    /**
     * Compact conversation history by replacing verbose assistant responses with file paths
     * @param {string} conversationID - The conversation ID to compact
     * @param {Object} options - Compaction options
     * @param {Object} options.persistence - Persistence provider (required)
     * @param {string} options.mode - Compaction mode: 'files-only' (default) or 'user-only'
     * @param {boolean} options.dryRun - Preview changes without modifying history (default: false)
     * @returns {Promise<{originalTokens: number, compactedTokens: number, reduction: string, messagesProcessed: number, messagesCompacted: number}>}
     *
     * @example
     * // Compact existing conversation history
     * const result = await workspace.compactHistory('project-123', {
     *   mode: 'files-only',
     *   persistence: myPersistence
     * });
     * console.log(`Reduced by ${result.reduction}`);
     *
     * // Preview without modifying
     * const preview = await workspace.compactHistory('project-123', {
     *   mode: 'files-only',
     *   persistence: myPersistence,
     *   dryRun: true
     * });
     */
    async compactHistory(conversationID, options = {}) {
        const { mode = 'files-only', persistence, dryRun = false } = options;

        if (!persistence) {
            throw new Error('conversationPersistence required for compactHistory');
        }

        if (!conversationID) {
            throw new Error('conversationID required for compactHistory');
        }

        // Load existing history
        const history = await persistence.get(conversationID);
        if (!history || history.length === 0) {
            return {
                originalTokens: 0,
                compactedTokens: 0,
                reduction: '0%',
                messagesProcessed: 0,
                messagesCompacted: 0
            };
        }

        let messagesCompacted = 0;
        const originalSize = JSON.stringify(history).length;

        // Process each message
        const compactedHistory = history.map(msg => {
            if (msg.role !== 'assistant') return msg;

            if (mode === 'files-only') {
                // Extract file paths from <sg-file> tags
                const fileRegex = /<sg-file[^>]*path="([^"]+)"/g;
                const files = [];
                let match;
                while ((match = fileRegex.exec(msg.content)) !== null) {
                    files.push(match[1]);
                }

                if (files.length > 0) {
                    messagesCompacted++;
                    return {
                        ...msg,
                        content: `Modified: ${files.join(', ')}`,
                        _original_length: msg.content.length // for debugging
                    };
                }
            }

            return msg;
        });

        const compactedSize = JSON.stringify(compactedHistory).length;

        // Return early if dry run
        if (dryRun) {
            return {
                originalTokens: Math.ceil(originalSize / 4),
                compactedTokens: Math.ceil(compactedSize / 4),
                reduction: originalSize > 0
                    ? `${((1 - compactedSize / originalSize) * 100).toFixed(1)}%`
                    : '0%',
                messagesProcessed: history.length,
                messagesCompacted
            };
        }

        // Write compacted history back
        await persistence.delete(conversationID);
        for (const msg of compactedHistory) {
            await persistence.append(conversationID, JSON.stringify(msg));
        }

        return {
            originalTokens: Math.ceil(originalSize / 4),
            compactedTokens: Math.ceil(compactedSize / 4),
            reduction: originalSize > 0
                ? `${((1 - compactedSize / originalSize) * 100).toFixed(1)}%`
                : '0%',
            messagesProcessed: history.length,
            messagesCompacted
        };
    }

    /**
     * Delete workspace directory
     * @returns {Promise<void>}
     */
    async delete() {
        // Check if workspace exists first
        try {
            await fs.access(this.path);
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new Error('Workspace already deleted or does not exist');
            }
            throw error;
        }

        // Now delete it
        await fs.rm(this.path, { recursive: true, force: true });
    }
}

/**
 * Open an existing workspace from a directory path
 * @param {string} workspacePath - Absolute path to existing workspace directory
 * @returns {Promise<Workspace>}
 */
export async function openWorkspace(workspacePath) {
    if (!workspacePath || typeof workspacePath !== 'string') {
        throw new Error('Workspace path must be a string');
    }

    // Validate path exists
    try {
        const stat = await fs.stat(workspacePath);
        if (!stat.isDirectory()) {
            throw new Error('Workspace path is not a directory');
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error('Workspace path does not exist');
        }
        throw error;
    }

    const workspace = new Workspace(path.resolve(workspacePath));
    // Mark as populated since we're opening an existing workspace
    workspace._populated = true;
    return workspace;
}

/**
 * Create a new workspace
 * @param {Buffer|Object} tarGzBufferOrOptions - Optional tar.gz buffer or options object
 * @param {Object} options - Optional configuration (only if first param is Buffer)
 * @param {string} options.baseDir - Base directory for workspaces (default: os.tmpdir())
 * @param {number} options.strip - Number of leading path components to strip (default: 0)
 * @returns {Promise<Workspace>}
 *
 * @example
 * // Create empty workspace
 * const workspace = await createWorkspace();
 *
 * // Create and populate from buffer (backward compatible)
 * const workspace = await createWorkspace(tarGzBuffer, { strip: 1 });
 */
export async function createWorkspace(tarGzBufferOrOptions, options = {}) {
    // Generate unique workspace directory
    const baseDir = options.baseDir || path.join(os.tmpdir(), 'sigrid-workspaces');
    await fs.mkdir(baseDir, { recursive: true });

    const workspaceId = randomBytes(8).toString('hex');
    const workspaceDir = path.join(baseDir, workspaceId);

    try {
        // Create workspace directory
        await fs.mkdir(workspaceDir, { recursive: true });

        const workspace = new Workspace(workspaceDir);

        // If tarGzBuffer provided, populate immediately (backward compatible)
        if (tarGzBufferOrOptions && Buffer.isBuffer(tarGzBufferOrOptions)) {
            await workspace.populateWithTarballBuffer(tarGzBufferOrOptions, options);
        }

        return workspace;
    } catch (error) {
        // Cleanup on error
        try {
            await fs.rm(workspaceDir, { recursive: true, force: true });
        } catch (cleanupError) {
            // Ignore cleanup errors
        }
        throw new Error(`Failed to create workspace: ${error.message}`);
    }
}
