import { describe, test, expect } from '@jest/globals';
import { applyAddon } from './addon.js';
import { createWorkspace } from './workspace.js';

/**
 * Addon Stress Tests
 *
 * Tests exotic and edge case addon scenarios to ensure robustness.
 * Not about performance, but about unusual configurations.
 *
 * Run with: npm test -- addon.stress.test.js
 */
describe('Addon Stress Tests', () => {
    let workspace;

    afterEach(async () => {
        if (workspace) {
            await workspace.delete();
            workspace = null;
        }
    });

    describe('Large and complex addons', () => {
        test('should handle addon with many API modules (10+)', async () => {
            workspace = await createWorkspace();

            // Create an addon with 15 different modules
            const files = {};
            const api = {};

            for (let i = 1; i <= 15; i++) {
                const moduleName = `module${i}`;
                files[`src/lib/${moduleName}.js`] = `export function func${i}() { return ${i}; }`;
                api[`@/lib/${moduleName}`] = {
                    exports: {
                        [`func${i}`]: `Function ${i} from module ${i}`
                    }
                };
            }

            const addon = {
                name: 'large-api',
                description: 'Addon with many modules',
                api,
                files
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();

            // Verify AI rules contain all modules
            const aiRules = await workspace.getAIRules();
            expect(aiRules).toContain('func1');
            expect(aiRules).toContain('func15');
        });

        test('should handle very long descriptions and documentation', async () => {
            workspace = await createWorkspace();

            const longDescription = 'A'.repeat(5000); // 5KB description
            const longDocs = 'This is documentation. '.repeat(1000); // ~23KB

            const addon = {
                name: 'long-text',
                description: longDescription,
                api: {
                    '@/lib/test': {
                        exports: {
                            'testFunc': 'A test function'
                        }
                    }
                },
                files: {
                    'src/lib/test.js': 'export function testFunc() {}',
                    'docs/long-docs.md': longDocs
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();
        });

        test('should handle addon with deeply nested file paths', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'deep-paths',
                api: {
                    '@/lib/very/deep/nested/module/path': {
                        exports: {
                            'deepFunc': 'Deep function'
                        }
                    }
                },
                files: {
                    'src/lib/very/deep/nested/module/path.js': 'export function deepFunc() {}'
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();
        });
    });

    describe('Multiple addons interaction', () => {
        test('should apply multiple addons in sequence', async () => {
            workspace = await createWorkspace();

            const addon1 = {
                name: 'addon1',
                api: {
                    '@/lib/first': {
                        exports: { 'firstFunc': 'First' }
                    }
                },
                files: {
                    'src/lib/first.js': 'export function firstFunc() {}'
                }
            };

            const addon2 = {
                name: 'addon2',
                api: {
                    '@/lib/second': {
                        exports: { 'secondFunc': 'Second' }
                    }
                },
                files: {
                    'src/lib/second.js': 'export function secondFunc() {}'
                }
            };

            const addon3 = {
                name: 'addon3',
                api: {
                    '@/lib/third': {
                        exports: { 'thirdFunc': 'Third' }
                    }
                },
                files: {
                    'src/lib/third.js': 'export function thirdFunc() {}'
                }
            };

            await applyAddon(workspace, addon1);
            await applyAddon(workspace, addon2);
            await applyAddon(workspace, addon3);

            const aiRules = await workspace.getAIRules();
            expect(aiRules).toContain('firstFunc');
            expect(aiRules).toContain('secondFunc');
            expect(aiRules).toContain('thirdFunc');
        });

        test('should handle addons with overlapping dependencies', async () => {
            workspace = await createWorkspace();

            const addon1 = {
                name: 'dep1',
                dependencies: {
                    'lodash': '^4.17.21',
                    'axios': '^1.0.0'
                },
                files: {
                    'src/lib/dep1.js': 'export const d1 = 1;'
                }
            };

            const addon2 = {
                name: 'dep2',
                dependencies: {
                    'lodash': '^4.17.21', // Same version
                    'react': '^18.0.0'
                },
                files: {
                    'src/lib/dep2.js': 'export const d2 = 2;'
                }
            };

            await applyAddon(workspace, addon1);
            await applyAddon(workspace, addon2);

            const fs = await import('fs/promises');
            const path = await import('path');
            const packageJson = JSON.parse(
                await fs.readFile(path.join(workspace.path, 'package.json'), 'utf-8')
            );

            expect(packageJson.dependencies['lodash']).toBe('^4.17.21');
            expect(packageJson.dependencies['axios']).toBe('^1.0.0');
            expect(packageJson.dependencies['react']).toBe('^18.0.0');
        });
    });

    describe('Special characters and edge cases', () => {
        test('should handle Unicode and special characters in content', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'unicode',
                description: 'Addon with Unicode: 你好世界 🚀 émojis',
                api: {
                    '@/lib/i18n': {
                        exports: {
                            'greet': 'Greeting function'
                        }
                    }
                },
                files: {
                    'src/lib/i18n.js': `export function greet() { return '你好 🌍'; }`
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();

            const aiRules = await workspace.getAIRules();
            expect(aiRules).toContain('你好世界');
            expect(aiRules).toContain('🚀');
        });

        test('should handle addon with hyphens and underscores in name', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'my-awesome_addon-v2',
                api: {
                    '@/lib/test': {
                        exports: { 'testFunc': 'Test' }
                    }
                },
                files: {
                    'src/lib/test.js': 'export function testFunc() {}'
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();
        });

        test('should handle empty files in addon', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'empty-files',
                files: {
                    'src/lib/empty.js': '',
                    'src/lib/whitespace.js': '   \n\n  ',
                    'src/lib/actual.js': 'export const x = 1;'
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();
        });
    });

    describe('File type variations', () => {
        test('should handle various file extensions (ts, tsx, jsx)', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'multi-ext',
                api: {
                    '@/lib/typescript': {
                        exports: { 'tsFunc': 'TypeScript function' }
                    },
                    '@/components/Component': {
                        exports: { 'Component': 'React component' }
                    }
                },
                files: {
                    'src/lib/typescript.ts': 'export function tsFunc() {}',
                    'src/components/Component.tsx': 'export function Component() {}',
                    'src/utils/helper.jsx': 'export const helper = () => {};'
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();
        });

        test('should handle mixed API and manual aiRulesAddition', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'mixed',
                description: 'Mixed API and manual rules',
                api: {
                    '@/lib/auto': {
                        exports: { 'autoFunc': 'Auto-documented' }
                    }
                },
                aiRulesAddition: '\n## Custom Section\n\nThis is manually added content.\n',
                files: {
                    'src/lib/auto.js': 'export function autoFunc() {}',
                    'src/lib/manual.js': 'export function manualFunc() {}'
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();

            const aiRules = await workspace.getAIRules();
            // Manual rules should take precedence
            expect(aiRules).toContain('Custom Section');
            expect(aiRules).toContain('manually added content');
        });
    });

    describe('API definition variations', () => {
        test('should handle API with only exports, no methods', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'exports-only',
                api: {
                    '@/lib/simple': {
                        exports: {
                            'func1': 'Function 1',
                            'func2': 'Function 2'
                        }
                        // No methods field
                    }
                },
                files: {
                    'src/lib/simple.js': 'export function func1() {}\nexport function func2() {}'
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();
        });

        test('should handle API with many exports (50+)', async () => {
            workspace = await createWorkspace();

            const exports = {};
            const fileContent = [];

            for (let i = 1; i <= 50; i++) {
                exports[`func${i}`] = `Function ${i}`;
                fileContent.push(`export function func${i}() { return ${i}; }`);
            }

            const addon = {
                name: 'many-exports',
                api: {
                    '@/lib/huge': {
                        exports
                    }
                },
                files: {
                    'src/lib/huge.js': fileContent.join('\n')
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();
        });

        test('should handle addon with no API but with dependencies', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'deps-only',
                description: 'Just adds dependencies, no API',
                dependencies: {
                    'some-library': '^1.0.0',
                    'another-lib': '^2.0.0'
                },
                files: {
                    'src/lib/setup.js': '// Setup file with no exports'
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();
        });
    });

    describe('Internal paths and docs variations', () => {
        test('should handle addon with many internal files', async () => {
            workspace = await createWorkspace();

            const files = {};
            const internal = [];

            // Add 20 internal files
            for (let i = 1; i <= 20; i++) {
                const path = `src/lib/internal/file${i}.js`;
                files[path] = `// Internal implementation ${i}`;
                internal.push(path);
            }

            // Add one public API
            files['src/lib/api.js'] = 'export function publicAPI() {}';

            const addon = {
                name: 'many-internals',
                api: {
                    '@/lib/api': {
                        exports: { 'publicAPI': 'Public API' }
                    }
                },
                files,
                internal
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();
        });

        test('should handle addon with multiple doc files', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'multi-docs',
                docs: 'docs/main-api.md',
                api: {
                    '@/lib/feature': {
                        exports: { 'feature': 'Main feature' }
                    }
                },
                files: {
                    'src/lib/feature.js': 'export function feature() {}',
                    'docs/main-api.md': '# Main API\n\nDocumentation here.',
                    'docs/guides/getting-started.md': '# Getting Started\n\nGuide here.',
                    'docs/guides/advanced.md': '# Advanced Usage\n\nAdvanced topics.',
                    'docs/examples/example1.md': '# Example 1\n\nExample code.'
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();
        });
    });

    describe('Edge cases and error conditions', () => {
        test('should handle addon with very long function names', async () => {
            workspace = await createWorkspace();

            const longName = 'veryLongFunctionNameThatKeepsGoing'.repeat(5);

            const addon = {
                name: 'long-names',
                api: {
                    '@/lib/test': {
                        exports: {
                            [longName]: 'Very long function name'
                        }
                    }
                },
                files: {
                    'src/lib/test.js': `export function ${longName}() {}`
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();
        });

        test('should handle addon that creates deeply nested directories', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'deep-structure',
                files: {
                    'src/a/b/c/d/e/f/g/h/i/deep.js': 'export const deep = true;',
                    'docs/guides/tutorials/advanced/performance/optimization/caching.md': '# Caching'
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();

            // Verify files were created
            const fs = await import('fs/promises');
            const path = await import('path');
            const deepFile = path.join(workspace.path, 'src/a/b/c/d/e/f/g/h/i/deep.js');
            await expect(fs.access(deepFile)).resolves.not.toThrow();
        });

        test('should handle addon with minimal configuration', async () => {
            workspace = await createWorkspace();

            const addon = {
                name: 'minimal',
                files: {
                    'src/lib/minimal.js': 'export const x = 1;'
                }
            };

            await expect(applyAddon(workspace, addon)).resolves.not.toThrow();
        });
    });
});
