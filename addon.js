/**
 * Addon System for Sigrid Workspaces
 *
 * Addons provide modular functionality that can be added to workspaces.
 * They are simple JavaScript objects - no coupling to directory structure.
 *
 * See test-fixtures/addons/ for example addons (like sqlite.js).
 *
 * Addons are JavaScript objects with the following structure:
 *
 * {
 *   name: string,           // Addon name
 *   version: string,        // Addon version
 *   description: string,    // Human-readable description
 *   dependencies: object,   // npm dependencies to add to package.json
 *   aiRulesAddition: string,// Text to append to AI_RULES.md
 *   files: {                // Files to write to workspace
 *     'path/to/file.js': 'file content...',
 *     ...
 *   },
 *   internal: [string]      // Paths to exclude from snapshots (implementation files)
 * }
 *
 * Addons can be defined inline, loaded from files, or generated programmatically.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Registry of paths that should be excluded from snapshots
 * Populated when addons are applied to workspaces
 */
const internalPaths = new Set();

/**
 * Generate AI rules addition text from addon's API definition
 * Auto-generates LLM documentation from structured API metadata
 *
 * @param {Object} addon - Addon object with api field
 * @param {string} addon.name - Addon name
 * @param {string} [addon.description] - Brief description
 * @param {Object} [addon.api] - Structured API definition
 * @param {string} [addon.docs] - Path to documentation file
 * @param {string} [addon.technology] - Technology used
 * @param {string} [addon.useCases] - Use cases description
 * @returns {string} Formatted AI rules addition text
 *
 * @example
 * // Addon with structured API definition
 * const addon = {
 *   name: 'sqlite',
 *   description: 'Browser SQLite database',
 *   technology: 'sql.js (SQLite WASM) with IndexedDB',
 *   useCases: 'Perfect for todo apps, notes, offline-first apps',
 *   docs: 'docs/database-api.md',
 *   api: {
 *     '@/lib/database': {
 *       exports: {
 *         'createDatabase': 'Creates a new SQLite database instance'
 *       },
 *       methods: {
 *         'query(sql, params)': 'Execute SELECT queries',
 *         'execute(sql, params)': 'Execute INSERT/UPDATE/DELETE',
 *         'transaction(statements)': 'Run multiple statements atomically'
 *       }
 *     }
 *   }
 * };
 * const aiRules = generateAIRulesFromAPI(addon);
 */
export function generateAIRulesFromAPI(addon) {
    if (!addon.api) {
        return ''; // No API definition provided
    }

    const title = addon.name.charAt(0).toUpperCase() + addon.name.slice(1);
    let content = `\n## ${title}\n\n${addon.description || `Provides ${addon.name} functionality`}`;

    const bullets = [];

    // Extract imports and exports from api definition
    const apiPaths = Object.keys(addon.api);

    for (const importPath of apiPaths) {
        const apiDef = addon.api[importPath];

        // Add imports
        if (apiDef.exports) {
            const exportNames = Object.keys(apiDef.exports);
            if (exportNames.length > 0) {
                bullets.push(`**Import**: \`import { ${exportNames.join(', ')} } from '${importPath}'\``);
            }
        }
    }

    // Add documentation reference
    if (addon.docs) {
        bullets.push(`**Documentation**: See \`${addon.docs}\` for complete API reference and examples`);
    }

    // Add technology
    if (addon.technology) {
        bullets.push(`**Technology**: ${addon.technology}`);
    }

    // Add use cases
    if (addon.useCases) {
        bullets.push(`**Use Case**: ${addon.useCases}`);
    }

    if (bullets.length > 0) {
        content += ':\n\n' + bullets.map(b => `- ${b}`).join('\n');
    }

    // Add API methods summary
    const allMethods = [];
    for (const importPath of apiPaths) {
        const apiDef = addon.api[importPath];
        if (apiDef.methods) {
            allMethods.push(...Object.keys(apiDef.methods));
        }
    }

    if (allMethods.length > 0) {
        content += `\n\nMain API: ${allMethods.map(m => `\`${m}\``).join(', ')}.`;
        if (addon.docs) {
            content += ' See the docs for usage patterns.';
        }
    }

    content += '\n';

    return content;
}

/**
 * Validate that addon's API definition matches its file contents
 * Throws error if validation fails
 * @param {Object} addon - Addon object
 * @throws {Error} If API definition doesn't match files
 */
function validateAddonAPI(addon) {
    if (!addon.api || !addon.files) {
        return;
    }

    const errors = [];

    // Check each API module
    for (const [importPath, apiDef] of Object.entries(addon.api)) {
        // Convert import path to file path
        // @/lib/database -> src/lib/database.js (or .ts)
        const possiblePaths = [
            importPath.replace('@/', 'src/') + '.js',
            importPath.replace('@/', 'src/') + '.ts',
            importPath.replace('@/', 'src/') + '.jsx',
            importPath.replace('@/', 'src/') + '.tsx'
        ];

        // Find matching file
        const filePath = possiblePaths.find(p => addon.files[p]);
        if (!filePath) {
            errors.push(`API defines "${importPath}" but no matching file found in files object`);
            continue;
        }

        const fileContent = addon.files[filePath];

        // Validate exports
        if (apiDef.exports) {
            for (const exportName of Object.keys(apiDef.exports)) {
                // Simple check: does export appear in file?
                const exportPatterns = [
                    `export function ${exportName}`,
                    `export const ${exportName}`,
                    `export async function ${exportName}`,
                    `export { ${exportName}`,
                    `function ${exportName}`
                ];

                const found = exportPatterns.some(pattern => fileContent.includes(pattern));
                if (!found) {
                    errors.push(`API defines export "${exportName}" in ${importPath} but it does not exist in ${filePath}`);
                }
            }
        }
    }

    if (errors.length > 0) {
        throw new Error(`Addon API validation failed:\n  - ${errors.join('\n  - ')}`);
    }
}

/**
 * Get list of paths that should be excluded from snapshots
 * @returns {Array<string>} Array of paths to exclude
 */
export function getAddonInternalPaths() {
    return Array.from(internalPaths);
}

/**
 * Apply an addon to a workspace
 *
 * @param {import('./workspace.js').Workspace} workspace - Workspace instance
 * @param {Object} addon - Addon object
 * @param {string} addon.name - Addon name
 * @param {string} addon.version - Addon version
 * @param {string} [addon.description] - Description
 * @param {Object} [addon.dependencies] - npm dependencies to add
 * @param {string} [addon.aiRulesAddition] - Text to append to AI_RULES.md
 * @param {Object} [addon.api] - Structured API definition for auto-generating AI rules
 * @param {Object} addon.files - Files to write { 'path': 'content' }
 * @param {Array<string>} [addon.internal] - Paths to exclude from snapshots
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.validate] - Validate API definitions against actual file contents
 * @returns {Promise<Object>} Application result
 *
 * @example
 * // Simple addon
 * await applyAddon(workspace, {
 *   name: 'config',
 *   files: {
 *     'src/config.js': 'export const API_URL = "https://api.example.com";'
 *   }
 * });
 *
 * @example
 * // Complex addon with dependencies
 * import sqliteAddon from './addons/sqlite.js';
 * await applyAddon(workspace, sqliteAddon);
 */
export async function applyAddon(workspace, addon, options = {}) {
    if (!addon || typeof addon !== 'object') {
        throw new Error('Addon must be an object');
    }

    if (!addon.name) {
        throw new Error('Addon must have a name');
    }

    if (!addon.files || typeof addon.files !== 'object') {
        throw new Error('Addon must have a files object');
    }

    const result = {
        addon: addon.name,
        version: addon.version || '1.0.0',
        filesAdded: []
    };

    // Validate API definitions (always-on, minimal overhead)
    // Throws if validation fails
    if (addon.api) {
        validateAddonAPI(addon);
    }

    // 1. Write all files to workspace
    for (const [filePath, content] of Object.entries(addon.files)) {
        const fullPath = path.join(workspace.path, filePath);

        // Create directory if needed
        await fs.mkdir(path.dirname(fullPath), { recursive: true });

        // Write file
        await fs.writeFile(fullPath, content, 'utf-8');

        result.filesAdded.push(filePath);
    }

    // 2. Register internal paths for exclusion from snapshots
    if (addon.internal && Array.isArray(addon.internal)) {
        for (const internalPath of addon.internal) {
            internalPaths.add(internalPath);
        }
    }

    // 3. Update package.json with dependencies
    if (addon.dependencies && Object.keys(addon.dependencies).length > 0) {
        const packageJsonPath = path.join(workspace.path, 'package.json');

        let packageJson;
        try {
            packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        } catch (error) {
            if (error.code === 'ENOENT') {
                // package.json doesn't exist, create minimal one
                packageJson = {
                    name: 'workspace',
                    version: '1.0.0',
                    dependencies: {}
                };
            } else {
                throw error;
            }
        }

        packageJson.dependencies = {
            ...packageJson.dependencies,
            ...addon.dependencies
        };

        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
        result.dependenciesAdded = addon.dependencies;
    }

    // 4. Update AI_RULES.md with addon instructions
    // Auto-generate from api field if aiRulesAddition not provided
    let aiRulesContent = addon.aiRulesAddition;
    if (!aiRulesContent && addon.api) {
        aiRulesContent = generateAIRulesFromAPI(addon);
    }

    if (aiRulesContent) {
        const aiRulesPath = path.join(workspace.path, 'AI_RULES.md');
        let currentRules = '';
        try {
            currentRules = await fs.readFile(aiRulesPath, 'utf-8');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            // File doesn't exist, create it with a header
            currentRules = '# AI Rules\n\nProject-specific instructions for AI assistants.\n';
        }
        await fs.writeFile(aiRulesPath, currentRules + aiRulesContent);
        result.aiRulesUpdated = true;
    }

    return result;
}

/**
 * Check if an addon is applied to a workspace
 * @param {import('./workspace.js').Workspace} workspace - Workspace instance
 * @param {Object} addon - Addon object to check
 * @returns {Promise<boolean>} True if addon is applied
 */
export async function isAddonApplied(workspace, addon) {
    // Check if addon dependencies are in package.json
    const packageJsonPath = path.join(workspace.path, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

    if (addon.dependencies) {
        for (const dep of Object.keys(addon.dependencies)) {
            if (!packageJson.dependencies?.[dep]) {
                return false;
            }
        }
    }

    // Check if AI rules contain the addon's content
    let contentToCheck = addon.aiRulesAddition;
    if (!contentToCheck && addon.api) {
        // Generate the content that would have been added
        contentToCheck = generateAIRulesFromAPI(addon);
    }

    if (contentToCheck) {
        const aiRulesPath = path.join(workspace.path, 'AI_RULES.md');
        try {
            const aiRules = await fs.readFile(aiRulesPath, 'utf-8');
            // Check if the specific content is present
            // Use a substring as a marker
            const marker = contentToCheck.trim().substring(0, 50);
            if (!aiRules.includes(marker)) {
                return false;
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                return false; // AI_RULES.md doesn't exist, addon not applied
            }
            throw error;
        }
    }

    return true;
}
