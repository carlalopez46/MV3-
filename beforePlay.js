/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

var args = null;

async function play() {
    if (!args) {
        window.close();
        return;
    }

    var m = {
        source: args.source,
        name: args.name,
        bookmark_id: args.bookmark_id
    };
    var win_id = args.win_id;
    var showAgain = document.getElementById("checkbox").checked;

    try {
        await chrome.runtime.sendMessage({
            type: 'SET_PREFERENCE',
            key: "before-play-dialog",
            value: showAgain
        });

        await chrome.runtime.sendMessage({
            type: 'PLAY_MACRO',
            macro: m,
            win_id: win_id
        });
    } catch (err) {
        console.error('[iMacros] Failed to send message:', err);
    }
    window.close();
}

async function cancel() {
    if (!args) {
        window.close();
        return;
    }
    var showAgain = document.getElementById("checkbox").checked;
    try {
        await chrome.runtime.sendMessage({
            type: 'SET_PREFERENCE',
            key: "before-play-dialog",
            value: showAgain
        });
    } catch (err) {
        console.error('[iMacros] Failed to send message:', err);
    }
    window.close();
}



// Give the background/offscreen worker enough time to register dialog args
// before abandoning the dialog. Mirror the timing from promptDialog.js.
const RETRY_DELAY_MS = 200;
const DIALOG_ARGS_RETRY_WINDOW_MS = 6000;
const MAX_RETRY_ATTEMPTS = DIALOG_ARGS_RETRY_WINDOW_MS / RETRY_DELAY_MS;

async function getArguments(windowId, attemptsLeft = MAX_RETRY_ATTEMPTS) {
    try {
        const result = await chrome.runtime.sendMessage({
            type: 'GET_DIALOG_ARGS',
            windowId: windowId
        });
        if (chrome.runtime.lastError) {
            throw new Error(chrome.runtime.lastError.message);
        }
        if (!result || !result.success) {
            throw new Error(result?.error || 'Unknown error');
        }
        return result.args;
    } catch (err) {
        console.error("[iMacros] Failed to get dialog args:", err.message);
        // Retry to handle race where dialog args are not yet registered
        if (attemptsLeft > 0) {
            const attemptNumber = MAX_RETRY_ATTEMPTS - attemptsLeft + 1;
            console.log(`[iMacros] Retrying getArguments (${attemptNumber}/${MAX_RETRY_ATTEMPTS})...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            return getArguments(windowId, attemptsLeft - 1);
        }
        return null;
    }
}

window.addEventListener("load", async function (evt) {
    try {
        const w = await chrome.windows.getCurrent();
        const myArgs = await getArguments(w.id);

        if (!myArgs) {
            console.error("[iMacros] Failed to get dialog arguments");
            // Don't close immediately to allow debugging
            return;
        }
        args = myArgs;

        var x = document.getElementById("message").textContent;
        x = x.replace(/{{macroname}}/, args.name);
        document.getElementById("message").textContent = x;

        document.getElementById("play-button").focus();

        // Get the current preference value
        try {
            const response = await chrome.runtime.sendMessage({
                type: 'GET_PREFERENCE',
                key: "before-play-dialog"
            });
            if (response && response.success) {
                document.getElementById("checkbox").checked = response.value;
            }
        } catch (err) {
            console.warn("[iMacros] Failed to get preference:", err);
        }

        // add DOM event handlers
        document.getElementById("play-button").addEventListener("click", play);

        document.getElementById("cancel-button").addEventListener("click", cancel);
    } catch (err) {
        console.error("[iMacros] Failed to initialize dialog:", err);
    }

    resizeToContent(window, document.getElementById('container'));
    // prevent right-click
    document.body.oncontextmenu = function (e) {
        e.preventDefault();
        return false;
    };
}, true);
