/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/
/* global getRequiredElement, safeResizeDialog, getDialogArgs */

// Give the background/offscreen worker enough time to register dialog args
// before abandoning the dialog. Mirror the timing from promptDialog.js.
const RETRY_DELAY_MS = 200;
const DIALOG_ARGS_RETRY_WINDOW_MS = 6000;
const MAX_RETRY_ATTEMPTS = DIALOG_ARGS_RETRY_WINDOW_MS / RETRY_DELAY_MS;

// Global args variable populated from dialog arguments
let args = null;
let usernameInput = null;
let passwordInput = null;
let okButton = null;
let cancelButton = null;
let messageElement = null;

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
            console.error('[iMacros] Failed to get current window for login dialog:', chrome.runtime.lastError.message);
            window.close();
            return;
        }

        if (!w || typeof w.id !== 'number') {
            console.error('[iMacros] Invalid window reference while sending login dialog response');
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
    // Defensive check: ensure args are loaded before proceeding
    if (!args) {
        console.error("[iMacros] Login dialog args not available");
        window.close();
        return;
    }

    if (!usernameInput || !passwordInput) {
        console.error('[iMacros] Login dialog input elements missing');
        window.close();
        return;
    }

    const user = usernameInput.value;
    const pwd = passwordInput.value;

    // MV3: Send login credentials to background for processing
    // Background will handle encryption, recorder updates, and panel updates
    chrome.runtime.sendMessage({
        type: 'HANDLE_LOGIN_DIALOG',
        username: user,
        password: pwd,
        args: args
    }, function(result) {
        if (chrome.runtime.lastError) {
            console.error("[iMacros] Failed to send login data:", chrome.runtime.lastError.message);
            window.close();
            return;
        }
        if (!result || !result.success) {
            console.error("[iMacros] Background failed to process login:", result?.error);
            window.close();
            return;
        }

        // Send the auth response using the standard dialog result mechanism
        sendResponse(result.response);
    });
}

function cancel() {
    sendResponse({canceled: true});
}

window.addEventListener("load", function(evt) {
    if (typeof getRequiredElement !== 'function' || typeof safeResizeDialog !== 'function') {
        console.error('[iMacros] Dialog helpers are unavailable; closing login dialog');
        window.close();
        return;
    }

    chrome.windows.getCurrent(null, function(w) {
        if (chrome.runtime.lastError) {
            console.error('[iMacros] Failed to get current window for login dialog:', chrome.runtime.lastError.message);
            window.close();
            return;
        }

        if (!w || typeof w.id !== 'number') {
            console.error('[iMacros] Invalid window reference for login dialog');
            window.close();
            return;
        }

        getDialogArgs(w.id, function(myArgs) {
            if (!myArgs) {
                console.error("[iMacros] Failed to get dialog arguments");
                window.close();
                return;
            }

            if (typeof myArgs !== 'object') {
                console.error('[iMacros] Unexpected dialog arguments; expected object');
                window.close();
                return;
            }

            // Store args globally for ok() function
            args = myArgs;

            usernameInput = getRequiredElement('username');
            passwordInput = getRequiredElement('password');
            okButton = getRequiredElement('ok-button');
            cancelButton = getRequiredElement('cancel-button');
            messageElement = getRequiredElement('message');

            if (!usernameInput || !passwordInput || !okButton || !cancelButton || !messageElement) {
                console.error('[iMacros] Required login dialog elements missing; closing dialog');
                window.close();
                return;
            }

            if (!args.details || !args.details.challenger || typeof args.details.challenger.host !== 'string') {
                console.error('[iMacros] Missing challenger host information for login dialog');
                window.close();
                return;
            }

            if (typeof args.details.challenger.port !== 'number') {
                console.error('[iMacros] Invalid challenger port for login dialog');
                window.close();
                return;
            }

            const messageElementParts = [];
            const hostPortMessage = `${args.details.challenger.host}:${args.details.challenger.port} requires authentication.`;
            messageElementParts.push(hostPortMessage);
            if (args.details.realm) {
                messageElementParts.push(`Server message: ${args.details.realm}`);
            }
            const message = messageElementParts.join(' ');
            messageElement.innerText = message;

            usernameInput.addEventListener("keydown", function(e) {
                if (e.key === "Enter") ok();
            });
            passwordInput.addEventListener("keydown", function(e) {
                if (e.key === "Enter") ok();
            });
            okButton.addEventListener("click", ok);
            cancelButton.addEventListener("click", cancel);

            const containerElement = getRequiredElement('container');
            if (!containerElement) {
                console.error('[iMacros] Login dialog container element missing; closing dialog');
                window.close();
                return;
            }

            safeResizeDialog(containerElement, 'login dialog');
        });
    });
});