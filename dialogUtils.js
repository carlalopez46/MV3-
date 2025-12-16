/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

const RETRY_DELAY_MS = 200;
const MAX_RETRY_ATTEMPTS = 30;

/**
 * Safely get a required DOM element by ID.
 * @param {string} id - The element ID
 * @returns {HTMLElement|null} The element or null if not found
 */
function getRequiredElement(id) {
    if (typeof id !== 'string') {
        console.error('[iMacros] getRequiredElement requires a non-empty string id');
        return null;
    }

    const trimmedId = id.trim();
    if (!trimmedId) {
        console.error('[iMacros] getRequiredElement requires a non-empty string id');
        return null;
    }

    const element = document.getElementById(trimmedId);
    if (!element) {
        console.error(`[iMacros] Required element "${trimmedId}" was not found`);
    }
    return element;
}

/**
 * Safely resize a dialog window to fit its content.
 * @param {HTMLElement} containerElement - The container element
 * @param {string} contextLabel - Label for error messages
 * @returns {boolean} True if resize was successful
 */
function safeResizeDialog(containerElement, contextLabel = 'dialog') {
    if (typeof resizeToContent !== 'function') {
        console.error(`[iMacros] resizeToContent is not available; cannot size ${contextLabel}`);
        return false;
    }

    if (!containerElement) {
        console.error(`[iMacros] ${contextLabel} container element missing; cannot resize`);
        return false;
    }

    resizeToContent(window, containerElement);
    return true;
}

function getDialogArgs(windowId, callback, attemptsLeft = MAX_RETRY_ATTEMPTS) {
    chrome.runtime.sendMessage({
        type: 'GET_DIALOG_ARGS',
        windowId: windowId
    }, function (result) {
        if (chrome.runtime.lastError || !result || !result.success) {
            const error = chrome.runtime.lastError ? chrome.runtime.lastError.message : (result ? result.error : 'Unknown error');
            console.warn(`[iMacros] Failed to get dialog args: ${error}`);
            if (attemptsLeft > 0) {
                const attemptNumber = MAX_RETRY_ATTEMPTS - attemptsLeft + 1;
                console.log(`[iMacros] Retrying getDialogArgs (${attemptNumber}/${MAX_RETRY_ATTEMPTS})...`);
                setTimeout(() => getDialogArgs(windowId, callback, attemptsLeft - 1), RETRY_DELAY_MS);
            } else {
                console.error('[iMacros] Max retries reached for getDialogArgs. Aborting.');
                callback(null);
            }
            return;
        }
        callback(result.args);
    });
}
