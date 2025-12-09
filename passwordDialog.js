/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

function sendResponse(response) {
    chrome.windows.getCurrent(null, function(w) {
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
    let pwd = document.getElementById("password")
    sendResponse({password: pwd.value});
    // window.close() is now called in sendResponse callback
}

function cancel() {
    sendResponse({canceled: true});
    // window.close() is now called in sendResponse callback
}

window.addEventListener("load", function(evt) {
    document.getElementById("password").focus()
    document.getElementById("more-info-encryption").addEventListener("click", function() {
        link(getRedirectURL('!ENCRYPTION'));
    });
    resizeToContent(window, document.getElementById('container'));
    document.getElementById("password").addEventListener("keypress", function(e) {
        if (e.which == 13) ok();
    });
    document.getElementById("ok-button").addEventListener("click", ok);
    document.getElementById("cancel-button").addEventListener("click", cancel);
    // prevent right-click
    document.body.oncontextmenu = function(e) {
        e.preventDefault();
        return false;
    };
}, true);
