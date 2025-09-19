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
} from './filetooling.js';

describe('Filetooling', () => {
    let tempDir;
    let originalCwd;
    let progressCallbacks = [];

    // Mock progress callback to track calls
    const mockProgressCallback = (action, message) => {
        progressCallbacks.push({ action, message });
    };

    beforeEach(async () => {
        // Create temporary directory for tests
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sigrid-test-'));
        originalCwd = process.cwd();
        setSandboxRoot(tempDir);
        progressCallbacks = []; // Reset progress callbacks
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
            }, mockProgressCallback);

            expect(result.ok).toBe(true);
            expect(result.path).toBe(testFile);
            expect(result.size).toBe(Buffer.byteLength(testContent, 'utf8'));

            // Verify file exists and has correct content
            const filePath = path.join(tempDir, testFile);
            const fileContent = await fs.readFile(filePath, 'utf8');
            expect(fileContent).toBe(testContent);

            // Verify progress callbacks
            expect(progressCallbacks).toHaveLength(2);
            expect(progressCallbacks[0]).toEqual({ action: 'start', message: 'Writing file...' });
            expect(progressCallbacks[1]).toEqual({ action: 'succeed', message: 'File written successfully' });
        });

        test('handleReadFile reads existing file', async () => {
            const testFile = 'test.txt';
            const testContent = 'Hello, World!';
            
            // Create test file first
            const filePath = path.join(tempDir, testFile);
            await fs.writeFile(filePath, testContent);

            const result = await handleReadFile({
                filepath: testFile
            }, mockProgressCallback);

            expect(result.ok).toBe(true);
            expect(result.path).toBe(testFile);
            expect(result.preview).toBe(testContent);
            expect(result.truncated).toBe(false);

            // Verify progress callbacks
            expect(progressCallbacks).toHaveLength(2);
            expect(progressCallbacks[0]).toEqual({ action: 'start', message: 'Reading file...' });
            expect(progressCallbacks[1]).toEqual({ action: 'succeed', message: 'File read successfully' });
        });

        test('handleListDir lists directory contents', async () => {
            // Create test files
            await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content1');
            await fs.writeFile(path.join(tempDir, 'file2.js'), 'content2');
            await fs.mkdir(path.join(tempDir, 'subdir'));

            const result = await handleListDir({
                dir: '.'
            }, mockProgressCallback);

            expect(result.ok).toBe(true);
            expect(result.entries).toHaveLength(3);
            
            const entryNames = result.entries.map(e => e.name);
            expect(entryNames).toContain('file1.txt');
            expect(entryNames).toContain('file2.js');
            expect(entryNames).toContain('subdir');

            // Verify progress callbacks
            expect(progressCallbacks).toHaveLength(2);
            expect(progressCallbacks[0]).toEqual({ action: 'start', message: 'Listing directory...' });
            expect(progressCallbacks[1]).toEqual({ action: 'succeed', message: 'Directory listed successfully' });
        });

        test('handleWriteFile works without progress callback', async () => {
            const testFile = 'test.txt';
            const testContent = 'Hello, World!';

            const result = await handleWriteFile({
                filepath: testFile,
                content: testContent
            }); // No progress callback

            expect(result.ok).toBe(true);
            expect(result.path).toBe(testFile);
        });

        test('handleWriteFile respects file extension restrictions', async () => {
            const testFile = 'test.exe';  // Not allowed extension
            const testContent = 'Hello, World!';

            await expect(handleWriteFile({
                filepath: testFile,
                content: testContent
            }, mockProgressCallback)).rejects.toThrow('Disallowed file type');

            // Verify progress callbacks include fail
            expect(progressCallbacks).toHaveLength(2);
            expect(progressCallbacks[0]).toEqual({ action: 'start', message: 'Writing file...' });
            expect(progressCallbacks[1].action).toBe('fail');
            expect(progressCallbacks[1].message).toContain('Error writing file');
        });

        test('handleWriteFile creates parent directories when mkdirp is true', async () => {
            const testFile = 'nested/deep/test.txt';
            const testContent = 'Hello, World!';

            const result = await handleWriteFile({
                filepath: testFile,
                content: testContent,
                mkdirp: true
            }, mockProgressCallback);

            expect(result.ok).toBe(true);
            
            // Verify file exists
            const filePath = path.join(tempDir, testFile);
            const fileContent = await fs.readFile(filePath, 'utf8');
            expect(fileContent).toBe(testContent);
        });
    });

    describe('Progress Callback Integration', () => {
        test('progress callback receives correct actions for successful operations', async () => {
            const testFile = 'progress-test.txt';
            const testContent = 'Test content';

            await handleWriteFile({
                filepath: testFile,
                content: testContent
            }, mockProgressCallback);

            expect(progressCallbacks).toEqual([
                { action: 'start', message: 'Writing file...' },
                { action: 'succeed', message: 'File written successfully' }
            ]);
        });

        test('progress callback receives fail action for errors', async () => {
            await expect(handleReadFile({
                filepath: 'nonexistent.txt'
            }, mockProgressCallback)).rejects.toThrow();

            expect(progressCallbacks).toHaveLength(2);
            expect(progressCallbacks[0]).toEqual({ action: 'start', message: 'Reading file...' });
            expect(progressCallbacks[1].action).toBe('fail');
            expect(progressCallbacks[1].message).toContain('Error reading file');
        });
    });

    describe('Sandbox Security', () => {
        test('handleReadFile rejects paths outside sandbox', async () => {
            await expect(handleReadFile({
                filepath: '../outside.txt'
            }, mockProgressCallback)).rejects.toThrow('Access outside sandbox is not allowed');
        });

        test('handleWriteFile rejects paths outside sandbox', async () => {
            await expect(handleWriteFile({
                filepath: '../outside.txt',
                content: 'content'
            }, mockProgressCallback)).rejects.toThrow('Access outside sandbox is not allowed');
        });

        test('handleListDir rejects paths outside sandbox', async () => {
            await expect(handleListDir({
                dir: '../'
            }, mockProgressCallback)).rejects.toThrow('Access outside sandbox is not allowed');
        });
    });

    describe('executeFileTool dispatcher', () => {
        test('executeFileTool dispatches to correct handler with progress callback', async () => {
            const testFile = 'dispatcher.txt';
            const testContent = 'Test content';

            const result = await executeFileTool('write_file', {
                filepath: testFile,
                content: testContent
            }, mockProgressCallback);

            expect(result.ok).toBe(true);
            expect(result.path).toBe(testFile);

            // Verify progress callback was called
            expect(progressCallbacks).toHaveLength(2);
            expect(progressCallbacks[0].action).toBe('start');
            expect(progressCallbacks[1].action).toBe('succeed');
        });

        test('executeFileTool throws error for unknown tool', async () => {
            await expect(executeFileTool('unknown_tool', {}, mockProgressCallback))
                .rejects.toThrow('Unknown tool: unknown_tool');
        });
    });

    describe('Error Handling', () => {
        test('handleReadFile handles non-existent file with progress callback', async () => {
            await expect(handleReadFile({
                filepath: 'nonexistent.txt'
            }, mockProgressCallback)).rejects.toThrow();

            // Verify progress fail callback
            expect(progressCallbacks).toHaveLength(2);
            expect(progressCallbacks[1].action).toBe('fail');
        });

        test('handleWriteFile handles invalid arguments with progress callback', async () => {
            await expect(handleWriteFile({
                filepath: null,
                content: 'content'
            }, mockProgressCallback)).rejects.toThrow("Invalid 'filepath' or 'content'");

            await expect(handleWriteFile({
                filepath: 'test.txt',
                content: null
            }, mockProgressCallback)).rejects.toThrow("Invalid 'filepath' or 'content'");
        });

        test('handleWriteFile respects size limits', async () => {
            const largeContent = 'x'.repeat(300 * 1024); // 300KB > 256KB limit
            
            await expect(handleWriteFile({
                filepath: 'large.txt',
                content: largeContent
            }, mockProgressCallback)).rejects.toThrow('Content too large');
        });
    });
});
