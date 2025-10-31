import { describe, test, expect } from '@jest/globals';
import { applyAddon, generateAIRulesFromAPI } from '../addon.js';
import { createWorkspace } from '../workspace.js';

/**
 * Addon System Unit Tests
 *
 * Tests validation and API generation functions
 * Run with: npm test -- addon.test.js
 */
describe('Addon Unit Tests', () => {
    let workspace;

    afterEach(async () => {
        if (workspace) {
            await workspace.delete();
            workspace = null;
        }
    });

    describe('API validation', () => {
        test('should throw error when export is missing from file', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'test',
                api: {
                    '@/lib/foo': {
                        exports: {
                            'missingFunction': 'This function does not exist'
                        }
                    }
                },
                files: {
                    'src/lib/foo.js': 'export function actualFunction() {}'
                }
            };

            await expect(applyAddon(workspace, addon)).rejects.toThrow('Addon API validation failed');
            await expect(applyAddon(workspace, addon)).rejects.toThrow('missingFunction');
            await expect(applyAddon(workspace, addon)).rejects.toThrow('does not exist');
        });

        test('should not throw when export exists in file', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'test',
                api: {
                    '@/lib/foo': {
                        exports: {
                            'myFunction': 'A function that exists'
                        }
                    }
                },
                files: {
                    'src/lib/foo.js': 'export function myFunction() { return 42; }'
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();
        });

        test('should throw error when API references non-existent file', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'test',
                api: {
                    '@/lib/missing': {
                        exports: {
                            'foo': 'Some function'
                        }
                    }
                },
                files: {
                    'src/lib/other.js': 'export function bar() {}'
                }
            };

            await expect(applyAddon(workspace, addon)).rejects.toThrow('no matching file found');
        });

        test('should validate multiple export patterns', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'test',
                api: {
                    '@/lib/exports': {
                        exports: {
                            'func1': 'Regular function',
                            'func2': 'Const function',
                            'func3': 'Async function'
                        }
                    }
                },
                files: {
                    'src/lib/exports.js': `
                        export function func1() {}
                        export const func2 = () => {};
                        export async function func3() {}
                    `
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();
        });
    });

    describe('AI rules generation', () => {
        test('should generate AI rules from API definition', () => {
            const addon = {
                name: 'database',
                description: 'A database addon',
                technology: 'SQLite',
                useCases: 'Data storage',
                docs: 'docs/api.md',
                api: {
                    '@/lib/db': {
                        exports: {
                            'createDB': 'Creates database'
                        },
                        methods: {
                            'query(sql)': 'Execute query',
                            'close()': 'Close connection'
                        }
                    }
                }
            };

            const rules = generateAIRulesFromAPI(addon);

            expect(rules).toContain('## Database');
            expect(rules).toContain('A database addon');
            expect(rules).toContain("import { createDB } from '@/lib/db'");
            expect(rules).toContain('docs/api.md');
            expect(rules).toContain('SQLite');
            expect(rules).toContain('Data storage');
            expect(rules).toContain('query(sql)');
            expect(rules).toContain('close()');
        });

        test('should return empty string when no API defined', () => {
            const addon = {
                name: 'simple',
                description: 'No API'
            };

            const rules = generateAIRulesFromAPI(addon);

            expect(rules).toBe('');
        });

        test('should include conventions from API definition', () => {
            const addon = {
                name: 'database',
                description: 'A database addon',
                api: {
                    '@/lib/db': {
                        exports: {
                            'query': 'Query function'
                        },
                        conventions: [
                            'Always use parameterized queries to prevent SQL injection',
                            'Close connections when done',
                            'Use transactions for multiple related operations'
                        ]
                    }
                }
            };

            const rules = generateAIRulesFromAPI(addon);

            expect(rules).toContain('**Conventions**:');
            expect(rules).toContain('Always use parameterized queries to prevent SQL injection');
            expect(rules).toContain('Close connections when done');
            expect(rules).toContain('Use transactions for multiple related operations');
        });

        test('should handle conventions from multiple import paths', () => {
            const addon = {
                name: 'multi',
                description: 'Multiple APIs with conventions',
                api: {
                    '@/lib/auth': {
                        exports: { 'login': 'Login function' },
                        conventions: ['Always validate user input', 'Use secure tokens']
                    },
                    '@/lib/db': {
                        exports: { 'query': 'Query function' },
                        conventions: ['Use parameterized queries', 'Handle errors properly']
                    }
                }
            };

            const rules = generateAIRulesFromAPI(addon);

            expect(rules).toContain('**Conventions**:');
            expect(rules).toContain('Always validate user input');
            expect(rules).toContain('Use secure tokens');
            expect(rules).toContain('Use parameterized queries');
            expect(rules).toContain('Handle errors properly');
        });

        test('should handle multiple import paths', () => {
            const addon = {
                name: 'multi',
                description: 'Multiple APIs',
                api: {
                    '@/lib/auth': {
                        exports: {
                            'login': 'Login function'
                        }
                    },
                    '@/lib/db': {
                        exports: {
                            'query': 'Query function'
                        }
                    }
                }
            };

            const rules = generateAIRulesFromAPI(addon);

            expect(rules).toContain('@/lib/auth');
            expect(rules).toContain('@/lib/db');
            expect(rules).toContain('login');
            expect(rules).toContain('query');
        });
    });

    describe('Addon application', () => {
        test('should auto-generate AI rules from api field', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'auto-rules',
                description: 'Test auto-generation',
                api: {
                    '@/lib/test': {
                        exports: {
                            'testFunc': 'A test function'
                        }
                    }
                },
                files: {
                    'src/lib/test.js': 'export function testFunc() {}'
                }
            };

            const result = await applyAddon(workspace, addon);

            expect(result.aiRulesUpdated).toBe(true);

            // Read AI_RULES.md and verify it contains generated content
            const aiRules = await workspace.getAIRules();
            expect(aiRules).toContain('Auto-rules');
            expect(aiRules).toContain('testFunc');
            expect(aiRules).toContain('@/lib/test');
        });

        test('should prefer manual aiRulesAddition over auto-generation', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'manual',
                description: 'Manual rules',
                api: {
                    '@/lib/test': {
                        exports: { 'autoFunc': 'Should not appear' }
                    }
                },
                aiRulesAddition: '\n## Custom Rules\n\nManually written rules\n',
                files: {
                    'src/lib/test.js': 'export function autoFunc() {}'
                }
            };

            const result = await applyAddon(workspace, addon);

            expect(result.aiRulesUpdated).toBe(true);

            const aiRules = await workspace.getAIRules();
            expect(aiRules).toContain('Custom Rules');
            expect(aiRules).toContain('Manually written rules');
            expect(aiRules).not.toContain('autoFunc'); // Should not have auto-generated content
        });

        test('should be idempotent - applying same addon twice is safe', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'idempotent-test',
                version: '1.0.0',
                files: {
                    'src/lib/test.js': 'export function test() { return 42; }'
                }
            };

            // Apply first time
            const result1 = await applyAddon(workspace, addon);
            expect(result1.filesAdded).toHaveLength(1);
            expect(result1.alreadyApplied).toBeUndefined();

            // Apply second time - should be idempotent
            const result2 = await applyAddon(workspace, addon);
            expect(result2.alreadyApplied).toBe(true);
            expect(result2.appliedAt).toBeDefined();
            expect(result2.filesAdded).toBeUndefined();
        });

        test('should store internal paths per workspace in .sigrid/addons.json', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'internal-test',
                version: '1.0.0',
                files: {
                    'src/lib/public.js': 'export function api() {}',
                    'src/lib/internal.js': 'function impl() {}'
                },
                internal: ['src/lib/internal.js']
            };

            await applyAddon(workspace, addon);

            // Read .sigrid/addons.json directly
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const addonsFile = path.join(workspace.path, '.sigrid', 'addons.json');
            const content = await fs.readFile(addonsFile, 'utf-8');
            const registry = JSON.parse(content);

            expect(registry.applied['internal-test@1.0.0']).toBeDefined();
            expect(registry.applied['internal-test@1.0.0'].internalPaths).toEqual(['src/lib/internal.js']);
        });
    });

    describe('Workspace initialization', () => {
        test('should create .sigrid directory on workspace creation', async () => {
            workspace = await createWorkspace();

            const fs = await import('node:fs/promises');
            const path = await import('node:path');

            // Check .sigrid directory exists
            const sigridDir = path.join(workspace.path, '.sigrid');
            const stats = await fs.stat(sigridDir);
            expect(stats.isDirectory()).toBe(true);

            // Check metadata.json exists
            const metadataFile = path.join(sigridDir, 'metadata.json');
            const metadata = JSON.parse(await fs.readFile(metadataFile, 'utf-8'));
            expect(metadata.workspaceId).toBe(workspace.id);
            expect(metadata.createdAt).toBeDefined();
            expect(metadata.sigridVersion).toBe('1.0.0');

            // Check addons.json exists and is empty
            const addonsFile = path.join(sigridDir, 'addons.json');
            const addons = JSON.parse(await fs.readFile(addonsFile, 'utf-8'));
            expect(addons.applied).toEqual({});
        });
    });
});
