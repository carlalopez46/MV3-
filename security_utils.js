/**
 * security_utils.js
 * Shared, dependency-free helpers for basic MV3 hardening.
 *
 * NOTE: This file intentionally avoids referencing `chrome` at load time so it
 * can be executed in CLI/unit-test environments.
 */
(function (global) {
    'use strict';

    function normalizeString(value) {
        if (typeof value === 'string') return value;
        if (value === null || typeof value === 'undefined') return '';
        return String(value);
    }

    function stripNullBytes(value) {
        return normalizeString(value).replace(/\0/g, '');
    }

    /**
     * Checks whether a runtime message sender is from a privileged extension
     * page (panel/options/offscreen/etc).
     *
     * @param {chrome.runtime.MessageSender} sender
     * @param {string} extensionId
     * @param {string} extensionOrigin chrome.runtime.getURL('') (trailing slash)
     * @returns {boolean}
     */
    function isPrivilegedSender(sender, extensionId, extensionOrigin) {
        if (!sender || typeof sender !== 'object') return false;
        if (typeof extensionId === 'string' && sender.id !== extensionId) return false;

        const senderUrl = typeof sender.url === 'string' ? sender.url : '';
        const origin = typeof extensionOrigin === 'string' ? extensionOrigin : '';
        if (senderUrl && origin && senderUrl.startsWith(origin)) return true;

        // Some internal extension contexts do not populate sender.url but are not
        // content-script senders either. Treat these as privileged.
        const hasTab = !!(sender.tab && typeof sender.tab === 'object');
        if (!senderUrl && !hasTab) return true;

        return false;
    }

    function hasPathTraversalSegments(path) {
        const cleaned = stripNullBytes(path);
        if (!cleaned) return false;
        const segments = cleaned.split(/[\\/]+/);
        return segments.some((seg) => seg === '..');
    }

    /**
     * Sanitizes a macro file path to prevent basic traversal.
     * Throws on traversal segments.
     */
    function sanitizeMacroFilePath(path) {
        const cleaned = stripNullBytes(path).trim();
        if (!cleaned) return cleaned;
        if (hasPathTraversalSegments(cleaned)) {
            throw new Error('Invalid macro path: traversal segment ("..") is not allowed');
        }
        return cleaned;
    }

    global.isPrivilegedSender = isPrivilegedSender;
    global.hasPathTraversalSegments = hasPathTraversalSegments;
    global.sanitizeMacroFilePath = sanitizeMacroFilePath;
})(typeof globalThis !== 'undefined' ? globalThis : this);

