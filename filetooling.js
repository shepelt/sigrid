import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

// Constants
const MAX_READ_LINES = 2000;
const MAX_LINE_LENGTH = 2000;
const LIST_MAX_ENTRIES = 500;
const LIST_MAX_DEPTH = 3;
const WRITE_MAX_BYTES = 256 * 1024;
const WRITE_ALLOWED_EXTS = [
    ".md", ".txt", ".log", ".json", ".js", ".ts", ".tsx", ".jsx",
    ".css", ".html", ".sh", ".yml", ".yaml", ".gitignore", ".patch"
];

// Global sandbox root - will be set by setSandboxRoot
let sandboxRootPath = path.resolve(process.cwd());

// File read tracking for staleness detection
// Maps filepath -> { mtimeMs, readAt } for files that have been read
const fileReadTracker = new Map();

/**
 * Track that a file was read at a specific mtime
 */
function trackFileRead(filepath, mtimeMs) {
    fileReadTracker.set(filepath, { mtimeMs, readAt: Date.now() });
}

/**
 * Check if a file was read before and if it's stale
 * Returns { wasRead, isStale, lastReadMtime, currentMtime }
 */
function checkFileStaleness(filepath, currentMtimeMs) {
    const tracked = fileReadTracker.get(filepath);
    if (!tracked) {
        return { wasRead: false, isStale: false, lastReadMtime: null, currentMtime: currentMtimeMs };
    }
    const isStale = currentMtimeMs > tracked.mtimeMs;
    return { wasRead: true, isStale, lastReadMtime: tracked.mtimeMs, currentMtime: currentMtimeMs };
}

/**
 * Clear file read tracking (call when starting a new session)
 */
export function clearFileReadTracking() {
    fileReadTracker.clear();
}

/**
 * Get current tracking state (for debugging)
 */
export function getFileReadTrackingState() {
    return Object.fromEntries(fileReadTracker);
}

// Tool definitions
export const readFileTool = {
    type: "function",
    name: "read_file",
    description: "Read a text file within the sandbox. Returns content with line numbers. Use offset/limit for large files.",
    parameters: {
        type: "object",
        properties: {
            filepath: { type: "string", description: "Relative path from project root" },
            offset: { type: "integer", minimum: 0, default: 0, description: "Line number to start from (0-based)" },
            limit: { type: "integer", minimum: 1, maximum: MAX_READ_LINES, default: MAX_READ_LINES, description: "Maximum number of lines to read" }
        },
        required: ["filepath"]
    }
};

export const listDirTool = {
    type: "function",
    name: "list_dir",
    description:
        "List files/directories within the sandbox. Useful before read_file. Returns basic metadata (type, size, mtime).",
    parameters: {
        type: "object",
        properties: {
            dir: { type: "string", description: "Directory path (relative to project root). Default: '.'" },
            recursive: { type: "boolean", default: false, description: "Recurse into subdirectories up to max_depth." },
            max_depth: { type: "integer", minimum: 1, maximum: LIST_MAX_DEPTH, default: 1 },
            include_hidden: { type: "boolean", default: false, description: "Include dotfiles (.*)" },
            limit: { type: "integer", minimum: 1, maximum: LIST_MAX_ENTRIES, default: 200 },
        }
    }
};

export const writeFileTool = {
    type: "function",
    name: "write_file",
    description:
        "Write a UTF-8 text file within the sandbox, atomically (tmpfile → rename). Supports create/overwrite/append.",
    parameters: {
        type: "object",
        properties: {
            filepath: { type: "string", description: "Relative path from project root" },
            content: { type: "string", description: "UTF-8 text content to write" },
            mode: { type: "string", enum: ["overwrite", "append", "create"], default: "overwrite" },
            mkdirp: { type: "boolean", default: true, description: "Create parent directories if needed" },
            make_backup: { type: "boolean", default: false, description: "Create .bak before overwrite" },
            max_bytes: { type: "integer", minimum: 1, maximum: WRITE_MAX_BYTES, default: WRITE_MAX_BYTES },
            eol: {
                type: "string", enum: ["lf", "crlf", "auto"], default: "auto",
                description: "Normalize line endings. 'auto' keeps as-is."
            },
            chmod: { type: "string", description: "Optional chmod like '644' or '755' (octal string)" }
        },
        required: ["filepath", "content"]
    }
};

export const megaWriterTool = {
    type: "function",
    name: "write_multiple_files",
    description:
        "Write multiple UTF-8 text files in a single call. Use this to write all files at once instead of calling write_file multiple times. Much faster for creating multiple files.",
    parameters: {
        type: "object",
        properties: {
            files: {
                type: "array",
                description: "Array of files to write",
                items: {
                    type: "object",
                    properties: {
                        filepath: { type: "string", description: "Relative path from project root" },
                        content: { type: "string", description: "UTF-8 text content to write" },
                        summary: { type: "string", description: "Brief description of changes made to this file (e.g., 'Created login component', 'Added error handling')" }
                    },
                    required: ["filepath", "content"]
                }
            }
        },
        required: ["files"]
    }
};

export const editFileTool = {
    type: "function",
    name: "edit_file",
    description:
        "Edit a file by replacing specific text. Uses search/replace - finds old_string and replaces with new_string. More efficient than rewriting entire files. File must be read first.",
    parameters: {
        type: "object",
        properties: {
            filepath: { type: "string", description: "Relative path from project root" },
            old_string: { type: "string", description: "The exact text to find and replace" },
            new_string: { type: "string", description: "The text to replace it with" },
            replace_all: { type: "boolean", default: false, description: "Replace all occurrences (default: first match only)" }
        },
        required: ["filepath", "old_string", "new_string"]
    }
};

export const editMultipleFilesTool = {
    type: "function",
    name: "edit_multiple_files",
    description:
        "Make multiple targeted edits across one or more files in a single call. Use this to batch all edits at once instead of calling edit_file multiple times. Much more efficient for multi-edit operations. Files must be read first.",
    parameters: {
        type: "object",
        properties: {
            edits: {
                type: "array",
                description: "Array of edits to apply",
                items: {
                    type: "object",
                    properties: {
                        filepath: { type: "string", description: "Relative path from project root" },
                        old_string: { type: "string", description: "The exact text to find and replace" },
                        new_string: { type: "string", description: "The text to replace it with" },
                        replace_all: { type: "boolean", default: false, description: "Replace all occurrences" },
                        description: { type: "string", description: "Brief description of this edit (optional)" }
                    },
                    required: ["filepath", "old_string", "new_string"]
                }
            }
        },
        required: ["edits"]
    }
};

// Utility functions
export function setSandboxRoot(root) {
    sandboxRootPath = path.resolve(root);
}

export function getSandboxRoot() {
    return sandboxRootPath;
}

function assertInsideSandbox(relativePath, workspacePath) {
    // Use workspacePath if provided, otherwise fall back to global sandboxRootPath
    let effectiveRootPath = sandboxRootPath;
    if (workspacePath != null) {
        effectiveRootPath = path.resolve(workspacePath);
    }

    const absolutePath = path.resolve(effectiveRootPath, relativePath);
    if (!absolutePath.startsWith(effectiveRootPath + path.sep) && absolutePath !== effectiveRootPath) {
        throw new Error("Access outside sandbox is not allowed.");
    }
    return absolutePath;
}

function toEntry(abs, rel, st) {
    const type = st.isDirectory()
        ? "dir"
        : st.isSymbolicLink()
            ? "link"
            : st.isFile()
                ? "file"
                : "other";
    return {
        path: rel,
        name: path.basename(abs),
        type,
        size: st.size,
        mtimeMs: st.mtimeMs
    };
}

function normalizeEOL(text, eol) {
    if (eol === "lf") return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (eol === "crlf") return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n/g, "\r\n");
    return text; // auto
}

async function ensureParentDir(target, mkdirp) {
    const parent = path.dirname(target);
    if (mkdirp) await fs.mkdir(parent, { recursive: true });
}

async function makeBackupIfNeeded(target) {
    try {
        const st = await fs.stat(target);
        if (st.isFile()) {
            await fs.copyFile(target, target + ".bak");
        }
    } catch {
        /* no-op if not exists */
    }
}

async function exists(p) {
    try { await fs.access(p); return true; } catch { return false; }
}

// Format line number with padding (cat -n style)
function formatLineNumber(lineNum, maxLineNum) {
    const width = String(maxLineNum).length;
    return String(lineNum).padStart(width, ' ');
}

// Tool handlers with progress callback support
export async function handleReadFile(args, progressCallback = null, workspacePath = null) {
    const { filepath, offset = 0, limit = MAX_READ_LINES } = args;

    try {
        if (progressCallback) progressCallback('start', 'Reading file...');

        const abs = assertInsideSandbox(filepath, workspacePath);
        const stat = await fs.stat(abs);
        const content = await fs.readFile(abs, 'utf-8');
        const allLines = content.split('\n');
        const totalLines = allLines.length;

        // Track this file read for staleness detection
        const effectiveRootPath = workspacePath != null ? path.resolve(workspacePath) : sandboxRootPath;
        const relativePath = path.relative(effectiveRootPath, abs);
        trackFileRead(relativePath, stat.mtimeMs);

        // Calculate line range
        const startLine = Math.max(0, offset);
        const endLine = Math.min(startLine + limit, totalLines);
        const selectedLines = allLines.slice(startLine, endLine);

        // Format with line numbers (1-based for display)
        const maxLineNum = endLine;
        const formattedLines = selectedLines.map((line, idx) => {
            const lineNum = startLine + idx + 1; // 1-based line number
            const truncatedLine = line.length > MAX_LINE_LENGTH
                ? line.substring(0, MAX_LINE_LENGTH) + '...'
                : line;
            return `${formatLineNumber(lineNum, maxLineNum)}| ${truncatedLine}`;
        });

        const formattedContent = formattedLines.join('\n');
        const hasMore = endLine < totalLines;

        if (progressCallback) progressCallback('succeed', 'File read successfully');

        const result = {
            ok: true,
            path: relativePath,
            totalLines,
            startLine: startLine + 1, // 1-based for response
            endLine,
            truncated: hasMore,
            content: formattedContent
        };

        // Add pagination hint if file has more lines
        if (hasMore) {
            result.hint = `File has more lines. Use offset=${endLine} to read beyond line ${endLine}.`;
        }

        return result;
    } catch (error) {
        if (progressCallback) progressCallback('fail', `Error reading file: ${error.message}`);
        throw error;
    }
}

export async function handleListDir(args = {}, progressCallback = null, workspacePath = null) {
    try {
        if (progressCallback) progressCallback('start', 'Listing directory...');

        const {
            dir = ".",
            recursive = false,
            max_depth = 1,
            include_hidden = false,
            limit = 200
        } = args;

        const absRoot = assertInsideSandbox(dir, workspacePath);
        const maxDepth = Math.min(max_depth, LIST_MAX_DEPTH);
        const cap = Math.min(limit, LIST_MAX_ENTRIES);
        const results = [];
        const effectiveRootPath = workspacePath != null ? path.resolve(workspacePath) : sandboxRootPath;
        const q = [{ abs: absRoot, rel: path.relative(effectiveRootPath, absRoot) || ".", depth: 0 }];
        
        while (q.length && results.length < cap) {
            const { abs, rel, depth } = q.shift();
            let dirHandle;
            
            try {
                dirHandle = await fs.opendir(abs);
            } catch (e) {
                const st = await fs.lstat(abs);
                results.push(toEntry(abs, rel, st));
                continue;
            }
            
            for await (const dirent of dirHandle) {
                if (results.length >= cap) break;
                const name = dirent.name;
                if (!include_hidden && name.startsWith(".")) continue;

                const childAbs = path.join(abs, name);
                const childRel = path.relative(effectiveRootPath, childAbs);
                const st = await fs.lstat(childAbs);
                results.push(toEntry(childAbs, childRel, st));

                // 재귀: symlink는 타지 않고, 디렉터리만 큐에 추가
                if (recursive && dirent.isDirectory() && depth + 1 < maxDepth) {
                    q.push({ abs: childAbs, rel: childRel, depth: depth + 1 });
                }
            }
        }

        if (progressCallback) progressCallback('succeed', 'Directory listed successfully');

        return {
            ok: true,
            root: path.relative(effectiveRootPath, absRoot) || ".",
            count: results.length,
            truncated: results.length >= cap,
            entries: results
        };
    } catch (error) {
        if (progressCallback) progressCallback('fail', `Error listing directory: ${error.message}`);
        throw error;
    }
}

export async function handleWriteFile(args = {}, progressCallback = null, workspacePath = null) {
    try {
        if (progressCallback) progressCallback('start', 'Writing file...');

        const {
            filepath,
            content,
            mode = "overwrite",
            mkdirp = true,
            make_backup = false,
            max_bytes = WRITE_MAX_BYTES,
            eol = "auto",
            chmod
        } = args ?? {};

        if (typeof filepath !== "string" || typeof content !== "string") {
            throw new Error("Invalid 'filepath' or 'content'");
        }

        const abs = assertInsideSandbox(filepath, workspacePath);
        const fileExistedBefore = await exists(abs);

        // 확장자 제한
        const ext = path.extname(abs).toLowerCase();
        if (!WRITE_ALLOWED_EXTS.includes(ext)) {
            throw new Error(`Disallowed file type: ${ext || "(no ext)"}`);
        }
        
        // 크기 제한
        const buf = Buffer.from(normalizeEOL(content, eol), "utf-8");
        if (buf.length > Math.min(max_bytes, WRITE_MAX_BYTES)) {
            throw new Error(`Content too large: ${buf.length} bytes (max ${Math.min(max_bytes, WRITE_MAX_BYTES)})`);
        }
        
        await ensureParentDir(abs, mkdirp);
        
        // append 모드면 원자성 보장 위해 기존 + 신규 → tmp → rename
        let finalContent = buf;
        if (mode === "append") {
            try {
                const existing = await fs.readFile(abs);
                finalContent = Buffer.concat([existing, buf]);
                if (finalContent.length > Math.min(max_bytes, WRITE_MAX_BYTES)) {
                    throw new Error(`Resulting file too large after append: ${finalContent.length} bytes`);
                }
            } catch {
                // 없으면 새로 생성
                if (mode === "append") {
                    // 그대로 진행
                }
            }
        } else if (mode === "create") {
            // 이미 있으면 거부
            try {
                await fs.access(abs);
                throw new Error("File already exists (mode=create).");
            } catch {
                /* OK if not exists */
            }
        } else if (mode !== "overwrite") {
            throw new Error("Invalid mode. Use overwrite | append | create");
        }
        
        if (make_backup && mode !== "create") {
            await makeBackupIfNeeded(abs);
        }
        
        // 원자적 쓰기: tmp → rename
        const rand = randomBytes(6).toString("hex");
        const tmp = abs + ".tmp-" + rand;
        await fs.writeFile(tmp, finalContent, { encoding: "utf-8", flag: "w" });
        
        if (chmod) {
            // 안전한 8진수 처리
            const perm = parseInt(chmod, 8);
            if (!Number.isNaN(perm)) await fs.chmod(tmp, perm);
        }
        
        await fs.rename(tmp, abs);
        const stat = await fs.stat(abs);

        const effectiveRootPath = workspacePath != null ? path.resolve(workspacePath) : sandboxRootPath;
        const relativePath = path.relative(effectiveRootPath, abs);

        // Emit FILE_STREAMING_END for tracking in toolFilesWritten
        if (progressCallback) {
            progressCallback('FILE_STREAMING_END', {
                path: relativePath,
                action: 'write',
                fullContent: finalContent.toString('utf-8'),
                isNewFile: !fileExistedBefore
            });
        }

        if (progressCallback) progressCallback('succeed', 'File written successfully');

        return {
            ok: true,
            path: path.relative(effectiveRootPath, abs),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            mode,
            backup: make_backup ? (await exists(abs + ".bak")) : false
        };
    } catch (error) {
        if (progressCallback) progressCallback('fail', `Error writing file: ${error.message}`);
        throw error;
    }
}

// Handler for megawriter (write multiple files in single call)
export async function handleWriteMultipleFiles(args = {}, progressCallback = null, workspacePath = null) {
    try {
        if (progressCallback) progressCallback('start', 'Writing multiple files...');

        const { files = [] } = args;

        if (!Array.isArray(files)) {
            throw new Error("'files' must be an array");
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        for (const file of files) {
            try {
                // Emit FILE_STREAMING_START event
                if (progressCallback) {
                    const eventData = {
                        path: file.filepath,
                        action: 'write'
                    };
                    if (file.summary) {
                        eventData.summary = file.summary;
                    }
                    progressCallback('FILE_STREAMING_START', eventData);
                }

                // Emit FILE_STREAMING_CONTENT event with full content
                // (not incremental like XML streaming, but gives UI the content)
                if (progressCallback) {
                    progressCallback('FILE_STREAMING_CONTENT', {
                        path: file.filepath,
                        content: file.content,
                        isIncremental: false // Full content at once
                    });
                }

                const result = await handleWriteFile(
                    {
                        filepath: file.filepath,
                        content: file.content,
                        mode: "overwrite",
                        mkdirp: true
                    },
                    null, // No individual progress callbacks
                    workspacePath
                );
                results.push({ ...result, filepath: file.filepath });
                successCount++;

                // Emit FILE_STREAMING_END event
                if (progressCallback) {
                    progressCallback('FILE_STREAMING_END', {
                        path: file.filepath,
                        action: 'write',
                        fullContent: file.content
                    });
                }
            } catch (error) {
                results.push({
                    ok: false,
                    filepath: file.filepath,
                    error: error.message
                });
                failCount++;
            }
        }

        if (progressCallback) {
            progressCallback('succeed', `Wrote ${successCount} files (${failCount} failed)`);
        }

        return {
            ok: failCount === 0,
            filesWritten: successCount,
            filesFailed: failCount,
            totalFiles: files.length,
            message: failCount === 0
                ? `Successfully wrote all ${successCount} files. Operation complete - no further action needed.`
                : `Wrote ${successCount} files successfully, ${failCount} failed.`,
            results
        };
    } catch (error) {
        if (progressCallback) progressCallback('fail', `Error writing files: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// Fuzzy matching strategies for edit_file
// Inspired by OpenCode/Cline - handles LLM imprecision with whitespace/indentation
// ============================================================================

/**
 * Try to find old_string in content using multiple matching strategies.
 * Returns { match: actualStringInContent, strategy: strategyName } or null if not found.
 */
function findWithFuzzyMatch(content, oldString) {
    // Strategy 1: Exact match
    if (content.includes(oldString)) {
        return { match: oldString, strategy: 'exact' };
    }

    // Strategy 2: Line-trimmed match
    // Trims each line but preserves line structure
    const lineTrimmedResult = tryLineTrimmedMatch(content, oldString);
    if (lineTrimmedResult) {
        return { match: lineTrimmedResult, strategy: 'line-trimmed' };
    }

    // Strategy 3: Indentation-flexible match
    // Removes leading indentation from both search and content blocks
    const indentFlexResult = tryIndentationFlexibleMatch(content, oldString);
    if (indentFlexResult) {
        return { match: indentFlexResult, strategy: 'indentation-flexible' };
    }

    // Strategy 4: Whitespace-normalized match
    // Normalizes all whitespace to single spaces
    const wsNormalizedResult = tryWhitespaceNormalizedMatch(content, oldString);
    if (wsNormalizedResult) {
        return { match: wsNormalizedResult, strategy: 'whitespace-normalized' };
    }

    return null;
}

/**
 * Strategy 2: Line-trimmed matching
 * Trims whitespace from each line, finds match, returns original text
 */
function tryLineTrimmedMatch(content, oldString) {
    const contentLines = content.split('\n');
    const searchLines = oldString.split('\n').map(l => l.trim());
    const searchJoined = searchLines.join('\n');

    // Slide through content looking for trimmed match
    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
        const windowLines = contentLines.slice(i, i + searchLines.length);
        const windowTrimmed = windowLines.map(l => l.trim()).join('\n');

        if (windowTrimmed === searchJoined) {
            // Return the original text from content (with original whitespace)
            return windowLines.join('\n');
        }
    }
    return null;
}

/**
 * Strategy 3: Indentation-flexible matching
 * Removes minimum indentation from both blocks before comparing
 */
function tryIndentationFlexibleMatch(content, oldString) {
    const contentLines = content.split('\n');
    const searchLines = oldString.split('\n');

    // Calculate minimum indentation of search string
    const searchMinIndent = getMinIndent(searchLines);
    const searchNormalized = searchLines.map(l => l.slice(searchMinIndent)).join('\n');

    // Slide through content
    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
        const windowLines = contentLines.slice(i, i + searchLines.length);
        const windowMinIndent = getMinIndent(windowLines);
        const windowNormalized = windowLines.map(l => l.slice(windowMinIndent)).join('\n');

        if (windowNormalized === searchNormalized) {
            return windowLines.join('\n');
        }
    }
    return null;
}

/**
 * Get minimum indentation (number of leading spaces) across non-empty lines
 */
function getMinIndent(lines) {
    let min = Infinity;
    for (const line of lines) {
        if (line.trim().length === 0) continue; // Skip empty lines
        const indent = line.match(/^(\s*)/)[1].length;
        if (indent < min) min = indent;
    }
    return min === Infinity ? 0 : min;
}

/**
 * Strategy 4: Whitespace-normalized matching
 * Normalizes all whitespace to single spaces
 */
function tryWhitespaceNormalizedMatch(content, oldString) {
    const normalizeWs = s => s.replace(/\s+/g, ' ').trim();
    const searchNormalized = normalizeWs(oldString);

    // This is trickier - we need to find the actual span in content
    // Use a sliding window approach on the normalized form
    const contentLines = content.split('\n');

    // Try progressively larger windows
    for (let windowSize = 1; windowSize <= contentLines.length; windowSize++) {
        for (let i = 0; i <= contentLines.length - windowSize; i++) {
            const windowLines = contentLines.slice(i, i + windowSize);
            const windowText = windowLines.join('\n');
            const windowNormalized = normalizeWs(windowText);

            if (windowNormalized === searchNormalized) {
                return windowText;
            }
        }
    }
    return null;
}

/**
 * Count occurrences using fuzzy matching
 */
function countFuzzyOccurrences(content, oldString, strategy) {
    if (strategy === 'exact') {
        return content.split(oldString).length - 1;
    }
    // For fuzzy strategies, we count line-based occurrences
    // This is a simplified count - may not be 100% accurate for overlapping matches
    let count = 0;
    let remaining = content;
    let match;
    while ((match = findWithFuzzyMatch(remaining, oldString)) !== null) {
        count++;
        const idx = remaining.indexOf(match.match);
        if (idx === -1) break;
        remaining = remaining.slice(idx + match.match.length);
        if (remaining.length === 0) break;
    }
    return count;
}

/**
 * Replace using fuzzy matching
 */
function fuzzyReplace(content, oldString, newString, replaceAll, matchInfo) {
    if (matchInfo.strategy === 'exact') {
        if (replaceAll) {
            return content.split(oldString).join(newString);
        } else {
            return content.replace(oldString, newString);
        }
    }

    // For fuzzy matches, we need to handle indentation preservation
    if (replaceAll) {
        let result = content;
        let match;
        while ((match = findWithFuzzyMatch(result, oldString)) !== null) {
            const adjustedNew = adjustIndentation(match.match, newString);
            result = result.replace(match.match, adjustedNew);
        }
        return result;
    } else {
        const adjustedNew = adjustIndentation(matchInfo.match, newString);
        return content.replace(matchInfo.match, adjustedNew);
    }
}

/**
 * Adjust new_string indentation to match the original matched text
 */
function adjustIndentation(originalMatch, newString) {
    const originalLines = originalMatch.split('\n');
    const newLines = newString.split('\n');

    if (originalLines.length === 0 || newLines.length === 0) {
        return newString;
    }

    // Get the indentation of the first line of original
    const originalIndent = originalLines[0].match(/^(\s*)/)[1];
    const newIndent = newLines[0].match(/^(\s*)/)[1];

    // If new string has less indentation, add the difference
    if (newIndent.length < originalIndent.length) {
        const indentDiff = originalIndent.slice(0, originalIndent.length - newIndent.length);
        return newLines.map(l => indentDiff + l).join('\n');
    }

    return newString;
}

// Handler for edit_file (search/replace)
export async function handleEditFile(args = {}, progressCallback = null, workspacePath = null) {
    try {
        if (progressCallback) progressCallback('start', 'Editing file...');

        const { filepath, old_string, new_string, replace_all = false } = args;

        if (typeof filepath !== "string" || typeof old_string !== "string" || typeof new_string !== "string") {
            throw new Error("Invalid 'filepath', 'old_string', or 'new_string'");
        }

        if (old_string === new_string) {
            throw new Error("old_string and new_string must be different");
        }

        if (old_string.length === 0) {
            throw new Error("old_string cannot be empty");
        }

        const abs = assertInsideSandbox(filepath, workspacePath);
        const effectiveRootPath = workspacePath != null ? path.resolve(workspacePath) : sandboxRootPath;
        const relativePath = path.relative(effectiveRootPath, abs);

        // Check file staleness - require read before edit
        const stat = await fs.stat(abs);
        const staleness = checkFileStaleness(relativePath, stat.mtimeMs);

        if (!staleness.wasRead) {
            throw new Error(`File must be read before editing. Use read_file first to view the current content of '${relativePath}'.`);
        }

        if (staleness.isStale) {
            throw new Error(`File '${relativePath}' has been modified since it was last read. Use read_file again to see current content before editing.`);
        }

        // Read current file content
        const content = await fs.readFile(abs, 'utf-8');

        // Try to find match using fuzzy strategies
        const matchInfo = findWithFuzzyMatch(content, old_string);

        if (!matchInfo) {
            throw new Error(`old_string not found in file. No matches for the search text (tried exact, line-trimmed, indentation-flexible, and whitespace-normalized matching).`);
        }

        // Count occurrences
        const occurrences = countFuzzyOccurrences(content, old_string, matchInfo.strategy);

        if (occurrences > 1 && !replace_all) {
            throw new Error(`old_string matches ${occurrences} locations. Use replace_all=true to replace all, or provide more context to match uniquely.`);
        }

        // Perform replacement
        const newContent = fuzzyReplace(content, old_string, new_string, replace_all, matchInfo);
        const replacementCount = replace_all ? occurrences : 1;

        // Atomic write: tmp → rename
        const rand = randomBytes(6).toString("hex");
        const tmp = abs + ".tmp-" + rand;
        await fs.writeFile(tmp, newContent, { encoding: "utf-8", flag: "w" });
        await fs.rename(tmp, abs);

        const newStat = await fs.stat(abs);

        // Update tracking with new mtime after successful edit
        trackFileRead(relativePath, newStat.mtimeMs);

        const strategyMsg = matchInfo.strategy !== 'exact'
            ? ` (matched via ${matchInfo.strategy})`
            : '';
        if (progressCallback) progressCallback('succeed', `Replaced ${replacementCount} occurrence(s)${strategyMsg}`);

        // Calculate line number where match occurred (1-based)
        const matchIndex = content.indexOf(matchInfo.match);
        const lineNumber = matchIndex >= 0
            ? content.substring(0, matchIndex).split('\n').length
            : 1;

        // Emit FILE_STREAMING_END for tracking in toolFilesWritten
        if (progressCallback) {
            progressCallback('FILE_STREAMING_END', {
                path: relativePath,
                action: 'edit',
                oldString: old_string,
                newString: new_string,
                lineNumber,
                fullContent: newContent,
                replacements: replacementCount,
                matchStrategy: matchInfo.strategy
            });
        }

        return {
            ok: true,
            path: relativePath,
            replacements: replacementCount,
            matchStrategy: matchInfo.strategy,
            size: newStat.size,
            mtimeMs: newStat.mtimeMs
        };
    } catch (error) {
        if (progressCallback) progressCallback('fail', `Error editing file: ${error.message}`);
        throw error;
    }
}

/**
 * Handle edit_multiple_files - batch multiple edits in a single call
 * This is the "megaeditor" - reduces API round trips by batching all edits
 */
export async function handleEditMultipleFiles(args = {}, progressCallback = null, workspacePath = null) {
    try {
        if (progressCallback) progressCallback('start', 'Applying multiple edits...');

        const { edits = [] } = args;

        if (!Array.isArray(edits)) {
            throw new Error("'edits' must be an array");
        }

        if (edits.length === 0) {
            throw new Error("'edits' array cannot be empty");
        }

        const results = [];
        let successCount = 0;
        let failCount = 0;

        // Group edits by file for efficient processing
        // When multiple edits target the same file, we need to apply them sequentially
        // and refresh file content between edits
        for (const edit of edits) {
            try {
                // Emit edit start event
                if (progressCallback) {
                    progressCallback('EDIT_START', {
                        path: edit.filepath,
                        description: edit.description || `${edit.old_string.slice(0, 30)}... → ${edit.new_string.slice(0, 30)}...`
                    });
                }

                // Use the existing handleEditFile logic
                const result = await handleEditFile(
                    {
                        filepath: edit.filepath,
                        old_string: edit.old_string,
                        new_string: edit.new_string,
                        replace_all: edit.replace_all || false
                    },
                    null, // No individual progress callbacks
                    workspacePath
                );

                results.push({
                    ...result,
                    filepath: edit.filepath,
                    description: edit.description
                });
                successCount++;

                // Emit edit end event
                if (progressCallback) {
                    progressCallback('EDIT_END', {
                        path: edit.filepath,
                        success: true,
                        replacements: result.replacements
                    });
                }
            } catch (error) {
                failCount++;
                results.push({
                    ok: false,
                    filepath: edit.filepath,
                    error: error.message,
                    description: edit.description
                });

                // Emit edit end event with error
                if (progressCallback) {
                    progressCallback('EDIT_END', {
                        path: edit.filepath,
                        success: false,
                        error: error.message
                    });
                }
            }
        }

        const summary = `Applied ${successCount} edit(s)${failCount > 0 ? `, ${failCount} failed` : ''}`;
        if (progressCallback) progressCallback('succeed', summary);

        return {
            ok: failCount === 0,
            summary,
            totalEdits: edits.length,
            successCount,
            failCount,
            results
        };
    } catch (error) {
        if (progressCallback) progressCallback('fail', `Error applying edits: ${error.message}`);
        throw error;
    }
}

// Tool execution dispatcher
export async function executeFileTool(toolName, args, progressCallback = null, workspacePath = null) {
    switch (toolName) {
        case "read_file":
            return await handleReadFile(args, progressCallback, workspacePath);
        case "list_dir":
            return await handleListDir(args, progressCallback, workspacePath);
        case "write_file":
            return await handleWriteFile(args, progressCallback, workspacePath);
        case "write_multiple_files":
            return await handleWriteMultipleFiles(args, progressCallback, workspacePath);
        case "edit_file":
            return await handleEditFile(args, progressCallback, workspacePath);
        case "edit_multiple_files":
            return await handleEditMultipleFiles(args, progressCallback, workspacePath);
        default:
            throw new Error(`Unknown tool: ${toolName}`);
    }
}

// Export all tools as array for convenience
// Uses megaWriterTool instead of writeFileTool for flexibility (can write 1 or more files)
// Uses editMultipleFilesTool (megaeditor) instead of editFileTool for batched edits
// This also prevents duplicate tools when used with enableMegawriter option
export const fileTools = [readFileTool, listDirTool, megaWriterTool, editMultipleFilesTool];
