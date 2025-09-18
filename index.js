#!/usr/bin/env node
import { Command } from "commander";
import 'dotenv/config';
import os from "os";
import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { randomBytes } from "node:crypto";
import chalk from 'chalk'; // Added for colorizing outputs
import ora from 'ora'; // Import ora for loading spinner

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// tooling support
let sandboxRoot = path.resolve(process.cwd());
const MAX_BYTES = 64 * 1024;
const readFileTool = {
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
const LIST_MAX_ENTRIES = 500;
const LIST_MAX_DEPTH = 3;
const listDirTool = {
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

const WRITE_MAX_BYTES = 256 * 1024; // 256KB 기본 상한 (원하면 키우기)
const WRITE_ALLOWED_EXTS = [
    ".md", ".txt", ".log", ".json", ".js", ".ts", ".tsx", ".jsx",
    ".css", ".html", ".sh", ".yml", ".yaml", ".gitignore", ".patch"
];
const writeFileTool = {
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

function assertInsideSandbox(p) {
    const abs = path.resolve(sandboxRoot, p);
    if (!abs.startsWith(sandboxRoot + path.sep) && abs !== sandboxRoot) {
        throw new Error("Access outside sandbox is not allowed.");
    }
    return abs;
}

async function handleReadFile(args) {
    const { filepath, encoding = "utf-8", start = 0, length = MAX_BYTES } = args;
    const abs = assertInsideSandbox(filepath);
    const stat = await fs.stat(abs);
    const end = Math.min(start + length, stat.size);
    const fh = await fs.open(abs, "r");

    try {
        const buf = Buffer.alloc(end - start);
        await fh.read(buf, 0, buf.length, start);
        const text = buf.toString(encoding);
        console.log(chalk.green(`Read file: ${filepath}`)); // Log message
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
        await fh.close();
    }
}

async function handleListDir(args = {}) {
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

    console.log(chalk.green(`Listed directory: ${dir}`)); // Log message
    return {
        ok: true,
        root: path.relative(sandboxRoot, absRoot) || ".",
        count: results.length,
        truncated: results.length >= cap,
        entries: results
    };
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

// write file tooling
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

async function handleWriteFile(args = {}) {
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

    console.log(chalk.green(`Wrote file: ${filepath}`)); // Log message
    return {
        ok: true,
        path: path.relative(sandboxRoot, abs),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        mode,
        backup: make_backup ? (await exists(abs + ".bak")) : false
    };
}

async function exists(p) {
    try { await fs.access(p); return true; } catch { return false; }
}



// tooling helpers
function extractToolCalls(r) {
    const calls = [];

    for (const item of r.output ?? []) {
        if (item.type === "function_call" && item.name && item.call_id) {
            calls.push({
                id: item.call_id,
                name: item.name,
                arguments: item.arguments ?? "{}"
            });
        }
    }

    for (const item of r.output ?? []) {
        for (const part of item.content ?? []) {
            if (part.type === "tool_call" && part.name && part.id) {
                calls.push({
                    id: part.id,
                    name: part.name,
                    arguments: part.arguments ?? "{}"
                });
            }
        }
    }

    return calls;
}

function extractText(r) {
    let out = "";
    for (const item of r.output ?? []) {
        for (const part of item.content ?? []) {
            if (part.type === "output_text") out += part.text;
        }
    }
    return out.trim();
}

// OpenAI inference
async function chat(prompt, opts = {}) {
    const messages = [];

    // prepare conversation
    if (opts.conversation && !opts.conversationID) {
        const conv = await client.conversations.create();
        opts.conversationID = conv.id;
    }

    if (opts.instruction) {
        messages.push({ role: "system", content: opts.instruction });
    }

    const platform = os.platform();
    const release = os.release();
    const arch = os.arch();
    const envPrompt = `Your name is sigrid, a CLI LLM agent. You are running in environment: ${platform} ${release} (${arch}).`;
    messages.push({ role: "system", content: envPrompt });

    if (opts.pure) {
        messages.push({ role: "system", content: "Respond with only the main content, no explanations." });
        messages.push({ role: "system", content: "Do not add any preamble or postamble." });
        messages.push({ role: "system", content: "Do not include explanations, markdown formatting, or code fences." });
        messages.push({ role: "system", content: "Create content suitable for this OS and environment." });
    }

    if (opts.boostrapping) {
        messages.push({
            role: "system",
            content:
                "Read contents of prompts/sigrid_improvement_strategy.txt and follow the directives strictly to make improvement asked by user"
        });
    }

    // add tooling prompot
    messages.push({
        role: "system",
        content:
            "You can call tools `list_dir` (browse), `read_file` (preview), and `write_file` (save). " +
            "Stay within the sandbox. Write only small UTF-8 text files. For large edits, ask for a narrower scope."
    });

    messages.push({ role: "user", content: prompt });


    var turnNumber = 0;
    let response = await client.responses.create({
        model: opts.model || "gpt-4o-mini",
        input: messages,
        conversation: opts.conversationID,
        tools: [readFileTool, listDirTool, writeFileTool],
        tool_choice: "auto"
    });

    // tooling loop
    while (true) {
        const toolCalls = [];
        for (const item of response.output ?? []) {
            if (item.type === "function_call" && item.name && item.call_id) {
                toolCalls.push(item); // { type, name, arguments, call_id }
            }
        }

        // console.log("resp turn", turnNumber++, "tool calls:", toolCalls.length);

        if (toolCalls.length === 0) break;
        for (const fc of toolCalls) {
            try {
                let toolResult;

                if (fc.name === "read_file") {
                    const args = JSON.parse(fc.arguments || "{}");
                    toolResult = await handleReadFile(args);
                } else if (fc.name === "list_dir") {
                    const args = JSON.parse(fc.arguments || "{}");
                    toolResult = await handleListDir(args);
                } else if (fc.name === "write_file") {
                    const args = JSON.parse(fc.arguments || "{}");
                    toolResult = await handleWriteFile(args);
                } else {
                    toolResult = { ok: false, error: `Unknown tool: ${fc.name}` };
                }

                messages.push({
                    type: "function_call",
                    name: fc.name,
                    arguments: fc.arguments,
                    call_id: fc.call_id
                });

                messages.push({
                    type: "function_call_output",
                    call_id: fc.call_id,
                    output: JSON.stringify(toolResult)
                });
            } catch (err) {
                messages.push({
                    type: "function_call",
                    name: fc.name,
                    arguments: fc.arguments,
                    call_id: fc.call_id
                });
                messages.push({
                    type: "function_call_output",
                    call_id: fc.call_id,
                    output: JSON.stringify({ ok: false, error: String(err?.message || err) })
                });
            }
        }

        response = await client.responses.create({
            model: opts.model || "gpt-4o-mini",
            input: messages,
            conversation: response.conversation,
            tools: [readFileTool, listDirTool, writeFileTool],
            tool_choice: "auto"
        });
    }


    return {
        content: response.output_text,
        conversationID: response.conversation
    };
}

// TUI
const program = new Command();

program
    .name("sigrid")
    .description("Sigrid: LLM CLI with LangChainJS")
    .version("0.1.0");

program
    .argument("[prompt...]", "your prompt")
    .option("-e, --environment <text>", "change directory to sandbox environment")
    .option("-p, --pure", "pure output")
    .option("-s, --stream", "stream output")
    .option("-i, --instruction <text>", "instruction")
    .option("-b, --boostrapping", "operating in self-improvement mode")
    .action(async (words, opts) => {
        // change sandbox directory
        if (opts.environment) {
            process.chdir(opts.environment);
            sandboxRoot = path.resolve(process.cwd());
        }

        const prompt = words.join(" ") || await readStdin();
        if (!prompt) {
            console.log("running in interactive mode");
            opts.conversation = true;
            while (true) {
                const readline = await import("readline");
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                const question = (query) => new Promise((resolve) => rl.question(query, resolve));
                const userInput = await question(chalk.green("You: ")); // Colorized user input
                if (userInput.toLowerCase() === "exit" || userInput.toLowerCase() === "quit") {
                    rl.close();
                    break;
                }
                const spinner = ora('Waiting for response...').start(); // Start spinner
                const res = await chat(userInput, opts);
                spinner.stop(); // Stop spinner
                console.log(chalk.blue("Sigrid:"), res.content); // Colorized Sigrid output
                rl.close();
            }
            process.exit(2);
        }
        var res = await chat(prompt, opts);
        console.log(res.content);
    });

program.parse(process.argv);

// main loop
async function readStdin() {
    return new Promise((res) => {
        if (process.stdin.isTTY) return res("");
        let d = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (c) => (d += c));
        process.stdin.on("end", () => res(d.trim()));
    });
}