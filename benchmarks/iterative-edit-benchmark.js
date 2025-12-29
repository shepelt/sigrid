/**
 * Full-Scale Iterative Edit Benchmark
 *
 * Simulates the NOBI scenario from issue #7:
 * - 4 iterative edit steps on a codebase
 * - Compares megawriter (full rewrite) vs file tools (targeted edits)
 *
 * Target from issue: 226,674 tokens → <100,000 tokens (55%+ reduction)
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createWorkspace, initializeClient } from '../index.js';
import { clearFileReadTracking } from '../filetooling.js';

// Check for API key
const hasApiKey = !!(process.env.LLM_GATEWAY_URL && process.env.LLM_GATEWAY_API_KEY);

if (!hasApiKey) {
    console.error('Error: No gateway configuration found.');
    console.error('Set LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY');
    process.exit(1);
}

// Initialize client
initializeClient({
    apiKey: process.env.LLM_GATEWAY_API_KEY,
    baseURL: process.env.LLM_GATEWAY_URL
});

const model = process.env.LLM_MODEL || 'anthropic/claude-haiku-4-5-20251001';
console.log(`Using gateway: ${process.env.LLM_GATEWAY_URL}`);
console.log(`Model: ${model}\n`);

// Larger sample codebase (~500 lines total) simulating a game
const GAME_FILES = {
    'src/game.ts': `// Main game module
import { Player } from './player';
import { Ball } from './ball';
import { Paddle } from './paddle';
import { ScoreBoard } from './scoreboard';

export class Game {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private player1: Player;
    private player2: Player;
    private ball: Ball;
    private paddle1: Paddle;
    private paddle2: Paddle;
    private scoreBoard: ScoreBoard;
    private isRunning: boolean = false;
    private lastTime: number = 0;

    constructor(canvasId: string) {
        this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        this.ctx = this.canvas.getContext('2d')!;
        this.player1 = new Player('Player 1', 0);
        this.player2 = new Player('Player 2', 0);
        this.ball = new Ball(400, 300, 10);
        this.paddle1 = new Paddle(50, 250, 10, 100);
        this.paddle2 = new Paddle(740, 250, 10, 100);
        this.scoreBoard = new ScoreBoard();
    }

    start(): void {
        this.isRunning = true;
        this.lastTime = performance.now();
        this.gameLoop();
    }

    stop(): void {
        this.isRunning = false;
    }

    private gameLoop(): void {
        if (!this.isRunning) return;

        const currentTime = performance.now();
        const deltaTime = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;

        this.update(deltaTime);
        this.render();

        requestAnimationFrame(() => this.gameLoop());
    }

    private update(deltaTime: number): void {
        this.ball.update(deltaTime);
        this.paddle1.update(deltaTime);
        this.paddle2.update(deltaTime);

        // Check collisions
        this.checkPaddleCollision(this.paddle1);
        this.checkPaddleCollision(this.paddle2);
        this.checkWallCollision();
        this.checkScore();
    }

    private checkPaddleCollision(paddle: Paddle): void {
        if (this.ball.intersects(paddle)) {
            this.ball.bounceX();
            // Add spin based on where ball hit paddle
            const hitPos = (this.ball.y - paddle.y) / paddle.height;
            this.ball.addSpin((hitPos - 0.5) * 2);
        }
    }

    private checkWallCollision(): void {
        if (this.ball.y <= 0 || this.ball.y >= this.canvas.height) {
            this.ball.bounceY();
        }
    }

    private checkScore(): void {
        if (this.ball.x <= 0) {
            this.player2.addScore(1);
            this.scoreBoard.update(this.player1.score, this.player2.score);
            this.resetBall();
        } else if (this.ball.x >= this.canvas.width) {
            this.player1.addScore(1);
            this.scoreBoard.update(this.player1.score, this.player2.score);
            this.resetBall();
        }
    }

    private resetBall(): void {
        this.ball.reset(400, 300);
    }

    private render(): void {
        // Clear canvas
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw paddles
        this.ctx.fillStyle = '#fff';
        this.paddle1.draw(this.ctx);
        this.paddle2.draw(this.ctx);

        // Draw ball
        this.ball.draw(this.ctx);

        // Draw center line
        this.ctx.setLineDash([5, 15]);
        this.ctx.beginPath();
        this.ctx.moveTo(400, 0);
        this.ctx.lineTo(400, 600);
        this.ctx.strokeStyle = '#fff';
        this.ctx.stroke();
    }
}
`,

    'src/player.ts': `// Player module
export class Player {
    public name: string;
    public score: number;
    private wins: number = 0;
    private losses: number = 0;

    constructor(name: string, initialScore: number = 0) {
        this.name = name;
        this.score = initialScore;
    }

    addScore(points: number): void {
        this.score += points;
    }

    resetScore(): void {
        this.score = 0;
    }

    recordWin(): void {
        this.wins++;
    }

    recordLoss(): void {
        this.losses++;
    }

    getWinRate(): number {
        const total = this.wins + this.losses;
        if (total === 0) return 0;
        return this.wins / total;
    }

    getStats(): { wins: number; losses: number; winRate: number } {
        return {
            wins: this.wins,
            losses: this.losses,
            winRate: this.getWinRate()
        };
    }
}
`,

    'src/ball.ts': `// Ball module
export class Ball {
    public x: number;
    public y: number;
    public radius: number;
    private vx: number = 300;
    private vy: number = 200;
    private spin: number = 0;
    private maxSpeed: number = 600;

    constructor(x: number, y: number, radius: number) {
        this.x = x;
        this.y = y;
        this.radius = radius;
    }

    update(deltaTime: number): void {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;

        // Apply spin effect
        this.vy += this.spin * deltaTime * 50;

        // Gradually reduce spin
        this.spin *= 0.99;
    }

    bounceX(): void {
        this.vx = -this.vx;
        // Speed up slightly on each bounce
        this.vx *= 1.05;
        this.vy *= 1.05;

        // Cap speed
        const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (speed > this.maxSpeed) {
            const scale = this.maxSpeed / speed;
            this.vx *= scale;
            this.vy *= scale;
        }
    }

    bounceY(): void {
        this.vy = -this.vy;
    }

    addSpin(amount: number): void {
        this.spin += amount;
    }

    reset(x: number, y: number): void {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() > 0.5 ? 1 : -1) * 300;
        this.vy = (Math.random() - 0.5) * 400;
        this.spin = 0;
    }

    intersects(paddle: { x: number; y: number; width: number; height: number }): boolean {
        return this.x - this.radius < paddle.x + paddle.width &&
               this.x + this.radius > paddle.x &&
               this.y - this.radius < paddle.y + paddle.height &&
               this.y + this.radius > paddle.y;
    }

    draw(ctx: CanvasRenderingContext2D): void {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.closePath();
    }
}
`,

    'src/paddle.ts': `// Paddle module
export class Paddle {
    public x: number;
    public y: number;
    public width: number;
    public height: number;
    private speed: number = 400;
    private targetY: number;
    private isAI: boolean = false;

    constructor(x: number, y: number, width: number, height: number) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.targetY = y;
    }

    setAI(enabled: boolean): void {
        this.isAI = enabled;
    }

    setTarget(y: number): void {
        this.targetY = y - this.height / 2;
    }

    moveUp(): void {
        this.targetY -= 20;
    }

    moveDown(): void {
        this.targetY += 20;
    }

    update(deltaTime: number): void {
        // Smooth movement towards target
        const diff = this.targetY - this.y;
        const movement = Math.sign(diff) * Math.min(Math.abs(diff), this.speed * deltaTime);
        this.y += movement;

        // Keep paddle in bounds
        if (this.y < 0) this.y = 0;
        if (this.y + this.height > 600) this.y = 600 - this.height;
    }

    draw(ctx: CanvasRenderingContext2D): void {
        ctx.fillRect(this.x, this.y, this.width, this.height);
    }
}
`,

    'src/scoreboard.ts': `// Scoreboard module
export class ScoreBoard {
    private element: HTMLElement | null;
    private player1Score: number = 0;
    private player2Score: number = 0;
    private matchHistory: Array<{ p1: number; p2: number; winner: string }> = [];

    constructor(elementId: string = 'scoreboard') {
        this.element = document.getElementById(elementId);
    }

    update(p1Score: number, p2Score: number): void {
        this.player1Score = p1Score;
        this.player2Score = p2Score;
        this.render();
    }

    render(): void {
        if (this.element) {
            this.element.innerHTML = \`
                <div class="score">
                    <span class="player1">\${this.player1Score}</span>
                    <span class="separator">-</span>
                    <span class="player2">\${this.player2Score}</span>
                </div>
            \`;
        }
    }

    recordMatch(winner: string): void {
        this.matchHistory.push({
            p1: this.player1Score,
            p2: this.player2Score,
            winner
        });
    }

    getMatchHistory(): Array<{ p1: number; p2: number; winner: string }> {
        return [...this.matchHistory];
    }

    reset(): void {
        this.player1Score = 0;
        this.player2Score = 0;
        this.render();
    }
}
`
};

// 4 iterative edit prompts (like NOBI scenario)
const ITERATIVE_PROMPTS = [
    {
        step: 1,
        name: 'Add power-ups',
        prompt: 'Add a power-up system to the game. Create a new PowerUp class in src/powerup.ts that spawns randomly and when collected by the ball, either speeds up the ball, makes paddles bigger, or adds an extra ball. Update game.ts to spawn and check power-up collisions.',
    },
    {
        step: 2,
        name: 'Add sound effects',
        prompt: 'Add sound effects to the game. When the ball hits a paddle, play a "hit" sound. When a point is scored, play a "score" sound. When a power-up is collected, play a "powerup" sound. Add an AudioManager class and integrate it into the Game class.',
    },
    {
        step: 3,
        name: 'Add AI opponent',
        prompt: 'Improve the AI for player 2 paddle. Make it track the ball with some prediction - it should estimate where the ball will be when it reaches the paddle and move there early. Add difficulty levels (easy, medium, hard) that control reaction time and prediction accuracy.',
    },
    {
        step: 4,
        name: 'Add game modes',
        prompt: 'Add different game modes: Classic (first to 11), Timed (2 minutes, highest score wins), and Survival (one life each, last paddle standing). Add a menu screen to select mode before starting. Update ScoreBoard to show appropriate info for each mode.',
    },
];

async function runIterativeBenchmark() {
    console.log('='.repeat(70));
    console.log('ITERATIVE EDIT BENCHMARK - Full Scale (NOBI Scenario)');
    console.log('='.repeat(70));
    console.log();
    console.log('Scenario: 4 iterative edits on a game codebase (~500 lines)');
    console.log('Target from issue #7: 55%+ token reduction');
    console.log();

    // Calculate initial codebase size
    let totalLines = 0;
    let totalChars = 0;
    for (const content of Object.values(GAME_FILES)) {
        totalLines += content.split('\n').length;
        totalChars += content.length;
    }
    console.log(`Initial codebase: ${Object.keys(GAME_FILES).length} files, ${totalLines} lines, ~${Math.ceil(totalChars/4)} tokens`);
    console.log();

    // === MEGAWRITER MODE (full file rewrites) ===
    console.log('='.repeat(70));
    console.log('MODE 1: MEGAWRITER (Full File Rewrites)');
    console.log('='.repeat(70));
    console.log();

    const megawriterWorkspace = await createWorkspace();
    for (const [filepath, content] of Object.entries(GAME_FILES)) {
        const fullPath = path.join(megawriterWorkspace.path, filepath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content);
    }

    let megawriterTotalTokens = 0;
    let megawriterTotalTime = 0;
    const megawriterResults = [];

    for (const task of ITERATIVE_PROMPTS) {
        console.log(`Step ${task.step}: ${task.name}`);

        const start = performance.now();
        try {
            const result = await megawriterWorkspace.execute(task.prompt, {
                mode: 'static',
                model,
                max_tokens: 8192,
                enableMegawriter: true,
                instruction: 'You are a game developer. Make the requested changes to the codebase. Output all modified files.',
            });

            const tokens = result.tokenCount?.totalTokens || 0;
            const time = performance.now() - start;

            megawriterTotalTokens += tokens;
            megawriterTotalTime += time;
            megawriterResults.push({ step: task.step, tokens, time });

            console.log(`  Tokens: ${tokens}, Time: ${(time/1000).toFixed(1)}s`);
        } catch (error) {
            console.log(`  Error: ${error.message}`);
            megawriterResults.push({ step: task.step, tokens: 0, time: 0, error: true });
        }
    }

    console.log();
    console.log(`MEGAWRITER TOTAL: ${megawriterTotalTokens} tokens, ${(megawriterTotalTime/1000).toFixed(1)}s`);
    console.log();

    // === FILE TOOLS MODE (targeted edits) ===
    console.log('='.repeat(70));
    console.log('MODE 2: FILE TOOLS (Targeted Edits with edit_file)');
    console.log('='.repeat(70));
    console.log();

    const toolsWorkspace = await createWorkspace();
    for (const [filepath, content] of Object.entries(GAME_FILES)) {
        const fullPath = path.join(toolsWorkspace.path, filepath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content);
    }
    clearFileReadTracking();

    let toolsTotalTokens = 0;
    let toolsTotalTime = 0;
    const toolsResults = [];

    for (const task of ITERATIVE_PROMPTS) {
        console.log(`Step ${task.step}: ${task.name}`);
        clearFileReadTracking(); // Reset between steps for fair comparison

        const start = performance.now();
        try {
            const result = await toolsWorkspace.execute(task.prompt, {
                mode: 'static',
                model,
                max_tokens: 8192,
                enableWriteFileTool: true,
                tool_choice: { type: 'auto' },
                instruction: 'You are a game developer. Use read_file to view files, then use edit_file for targeted changes or write_file for new files. Prefer edit_file over rewriting entire files.',
            });

            const tokens = result.tokenCount?.totalTokens || 0;
            const time = performance.now() - start;

            toolsTotalTokens += tokens;
            toolsTotalTime += time;
            toolsResults.push({ step: task.step, tokens, time });

            console.log(`  Tokens: ${tokens}, Time: ${(time/1000).toFixed(1)}s`);
        } catch (error) {
            console.log(`  Error: ${error.message}`);
            toolsResults.push({ step: task.step, tokens: 0, time: 0, error: true });
        }
    }

    console.log();
    console.log(`FILE TOOLS TOTAL: ${toolsTotalTokens} tokens, ${(toolsTotalTime/1000).toFixed(1)}s`);
    console.log();

    // === SUMMARY ===
    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log();

    console.log('Per-Step Comparison:');
    console.log('| Step | Task                 | Megawriter | File Tools | Savings |');
    console.log('|------|----------------------|------------|------------|---------|');
    for (let i = 0; i < ITERATIVE_PROMPTS.length; i++) {
        const mw = megawriterResults[i];
        const ft = toolsResults[i];
        const savings = mw.tokens > 0 ? ((mw.tokens - ft.tokens) / mw.tokens * 100).toFixed(1) : 'N/A';
        console.log(`|  ${mw.step}   | ${ITERATIVE_PROMPTS[i].name.padEnd(20)} | ${String(mw.tokens).padStart(10)} | ${String(ft.tokens).padStart(10)} | ${String(savings + '%').padStart(7)} |`);
    }
    console.log();

    const totalSavings = megawriterTotalTokens > 0
        ? ((megawriterTotalTokens - toolsTotalTokens) / megawriterTotalTokens * 100).toFixed(1)
        : 'N/A';
    const timeSavings = megawriterTotalTime > 0
        ? ((megawriterTotalTime - toolsTotalTime) / megawriterTotalTime * 100).toFixed(1)
        : 'N/A';

    console.log('TOTALS:');
    console.log(`  Megawriter: ${megawriterTotalTokens} tokens, ${(megawriterTotalTime/1000).toFixed(1)}s`);
    console.log(`  File Tools: ${toolsTotalTokens} tokens, ${(toolsTotalTime/1000).toFixed(1)}s`);
    console.log(`  Token Savings: ${totalSavings}%`);
    console.log(`  Time Savings: ${timeSavings}%`);
    console.log();

    // Compare to issue target
    console.log('Comparison to Issue #7 Target:');
    console.log(`  Target: 55%+ reduction`);
    console.log(`  Achieved: ${totalSavings}%`);
    console.log(`  Status: ${parseFloat(totalSavings) >= 55 ? '✓ TARGET MET' : '✗ Below target'}`);
    console.log();

    // Cleanup
    await megawriterWorkspace.delete();
    await toolsWorkspace.delete();

    console.log('='.repeat(70));
    console.log('BENCHMARK COMPLETE');
    console.log('='.repeat(70));
}

runIterativeBenchmark().catch(error => {
    console.error('Benchmark failed:', error);
    process.exit(1);
});
