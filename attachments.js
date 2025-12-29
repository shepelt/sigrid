/**
 * Attachment handling for Sigrid
 *
 * Converts attachments to OpenAI-compatible API format.
 * Model-agnostic: always formats for vision support.
 * If the LLM doesn't support vision, the API will return an error - caller's responsibility.
 */

import { getAttachmentInfo } from './model-config.js';

/**
 * Validate attachment object
 *
 * @param {Object} attachment - Attachment to validate
 * @returns {Object} Validated attachment or throws error
 */
export function validateAttachment(attachment) {
    if (!attachment || typeof attachment !== 'object') {
        throw new Error('Attachment must be an object');
    }

    const { id, filename, mimeType, data } = attachment;

    if (!filename || typeof filename !== 'string') {
        throw new Error('Attachment must have a filename');
    }

    if (!mimeType || typeof mimeType !== 'string') {
        throw new Error('Attachment must have a mimeType');
    }

    if (!data || typeof data !== 'string') {
        throw new Error('Attachment must have base64 data');
    }

    return {
        id: id || `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        filename,
        mimeType,
        data
    };
}

/**
 * Decode base64 text content
 *
 * @param {string} base64Data - Base64 encoded data
 * @returns {string} Decoded text
 */
function decodeBase64Text(base64Data) {
    return Buffer.from(base64Data, 'base64').toString('utf-8');
}

/**
 * Format attachment as content block for OpenAI-compatible API
 *
 * @param {Object} attachment - Validated attachment (may include localPath if saved to workspace)
 * @returns {Object} Formatted content block
 */
function formatAttachmentBlock(attachment) {
    const info = getAttachmentInfo(attachment.mimeType);
    const category = info?.category || 'unknown';
    const localPathNote = attachment.localPath ? ` (saved to ${attachment.localPath})` : '';

    switch (category) {
        case 'image':
        case 'svg':
            // Image content block (OpenAI format)
            // Add text block before image to note the local path
            return attachment.localPath
                ? [
                    { type: 'text', text: `[Image: ${attachment.filename} saved to ${attachment.localPath}]` },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${attachment.mimeType};base64,${attachment.data}`,
                            detail: 'auto'
                        }
                    }
                ]
                : {
                    type: 'image_url',
                    image_url: {
                        url: `data:${attachment.mimeType};base64,${attachment.data}`,
                        detail: 'auto'
                    }
                };

        case 'text':
            // Inline text content
            try {
                const textContent = decodeBase64Text(attachment.data);
                const ext = attachment.filename.split('.').pop() || 'txt';
                return {
                    type: 'text',
                    text: `File: ${attachment.filename}${localPathNote}\n\`\`\`${ext}\n${textContent}\n\`\`\``
                };
            } catch (e) {
                return {
                    type: 'text',
                    text: `[File: ${attachment.filename}${localPathNote} - could not decode]`
                };
            }

        case 'document':
            // PDF - note as unprocessed for now
            return {
                type: 'text',
                text: `[Document: ${attachment.filename}${localPathNote} - PDF text extraction not yet implemented]`
            };

        default:
            return {
                type: 'text',
                text: `[Attachment: ${attachment.filename}${localPathNote} - unsupported type: ${attachment.mimeType}]`
            };
    }
}

/**
 * Format user message with attachments for LLM API
 *
 * @param {Object} message - User message with optional attachments
 * @param {string} model - Model identifier (unused, kept for API compatibility)
 * @returns {Object} Formatted message for API
 */
export function formatMessageWithAttachments(message, model) {
    const { content, attachments, ...rest } = message;

    // If no attachments, return message as-is
    if (!attachments || attachments.length === 0) {
        return { role: message.role, content, ...rest };
    }

    // Build content array
    const contentParts = [];

    // Add text content first
    if (content) {
        contentParts.push({ type: 'text', text: content });
    }

    // Process attachments
    for (const attachment of attachments) {
        const validated = validateAttachment(attachment);
        // Preserve localPath if present
        if (attachment.localPath) {
            validated.localPath = attachment.localPath;
        }
        const block = formatAttachmentBlock(validated);
        // Handle arrays (e.g., image with text label)
        if (Array.isArray(block)) {
            contentParts.push(...block);
        } else {
            contentParts.push(block);
        }
    }

    // Merge consecutive text blocks
    const mergedParts = [];
    for (const part of contentParts) {
        if (part.type === 'text' && mergedParts.length > 0 && mergedParts[mergedParts.length - 1].type === 'text') {
            mergedParts[mergedParts.length - 1].text += '\n\n' + part.text;
        } else {
            mergedParts.push(part);
        }
    }

    // Simplify to string if only one text block
    const finalContent = mergedParts.length === 1 && mergedParts[0].type === 'text'
        ? mergedParts[0].text
        : mergedParts;

    return {
        role: message.role,
        content: finalContent,
        ...rest
    };
}

/**
 * Format conversation history with attachments
 *
 * @param {Array} messages - Array of messages
 * @param {string} model - Model identifier (unused, kept for API compatibility)
 * @returns {Array} Formatted messages for API
 */
export function formatMessagesWithAttachments(messages, model) {
    return messages.map(msg => {
        if (msg.role === 'user' && msg.attachments) {
            return formatMessageWithAttachments(msg, model);
        }
        return msg;
    });
}

/**
 * Prepare message for persistence (keep attachments as-is)
 *
 * @param {Object} message - Message to process
 * @returns {Object} Message for persistence
 */
export function prepareMessageForPersistence(message) {
    return { ...message };
}

/**
 * Check if any attachments are images (require vision)
 *
 * @param {Array} attachments - Array of attachments
 * @returns {boolean} True if any attachment is an image
 */
export function attachmentsRequireVision(attachments) {
    if (!attachments || attachments.length === 0) return false;

    return attachments.some(att => {
        const info = getAttachmentInfo(att.mimeType);
        return info?.category === 'image';
    });
}
