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
    handleWriteMultipleFiles,
    handleEditFile,
    executeFileTool,
    readFileTool,
    listDirTool,
    writeFileTool,
    megaWriterTool,
    editFileTool,
    fileTools,
    clearFileReadTracking
} from '../filetooling.js';

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
        clearFileReadTracking(); // Reset file read tracking
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
            expect(fileTools).toHaveLength(4);
            expect(fileTools).toContain(readFileTool);
            expect(fileTools).toContain(listDirTool);
            // megaWriterTool replaces writeFileTool for flexibility (Issue #6)
            expect(fileTools).toContain(megaWriterTool);
            // editFileTool added for Issue #7
            expect(fileTools).toContain(editFileTool);
        });

        test('editFileTool has correct structure', () => {
            expect(editFileTool).toHaveProperty('type', 'function');
            expect(editFileTool).toHaveProperty('name', 'edit_file');
            expect(editFileTool).toHaveProperty('description');
            expect(editFileTool.parameters.required).toContain('filepath');
            expect(editFileTool.parameters.required).toContain('old_string');
            expect(editFileTool.parameters.required).toContain('new_string');
            expect(editFileTool.parameters.properties).toHaveProperty('replace_all');
        });

        test('megaWriterTool has correct structure with summary field', () => {
            expect(megaWriterTool).toHaveProperty('type', 'function');
            expect(megaWriterTool).toHaveProperty('name', 'write_multiple_files');
            expect(megaWriterTool).toHaveProperty('description');
            expect(megaWriterTool).toHaveProperty('parameters');

            // Verify summary field is in schema
            const fileItemProps = megaWriterTool.parameters.properties.files.items.properties;
            expect(fileItemProps).toHaveProperty('filepath');
            expect(fileItemProps).toHaveProperty('content');
            expect(fileItemProps).toHaveProperty('summary');
            expect(fileItemProps.summary.description).toContain('Brief description');

            // Verify summary is optional (not in required array)
            const required = megaWriterTool.parameters.properties.files.items.required;
            expect(required).toContain('filepath');
            expect(required).toContain('content');
            expect(required).not.toContain('summary');
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

        test('handleReadFile reads existing file with line numbers', async () => {
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
            // Content now includes line numbers (cat -n format)
            expect(result.content).toBe('1| Hello, World!');
            expect(result.totalLines).toBe(1);
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

    describe('Write Multiple Files', () => {
        test('handleWriteMultipleFiles creates multiple files', async () => {
            const files = [
                { filepath: 'file1.txt', content: 'content1' },
                { filepath: 'file2.js', content: 'content2' }
            ];

            const result = await handleWriteMultipleFiles(
                { files },
                mockProgressCallback,
                tempDir
            );

            expect(result.ok).toBe(true);
            expect(result.filesWritten).toBe(2);
            expect(result.filesFailed).toBe(0);
            expect(result.totalFiles).toBe(2);

            // Verify files exist
            const file1 = await fs.readFile(path.join(tempDir, 'file1.txt'), 'utf-8');
            const file2 = await fs.readFile(path.join(tempDir, 'file2.js'), 'utf-8');
            expect(file1).toBe('content1');
            expect(file2).toBe('content2');
        });

        test('handleWriteMultipleFiles emits FILE_STREAMING_START with summary', async () => {
            const fileStreamingEvents = [];
            const trackingCallback = (event, data) => {
                if (event === 'FILE_STREAMING_START') {
                    fileStreamingEvents.push(data);
                }
            };

            const files = [
                {
                    filepath: 'component.tsx',
                    content: 'export default function Component() {}',
                    summary: 'Created reusable button component'
                },
                {
                    filepath: 'util.ts',
                    content: 'export const util = () => {}',
                    summary: 'Added utility function'
                },
                {
                    filepath: 'no-summary.ts',
                    content: 'export const test = () => {}'
                    // No summary field
                }
            ];

            await handleWriteMultipleFiles(
                { files },
                trackingCallback,
                tempDir
            );

            // Verify FILE_STREAMING_START events
            expect(fileStreamingEvents).toHaveLength(3);

            // First file with summary
            expect(fileStreamingEvents[0]).toEqual({
                path: 'component.tsx',
                action: 'write',
                summary: 'Created reusable button component'
            });

            // Second file with summary
            expect(fileStreamingEvents[1]).toEqual({
                path: 'util.ts',
                action: 'write',
                summary: 'Added utility function'
            });

            // Third file without summary
            expect(fileStreamingEvents[2]).toEqual({
                path: 'no-summary.ts',
                action: 'write'
            });
            expect(fileStreamingEvents[2]).not.toHaveProperty('summary');
        });

        test('handleWriteMultipleFiles works without progress callback', async () => {
            const files = [
                { filepath: 'file1.txt', content: 'content1' }
            ];

            const result = await handleWriteMultipleFiles(
                { files },
                null, // No callback
                tempDir
            );

            expect(result.ok).toBe(true);
            expect(result.filesWritten).toBe(1);
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

    describe('Edit File Operations', () => {
        test('handleEditFile performs exact string replacement', async () => {
            const testFile = 'edit-test.txt';
            const filePath = path.join(tempDir, testFile);
            await fs.writeFile(filePath, 'Hello World\nGoodbye World\n');

            // Read first (required for staleness tracking)
            await handleReadFile({ filepath: testFile });

            const result = await handleEditFile({
                filepath: testFile,
                old_string: 'Hello World',
                new_string: 'Hi World'
            }, mockProgressCallback);

            expect(result.ok).toBe(true);
            expect(result.replacements).toBe(1);
            expect(result.matchStrategy).toBe('exact');

            const content = await fs.readFile(filePath, 'utf-8');
            expect(content).toBe('Hi World\nGoodbye World\n');
        });

        test('handleEditFile requires read before edit', async () => {
            const testFile = 'edit-test.txt';
            const filePath = path.join(tempDir, testFile);
            await fs.writeFile(filePath, 'Hello World\n');

            // Don't read first - should fail
            await expect(handleEditFile({
                filepath: testFile,
                old_string: 'Hello',
                new_string: 'Hi'
            }, mockProgressCallback)).rejects.toThrow('File must be read before editing');
        });

        test('handleEditFile detects stale file', async () => {
            const testFile = 'edit-test.txt';
            const filePath = path.join(tempDir, testFile);
            await fs.writeFile(filePath, 'Original content\n');

            // Read file
            await handleReadFile({ filepath: testFile });

            // Wait and externally modify
            await new Promise(r => setTimeout(r, 10));
            await fs.writeFile(filePath, 'Modified externally\n');

            // Try to edit - should fail due to staleness
            await expect(handleEditFile({
                filepath: testFile,
                old_string: 'Original',
                new_string: 'New'
            }, mockProgressCallback)).rejects.toThrow('has been modified since it was last read');
        });

        test('handleEditFile allows consecutive edits without re-read', async () => {
            const testFile = 'edit-test.txt';
            const filePath = path.join(tempDir, testFile);
            await fs.writeFile(filePath, 'aaa bbb ccc\n');

            await handleReadFile({ filepath: testFile });

            // First edit
            const r1 = await handleEditFile({
                filepath: testFile,
                old_string: 'aaa',
                new_string: 'xxx'
            });
            expect(r1.ok).toBe(true);

            // Second edit without re-read (should work - tracking is updated after edit)
            const r2 = await handleEditFile({
                filepath: testFile,
                old_string: 'bbb',
                new_string: 'yyy'
            });
            expect(r2.ok).toBe(true);

            const content = await fs.readFile(filePath, 'utf-8');
            expect(content).toBe('xxx yyy ccc\n');
        });

        test('handleEditFile rejects multiple matches without replace_all', async () => {
            const testFile = 'edit-test.txt';
            const filePath = path.join(tempDir, testFile);
            await fs.writeFile(filePath, 'foo bar foo baz foo\n');

            await handleReadFile({ filepath: testFile });

            await expect(handleEditFile({
                filepath: testFile,
                old_string: 'foo',
                new_string: 'qux'
            })).rejects.toThrow('matches 3 locations');
        });

        test('handleEditFile replaces all with replace_all flag', async () => {
            const testFile = 'edit-test.txt';
            const filePath = path.join(tempDir, testFile);
            await fs.writeFile(filePath, 'foo bar foo baz foo\n');

            await handleReadFile({ filepath: testFile });

            const result = await handleEditFile({
                filepath: testFile,
                old_string: 'foo',
                new_string: 'qux',
                replace_all: true
            });

            expect(result.ok).toBe(true);
            expect(result.replacements).toBe(3);

            const content = await fs.readFile(filePath, 'utf-8');
            expect(content).toBe('qux bar qux baz qux\n');
        });
    });

    describe('Fuzzy Matching', () => {
        test('line-trimmed matching handles whitespace differences', async () => {
            const testFile = 'fuzzy-test.txt';
            const filePath = path.join(tempDir, testFile);
            // File has extra whitespace
            await fs.writeFile(filePath, '    function greet() {   \n        console.log("hi");   \n    }  \n');

            await handleReadFile({ filepath: testFile });

            // Search without whitespace
            const result = await handleEditFile({
                filepath: testFile,
                old_string: 'function greet() {\nconsole.log("hi");\n}',
                new_string: 'function greet() {\n    console.log("hello");\n}'
            });

            expect(result.ok).toBe(true);
            expect(result.matchStrategy).toBe('line-trimmed');
        });

        test('indentation-flexible matching handles indent differences', async () => {
            const testFile = 'fuzzy-test.txt';
            const filePath = path.join(tempDir, testFile);
            // File has 8-space indent
            await fs.writeFile(filePath, '        const x = 1;\n        const y = 2;\n');

            await handleReadFile({ filepath: testFile });

            // Search with no indent
            const result = await handleEditFile({
                filepath: testFile,
                old_string: 'const x = 1;\nconst y = 2;',
                new_string: 'const a = 1;\nconst b = 2;'
            });

            expect(result.ok).toBe(true);
            // Either line-trimmed or indentation-flexible will match
            expect(['line-trimmed', 'indentation-flexible']).toContain(result.matchStrategy);
        });

        test('whitespace-normalized matching handles collapsed whitespace', async () => {
            const testFile = 'fuzzy-test.txt';
            const filePath = path.join(tempDir, testFile);
            // File has extra internal whitespace
            await fs.writeFile(filePath, 'if (x    ==    y) {\n    doSomething();\n}\n');

            await handleReadFile({ filepath: testFile });

            // Search with normalized whitespace
            const result = await handleEditFile({
                filepath: testFile,
                old_string: 'if (x == y) { doSomething(); }',
                new_string: 'if (x === y) {\n    doSomething();\n}'
            });

            expect(result.ok).toBe(true);
            expect(result.matchStrategy).toBe('whitespace-normalized');
        });
    });

    describe('Read File Line-Based Operations', () => {
        test('handleReadFile supports offset and limit', async () => {
            const testFile = 'multiline.txt';
            const filePath = path.join(tempDir, testFile);
            await fs.writeFile(filePath, 'line1\nline2\nline3\nline4\nline5\n');

            // Read lines 2-3 (offset 1, limit 2)
            const result = await handleReadFile({
                filepath: testFile,
                offset: 1,
                limit: 2
            });

            expect(result.ok).toBe(true);
            expect(result.startLine).toBe(2);
            expect(result.endLine).toBe(3);
            expect(result.content).toContain('line2');
            expect(result.content).toContain('line3');
            expect(result.content).not.toContain('line1');
            expect(result.content).not.toContain('line4');
        });

        test('handleReadFile provides pagination hint for large files', async () => {
            const testFile = 'large.txt';
            const filePath = path.join(tempDir, testFile);
            const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
            await fs.writeFile(filePath, lines);

            const result = await handleReadFile({
                filepath: testFile,
                limit: 10
            });

            expect(result.truncated).toBe(true);
            expect(result.hint).toContain('offset=10');
        });

        test('handleReadFile truncates long lines', async () => {
            const testFile = 'longline.txt';
            const filePath = path.join(tempDir, testFile);
            const longLine = 'x'.repeat(3000); // Longer than MAX_LINE_LENGTH (2000)
            await fs.writeFile(filePath, longLine);

            const result = await handleReadFile({ filepath: testFile });

            expect(result.ok).toBe(true);
            expect(result.content).toContain('...');
            expect(result.content.length).toBeLessThan(3000);
        });
    });

    describe('executeFileTool with edit_file', () => {
        test('executeFileTool dispatches to edit_file handler', async () => {
            const testFile = 'dispatch-test.txt';
            const filePath = path.join(tempDir, testFile);
            await fs.writeFile(filePath, 'original content\n');

            // Read first
            await executeFileTool('read_file', { filepath: testFile });

            const result = await executeFileTool('edit_file', {
                filepath: testFile,
                old_string: 'original',
                new_string: 'modified'
            }, mockProgressCallback);

            expect(result.ok).toBe(true);
            expect(result.replacements).toBe(1);
        });
    });
});
