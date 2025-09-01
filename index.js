#!/usr/bin/env node
import { Command } from "commander";
import { ChatOpenAI } from "@langchain/openai";
import 'dotenv/config';

const model = new ChatOpenAI({
    modelName: "gpt-4o-mini", // 또는 gpt-4o
    temperature: 0,
});

function chat(prompt, opts) {
    const messages = [];
    if (opts.instruction) {
        messages.push({ role: "system", content: opts.instruction });
    }
    messages.push({ role: "user", content: prompt });

    return model.invoke(messages);
}

const program = new Command();

program
    .name("sigrid")
    .description("Sigrid: LLM CLI with LangChainJS")
    .version("0.1.0");


program
    .argument("[prompt...]", "your prompt")
    .option("-s, --stream", "stream output")
    .option("-i, --instruction <text>", "instruction")
    .action(async (words, opts) => {
        const prompt = words.join(" ") || await readStdin();
        if (!prompt) {
            console.error("No prompt provided");
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