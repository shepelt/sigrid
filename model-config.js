/**
 * Model configuration for Sigrid
 *
 * Model-agnostic: uses OpenAI-compatible API format.
 * Vision support is assumed - if LLM doesn't support it, API will error (caller's responsibility).
 */

/**
 * Supported attachment MIME types
 */
export const SUPPORTED_MIME_TYPES = {
    // Images (require vision capability)
    'image/png': { category: 'image', requiresVision: true },
    'image/jpeg': { category: 'image', requiresVision: true },
    'image/gif': { category: 'image', requiresVision: true },
    'image/webp': { category: 'image', requiresVision: true },
    'image/svg+xml': { category: 'svg', requiresVision: false }, // Can be serialized as text

    // Text files (work with all models)
    'text/plain': { category: 'text', requiresVision: false },
    'text/csv': { category: 'text', requiresVision: false },
    'text/markdown': { category: 'text', requiresVision: false },
    'text/html': { category: 'text', requiresVision: false },
    'application/json': { category: 'text', requiresVision: false },

    // Documents
    'application/pdf': { category: 'document', requiresVision: false }, // Extract text
};

/**
 * Get attachment category and handling info
 *
 * @param {string} mimeType - MIME type
 * @returns {Object|null} Category info or null if unsupported
 */
export function getAttachmentInfo(mimeType) {
    return SUPPORTED_MIME_TYPES[mimeType] || null;
}
