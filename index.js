#!/usr/bin/env node
import { Command } from "commander";
import 'dotenv/config';
import os from "os";
import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

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
    const envPrompt = `You are running in environment: ${platform} ${release} (${arch}).`;
    messages.push({ role: "system", content: envPrompt });

    if (opts.pure) {
        messages.push({ role: "system", content: "Respond with only the main content, no explanations." });
        messages.push({ role: "system", content: "Do not add any preamble or postamble." });
        messages.push({ role: "system", content: "Do not include explanations, markdown formatting, or code fences." });
        messages.push({ role: "system", content: "Create content suitable for this OS and environment." });
    }

    // add tooling prompot
    messages.push({
        role: "system",
        content:
            "You can call the tool `read_file` to inspect project files. Only read within the sandbox root. " +
            `Prefer small previews (<= ${MAX_BYTES} bytes). For large files, request a narrower range.`
    });
    messages.push({
        role: "system",
        content:
            "You can call tools `list_dir` to list project files in directory. "
    });

    messages.push({ role: "user", content: prompt });


    var turnNumber = 0;
    let response = await client.responses.create({
        model: opts.model || "gpt-4o-mini",
        input: messages,
        conversation: opts.conversationID,
        tools: [readFileTool, listDirTool],
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
            tools: [readFileTool, listDirTool],
            tool_choice: opts.enableFileRead ? "auto" : undefined
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
                const userInput = await question("You: ");
                if (userInput.toLowerCase() === "exit" || userInput.toLowerCase() === "quit") {
                    rl.close();
                    break;
                }
                const res = await chat(userInput, opts);
                console.log("Sigrid:", res.content);
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