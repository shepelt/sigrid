import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import 'dotenv/config';
import { initializeClient, execute, setSandboxRoot } from './llm.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import * as tar from 'tar';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Code Generation Integration Tests
 * 
 * Tests Sigrid's ability to generate React components using scaffolding.
 * These tests require OPENAI_API_KEY environment variable.
 */
describe('Code Generation Integration Tests', () => {
    const hasApiKey = !!process.env.OPENAI_API_KEY;
    const testFn = hasApiKey ? test : test.skip;
    
    let tempDir;
    let aiRules;
    const scaffoldPath = path.join(__dirname, 'test-fixtures', 'react-scaffold.tar.gz');
    
    beforeAll(async () => {
        if (hasApiKey) {
            initializeClient(process.env.OPENAI_API_KEY);
            
            // Create temporary directory for test project
            tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sigrid-react-'));
            
            // Extract scaffold
            console.log(`Extracting scaffold to: ${tempDir}`);
            await tar.x({
                file: scaffoldPath,
                cwd: tempDir,
                strip: 1
            });
            
            setSandboxRoot(tempDir);
            console.log(`Test project ready at: ${tempDir}`);
            
            // Install dependencies
            console.log('Installing dependencies...');
            execSync('npm install', {
                cwd: tempDir,
                stdio: 'inherit'
            });
            console.log('✓ Dependencies installed');
            
            // Read AI_RULES.md from scaffold
            const aiRulesPath = path.join(tempDir, 'AI_RULES.md');
            aiRules = await fs.readFile(aiRulesPath, 'utf-8');
            console.log('✓ AI_RULES.md loaded');
        }
    }, 60000); // 60 second timeout for setup
    
    afterAll(async () => {
        // Cleanup temporary directory
        if (tempDir) {
            if (process.env.KEEP_TEST_DIR) {
                console.log(`\n⚠️  Test directory preserved at: ${tempDir}`);
                console.log(`To run the app manually:`);
                console.log(`  cd ${tempDir}`);
                console.log(`  npm run dev`);
                console.log(`\nTo build:`);
                console.log(`  cd ${tempDir}`);
                console.log(`  npm run build`);
                console.log(`\nTo clean up later:`);
                console.log(`  rm -rf ${tempDir}\n`);
            } else {
                console.log(`Cleaning up: ${tempDir}`);
                await fs.rm(tempDir, { recursive: true, force: true });
            }
        }
    });
    
    if (!hasApiKey) {
        test('skipping code generation tests - no OPENAI_API_KEY', () => {
            console.log('ℹ️  Set OPENAI_API_KEY to run code generation tests');
            expect(true).toBe(true);
        });
    }
    
    describe('React Component Generation', () => {
        testFn('should generate a simple Button component', async () => {
            const result = await execute(
                'Create a Button component in src/components/Button.tsx. ' +
                'It should accept children and onClick props.',
                {
                    instructions: [
                        aiRules,
                        'You are a React expert',
                        'Create a reusable Button component'
                    ],
                    model: 'gpt-4o-mini'
                }
            );
            
            const buttonPath = path.join(tempDir, 'src', 'components', 'Button.tsx');
            const exists = await fs.access(buttonPath).then(() => true).catch(() => false);
            
            if (!exists) {
                console.log('❌ Button component not created');
                console.log('LLM Response:', result.content);
            }
            expect(exists).toBe(true);
            
            if (exists) {
                const content = await fs.readFile(buttonPath, 'utf-8');
                try {
                    expect(content).toMatch(/export/i);
                    expect(content).toMatch(/button/i);
                    expect(content).toContain('onClick');
                    expect(content).toMatch(/interface|type/i);
                    expect(content).toMatch(/className/);
                } catch (err) {
                    console.log('❌ Validation failed. Generated component:\n', content);
                    throw err;
                }
            }
        }, 60000);
        
        testFn('should generate a component with state', async () => {
            const result = await execute(
                'Create a Counter component in src/components/Counter.tsx with increment and decrement buttons.',
                {
                    instructions: [
                        aiRules,
                        'Use useState hook'
                    ],
                    model: 'gpt-4o-mini'
                }
            );
            
            const counterPath = path.join(tempDir, 'src', 'components', 'Counter.tsx');
            const exists = await fs.access(counterPath).then(() => true).catch(() => false);
            
            if (!exists) {
                console.log('❌ Counter component not created');
                console.log('LLM Response:', result.content);
            }
            expect(exists).toBe(true);
            
            if (exists) {
                const content = await fs.readFile(counterPath, 'utf-8');
                try {
                    expect(content).toMatch(/useState/);
                    expect(content).toMatch(/increment|decrement/i);
                } catch (err) {
                    console.log('❌ Validation failed. Generated component:\n', content);
                    throw err;
                }
            }
        }, 60000);
        
        testFn('should read existing files and create related component', async () => {
            await fs.mkdir(path.join(tempDir, 'src', 'components'), { recursive: true });
            await fs.writeFile(
                path.join(tempDir, 'src', 'components', 'Card.tsx'),
                `interface CardProps {
  title: string;
  children: React.ReactNode;
}

export default function Card({ title, children }: CardProps) {
  return (
    <div className="rounded-lg border p-4">
      <h2 className="text-xl font-bold">{title}</h2>
      <div>{children}</div>
    </div>
  );
}`
            );
            
            const result = await execute(
                'Read the Card component and create a CardList component in src/components/CardList.tsx that renders multiple Cards.',
                {
                    instructions: [
                        aiRules,
                        'Use the existing Card component',
                        'Accept an array of items as props'
                    ],
                    model: 'gpt-4o-mini'
                }
            );
            
            const cardListPath = path.join(tempDir, 'src', 'components', 'CardList.tsx');
            const exists = await fs.access(cardListPath).then(() => true).catch(() => false);
            
            if (!exists) {
                console.log('❌ CardList component not created');
                console.log('LLM Response:', result.content);
            }
            expect(exists).toBe(true);
            
            if (exists) {
                const content = await fs.readFile(cardListPath, 'utf-8');
                try {
                    expect(content).toMatch(/import.*Card/);
                    expect(content).toMatch(/export/);
                } catch (err) {
                    console.log('❌ Validation failed. Generated component:\n', content);
                    throw err;
                }
            }
        }, 60000);
    });
    
    describe('File Structure Operations', () => {
        testFn('should list project structure', async () => {
            const result = await execute(
                'List all files in the src directory',
                {
                    instructions: [aiRules],
                    model: 'gpt-4o-mini'
                }
            );
            
            expect(result.content.toLowerCase()).toMatch(/src|main|app/);
        }, 30000);
        
        testFn('should read and summarize package.json', async () => {
            const result = await execute(
                'Read package.json and tell me what main dependencies are used',
                {
                    instructions: [aiRules],
                    model: 'gpt-4o-mini'
                }
            );
            
            expect(result.content.toLowerCase()).toMatch(/react|vite/);
        }, 60000); // Increased timeout to 60s
    });
    
    describe('Full App Integration', () => {
        testFn('should create TodoList page and integrate it into the app', async () => {
            console.log('\n=== Full App Integration Test ===\n');
            const startTime = Date.now();
            
            // Step 1: Create the Todo List page
            console.log('[Step 1/4] Creating TodoList page...');
            const step1Start = Date.now();
            const createPageResult = await execute(
                'Create a Todo List page in src/pages/TodoList.tsx with the following features:\n' +
                '- Display a list of todos\n' +
                '- Add new todo with an input field and button\n' +
                '- Mark todos as complete/incomplete with checkbox\n' +
                '- Delete todos with a delete button',
                {
                    instructions: [
                        aiRules,
                        'Create a fully functional Todo List page',
                        'Use React hooks (useState) for state management',
                        'Make it visually appealing with good UX'
                    ],
                    model: 'gpt-4o-mini'
                }
            );
            
            const todoPath = path.join(tempDir, 'src', 'pages', 'TodoList.tsx');
            const pageExists = await fs.access(todoPath).then(() => true).catch(() => false);
            
            if (!pageExists) {
                console.log('❌ Step 1 failed: TodoList page not created');
                console.log('LLM Response:', createPageResult.content);
            }
            expect(pageExists).toBe(true);
            
            if (pageExists) {
                const content = await fs.readFile(todoPath, 'utf-8');
                try {
                    expect(content).toMatch(/export/i);
                    expect(content).toMatch(/todo/i);
                    expect(content).toMatch(/useState/i);
                    expect(content).toMatch(/add|create/i);
                    expect(content).toMatch(/delete|remove/i);
                    expect(content).toMatch(/complete|check|toggle/i);
                    expect(content).toMatch(/interface|type/i);
                    const step1Time = ((Date.now() - step1Start) / 1000).toFixed(1);
                    console.log(`✓ TodoList page created (${content.length} chars) [${step1Time}s]`);
                } catch (err) {
                    console.log('❌ TodoList validation failed. Content:\n', content);
                    throw err;
                }
            }
            
            // Step 2: Add route to App.tsx
            console.log('[Step 2/4] Adding route to App.tsx...');
            const step2Start = Date.now();
            const addRouteResult = await execute(
                'Read src/App.tsx and add a new route for the TodoList page at /todos. ' +
                'Import the TodoList component and add it to the router configuration.',
                {
                    instructions: [
                        aiRules,
                        'Update the existing App.tsx file',
                        'Add the route following the existing route pattern',
                        'Keep all existing routes intact'
                    ],
                    model: 'gpt-4o-mini'
                }
            );
            
            const appPath = path.join(tempDir, 'src', 'App.tsx');
            const appExists = await fs.access(appPath).then(() => true).catch(() => false);
            expect(appExists).toBe(true);
            
            if (appExists) {
                const appContent = await fs.readFile(appPath, 'utf-8');
                try {
                    expect(appContent).toMatch(/import.*TodoList/i);
                    expect(appContent).toMatch(/\/todos/i);
                    expect(appContent).toMatch(/<Route.*path.*=.*["']\/todos["']/i);
                    const step2Time = ((Date.now() - step2Start) / 1000).toFixed(1);
                    console.log(`✓ Route added to App.tsx [${step2Time}s]`);
                } catch (err) {
                    console.log('❌ Step 2 failed. Modified App.tsx:\n', appContent);
                    throw err;
                }
            }
            
            // Step 3: Update Index page
            console.log('[Step 3/4] Adding navigation link to Index page...');
            const step3Start = Date.now();
            const updateIndexResult = await execute(
                'Read src/pages/Index.tsx and add a navigation link or button to the TodoList page (/todos). ' +
                'Make it prominent and easy to find on the page.',
                {
                    instructions: [
                        aiRules,
                        'Add a link or button to navigate to /todos',
                        'Use React Router Link component',
                        'Make it visually appealing'
                    ],
                    model: 'gpt-4o-mini'
                }
            );
            
            const indexPath = path.join(tempDir, 'src', 'pages', 'Index.tsx');
            const indexExists = await fs.access(indexPath).then(() => true).catch(() => false);
            expect(indexExists).toBe(true);
            
            if (indexExists) {
                const indexContent = await fs.readFile(indexPath, 'utf-8');
                try {
                    expect(indexContent).toMatch(/\/todos/i);
                    expect(indexContent).toMatch(/Link|to=|href=/i);
                    const step3Time = ((Date.now() - step3Start) / 1000).toFixed(1);
                    console.log(`✓ Navigation link added to Index page [${step3Time}s]`);
                } catch (err) {
                    console.log('❌ Step 3 failed. Modified Index.tsx:\n', indexContent);
                    throw err;
                }
            }
            
            // Step 4: Build verification
            console.log('[Step 4/4] Verifying build...');
            const step4Start = Date.now();
            try {
                execSync('npm run build', {
                    cwd: tempDir,
                    stdio: 'pipe',
                    timeout: 60000
                });
                const step4Time = ((Date.now() - step4Start) / 1000).toFixed(1);
                console.log(`✓ Build successful! [${step4Time}s]`);
                
                const distPath = path.join(tempDir, 'dist');
                const distExists = await fs.access(distPath).then(() => true).catch(() => false);
                expect(distExists).toBe(true);
                
                if (distExists) {
                    const indexHtmlPath = path.join(distPath, 'index.html');
                    const indexHtmlExists = await fs.access(indexHtmlPath).then(() => true).catch(() => false);
                    expect(indexHtmlExists).toBe(true);
                    console.log('✓ dist/index.html generated');
                }
            } catch (buildError) {
                console.error('\n❌ Build failed:');
                const stdout = buildError.stdout?.toString();
                const stderr = buildError.stderr?.toString();
                
                if (stdout) {
                    console.error('\nSTDOUT:');
                    console.error(stdout);
                }
                if (stderr) {
                    console.error('\nSTDERR:');
                    console.error(stderr);
                }
                if (!stdout && !stderr) {
                    console.error('\nError:', buildError.message);
                }
                
                // Also show the generated files for debugging
                console.error('\n--- Generated TodoList.tsx ---');
                const todoContent = await fs.readFile(todoPath, 'utf-8');
                console.error(todoContent);
                
                console.error('\n--- Modified App.tsx ---');
                const appContent = await fs.readFile(appPath, 'utf-8');
                console.error(appContent);
                
                throw new Error('Vite build failed: Generated code has compilation errors');
            }
            
            const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log('\n=== Test Complete ===');
            console.log('✓ Full app integration successful');
            console.log(`✓ Production build passes [Total: ${totalTime}s]\n`);
            
        }, 180000);
    });
    
    describe('Component Syntax Validation', () => {
        testFn('should generate syntactically valid TSX', async () => {
            await execute(
                'Create a simple HelloWorld component in src/components/HelloWorld.tsx',
                {
                    instructions: [
                        aiRules,
                        'Use functional component'
                    ],
                    model: 'gpt-4o-mini'
                }
            );
            
            const helloPath = path.join(tempDir, 'src', 'components', 'HelloWorld.tsx');
            const content = await fs.readFile(helloPath, 'utf-8');
            
            expect(content).toMatch(/export/);
            expect(content).toMatch(/function|const.*=.*\(/);
            expect(content).toMatch(/return/);
            
            const openBrackets = (content.match(/{/g) || []).length;
            const closeBrackets = (content.match(/}/g) || []).length;
            expect(openBrackets).toBe(closeBrackets);
            
            const openParens = (content.match(/\(/g) || []).length;
            const closeParens = (content.match(/\)/g) || []).length;
            expect(openParens).toBe(closeParens);
        }, 60000);
    });
});
