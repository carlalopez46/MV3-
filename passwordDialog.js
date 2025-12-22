/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/
/* global getRequiredElement, safeResizeDialog, link, getRedirectURL */

// Give the background/offscreen worker enough time to register dialog args
// before abandoning the dialog. Mirror the timing from promptDialog.js.
const RETRY_DELAY_MS = 200;
const DIALOG_ARGS_RETRY_WINDOW_MS = 6000;
const MAX_RETRY_ATTEMPTS = DIALOG_ARGS_RETRY_WINDOW_MS / RETRY_DELAY_MS;

let passwordInput = null;
let okButton = null;
let cancelButton = null;

function getArguments(windowId, callback, attemptsLeft = MAX_RETRY_ATTEMPTS) {
    // MV3 compatible: Use chrome.runtime.sendMessage instead of getBackgroundPage
    chrome.runtime.sendMessage({
        type: 'GET_DIALOG_ARGS',
        windowId: windowId
    }, function(result) {
        if (chrome.runtime.lastError) {
            console.error("[iMacros] Failed to get dialog args:", chrome.runtime.lastError.message);
            // Retry to handle race where dialog args are not yet registered
            if (attemptsLeft > 0) {
                const attemptNumber = MAX_RETRY_ATTEMPTS - attemptsLeft + 1;
                console.log(`[iMacros] Retrying getArguments (${attemptNumber}/${MAX_RETRY_ATTEMPTS})...`);
                setTimeout(() => getArguments(windowId, callback, attemptsLeft - 1), RETRY_DELAY_MS);
            } else {
                callback(null);
            }
            return;
        }
        if (!result || !result.success) {
            console.error("[iMacros] Background failed to get dialog args:", result?.error);
            if (attemptsLeft > 0) {
                const attemptNumber = MAX_RETRY_ATTEMPTS - attemptsLeft + 1;
                console.log(`[iMacros] Retrying getArguments (${attemptNumber}/${MAX_RETRY_ATTEMPTS})...`);
                setTimeout(() => getArguments(windowId, callback, attemptsLeft - 1), RETRY_DELAY_MS);
            } else {
                callback(null);
            }
            return;
        }
        callback(result.args);
    });
}

function sendResponse(response) {
    chrome.windows.getCurrent(null, function(w) {
        if (chrome.runtime.lastError) {
            console.error('[iMacros] Failed to get current window for password dialog:', chrome.runtime.lastError.message);
            window.close();
            return;
        }

        if (!w || typeof w.id !== 'number') {
            console.error('[iMacros] Invalid window reference while sending password dialog response');
            window.close();
            return;
        }

        // MV3 compatible: Use chrome.runtime.sendMessage instead of getBackgroundPage
        chrome.runtime.sendMessage({
            type: 'SET_DIALOG_RESULT',
            windowId: w.id,
            response: response
        }, function(result) {
            if (chrome.runtime.lastError) {
                console.error("[iMacros] Failed to send dialog result:", chrome.runtime.lastError.message);
            } else if (!result || !result.success) {
                console.error("[iMacros] Background failed to process dialog result:", result?.error);
            }
            // Always close the window, even if there was an error
            window.close();
        });
    });
}

function ok() {
    if (!passwordInput) {
        console.error('[iMacros] Password input element is not available');
        window.close();
        return;
    }
    const pwd = passwordInput.value;
    sendResponse({ password: pwd });
    // window.close() is now called in sendResponse callback
}

function cancel() {
    sendResponse({ canceled: true });
    // window.close() is now called in sendResponse callback
}

window.addEventListener("load", function() {
    if (typeof getRequiredElement !== 'function' || typeof safeResizeDialog !== 'function') {
        console.error('[iMacros] Dialog helpers are unavailable; closing password dialog');
        window.close();
        return;
    }

    chrome.windows.getCurrent(null, function(w) {
        if (chrome.runtime.lastError) {
            console.error('[iMacros] Failed to get current window for password dialog:', chrome.runtime.lastError.message);
            window.close();
            return;
        }

        if (!w || typeof w.id !== 'number') {
            console.error('[iMacros] Invalid window reference for password dialog');
            window.close();
            return;
        }

        getArguments(w.id, function(myArgs) {
            // Note: Password dialog may not require args, but we still attempt to fetch them
            // for consistency. If args are truly required, add validation here.

            passwordInput = getRequiredElement('password');
            okButton = getRequiredElement('ok-button');
            cancelButton = getRequiredElement('cancel-button');

            if (!passwordInput || !okButton || !cancelButton) {
                console.error('[iMacros] Required password dialog elements missing; closing dialog');
                window.close();
                return;
            }

            passwordInput.focus();

            // Set up "More Info" link for encryption information
            const moreInfoElement = document.getElementById('more-info-encryption');
            if (moreInfoElement && typeof link === 'function' && typeof getRedirectURL === 'function') {
                moreInfoElement.addEventListener("click", function() {
                    link(getRedirectURL('!ENCRYPTION'));
                });
            }

            // Resize dialog to fit content
            const containerElement = getRequiredElement('container');
            if (containerElement) {
                safeResizeDialog(containerElement, 'password dialog');
            }

            // Add event listeners
            passwordInput.addEventListener("keydown", function(e) {
                if (e.key === "Enter") ok();
            });
            okButton.addEventListener("click", ok);
            cancelButton.addEventListener("click", cancel);
        });
    });

    // Prevent right-click
    document.body.oncontextmenu = function(e) {
        e.preventDefault();
        return false;
    };
}, true);
