/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

function sendResponse(response) {
    chrome.windows.getCurrent(null, function(w) {
        let bg = chrome.extension.getBackgroundPage()
        bg.dialogUtils.setDialogResult(w.id, response)
    })
}

function ok() {
    let pwd = document.getElementById("password")
    sendResponse({password: pwd.value});
    window.close()
}

function cancel() {
    sendResponse({canceled: true})
    window.close()
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
