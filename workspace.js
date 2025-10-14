import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import * as tar from 'tar';
import { SigridBuilder } from './builder.js';

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
     * @param {Object} options - Additional options (model, instructions, etc.)
     * @returns {Promise<{content: string, conversationID: string}>}
     */
    async execute(prompt, options = {}) {
        const builder = new SigridBuilder();
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
