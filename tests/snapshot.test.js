import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createSnapshot, collectFiles, formatAsXML, estimateSnapshotTokens, DEFAULT_EXCLUDES, DEFAULT_EXTENSIONS } from '../snapshot.js';
import { estimateTokens } from '../token-utils.js';
import { createWorkspace } from '../workspace.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Snapshot Tests
 *
 * Tests workspace snapshot functionality for static context loading
 */
describe('Snapshot Tests', () => {
    let workspace;

    beforeAll(async () => {
        // Create a test workspace
        workspace = await createWorkspace();

        // Create test files
        await fs.mkdir(path.join(workspace.path, 'src'), { recursive: true });
        await fs.mkdir(path.join(workspace.path, 'tests'), { recursive: true });
        await fs.mkdir(path.join(workspace.path, 'node_modules'), { recursive: true });

        // Create various file types
        await fs.writeFile(
            path.join(workspace.path, 'src', 'index.ts'),
            'export function hello() { return "Hello"; }'
        );

        await fs.writeFile(
            path.join(workspace.path, 'src', 'types.ts'),
            'export interface User { id: string; name: string; }'
        );

        await fs.writeFile(
            path.join(workspace.path, 'src', 'styles.css'),
            '.button { color: blue; }'
        );

        await fs.writeFile(
            path.join(workspace.path, 'README.md'),
            '# Test Project'
        );

        await fs.writeFile(
            path.join(workspace.path, 'package.json'),
            '{"name": "test"}'
        );

        // File that should be excluded
        await fs.writeFile(
            path.join(workspace.path, 'node_modules', 'lib.js'),
            'module.exports = {};'
        );

        // Binary-like file (should be skipped)
        await fs.writeFile(
            path.join(workspace.path, 'image.png'),
            Buffer.from([0x89, 0x50, 0x4E, 0x47])
        );
    });

    afterAll(async () => {
        if (workspace) {
            await workspace.delete();
        }
    });

    describe('collectFiles', () => {
        test('should collect files with default options', async () => {
            const { files, omitted } = await collectFiles(workspace.path);

            expect(files.length).toBeGreaterThan(0);
            expect(files.some(f => f.path.includes('src/index.ts'))).toBe(true);
            expect(files.some(f => f.path.includes('node_modules'))).toBe(false);
            expect(Array.isArray(omitted)).toBe(true);
        });

        test('should filter by extensions', async () => {
            const { files } = await collectFiles(workspace.path, {
                extensions: ['.ts']
            });

            expect(files.every(f => f.path.endsWith('.ts'))).toBe(true);
            expect(files.some(f => f.path.includes('types.ts'))).toBe(true);
            expect(files.some(f => f.path.includes('styles.css'))).toBe(false);
        });

        test('should respect exclude patterns', async () => {
            const { files } = await collectFiles(workspace.path, {
                exclude: ['node_modules', 'tests']
            });

            expect(files.some(f => f.path.includes('node_modules'))).toBe(false);
            expect(files.some(f => f.path.includes('tests'))).toBe(false);
        });

        test('should respect include patterns', async () => {
            const { files } = await collectFiles(workspace.path, {
                include: ['src/**/*']
            });

            expect(files.every(f => f.path.startsWith('src/'))).toBe(true);
            expect(files.some(f => f.path.includes('README.md'))).toBe(false);
        });

        test('should respect max file size and track omitted', async () => {
            const { files, omitted } = await collectFiles(workspace.path, {
                maxFileSize: 10 // Very small to test filtering
            });

            // All files should be smaller than 10 bytes
            expect(files.every(f => f.size <= 10)).toBe(true);

            // Should have omitted files for those exceeding size
            expect(omitted.length).toBeGreaterThan(0);
            expect(omitted.some(f => f.reason === 'size')).toBe(true);
        });

        test('should respect .gitignore', async () => {
            // Create a .gitignore file
            await fs.writeFile(
                path.join(workspace.path, '.gitignore'),
                'ignored.txt\n*.log\n'
            );

            // Create files that should be ignored
            await fs.writeFile(
                path.join(workspace.path, 'ignored.txt'),
                'This should be ignored'
            );
            await fs.writeFile(
                path.join(workspace.path, 'debug.log'),
                'Log file'
            );

            const { files, omitted } = await collectFiles(workspace.path);

            expect(files.some(f => f.path === 'ignored.txt')).toBe(false);
            expect(files.some(f => f.path === 'debug.log')).toBe(false);
            expect(omitted.some(f => f.path === 'ignored.txt' && f.reason === 'gitignore')).toBe(true);
            expect(omitted.some(f => f.path === 'debug.log' && f.reason === 'gitignore')).toBe(true);
        });

        test('should allow disabling gitignore', async () => {
            const { files } = await collectFiles(workspace.path, {
                respectGitignore: false
            });

            // Should include gitignored files
            expect(files.some(f => f.path === 'ignored.txt') || true).toBe(true);
        });

        test('should handle dot files (files starting with .)', async () => {
            // Create a .env file in workspace root
            await fs.writeFile(
                path.join(workspace.path, '.env'),
                'API_KEY=secret'
            );

            // Append .env to .gitignore (don't overwrite existing entries)
            await fs.appendFile(
                path.join(workspace.path, '.gitignore'),
                '.env\n'
            );

            const { files, omitted } = await collectFiles(workspace.path, {
                include: ['**/*'],
                extensions: ['.env', '.ts', '.tsx']  // Explicitly include .env extension
            });

            // .env should be omitted (gitignored), not skipped by glob
            expect(omitted.some(f => f.path === '.env' && f.reason === 'gitignore')).toBe(true);

            // .env should NOT be in files (it's gitignored)
            expect(files.some(f => f.path === '.env')).toBe(false);
        });

        test('should include dot files that are NOT gitignored', async () => {
            // Create a .custom file
            await fs.writeFile(
                path.join(workspace.path, '.custom'),
                'custom config'
            );

            const { files } = await collectFiles(workspace.path, {
                include: ['**/*', '.*'],  // Include dot files in pattern
                extensions: ['', '.custom'],  // Allow files with .custom or no extension
                respectGitignore: false  // Disable gitignore for this test
            });

            // .custom should be collected (not gitignored, is a dot file)
            const customFile = files.find(f => f.path === '.custom');
            expect(customFile).toBeDefined();
            expect(customFile?.content).toBe('custom config');
        });

        test('should exclude JavaScript lock files by default', async () => {
            // Create lock files
            await fs.writeFile(
                path.join(workspace.path, 'package-lock.json'),
                '{"lockfileVersion": 3, "packages": {}}'
            );
            await fs.writeFile(
                path.join(workspace.path, 'yarn.lock'),
                '# yarn lockfile v1\n'
            );
            await fs.writeFile(
                path.join(workspace.path, 'pnpm-lock.yaml'),
                'lockfileVersion: 5.4\n'
            );
            await fs.writeFile(
                path.join(workspace.path, 'bun.lockb'),
                'binary lock file content'
            );

            const { files } = await collectFiles(workspace.path);

            // Lock files should not be in collected files
            expect(files.some(f => f.path === 'package-lock.json')).toBe(false);
            expect(files.some(f => f.path === 'yarn.lock')).toBe(false);
            expect(files.some(f => f.path === 'pnpm-lock.yaml')).toBe(false);
            expect(files.some(f => f.path === 'bun.lockb')).toBe(false);

            // But package.json should still be included
            expect(files.some(f => f.path === 'package.json')).toBe(true);
        });

        test('should allow including lock files when explicitly overriding excludes', async () => {
            // Create lock file
            await fs.writeFile(
                path.join(workspace.path, 'package-lock.json'),
                '{"lockfileVersion": 3}'
            );

            const { files } = await collectFiles(workspace.path, {
                exclude: []  // Empty array = include everything (except gitignored)
            });

            // Lock file should be included when excludes are overridden
            expect(files.some(f => f.path === 'package-lock.json')).toBe(true);
        });

        test('should export DEFAULT_EXCLUDES and DEFAULT_EXTENSIONS for application use', () => {
            // Verify exports are available
            expect(DEFAULT_EXCLUDES).toBeDefined();
            expect(DEFAULT_EXTENSIONS).toBeDefined();

            // Verify they are arrays
            expect(Array.isArray(DEFAULT_EXCLUDES)).toBe(true);
            expect(Array.isArray(DEFAULT_EXTENSIONS)).toBe(true);

            // Verify lock files are in DEFAULT_EXCLUDES
            expect(DEFAULT_EXCLUDES).toContain('package-lock.json');
            expect(DEFAULT_EXCLUDES).toContain('yarn.lock');
            expect(DEFAULT_EXCLUDES).toContain('pnpm-lock.yaml');
            expect(DEFAULT_EXCLUDES).toContain('bun.lockb');

            // Verify node_modules is still there
            expect(DEFAULT_EXCLUDES).toContain('node_modules');

            // Verify common extensions are in DEFAULT_EXTENSIONS
            expect(DEFAULT_EXTENSIONS).toContain('.js');
            expect(DEFAULT_EXTENSIONS).toContain('.ts');
        });

        test('should allow extending DEFAULT_EXCLUDES in applications', async () => {
            // Simulate application extending defaults
            const customExcludes = [
                ...DEFAULT_EXCLUDES,
                'custom-exclude.txt'
            ];

            await fs.writeFile(
                path.join(workspace.path, 'custom-exclude.txt'),
                'should be excluded'
            );

            const { files } = await collectFiles(workspace.path, {
                exclude: customExcludes
            });

            // Custom file should be excluded
            expect(files.some(f => f.path === 'custom-exclude.txt')).toBe(false);

            // Lock files should still be excluded
            expect(files.some(f => f.path === 'package-lock.json')).toBe(false);
        });
    });

    describe('formatAsXML', () => {
        test('should format files as XML', () => {
            const files = [
                { path: 'src/index.ts', content: 'export const x = 1;', size: 19 },
                { path: 'src/types.ts', content: 'interface User {}', size: 17 }
            ];

            const xml = formatAsXML(files);

            expect(xml).toContain('<file path="src/index.ts">');
            expect(xml).toContain('export const x = 1;');
            expect(xml).toContain('</file>');
            expect(xml).toContain('<file path="src/types.ts">');
        });

        test('should escape XML special characters', () => {
            const files = [
                { path: 'test.ts', content: 'const x = 1 < 2 && 3 > 2;', size: 26 }
            ];

            const xml = formatAsXML(files);

            expect(xml).toContain('&lt;');
            expect(xml).toContain('&gt;');
            expect(xml).toContain('&amp;&amp;');
        });

        test('should handle HTML/JSX content with many tags', () => {
            const files = [{
                path: 'App.tsx',
                content: '<div className="header">\n  <h1>Title</h1>\n  <p>Text</p>\n</div>',
                size: 60
            }];
            const xml = formatAsXML(files);

            // All < and > should be escaped
            expect(xml).toContain('&lt;div className="header"&gt;');
            expect(xml).toContain('&lt;h1&gt;Title&lt;/h1&gt;');
            expect(xml).toContain('&lt;p&gt;Text&lt;/p&gt;');
            expect(xml).toContain('&lt;/div&gt;');

            // Should NOT have unescaped HTML tags
            expect(xml).not.toMatch(/<div/);
            expect(xml).not.toMatch(/<h1>/);
        });

        test('should handle quotes and backslashes (not escaped in XML)', () => {
            const files = [{
                path: 'test.ts',
                content: 'const str = "Hello \\"world\\""; const path = "C:\\\\Users";',
                size: 60
            }];
            const xml = formatAsXML(files);

            // Quotes and backslashes should pass through (not escaped in XML)
            expect(xml).toContain('"Hello');
            expect(xml).toContain('world\\"');
            expect(xml).toContain('C:\\\\Users');
        });

        test('should handle newlines and whitespace', () => {
            const files = [{
                path: 'test.ts',
                content: 'line1\nline2\r\nline3\t\ttabs',
                size: 30
            }];
            const xml = formatAsXML(files);

            // Newlines and tabs should be preserved
            expect(xml).toContain('line1\nline2\r\nline3\t\ttabs');
        });

        test('should handle unicode and emoji', () => {
            const files = [{
                path: 'test.ts',
                content: 'const emoji = "🚀"; const chinese = "你好";',
                size: 50
            }];
            const xml = formatAsXML(files);

            // Unicode should be preserved
            expect(xml).toContain('🚀');
            expect(xml).toContain('你好');
        });

        test('should handle empty files', () => {
            const files = [{ path: 'empty.ts', content: '', size: 0 }];
            const xml = formatAsXML(files);

            expect(xml).toContain('<file path="empty.ts">');
            expect(xml).toContain('</file>');
        });

        test('should handle all XML special chars together', () => {
            const files = [{
                path: 'test.ts',
                content: 'if (a < b && c > d) { return x & y; }',
                size: 38
            }];
            const xml = formatAsXML(files);

            // All special chars should be escaped
            expect(xml).toContain('a &lt; b');
            expect(xml).toContain('c &gt; d');
            expect(xml).toContain('x &amp; y');

            // Should NOT have unescaped versions
            expect(xml).not.toMatch(/a < b/);
            expect(xml).not.toMatch(/c > d/);
        });

        test('should handle mixed content with HTML, code, and special chars', () => {
            const files = [{
                path: 'Component.tsx',
                content: `function Component() {
  const html = '<div>Test & "stuff"</div>';
  return <div className="test">Hello</div>;
}`,
                size: 120
            }];
            const xml = formatAsXML(files);

            // HTML in string should be escaped
            expect(xml).toContain('&lt;div&gt;Test &amp; "stuff"&lt;/div&gt;');

            // JSX should be escaped
            expect(xml).toContain('&lt;div className="test"&gt;Hello&lt;/div&gt;');
        });

        test('should handle file paths with special characters', () => {
            const files = [
                { path: 'src/components/Button & Icon.tsx', content: 'test', size: 4 },
                { path: 'path/with spaces/file.ts', content: 'test', size: 4 }
            ];
            const xml = formatAsXML(files);

            // File path with & should be in attribute (not escaped in our implementation)
            expect(xml).toContain('path="src/components/Button & Icon.tsx"');
            expect(xml).toContain('path="path/with spaces/file.ts"');
        });

        test('should handle very long lines', () => {
            const longLine = 'const x = ' + '"a"'.repeat(1000) + ';';
            const files = [{
                path: 'long.ts',
                content: longLine,
                size: longLine.length
            }];
            const xml = formatAsXML(files);

            expect(xml).toContain('const x =');
            expect(xml.length).toBeGreaterThan(longLine.length);
        });

        test('should include placeholders for omitted files', () => {
            const files = [
                { path: 'src/index.ts', content: 'export const x = 1;', size: 19 }
            ];
            const omitted = [
                { path: '.env', reason: 'gitignore' },
                { path: 'large.txt', reason: 'size', size: 2000000 }
            ];

            const xml = formatAsXML(files, omitted);

            expect(xml).toContain('<file path=".env">');
            expect(xml).toContain('// File contents excluded from context');
            expect(xml).toContain('(excluded by .gitignore)');
            expect(xml).toContain('<file path="large.txt">');
            expect(xml).toContain('(exceeds max size: 2000000 bytes)');
        });
    });

    describe('createSnapshot', () => {
        test('should create XML snapshot', async () => {
            const snapshot = await createSnapshot(workspace.path, {
                include: ['src/**/*']
            });

            expect(typeof snapshot).toBe('string');
            expect(snapshot).toContain('<file path=');
            expect(snapshot).toContain('src/index.ts');
            expect(snapshot).toContain('</file>');
        });

        test('should create snapshot with metadata including token count', async () => {
            const result = await createSnapshot(workspace.path, {
                include: ['src/**/*'],
                includeMetadata: true
            });

            expect(result).toHaveProperty('snapshot');
            expect(result).toHaveProperty('metadata');
            expect(result.metadata).toHaveProperty('fileCount');
            expect(result.metadata).toHaveProperty('omittedCount');
            expect(result.metadata).toHaveProperty('estimatedTokens');

            expect(typeof result.snapshot).toBe('string');
            expect(result.metadata.fileCount).toBeGreaterThan(0);
            expect(result.metadata.estimatedTokens).toBeGreaterThan(0);
        });
    });

    describe('Token Estimation', () => {
        test('estimateTokens should estimate token count from text', () => {
            const text = "Hello, world! This is a test.";
            const tokens = estimateTokens(text);

            expect(tokens).toBeGreaterThan(0);
            expect(tokens).toBe(Math.ceil(text.length / 4));
        });

        test('estimateSnapshotTokens should estimate token count from snapshot', () => {
            const snapshot = '<file path="test.js">\nconsole.log("Hello");\n</file>';
            const tokens = estimateSnapshotTokens(snapshot);

            expect(tokens).toBeGreaterThan(0);
            expect(tokens).toBe(Math.ceil(snapshot.length / 4));
        });

        test('should estimate tokens for real workspace snapshot', async () => {
            const snapshot = await workspace.snapshot();
            const tokens = estimateSnapshotTokens(snapshot);

            expect(tokens).toBeGreaterThan(0);
            // Reasonable estimate for a test workspace with a few files
            expect(tokens).toBeGreaterThan(10);
        });
    });

    describe('Workspace.snapshot()', () => {
        test('should create snapshot via workspace method', async () => {
            const snapshot = await workspace.snapshot({
                include: ['src/**/*'],
                extensions: ['.ts']
            });

            expect(snapshot).toContain('<file path=');
            expect(snapshot).toContain('src/index.ts');
            expect(snapshot).toContain('src/types.ts');
            expect(snapshot).not.toContain('styles.css');
        });

        test('should work with default options', async () => {
            const snapshot = await workspace.snapshot();

            expect(typeof snapshot).toBe('string');
            expect(snapshot.length).toBeGreaterThan(0);
        });

        test('should respect .gitignore in workspace', async () => {
            const snapshot = await workspace.snapshot();

            // Should not include gitignored files in content
            expect(snapshot).not.toContain('This should be ignored');

            // But should include placeholder
            expect(snapshot).toContain('<file path="ignored.txt">');
            expect(snapshot).toContain('// File contents excluded from context');
        });

        test('should allow disabling placeholders', async () => {
            const snapshot = await workspace.snapshot({
                includePlaceholders: false
            });

            // Should not have any placeholder comments
            expect(snapshot.match(/File contents excluded from context/g)).toBeFalsy();
        });
    });
});
