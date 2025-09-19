#!/usr/bin/env node
import { Command } from "commander";
import 'dotenv/config';
import os from "os";
import path from "node:path";
import OpenAI from "openai";
import chalk from 'chalk';
import ora from 'ora';
import { 
    fileTools, 
    setSandboxRoot, 
    executeFileTool 
} from "./filetooling.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Initialize sandbox root
setSandboxRoot(process.cwd());

// Spinner management
let currentSpinner = null;

function createSpinnerCallback() {
    return (action, message) => {
        switch (action) {
            case 'start':
                if (currentSpinner) currentSpinner.stop();
                currentSpinner = ora(message).start();
                break;
            case 'succeed':
                if (currentSpinner) {
                    currentSpinner.succeed(message);
                    currentSpinner = null;
                }
                break;
            case 'fail':
                if (currentSpinner) {
                    currentSpinner.fail(message);
                    currentSpinner = null;
                }
                break;
            case 'stop':
                if (currentSpinner) {
                    currentSpinner.stop();
                    currentSpinner = null;
                }
                break;
            default:
                console.warn(`Unknown spinner action: ${action}`);
        }
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
    const envPrompt = `Your name is sigrid, a CLI LLM agent. You are running in environment: ${platform} ${release} (${arch}).`;
    messages.push({ role: "system", content: envPrompt });
    if (opts.pure) {
        messages.push({ role: "system", content: "Respond with only the main content, no explanations." });
        messages.push({ role: "system", content: "Create content suitable for this OS and environment." });
        messages.push({ role: "system", content: "Content should be displayed to chat and no file should be written." });
        messages.push({ role: "system", content: "Do not add any preamble or postamble." });
        messages.push({ role: "system", content: "Do not include explanations, markdown formatting, code fences, or comment. Content should be executable." });
    }
    if (opts.boostrapping) {
        messages.push({
            role: "system",
            content:
                "Read contents of prompts/sigrid_improvement_strategy.txt and follow the directives strictly to make improvement asked by user"
        });
    }
    // add tooling prompt
    messages.push({
        role: "system",
        content:
            "You can call tools `list_dir` (browse), `read_file` (preview), and `write_file` (save). " +
            "Stay within the sandbox. Write only small UTF-8 text files. For large edits, ask for a narrower scope."
    });
    messages.push({ role: "user", content: prompt });
    
    // Start main conversation spinner
    const conversationSpinner = ora('Waiting for response...').start();
    
    var turnNumber = 0;
    let response = await client.responses.create({
        model: opts.model || "gpt-4o",
        input: messages,
        conversation: opts.conversationID,
        tools: fileTools,
        tool_choice: "auto"
    });

    conversationSpinner.stop();

    // Create spinner callback for file operations
    const spinnerCallback = createSpinnerCallback();

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
                const args = JSON.parse(fc.arguments || "{}");
                const toolResult = await executeFileTool(fc.name, args, spinnerCallback);
                
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
        
        // Start spinner for follow-up response
        const followUpSpinner = ora('Processing...').start();
        response = await client.responses.create({
            model: opts.model || "gpt-4o-mini",
            input: messages,
            conversation: response.conversation,
            tools: fileTools,
            tool_choice: "auto"
        });
        followUpSpinner.stop();
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
            setSandboxRoot(process.cwd());
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
                const res = await chat(userInput, opts);
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
