import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

// Constants
const MAX_BYTES = 64 * 1024;
const LIST_MAX_ENTRIES = 500;
const LIST_MAX_DEPTH = 3;
const WRITE_MAX_BYTES = 256 * 1024;
const WRITE_ALLOWED_EXTS = [
    ".md", ".txt", ".log", ".json", ".js", ".ts", ".tsx", ".jsx",
    ".css", ".html", ".sh", ".yml", ".yaml", ".gitignore", ".patch"
];

// Global sandbox root - will be set by setSandboxRoot
let sandboxRoot = path.resolve(process.cwd());

// Tool definitions
export const readFileTool = {
    type: "function",
    name: "read_file",
    description: "Read a text-like file within the sandbox and return a UTF-8 preview.",
    parameters: {
        type: "object",
        properties: {
            filepath: { type: "string", description: "Relative path from project root" },
            encoding: { type: "string", enum: ["utf-8"], default: "utf-8" },
            start: { type: "integer", minimum: 0, default: 0 },
            length: { type: "integer", minimum: 1, maximum: MAX_BYTES, default: MAX_BYTES }
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

// Utility functions
export function setSandboxRoot(root) {
    sandboxRoot = path.resolve(root);
}

export function getSandboxRoot() {
    return sandboxRoot;
}

function assertInsideSandbox(p) {
    const abs = path.resolve(sandboxRoot, p);
    if (!abs.startsWith(sandboxRoot + path.sep) && abs !== sandboxRoot) {
        throw new Error("Access outside sandbox is not allowed.");
    }
    return abs;
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

// Tool handlers with spinner callback support
export async function handleReadFile(args, spinnerCallback = null) {
    const { filepath, encoding = "utf-8", start = 0, length = MAX_BYTES } = args;
    
    try {
        if (spinnerCallback) spinnerCallback('start', 'Reading file...');
        
        const abs = assertInsideSandbox(filepath);
        const stat = await fs.stat(abs);
        const end = Math.min(start + length, stat.size);
        const fh = await fs.open(abs, "r");
        
        try {
            const buf = Buffer.alloc(end - start);
            await fh.read(buf, 0, buf.length, start);
            const text = buf.toString(encoding);
            
            if (spinnerCallback) spinnerCallback('succeed', 'File read successfully');
            
            return {
                ok: true,
                path: path.relative(sandboxRoot, abs),
                size: stat.size,
                start,
                end,
                truncated: end < stat.size,
                preview: text
            };
        } finally {
            if (fh) await fh.close();
        }
    } catch (error) {
        if (spinnerCallback) spinnerCallback('fail', `Error reading file: ${error.message}`);
        throw error;
    }
}

export async function handleListDir(args = {}, spinnerCallback = null) {
    try {
        if (spinnerCallback) spinnerCallback('start', 'Listing directory...');
        
        const {
            dir = ".",
            recursive = false,
            max_depth = 1,
            include_hidden = false,
            limit = 200
        } = args;
        
        const absRoot = assertInsideSandbox(dir);
        const maxDepth = Math.min(max_depth, LIST_MAX_DEPTH);
        const cap = Math.min(limit, LIST_MAX_ENTRIES);
        const results = [];
        const q = [{ abs: absRoot, rel: path.relative(sandboxRoot, absRoot) || ".", depth: 0 }];
        
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
                const childRel = path.relative(sandboxRoot, childAbs);
                const st = await fs.lstat(childAbs);
                results.push(toEntry(childAbs, childRel, st));
                
                // 재귀: symlink는 타지 않고, 디렉터리만 큐에 추가
                if (recursive && dirent.isDirectory() && depth + 1 < maxDepth) {
                    q.push({ abs: childAbs, rel: childRel, depth: depth + 1 });
                }
            }
        }
        
        if (spinnerCallback) spinnerCallback('succeed', 'Directory listed successfully');
        
        return {
            ok: true,
            root: path.relative(sandboxRoot, absRoot) || ".",
            count: results.length,
            truncated: results.length >= cap,
            entries: results
        };
    } catch (error) {
        if (spinnerCallback) spinnerCallback('fail', `Error listing directory: ${error.message}`);
        throw error;
    }
}

export async function handleWriteFile(args = {}, spinnerCallback = null) {
    try {
        if (spinnerCallback) spinnerCallback('start', 'Writing file...');
        
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
        
        const abs = assertInsideSandbox(filepath);
        
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
        
        if (spinnerCallback) spinnerCallback('succeed', 'File written successfully');
        
        return {
            ok: true,
            path: path.relative(sandboxRoot, abs),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            mode,
            backup: make_backup ? (await exists(abs + ".bak")) : false
        };
    } catch (error) {
        if (spinnerCallback) spinnerCallback('fail', `Error writing file: ${error.message}`);
        throw error;
    }
}

// Tool execution dispatcher
export async function executeFileTool(toolName, args, spinnerCallback = null) {
    switch (toolName) {
        case "read_file":
            return await handleReadFile(args, spinnerCallback);
        case "list_dir":
            return await handleListDir(args, spinnerCallback);
        case "write_file":
            return await handleWriteFile(args, spinnerCallback);
        default:
            throw new Error(`Unknown tool: ${toolName}`);
    }
}

// Export all tools as array for convenience
export const fileTools = [readFileTool, listDirTool, writeFileTool];
