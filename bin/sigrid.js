#!/usr/bin/env node
import { Command } from "commander";
import 'dotenv/config';
import os from "os";
import chalk from 'chalk';
import ora from 'ora';
import { 
    initializeClient,
    execute,
    setSandboxRoot 
} from "../llm.js";

// Initialize OpenAI client
initializeClient(process.env.OPENAI_API_KEY);

// Initialize sandbox root
setSandboxRoot(process.cwd());

// Spinner management for CLI
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

// Build system instructions array
function buildInstructions(opts) {
    const instructions = [];
    
    // Identity
    instructions.push("Your name is sigrid, a CLI LLM agent.");
    
    // Environment info
    const platform = os.platform();
    const release = os.release();
    const arch = os.arch();
    instructions.push(`You are running in environment: ${platform} ${release} (${arch}).`);
    
    // Custom instruction from -i flag
    if (opts.instruction) {
        instructions.push(opts.instruction);
    }
    
    // Bootstrapping
    if (opts.bootstrapping) {
        instructions.push("Read contents of prompts/sigrid_improvement_strategy.txt and follow the directives strictly to make improvement asked by user");
    }
    
    return instructions;
}

// Read from stdin
async function readStdin() {
    return new Promise((res) => {
        if (process.stdin.isTTY) return res("");
        let d = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (c) => (d += c));
        process.stdin.on("end", () => res(d.trim()));
    });
}

// TUI
const program = new Command();
program
    .name("sigrid")
    .description("Sigrid: LLM CLI agent with file tooling")
    .version("0.2.0");

program
    .argument("[prompt...]", "your prompt")
    .option("-e, --environment <text>", "change directory to sandbox environment")
    .option("-p, --pure", "pure output (no explanations)")
    .option("-s, --stream", "stream output")
    .option("-i, --instruction <text>", "custom system instruction")
    .option("-b, --bootstrapping", "operating in self-improvement mode")
    .option("-m, --model <text>", "model to use (default: gpt-5-mini)")
    .action(async (words, opts) => {
        // Change sandbox directory if specified
        if (opts.environment) {
            process.chdir(opts.environment);
            setSandboxRoot(process.cwd());
        }
        
        const prompt = words.join(" ") || await readStdin();
        
        if (!prompt) {
            // Interactive mode
            console.log("Running in interactive mode (type 'exit' or 'quit' to quit)");
            opts.conversation = true;
            
            while (true) {
                const readline = await import("readline");
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                
                const question = (query) => new Promise((resolve) => rl.question(query, resolve));
                const userInput = await question(chalk.green("You: "));
                
                if (userInput.toLowerCase() === "exit" || userInput.toLowerCase() === "quit") {
                    rl.close();
                    break;
                }
                
                const res = await execute(userInput, {
                    ...opts,
                    instructions: buildInstructions(opts),
                    progressCallback: createSpinnerCallback()
                });
                
                console.log(chalk.blue("Sigrid:"), res.content);
                rl.close();
            }
            process.exit(0);
        }
        
        // Single prompt mode
        const res = await execute(prompt, {
            ...opts,
            instructions: buildInstructions(opts),
            progressCallback: createSpinnerCallback()
        });
        
        console.log(res.content);
    });

program.parse(process.argv);
