#!/usr/bin/env node
import { Command } from "commander";
import 'dotenv/config';
import os from "os";
import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// tooling support
const SANDBOX_ROOT = path.resolve(process.cwd());
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

function assertInsideSandbox(p) {
    const abs = path.resolve(SANDBOX_ROOT, p);
    if (!abs.startsWith(SANDBOX_ROOT + path.sep) && abs !== SANDBOX_ROOT) {
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
            path: path.relative(SANDBOX_ROOT, abs),
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
    opts.enableFileRead = true; // always enable for now

    messages.push({ role: "user", content: prompt });

    let response = await client.responses.create({
        model: opts.model || "gpt-4o-mini",
        input: messages,
        conversation: opts.conversationID,
        tools: [readFileTool],
        tool_choice: opts.enableFileRead ? "auto" : undefined
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
            tools: opts.enableFileRead ? [readFileTool] : undefined,
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
    .option("-p, --pure", "pure output")
    .option("-s, --stream", "stream output")
    .option("-i, --instruction <text>", "instruction")
    .action(async (words, opts) => {
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