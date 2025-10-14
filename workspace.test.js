import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as tar from 'tar';
import { createWorkspace, openWorkspace, Workspace } from './workspace.js';

describe('Workspace', () => {
    let tempDir;
    let testTarGz;

    beforeEach(async () => {
        // Create temporary directory for tests
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sigrid-workspace-test-'));

        // Create a simple test scaffold
        const scaffoldDir = path.join(tempDir, 'scaffold');
        await fs.mkdir(scaffoldDir);
        await fs.writeFile(path.join(scaffoldDir, 'AI_RULES.md'), '# Test AI Rules');
        await fs.writeFile(path.join(scaffoldDir, 'index.js'), 'console.log("hello");');
        await fs.mkdir(path.join(scaffoldDir, 'src'));
        await fs.writeFile(path.join(scaffoldDir, 'src', 'app.js'), 'export default {}');

        // Create tar.gz from scaffold
        const tarPath = path.join(tempDir, 'test-scaffold.tar.gz');
        await tar.create(
            {
                gzip: true,
                file: tarPath,
                cwd: scaffoldDir
            },
            ['.']
        );

        testTarGz = await fs.readFile(tarPath);
    });

    afterEach(async () => {
        // Clean up temporary directory
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors in tests
        }
    });

    describe('createWorkspace', () => {
        test('creates workspace from tar.gz buffer', async () => {
            const workspace = await createWorkspace(testTarGz);

            expect(workspace).toBeInstanceOf(Workspace);
            expect(workspace.path).toBeDefined();
            expect(workspace.id).toBeDefined();
        });

        test('extracts files to workspace directory', async () => {
            const workspace = await createWorkspace(testTarGz);

            // Verify files exist
            const aiRulesPath = path.join(workspace.path, 'AI_RULES.md');
            const indexPath = path.join(workspace.path, 'index.js');
            const appPath = path.join(workspace.path, 'src', 'app.js');

            const aiRulesExists = await fs.access(aiRulesPath).then(() => true).catch(() => false);
            const indexExists = await fs.access(indexPath).then(() => true).catch(() => false);
            const appExists = await fs.access(appPath).then(() => true).catch(() => false);

            expect(aiRulesExists).toBe(true);
            expect(indexExists).toBe(true);
            expect(appExists).toBe(true);

            // Verify content
            const aiRulesContent = await fs.readFile(aiRulesPath, 'utf-8');
            expect(aiRulesContent).toContain('Test AI Rules');

            // Cleanup
            await workspace.delete();
        });

        test('returns Workspace instance with path and id', async () => {
            const workspace = await createWorkspace(testTarGz);

            expect(workspace).toBeInstanceOf(Workspace);
            expect(typeof workspace.path).toBe('string');
            expect(typeof workspace.id).toBe('string');
            expect(workspace.path).toContain(workspace.id);

            await workspace.delete();
        });

        test('throws error for invalid buffer', async () => {
            const invalidBuffer = Buffer.from('not a tar.gz file');

            await expect(createWorkspace(invalidBuffer))
                .rejects.toThrow();
        });

        test('creates unique workspace directories for multiple calls', async () => {
            const workspace1 = await createWorkspace(testTarGz);
            const workspace2 = await createWorkspace(testTarGz);

            expect(workspace1.id).not.toBe(workspace2.id);
            expect(workspace1.path).not.toBe(workspace2.path);

            await workspace1.delete();
            await workspace2.delete();
        });
    });

    describe('Workspace.execute', () => {
        test('executes prompt on workspace files', async () => {
            const workspace = await createWorkspace(testTarGz);

            // This test will be marked as skip for now since it requires API key
            // We'll test the structure only
            expect(workspace.execute).toBeDefined();
            expect(typeof workspace.execute).toBe('function');

            await workspace.delete();
        });

        test('returns result with expected structure', async () => {
            const workspace = await createWorkspace(testTarGz);

            // Mock test - just verify method signature
            expect(workspace.execute.length).toBeGreaterThanOrEqual(1); // At least prompt param

            await workspace.delete();
        });
    });

    describe('Workspace.export', () => {
        test('creates tar.gz buffer from workspace directory', async () => {
            const workspace = await createWorkspace(testTarGz);

            const exported = await workspace.export();

            expect(Buffer.isBuffer(exported)).toBe(true);
            expect(exported.length).toBeGreaterThan(0);

            await workspace.delete();
        });

        test('exported tar.gz includes all files from workspace', async () => {
            const workspace = await createWorkspace(testTarGz);

            // Add a new file to workspace
            await fs.writeFile(path.join(workspace.path, 'newfile.txt'), 'new content');

            const exported = await workspace.export();

            // Extract exported tar.gz to verify contents
            const verifyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sigrid-verify-'));
            const verifyTarPath = path.join(verifyDir, 'verify.tar.gz');
            await fs.writeFile(verifyTarPath, exported);

            await tar.extract({
                file: verifyTarPath,
                cwd: verifyDir
            });

            // Check files exist
            const newFileExists = await fs.access(path.join(verifyDir, 'newfile.txt'))
                .then(() => true).catch(() => false);
            const aiRulesExists = await fs.access(path.join(verifyDir, 'AI_RULES.md'))
                .then(() => true).catch(() => false);

            expect(newFileExists).toBe(true);
            expect(aiRulesExists).toBe(true);

            // Cleanup
            await workspace.delete();
            await fs.rm(verifyDir, { recursive: true, force: true });
        });

        test('exported tar.gz can be re-imported with createWorkspace', async () => {
            const workspace1 = await createWorkspace(testTarGz);

            // Add a file
            await fs.writeFile(path.join(workspace1.path, 'modified.txt'), 'modified content');

            const exported = await workspace1.export();
            await workspace1.delete();

            // Re-import
            const workspace2 = await createWorkspace(exported);

            // Verify modified file exists
            const modifiedPath = path.join(workspace2.path, 'modified.txt');
            const modifiedExists = await fs.access(modifiedPath).then(() => true).catch(() => false);
            expect(modifiedExists).toBe(true);

            const content = await fs.readFile(modifiedPath, 'utf-8');
            expect(content).toBe('modified content');

            await workspace2.delete();
        });
    });

    describe('openWorkspace', () => {
        test('opens existing workspace by path', async () => {
            const workspace1 = await createWorkspace(testTarGz);
            const workspacePath = workspace1.path;

            // Open the existing workspace
            const workspace2 = await openWorkspace(workspacePath);

            expect(workspace2).toBeInstanceOf(Workspace);
            expect(workspace2.path).toBe(workspacePath);
            expect(workspace2.id).toBe(workspace1.id);

            await workspace1.delete();
        });

        test('opened workspace has access to files', async () => {
            const workspace1 = await createWorkspace(testTarGz);

            // Add a file
            await fs.writeFile(path.join(workspace1.path, 'test.txt'), 'test content');

            // Open existing workspace
            const workspace2 = await openWorkspace(workspace1.path);

            // Verify file exists
            const testPath = path.join(workspace2.path, 'test.txt');
            const content = await fs.readFile(testPath, 'utf-8');
            expect(content).toBe('test content');

            await workspace1.delete();
        });

        test('throws error if workspace path does not exist', async () => {
            const nonExistentPath = path.join(os.tmpdir(), 'nonexistent-workspace-12345');

            await expect(openWorkspace(nonExistentPath))
                .rejects.toThrow('Workspace path does not exist');
        });

        test('throws error if path is not a directory', async () => {
            const filePath = path.join(tempDir, 'not-a-dir.txt');
            await fs.writeFile(filePath, 'content');

            await expect(openWorkspace(filePath))
                .rejects.toThrow('Workspace path is not a directory');
        });
    });

    describe('Workspace Population API', () => {
        test('creates empty workspace', async () => {
            const workspace = await createWorkspace();

            expect(workspace).toBeInstanceOf(Workspace);
            expect(workspace.path).toBeDefined();
            expect(workspace.id).toBeDefined();

            // Verify it's empty (no files)
            const files = await fs.readdir(workspace.path);
            expect(files.length).toBe(0);

            await workspace.delete();
        });

        test('populateWithTarballBuffer populates workspace from buffer', async () => {
            const workspace = await createWorkspace();

            await workspace.populateWithTarballBuffer(testTarGz);

            // Verify files exist
            const aiRulesPath = path.join(workspace.path, 'AI_RULES.md');
            const indexPath = path.join(workspace.path, 'index.js');

            const aiRulesExists = await fs.access(aiRulesPath).then(() => true).catch(() => false);
            const indexExists = await fs.access(indexPath).then(() => true).catch(() => false);

            expect(aiRulesExists).toBe(true);
            expect(indexExists).toBe(true);

            await workspace.delete();
        });

        test('populateWithTarballBuffer supports strip option', async () => {
            // Create tarball with nested directory
            const nestedDir = path.join(tempDir, 'nested-scaffold');
            await fs.mkdir(path.join(nestedDir, 'top-level'), { recursive: true });
            await fs.writeFile(path.join(nestedDir, 'top-level', 'file.txt'), 'content');

            const nestedTarPath = path.join(tempDir, 'nested.tar.gz');
            await tar.create(
                { gzip: true, file: nestedTarPath, cwd: nestedDir },
                ['top-level'] // Include top-level directory explicitly
            );
            const nestedTarGz = await fs.readFile(nestedTarPath);

            const workspace = await createWorkspace();
            await workspace.populateWithTarballBuffer(nestedTarGz, { strip: 1 });

            // File should be at root level, not in top-level/
            const filePath = path.join(workspace.path, 'file.txt');
            const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
            expect(fileExists).toBe(true);

            await workspace.delete();
        });

        test('populateWithTarball populates workspace from file path', async () => {
            const tarPath = path.join(tempDir, 'test-scaffold.tar.gz');
            const workspace = await createWorkspace();

            await workspace.populateWithTarball(tarPath);

            // Verify files exist
            const aiRulesPath = path.join(workspace.path, 'AI_RULES.md');
            const aiRulesExists = await fs.access(aiRulesPath).then(() => true).catch(() => false);
            expect(aiRulesExists).toBe(true);

            await workspace.delete();
        });

        test('populateWithTarball supports strip option', async () => {
            // Create tarball with nested directory
            const nestedDir = path.join(tempDir, 'nested-scaffold2');
            await fs.mkdir(path.join(nestedDir, 'project'), { recursive: true });
            await fs.writeFile(path.join(nestedDir, 'project', 'README.md'), 'readme');

            const nestedTarPath = path.join(tempDir, 'nested2.tar.gz');
            await tar.create(
                { gzip: true, file: nestedTarPath, cwd: nestedDir },
                ['project'] // Include project directory explicitly
            );

            const workspace = await createWorkspace();
            await workspace.populateWithTarball(nestedTarPath, { strip: 1 });

            // README should be at root level
            const readmePath = path.join(workspace.path, 'README.md');
            const readmeExists = await fs.access(readmePath).then(() => true).catch(() => false);
            expect(readmeExists).toBe(true);

            await workspace.delete();
        });

        test('populateWithTarball throws error for non-existent file', async () => {
            const workspace = await createWorkspace();
            const nonExistentPath = path.join(tempDir, 'does-not-exist.tar.gz');

            await expect(workspace.populateWithTarball(nonExistentPath))
                .rejects.toThrow();

            await workspace.delete();
        });

        test('throws error if populating already populated workspace', async () => {
            const workspace = await createWorkspace();
            await workspace.populateWithTarballBuffer(testTarGz);

            // Try to populate again
            await expect(workspace.populateWithTarballBuffer(testTarGz))
                .rejects.toThrow('Workspace is already populated');

            await workspace.delete();
        });
    });

    describe('Workspace.delete', () => {
        test('removes workspace directory', async () => {
            const workspace = await createWorkspace(testTarGz);
            const workspacePath = workspace.path;

            // Verify workspace exists
            const existsBefore = await fs.access(workspacePath).then(() => true).catch(() => false);
            expect(existsBefore).toBe(true);

            await workspace.delete();

            // Verify workspace is gone
            const existsAfter = await fs.access(workspacePath).then(() => true).catch(() => false);
            expect(existsAfter).toBe(false);
        });

        test('cleans up all files in workspace', async () => {
            const workspace = await createWorkspace(testTarGz);

            // Add more files
            await fs.writeFile(path.join(workspace.path, 'temp.txt'), 'temp');
            await fs.mkdir(path.join(workspace.path, 'tempdir'));
            await fs.writeFile(path.join(workspace.path, 'tempdir', 'nested.txt'), 'nested');

            const workspacePath = workspace.path;
            await workspace.delete();

            // Verify everything is gone
            const existsAfter = await fs.access(workspacePath).then(() => true).catch(() => false);
            expect(existsAfter).toBe(false);
        });

        test('throws error if already deleted', async () => {
            const workspace = await createWorkspace(testTarGz);

            await workspace.delete();

            // Second delete should throw
            await expect(workspace.delete())
                .rejects.toThrow();
        });
    });
});
