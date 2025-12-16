/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/
/* global getRequiredElement, safeResizeDialog */
// Custom prompt function
// as alternative for JavaScript prompt()

// Give the background/offscreen worker enough time to register dialog args
// before abandoning the prompt. The offscreen handler retries for ~6 seconds,
// so mirror that window here to avoid closing the dialog prematurely.
const RETRY_DELAY_MS = 200;
const DIALOG_ARGS_RETRY_WINDOW_MS = 6000;
const MAX_RETRY_ATTEMPTS = DIALOG_ARGS_RETRY_WINDOW_MS / RETRY_DELAY_MS;

let promptInput = null;
let okButton = null;

function sendResponse(response) {
    chrome.windows.getCurrent(null, function (w) {
        if (chrome.runtime.lastError) {
            console.error('[iMacros] Failed to get current window for prompt dialog:', chrome.runtime.lastError.message);
            window.close();
            return;
        }

        if (!w || typeof w.id !== 'number') {
            console.error('[iMacros] Invalid window information for prompt dialog');
            window.close();
            return;
        }

        // MV3 compatible: Use chrome.runtime.sendMessage instead of getBackgroundPage
        chrome.runtime.sendMessage({
            type: 'SET_DIALOG_RESULT',
            windowId: w.id,
            response: response
        }, function (result) {
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

function getArguments(windowId, callback, attemptsLeft = MAX_RETRY_ATTEMPTS) {
    // MV3 compatible: Use chrome.runtime.sendMessage instead of getBackgroundPage
    chrome.runtime.sendMessage({
        type: 'GET_DIALOG_ARGS',
        windowId: windowId
    }, function (result) {
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

function ok() {
    if (!promptInput) {
        console.error('[iMacros] Prompt input element is not available');
        window.close();
        return;
    }
    const promptValue = promptInput.value;
    sendResponse({ inputValue: promptValue });
    // window.close() is now called in sendResponse callback
}

function cancel() {
    sendResponse({ canceled: true });
    // window.close() is now called in sendResponse callback
}

window.addEventListener("load", function () {

    if (typeof getRequiredElement !== 'function' || typeof safeResizeDialog !== 'function') {
        console.error('[iMacros] Dialog helpers are unavailable; closing prompt dialog');
        window.close();
        return;
    }

    chrome.windows.getCurrent(null, function (w) {
        if (chrome.runtime.lastError) {
            console.error('[iMacros] Failed to get current window for prompt dialog:', chrome.runtime.lastError.message);
            window.close();
            return;
        }

        if (!w || typeof w.id !== 'number') {
            console.error('[iMacros] Invalid window reference for prompt dialog');
            window.close();
            return;
        }

        getArguments(w.id, function (myArgs) {
            if (!myArgs) {
                console.error("[iMacros] Failed to get dialog arguments");
                // Notify logic (Offscreen/Background) that we are closing to prevent hang
                sendResponse({ canceled: true });
                // window.close() is called inside sendResponse
                return;
            }

            if (typeof myArgs !== 'object') {
                console.error('[iMacros] Unexpected dialog arguments; expected object');
                window.close();
                return;
            }
            const dataField = getRequiredElement('data-field');
            promptInput = getRequiredElement('prompt-input-text');
            okButton = getRequiredElement('ok-button');

            if (!dataField || !promptInput || !okButton) {
                console.error('[iMacros] Dialog elements missing; closing prompt dialog');
                window.close();
                return;
            }

            if (typeof myArgs.text !== 'string') {
                console.error('[iMacros] Invalid prompt text received');
                window.close();
                return;
            }

            const promptType = myArgs.type;
            if (promptType !== 'askInput' && promptType !== 'alert') {
                console.error('[iMacros] Unsupported prompt dialog type:', promptType);
                window.close();
                return;
            }

            const containerElement = getRequiredElement('container');
            if (!containerElement) {
                console.error('[iMacros] Prompt dialog container missing; closing prompt dialog');
                window.close();
                return;
            }

            dataField.textContent = myArgs.text;
            okButton.addEventListener("click", ok);
            okButton.focus();
            okButton.addEventListener("keydown", function (e) {
                if (e.key === "Enter" || e.key === " ") {
                    ok();
                    e.preventDefault();
                }
            });
            // prompt dialog: type = askInput
            if (promptType === "askInput") {
                if (typeof myArgs.default !== "undefined") {
                    promptInput.defaultValue = String(myArgs.default);
                }
                promptInput.focus();
                promptInput.select();
                promptInput.addEventListener("keydown", function (e) {
                    if (e.key === "Enter") ok();
                });
                const buttonsContainer = getRequiredElement('buttons');
                if (!buttonsContainer) {
                    console.error('[iMacros] Buttons container missing; closing prompt dialog');
                    window.close();
                    return;
                }

                const cancelButton = document.createElement("div");
                cancelButton.id = "cancel-button";
                cancelButton.className = "button icon-button";
                cancelButton.innerHTML = "<span>Cancel</span>";
                cancelButton.addEventListener("click", cancel);
                buttonsContainer.appendChild(cancelButton);

                safeResizeDialog(containerElement, 'prompt dialog');
            }
            // alert dialog: type = alert
            else {
                promptInput.style.display = "none";
                //document.getElementById("buttons").style.webkitBoxPack = "end"; // moves the button to right
                safeResizeDialog(containerElement, 'prompt dialog');
            }
        });
    });
    // document.addeventlistener("keypress", function (e) {
    //    if (e.which == 13) ok();
    // });

    // prevent right-click
    document.body.oncontextmenu = function (e) {
        e.preventDefault();
        return false;
    };
}, true);