import { describe, test, expect } from '@jest/globals';
import {
    SUPPORTED_MIME_TYPES,
    getAttachmentInfo
} from '../model-config.js';

import {
    validateAttachment,
    formatMessageWithAttachments,
    formatMessagesWithAttachments,
    attachmentsRequireVision
} from '../attachments.js';

/**
 * Tests for attachment handling functionality
 *
 * Run with: npm test -- tests/attachments.test.js
 */

describe('Model Configuration', () => {
    describe('getAttachmentInfo', () => {
        test('should return info for image types', () => {
            const pngInfo = getAttachmentInfo('image/png');
            expect(pngInfo).toEqual({ category: 'image', requiresVision: true });

            const jpegInfo = getAttachmentInfo('image/jpeg');
            expect(jpegInfo).toEqual({ category: 'image', requiresVision: true });
        });

        test('should return info for text types', () => {
            const txtInfo = getAttachmentInfo('text/plain');
            expect(txtInfo).toEqual({ category: 'text', requiresVision: false });

            const csvInfo = getAttachmentInfo('text/csv');
            expect(csvInfo).toEqual({ category: 'text', requiresVision: false });
        });

        test('should return info for SVG', () => {
            const svgInfo = getAttachmentInfo('image/svg+xml');
            expect(svgInfo).toEqual({ category: 'svg', requiresVision: false });
        });

        test('should return null for unsupported types', () => {
            expect(getAttachmentInfo('application/octet-stream')).toBe(null);
            expect(getAttachmentInfo('video/mp4')).toBe(null);
        });
    });
});

describe('Attachment Validation', () => {
    describe('validateAttachment', () => {
        test('should validate a valid attachment', () => {
            const attachment = {
                filename: 'test.png',
                mimeType: 'image/png',
                data: 'iVBORw0KGgo='
            };
            const validated = validateAttachment(attachment);
            expect(validated).toHaveProperty('id');
            expect(validated.filename).toBe('test.png');
            expect(validated.mimeType).toBe('image/png');
            expect(validated.data).toBe('iVBORw0KGgo=');
        });

        test('should preserve provided id', () => {
            const attachment = {
                id: 'custom-id',
                filename: 'test.png',
                mimeType: 'image/png',
                data: 'iVBORw0KGgo='
            };
            const validated = validateAttachment(attachment);
            expect(validated.id).toBe('custom-id');
        });

        test('should throw on missing filename', () => {
            expect(() => validateAttachment({
                mimeType: 'image/png',
                data: 'abc'
            })).toThrow('Attachment must have a filename');
        });

        test('should throw on missing mimeType', () => {
            expect(() => validateAttachment({
                filename: 'test.png',
                data: 'abc'
            })).toThrow('Attachment must have a mimeType');
        });

        test('should throw on missing data', () => {
            expect(() => validateAttachment({
                filename: 'test.png',
                mimeType: 'image/png'
            })).toThrow('Attachment must have base64 data');
        });

        test('should throw on non-object input', () => {
            expect(() => validateAttachment(null)).toThrow('Attachment must be an object');
            expect(() => validateAttachment('string')).toThrow('Attachment must be an object');
        });
    });
});

describe('Attachment Formatting', () => {
    const createImageAttachment = (overrides = {}) => ({
        id: 'test-id',
        filename: 'test.png',
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        ...overrides
    });

    const createTextAttachment = (overrides = {}) => ({
        id: 'text-id',
        filename: 'data.csv',
        mimeType: 'text/csv',
        data: Buffer.from('name,age\nAlice,30').toString('base64'),
        ...overrides
    });

    describe('formatMessageWithAttachments - Image', () => {
        test('should format image attachment as OpenAI image_url block', () => {
            const message = {
                role: 'user',
                content: 'Describe this image',
                attachments: [createImageAttachment()]
            };

            const formatted = formatMessageWithAttachments(message, 'any-model');

            expect(formatted.role).toBe('user');
            expect(Array.isArray(formatted.content)).toBe(true);
            expect(formatted.content.length).toBe(2);
            expect(formatted.content[0]).toEqual({ type: 'text', text: 'Describe this image' });
            expect(formatted.content[1]).toHaveProperty('type', 'image_url');
            expect(formatted.content[1].image_url).toHaveProperty('url');
            expect(formatted.content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
            expect(formatted.content[1].image_url.detail).toBe('auto');
        });

        test('should handle multiple image attachments', () => {
            const message = {
                role: 'user',
                content: 'Compare these',
                attachments: [
                    createImageAttachment({ id: 'img1', filename: 'a.png' }),
                    createImageAttachment({ id: 'img2', filename: 'b.png' })
                ]
            };

            const formatted = formatMessageWithAttachments(message, 'any-model');

            expect(formatted.content.length).toBe(3); // 1 text + 2 images
            expect(formatted.content[1].type).toBe('image_url');
            expect(formatted.content[2].type).toBe('image_url');
        });
    });

    describe('formatMessageWithAttachments - Text', () => {
        test('should inline text attachment', () => {
            const message = {
                role: 'user',
                content: 'Analyze this data',
                attachments: [createTextAttachment()]
            };

            const formatted = formatMessageWithAttachments(message, 'any-model');

            expect(formatted.role).toBe('user');
            // Text attachments get merged into single text content
            expect(typeof formatted.content).toBe('string');
            expect(formatted.content).toContain('Analyze this data');
            expect(formatted.content).toContain('data.csv');
            expect(formatted.content).toContain('name,age');
        });
    });

    describe('formatMessageWithAttachments - Mixed', () => {
        test('should handle mixed image and text attachments', () => {
            const message = {
                role: 'user',
                content: 'Analyze both',
                attachments: [
                    createImageAttachment(),
                    createTextAttachment()
                ]
            };

            const formatted = formatMessageWithAttachments(message, 'any-model');

            expect(formatted.role).toBe('user');
            expect(Array.isArray(formatted.content)).toBe(true);
            // Order: text, image, text (CSV) - 3 parts since image breaks text sequence
            expect(formatted.content.length).toBe(3);

            expect(formatted.content[0].type).toBe('text');
            expect(formatted.content[0].text).toContain('Analyze both');

            expect(formatted.content[1].type).toBe('image_url');

            expect(formatted.content[2].type).toBe('text');
            expect(formatted.content[2].text).toContain('name,age'); // CSV content
        });
    });

    describe('formatMessageWithAttachments - No attachments', () => {
        test('should return message as-is without attachments', () => {
            const message = { role: 'user', content: 'Hello' };
            const formatted = formatMessageWithAttachments(message, 'any-model');
            expect(formatted).toEqual({ role: 'user', content: 'Hello' });
        });

        test('should return message as-is with empty attachments array', () => {
            const message = { role: 'user', content: 'Hello', attachments: [] };
            const formatted = formatMessageWithAttachments(message, 'any-model');
            expect(formatted).toEqual({ role: 'user', content: 'Hello' });
        });
    });
});

describe('Conversation History Formatting', () => {
    test('should format multiple messages with attachments', () => {
        const messages = [
            { role: 'user', content: 'Hello' },
            {
                role: 'user',
                content: 'See this image',
                attachments: [{
                    id: 'img1',
                    filename: 'pic.png',
                    mimeType: 'image/png',
                    data: 'abc123'
                }]
            },
            { role: 'assistant', content: 'I see the image' },
            { role: 'user', content: 'Thanks' }
        ];

        const formatted = formatMessagesWithAttachments(messages, 'any-model');

        expect(formatted.length).toBe(4);
        expect(formatted[0]).toEqual({ role: 'user', content: 'Hello' });
        expect(formatted[2]).toEqual({ role: 'assistant', content: 'I see the image' });
        expect(formatted[3]).toEqual({ role: 'user', content: 'Thanks' });

        // Message with attachment should be formatted
        expect(Array.isArray(formatted[1].content)).toBe(true);
    });

    test('should not modify assistant messages', () => {
        const messages = [
            {
                role: 'assistant',
                content: 'Response',
                attachments: [{ filename: 'x.png', mimeType: 'image/png', data: 'x' }]
            }
        ];

        const formatted = formatMessagesWithAttachments(messages, 'any-model');

        // Assistant messages with attachments are left as-is
        expect(formatted[0].content).toBe('Response');
    });
});

describe('Attachment Vision Requirements', () => {
    test('should return true if any image attachment', () => {
        const attachments = [
            { filename: 'pic.png', mimeType: 'image/png', data: 'x' }
        ];
        expect(attachmentsRequireVision(attachments)).toBe(true);
    });

    test('should return false if only text attachments', () => {
        const attachments = [
            { filename: 'data.csv', mimeType: 'text/csv', data: 'x' },
            { filename: 'notes.txt', mimeType: 'text/plain', data: 'y' }
        ];
        expect(attachmentsRequireVision(attachments)).toBe(false);
    });

    test('should return true for mixed attachments with images', () => {
        const attachments = [
            { filename: 'data.csv', mimeType: 'text/csv', data: 'x' },
            { filename: 'pic.png', mimeType: 'image/png', data: 'y' }
        ];
        expect(attachmentsRequireVision(attachments)).toBe(true);
    });

    test('should return false for SVG (can work without vision)', () => {
        const attachments = [
            { filename: 'icon.svg', mimeType: 'image/svg+xml', data: 'x' }
        ];
        // SVG is formatted as image but can also be sent as text
        expect(attachmentsRequireVision(attachments)).toBe(false);
    });

    test('should return false for empty/null attachments', () => {
        expect(attachmentsRequireVision([])).toBe(false);
        expect(attachmentsRequireVision(null)).toBe(false);
        expect(attachmentsRequireVision(undefined)).toBe(false);
    });
});
