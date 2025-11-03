import fs from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';
import ignore from 'ignore';
import { getAddonInternalPaths } from './addon.js';

/**
 * Default file extensions to include
 */
const DEFAULT_EXTENSIONS = [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
    '.css', '.scss', '.sass', '.less',
    '.html', '.htm',
    '.md', '.mdx',
    '.json', '.yaml', '.yml',
    '.xml',
    '.txt'
];

/**
 * Default directories and files to exclude
 */
const DEFAULT_EXCLUDES = [
    // Dependencies
    'node_modules',

    // Build artifacts
    'dist',
    'build',
    '.next',
    'out',
    'coverage',

    // Version control / tools
    '.git',
    '.sigrid',      // Sigrid workspace metadata (like .git)
    '.cache',

    // Lock files (machine-generated, coupled to node_modules)
    'package-lock.json',   // npm
    'pnpm-lock.yaml',      // pnpm
    'yarn.lock',           // yarn
    'bun.lockb'            // bun
];

/**
 * Default max file size (1MB)
 */
const DEFAULT_MAX_FILE_SIZE = 1024 * 1000;

/**
 * Read and parse .gitignore file
 * @param {string} workspaceDir - Workspace directory path
 * @returns {Promise<Object>} ignore instance
 */
async function loadGitignore(workspaceDir) {
    const ig = ignore();

    try {
        const gitignorePath = path.join(workspaceDir, '.gitignore');
        const content = await fs.readFile(gitignorePath, 'utf-8');
        ig.add(content);
    } catch (error) {
        // No .gitignore file, that's okay
    }

    return ig;
}

/**
 * Collect files from workspace directory
 * @param {string} workspaceDir - Workspace directory path
 * @param {Object} options - Collection options
 * @returns {Promise<{files: Array, omitted: Array}>}
 */
export async function collectFiles(workspaceDir, options = {}) {
    const {
        extensions = DEFAULT_EXTENSIONS,
        maxFileSize = DEFAULT_MAX_FILE_SIZE,
        exclude = DEFAULT_EXCLUDES,
        include = ['**/*'],
        respectGitignore = true
    } = options;

    const files = [];
    const omitted = [];

    // Load .gitignore
    const ig = respectGitignore ? await loadGitignore(workspaceDir) : ignore();

    // Convert include patterns to absolute patterns
    const includePatterns = Array.isArray(include) ? include : [include];

    // Merge default excludes with addon internal paths
    const addonInternalPaths = await getAddonInternalPaths(workspaceDir);
    const allExcludes = [...exclude, ...addonInternalPaths];

    // Build glob ignore patterns
    const ignorePatterns = allExcludes.map(pattern => {
        // If it's just a directory name, match it anywhere
        if (!pattern.includes('/') && !pattern.includes('*')) {
            return `**/${pattern}/**`;
        }
        return pattern;
    });

    // Collect all matching files
    for (const pattern of includePatterns) {
        const matches = await glob(pattern, {
            cwd: workspaceDir,
            nodir: true,
            absolute: false,
            ignore: ignorePatterns,
            dot: true // Include dot files so they can be checked against .gitignore
        });

        for (const relativePath of matches) {
            const absolutePath = path.join(workspaceDir, relativePath);

            // Check .gitignore
            if (respectGitignore && ig.ignores(relativePath)) {
                omitted.push({
                    path: relativePath,
                    reason: 'gitignore'
                });
                continue;
            }

            // Check extension
            const ext = path.extname(relativePath);
            if (extensions.length > 0 && !extensions.includes(ext)) {
                continue;
            }

            try {
                // Check file size
                const stat = await fs.stat(absolutePath);
                if (stat.size > maxFileSize) {
                    omitted.push({
                        path: relativePath,
                        reason: 'size',
                        size: stat.size
                    });
                    continue;
                }

                // Read file content
                const content = await fs.readFile(absolutePath, 'utf-8');

                files.push({
                    path: relativePath,
                    content,
                    size: stat.size
                });
            } catch (error) {
                // Skip files that can't be read (binary files, permission issues, etc.)
                omitted.push({
                    path: relativePath,
                    reason: 'read_error',
                    error: error.message
                });
            }
        }
    }

    return { files, omitted };
}

/**
 * Format files as XML
 * @param {Array} files - Array of file objects
 * @param {Array} omitted - Array of omitted file objects (optional)
 * @returns {string} XML formatted string
 */
export function formatAsXML(files, omitted = []) {
    const xmlParts = [];

    // Add regular files
    for (const file of files) {
        // Escape XML special characters in content
        const escapedContent = file.content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        xmlParts.push(`<file path="${file.path}">\n${escapedContent}\n</file>`);
    }

    // Add placeholders for omitted files
    for (const file of omitted) {
        let comment = '// File contents excluded from context';

        if (file.reason === 'size') {
            comment += ` (exceeds max size: ${file.size} bytes)`;
        } else if (file.reason === 'gitignore') {
            comment += ' (excluded by .gitignore)';
        } else if (file.reason === 'read_error') {
            comment += ` (${file.error})`;
        }

        xmlParts.push(`<file path="${file.path}">\n${comment}\n</file>`);
    }

    return xmlParts.join('\n\n');
}

/**
 * Create workspace snapshot in XML format
 * @param {string} workspaceDir - Workspace directory path
 * @param {Object} options - Snapshot options
 * @param {string[]} options.extensions - File extensions to include (default: DEFAULT_EXTENSIONS)
 * @param {number} options.maxFileSize - Max file size in bytes (default: 1MB)
 * @param {string[]} options.exclude - Patterns to exclude (default: DEFAULT_EXCLUDES)
 * @param {string[]} options.include - Patterns to include (default: ['**\/*'])
 * @param {boolean} options.respectGitignore - Respect .gitignore patterns (default: true)
 * @param {boolean} options.includePlaceholders - Include placeholders for omitted files (default: true)
 * @returns {Promise<string>} XML formatted snapshot string
 */
export async function createSnapshot(workspaceDir, options = {}) {
    const {
        includePlaceholders = true
    } = options;

    // Collect files and omitted file info
    const { files, omitted } = await collectFiles(workspaceDir, options);

    // Sort by path for consistency
    files.sort((a, b) => a.path.localeCompare(b.path));
    omitted.sort((a, b) => a.path.localeCompare(b.path));

    // Format as XML
    const omittedFiles = includePlaceholders ? omitted : [];
    return formatAsXML(files, omittedFiles);
}
