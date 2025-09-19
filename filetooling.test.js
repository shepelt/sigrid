import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
    setSandboxRoot,
    getSandboxRoot,
    handleReadFile,
    handleListDir,
    handleWriteFile,
    executeFileTool,
    readFileTool,
    listDirTool,
    writeFileTool,
    fileTools
} from '../filetooling.js';

describe('Filetooling', () => {
    let tempDir;
    let originalCwd;
    let spinnerCallbacks = [];

    // Mock spinner callback to track calls
    const mockSpinnerCallback = (action, message) => {
        spinnerCallbacks.push({ action, message });
    };

    beforeEach(async () => {
        // Create temporary directory for tests
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sigrid-test-'));
        originalCwd = process.cwd();
        setSandboxRoot(tempDir);
        spinnerCallbacks = []; // Reset spinner callbacks
    });

    afterEach(async () => {
        // Clean up temporary directory
        try {
            await fs.rmdir(tempDir, { recursive: true });
        } catch (error) {
            // Ignore cleanup errors in tests
        }
        setSandboxRoot(originalCwd);
    });

    describe('Sandbox Management', () => {
        test('setSandboxRoot and getSandboxRoot work correctly', () => {
            const testPath = '/test/path';
            setSandboxRoot(testPath);
            expect(getSandboxRoot()).toBe(path.resolve(testPath));
        });

        test('getSandboxRoot returns current sandbox root', () => {
            expect(getSandboxRoot()).toBe(path.resolve(tempDir));
        });
    });

    describe('Tool Definitions', () => {
        test('readFileTool has correct structure', () => {
            expect(readFileTool).toHaveProperty('type', 'function');
            expect(readFileTool).toHaveProperty('name', 'read_file');
            expect(readFileTool).toHaveProperty('description');
            expect(readFileTool).toHaveProperty('parameters');
            expect(readFileTool.parameters.required).toContain('filepath');
        });

        test('listDirTool has correct structure', () => {
            expect(listDirTool).toHaveProperty('type', 'function');
            expect(listDirTool).toHaveProperty('name', 'list_dir');
            expect(listDirTool).toHaveProperty('description');
            expect(listDirTool).toHaveProperty('parameters');
        });

        test('writeFileTool has correct structure', () => {
            expect(writeFileTool).toHaveProperty('type', 'function');
            expect(writeFileTool).toHaveProperty('name', 'write_file');
            expect(writeFileTool).toHaveProperty('description');
            expect(writeFileTool.parameters.required).toContain('filepath');
            expect(writeFileTool.parameters.required).toContain('content');
        });

        test('fileTools array contains all tools', () => {
            expect(fileTools).toHaveLength(3);
            expect(fileTools).toContain(readFileTool);
            expect(fileTools).toContain(listDirTool);
            expect(fileTools).toContain(writeFileTool);
        });
    });

    describe('File Operations', () => {
        test('handleWriteFile creates a new file', async () => {
            const testFile = 'test.txt';
            const testContent = 'Hello, World!';

            const result = await handleWriteFile({
                filepath: testFile,
                content: testContent
            }, mockSpinnerCallback);

            expect(result.ok).toBe(true);
            expect(result.path).toBe(testFile);
            expect(result.size).toBe(Buffer.byteLength(testContent, 'utf8'));

            // Verify file exists and has correct content
            const filePath = path.join(tempDir, testFile);
            const fileContent = await fs.readFile(filePath, 'utf8');
            expect(fileContent).toBe(testContent);

            // Verify spinner callbacks
            expect(spinnerCallbacks).toHaveLength(2);
            expect(spinnerCallbacks[0]).toEqual({ action: 'start', message: 'Writing file...' });
            expect(spinnerCallbacks[1]).toEqual({ action: 'succeed', message: 'File written successfully' });
        });

        test('handleReadFile reads existing file', async () => {
            const testFile = 'test.txt';
            const testContent = 'Hello, World!';
            
            // Create test file first
            const filePath = path.join(tempDir, testFile);
            await fs.writeFile(filePath, testContent);

            const result = await handleReadFile({
                filepath: testFile
            }, mockSpinnerCallback);

            expect(result.ok).toBe(true);
            expect(result.path).toBe(testFile);
            expect(result.preview).toBe(testContent);
            expect(result.truncated).toBe(false);

            // Verify spinner callbacks
            expect(spinnerCallbacks).toHaveLength(2);
            expect(spinnerCallbacks[0]).toEqual({ action: 'start', message: 'Reading file...' });
            expect(spinnerCallbacks[1]).toEqual({ action: 'succeed', message: 'File read successfully' });
        });

        test('handleListDir lists directory contents', async () => {
            // Create test files
            await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1');
            await fs.writeFile(path.join(tempDir, 'file2.js'), 'content2');
            await fs.mkdir(path.join(tempDir, 'subdir'));

            const result = await handleListDir({
                dir: '.'
            }, mockSpinnerCallback);

            expect(result.ok).toBe(true);
            expect(result.entries).toHaveLength(3);
            
            const entryNames = result.entries.map(e => e.name);
            expect(entryNames).toContain('file1.txt');
            expect(entryNames).toContain('file2.js');
            expect(entryNames).toContain('subdir');

            // Verify spinner callbacks
            expect(spinnerCallbacks).toHaveLength(2);
            expect(spinnerCallbacks[0]).toEqual({ action: 'start', message: 'Listing directory...' });
            expect(spinnerCallbacks[1]).toEqual({ action: 'succeed', message: 'Directory listed successfully' });
        });

        test('handleWriteFile works without spinner callback', async () => {
            const testFile = 'test.txt';
            const testContent = 'Hello, World!';

            const result = await handleWriteFile({
                filepath: testFile,
                content: testContent
            }); // No spinner callback

            expect(result.ok).toBe(true);
            expect(result.path).toBe(testFile);
        });

        test('handleWriteFile respects file extension restrictions', async () => {
            const testFile = 'test.exe';  // Not allowed extension
            const testContent = 'Hello, World!';

            await expect(handleWriteFile({
                filepath: testFile,
                content: testContent
            }, mockSpinnerCallback)).rejects.toThrow('Disallowed file type');

            // Verify spinner callbacks include fail
            expect(spinnerCallbacks).toHaveLength(2);
            expect(spinnerCallbacks[0]).toEqual({ action: 'start', message: 'Writing file...' });
            expect(spinnerCallbacks[1].action).toBe('fail');
            expect(spinnerCallbacks[1].message).toContain('Error writing file');
        });

        test('handleWriteFile creates parent directories when mkdirp is true', async () => {
            const testFile = 'nested/deep/test.txt';
            const testContent = 'Hello, World!';

            const result = await handleWriteFile({
                filepath: testFile,
                content: testContent,
                mkdirp: true
            }, mockSpinnerCallback);

            expect(result.ok).toBe(true);
            
            // Verify file exists
            const filePath = path.join(tempDir, testFile);
            const fileContent = await fs.readFile(filePath, 'utf8');
            expect(fileContent).toBe(testContent);
        });
    });

    describe('Spinner Callback Integration', () => {
        test('spinner callback receives correct actions for successful operations', async () => {
            const testFile = 'spinner-test.txt';
            const testContent = 'Test content';

            await handleWriteFile({
                filepath: testFile,
                content: testContent
            }, mockSpinnerCallback);

            expect(spinnerCallbacks).toEqual([
                { action: 'start', message: 'Writing file...' },
                { action: 'succeed', message: 'File written successfully' }
            ]);
        });

        test('spinner callback receives fail action for errors', async () => {
            await expect(handleReadFile({
                filepath: 'nonexistent.txt'
            }, mockSpinnerCallback)).rejects.toThrow();

            expect(spinnerCallbacks).toHaveLength(2);
            expect(spinnerCallbacks[0]).toEqual({ action: 'start', message: 'Reading file...' });
            expect(spinnerCallbacks[1].action).toBe('fail');
            expect(spinnerCallbacks[1].message).toContain('Error reading file');
        });
    });

    describe('Sandbox Security', () => {
        test('handleReadFile rejects paths outside sandbox', async () => {
            await expect(handleReadFile({
                filepath: '../outside.txt'
            }, mockSpinnerCallback)).rejects.toThrow('Access outside sandbox is not allowed');
        });

        test('handleWriteFile rejects paths outside sandbox', async () => {
            await expect(handleWriteFile({
                filepath: '../outside.txt',
                content: 'content'
            }, mockSpinnerCallback)).rejects.toThrow('Access outside sandbox is not allowed');
        });

        test('handleListDir rejects paths outside sandbox', async () => {
            await expect(handleListDir({
                dir: '../'
            }, mockSpinnerCallback)).rejects.toThrow('Access outside sandbox is not allowed');
        });
    });

    describe('executeFileTool dispatcher', () => {
        test('executeFileTool dispatches to correct handler with spinner', async () => {
            const testFile = 'dispatcher.txt';
            const testContent = 'Test content';

            const result = await executeFileTool('write_file', {
                filepath: testFile,
                content: testContent
            }, mockSpinnerCallback);

            expect(result.ok).toBe(true);
            expect(result.path).toBe(testFile);

            // Verify spinner was called
            expect(spinnerCallbacks).toHaveLength(2);
            expect(spinnerCallbacks[0].action).toBe('start');
            expect(spinnerCallbacks[1].action).toBe('succeed');
        });

        test('executeFileTool throws error for unknown tool', async () => {
            await expect(executeFileTool('unknown_tool', {}, mockSpinnerCallback))
                .rejects.toThrow('Unknown tool: unknown_tool');
        });
    });

    describe('Error Handling', () => {
        test('handleReadFile handles non-existent file with spinner', async () => {
            await expect(handleReadFile({
                filepath: 'nonexistent.txt'
            }, mockSpinnerCallback)).rejects.toThrow();

            // Verify spinner fail callback
            expect(spinnerCallbacks).toHaveLength(2);
            expect(spinnerCallbacks[1].action).toBe('fail');
        });

        test('handleWriteFile handles invalid arguments with spinner', async () => {
            await expect(handleWriteFile({
                filepath: null,
                content: 'content'
            }, mockSpinnerCallback)).rejects.toThrow("Invalid 'filepath' or 'content'");

            await expect(handleWriteFile({
                filepath: 'test.txt',
                content: null
            }, mockSpinnerCallback)).rejects.toThrow("Invalid 'filepath' or 'content'");
        });

        test('handleWriteFile respects size limits', async () => {
            const largeContent = 'x'.repeat(300 * 1024); // 300KB > 256KB limit
            
            await expect(handleWriteFile({
                filepath: 'large.txt',
                content: largeContent
            }, mockSpinnerCallback)).rejects.toThrow('Content too large');
        });
    });
});
