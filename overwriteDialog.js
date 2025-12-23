/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/
/* global getRequiredElement, safeResizeDialog */

let args;

window.addEventListener("load", function() {
    if (typeof getRequiredElement !== 'function' || typeof safeResizeDialog !== 'function') {
        console.error('[iMacros] Dialog helpers are unavailable; closing overwrite dialog');
        window.close();
        return;
    }

    chrome.windows.getCurrent(null, function(w) {
        if (chrome.runtime.lastError) {
            console.error('[iMacros] Failed to get current window for overwrite dialog:', chrome.runtime.lastError.message);
            window.close();
            return;
        }

        if (!w || typeof w.id !== 'number') {
            console.error('[iMacros] Invalid window reference for overwrite dialog');
            window.close();
            return;
        }

        // MV3 compatible: Use chrome.runtime.sendMessage instead of getBackgroundPage
        chrome.runtime.sendMessage({
            type: 'GET_DIALOG_ARGS',
            windowId: w.id
        }, function(result) {
            if (chrome.runtime.lastError) {
                console.error("[iMacros] Failed to get dialog args:", chrome.runtime.lastError.message);
                window.close();
                return;
            }
            if (!result || !result.success) {
                console.error("[iMacros] Background failed to get dialog args:", result?.error);
                window.close();
                return;
            }
            if (!result.args || typeof result.args !== 'object') {
                console.error('[iMacros] Invalid dialog arguments received');
                window.close();
                return;
            }

            args = result.args;

            // Display the macro name
            const macroNameElement = getRequiredElement('macro-name');
            if (!macroNameElement) {
                console.error('[iMacros] Macro name element missing; closing overwrite dialog');
                window.close();
                return;
            }

            if (typeof args.macroName !== 'string' || !args.macroName.trim()) {
                console.error('[iMacros] Invalid macro name provided to overwrite dialog');
                window.close();
                return;
            }

            macroNameElement.textContent = args.macroName;

            // Resize and position window
            const mc = getRequiredElement('main-container');
            if (!mc) {
                console.error('[iMacros] Main container missing; closing overwrite dialog');
                window.close();
                return;
            }

            const rc = mc.getBoundingClientRect();
            if (!Number.isFinite(rc.width) || !Number.isFinite(rc.height)) {
                console.error('[iMacros] Failed to measure overwrite dialog size; closing dialog');
                window.close();
                return;
            }

            const fallbackWidth = rc.width + 60;
            const fallbackHeight = rc.height + 60;

            const resized = safeResizeDialog(mc, 'overwrite dialog');
            if (!resized) {
                window.resizeTo(fallbackWidth, fallbackHeight);
            }

            const widthForPosition = resized && Number.isFinite(window.outerWidth)
                ? window.outerWidth
                : fallbackWidth;
            const heightForPosition = resized && Number.isFinite(window.outerHeight)
                ? window.outerHeight
                : fallbackHeight;

            if (window.opener) {
                window.moveTo(
                    window.opener.screenX + window.opener.outerWidth / 2 - widthForPosition / 2,
                    window.opener.screenY + window.opener.outerHeight / 2 - heightForPosition / 2
                );
            }

            // Add event listeners
            const overwriteButton = getRequiredElement('overwrite-button');
            const saveNewButton = getRequiredElement('save-new-button');
            const cancelButton = getRequiredElement('cancel-button');

            if (!overwriteButton || !saveNewButton || !cancelButton) {
                console.error('[iMacros] Missing dialog buttons; closing overwrite dialog');
                window.close();
                return;
            }

            overwriteButton.addEventListener("click", overwrite);
            saveNewButton.addEventListener("click", saveAsNew);
            cancelButton.addEventListener("click", cancel);

            // Focus on the Save as New button by default
            saveNewButton.focus();
        });
    });
});

function sendResponse(response) {
    chrome.windows.getCurrent(null, function (w) {
        if (chrome.runtime.lastError) {
            console.error('[iMacros] Failed to get current window for overwrite dialog response:', chrome.runtime.lastError.message);
            window.close();
            return;
        }

        if (!w || typeof w.id !== 'number') {
            console.error('[iMacros] Invalid window reference while sending overwrite dialog response');
            window.close();
            return;
        }

        // MV3 compatible: Use chrome.runtime.sendMessage instead of callback
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

function overwrite() {
    sendResponse({action: "overwrite"});
}

function saveAsNew() {
    sendResponse({action: "save-new"});
}

function cancel() {
    sendResponse({action: "cancel"});
}
