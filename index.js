#!/usr/bin/env node
import { Command } from "commander";
import 'dotenv/config';
import os from "os";
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function chat(prompt, opts = {}) {
    const messages = [];

    if (opts.instruction) {
        messages.push({ role: "system", content: opts.instruction });
    }

    // 환경 정보 추가
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

    messages.push({ role: "user", content: prompt });
    if (opts.conversation && !opts.conversationID) {
        const conv = await client.conversations.create();
        opts.conversationID = conv.id;
    }

    const response = await client.responses.create({
        model: opts.model || "gpt-4o-mini",
        input: messages,
        conversation: opts.conversationID
    });

    return {
        content: response.output_text,
        conversationID: response.conversation
    };
}



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