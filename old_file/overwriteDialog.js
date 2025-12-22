/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

var args;

window.addEventListener("load", function() {
    chrome.windows.getCurrent(null, function(w) {
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
            args = result.args;

            // Display the macro name
            document.getElementById("macro-name").textContent = args.macroName;

            // Resize and position window
            var mc = document.getElementById("main-container");
            var rc = mc.getBoundingClientRect();
            window.resizeTo(rc.width + 60, rc.height + 60);
            if (window.opener) {
                window.moveTo(
                    window.opener.screenX + window.opener.outerWidth / 2 - (rc.width + 60) / 2,
                    window.opener.screenY + window.opener.outerHeight / 2 - (rc.height + 60) / 2
                );
            }

            // Add event listeners
            document.getElementById("overwrite-button").addEventListener("click", overwrite);
            document.getElementById("save-new-button").addEventListener("click", saveAsNew);
            document.getElementById("cancel-button").addEventListener("click", cancel);

            // Focus on the Save as New button by default
            document.getElementById("save-new-button").focus();
        });
    });
});

function sendResponse(response) {
    chrome.windows.getCurrent(null, function (w) {
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
