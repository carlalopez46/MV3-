/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

"use strict";

// Helper to get tab info, proxying to Service Worker if needed (Offscreen Document support)
function getTab(tabId) {
    return new Promise((resolve, reject) => {
        if (chrome.tabs && chrome.tabs.get) {
            chrome.tabs.get(tabId, (tab) => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve(tab);
            });
        } else {
            chrome.runtime.sendMessage({ command: 'TAB_GET', tab_id: tabId }, (response) => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else if (response && response.error) reject(new Error(response.error));
                else if (response && response.tab) resolve(response.tab);
                else reject(new Error('Tab not found'));
            });
        }
    });
}

// An object to encapsulate all recording operations
// on extension side
function Recorder(win_id) {
    this.win_id = win_id;
    this.recording = false;
    this.actions = [];
    this.lastTabUrls = new Map();
    communicator.registerHandler("record-action",
        this.onRecordAction.bind(this), win_id);
    communicator.registerHandler("password-element-focused",
        this.onPasswordElementFocused.bind(this),
        win_id)
    communicator.registerHandler("query-state",
        this.onQueryState.bind(this), win_id);
    // make bindings of event listeners
    this.onActivated = this.onTabActivated.bind(this);
    this.onCreated = this.onTabCreated.bind(this);
    this.onUpdated = this.onTabUpdated.bind(this);
    this.onRemoved = this.onTabRemoved.bind(this);
    this.onMoved = this.onTabMoved.bind(this);
    this.onAttached = this.onTabAttached.bind(this);
    this.onDetached = this.onTabDetached.bind(this);

    // Note: Chrome Debugger Protocol integration is currently disabled.
    // These methods were intended for advanced event recording but are not used
    // in the current implementation. Event mode uses content script injection instead.
    // Debugger protocol
    // this.onEvent = this.onDebugProtoEvent.bind(this);
    // this.onDetach = this.onDebuggerDetached.bind(this);

    // bindings to monitor network activity
    this.onAuth = this.onAuthRequired.bind(this);
    // this.onRequest = this.onBeforeRequest.bind(this);
    // this.onRedirect = this.onBeforeRedirect.bind(this);
    // this.onSendHeaders = this.onBeforeSendHeaders.bind(this);
    // this.onCompleted = this.onReqCompleted.bind(this);
    // this.onReqError = this.onErrorOccurred.bind(this);

    // Restore state from session storage in case of Offscreen restart
    this.restoreState();
    // this.onHeaders = this.onHeadersReceived.bind(this);
    // this.onResponse = this.onResponseStarted.bind(this);
    // this.onSend = this.onSendHeaders.bind(this);

    this.onCommitted = this.onNavigation.bind(this);
    this._onDownloadCreated = this.onDownloadCreated.bind(this);
    this._onContextMenu = this.onContextMenu.bind(this);
};


Recorder.prototype.checkForFrameChange = function (frame) {
    if (frame.number != this.currentFrameNumber) {
        this.currentFrameNumber = frame.number;
        if (0 && frame.name) {
            this.recordAction("FRAME NAME=\"" + frame.name + "\"");
        } else {
            this.recordAction("FRAME F=" + frame.number.toString());
        }
    }
};


Recorder.prototype.start = function () {
    // console.info("start recording");
    this.writeEncryptionType = true;
    this.password = null;
    this.canEncrypt = true
    context.updateState(this.win_id, "recording");
    // MV3: Send message to panel
    try {
        chrome.runtime.sendMessage({
            type: 'PANEL_SHOW_LINES',
            panelWindowId: context[this.win_id].panelId,
            data: { code: null } // Clear lines or show empty
        });
        chrome.runtime.sendMessage({
            type: 'PANEL_SET_STAT_LINE',
            panelWindowId: context[this.win_id].panelId,
            data: { txt: "Recording...", type: "info" }
        });
    } catch (e) { /* ignore */ }
    // create array to store recorded actions
    this.actions = new Array();
    var recorder = this;

    // In Offscreen Document, chrome.tabs is not available, so we need to proxy through Service Worker
    function queryActiveTab() {
        return new Promise((resolve, reject) => {
            if (chrome.tabs && chrome.tabs.query) {
                // Direct access (Service Worker or extension page)
                chrome.tabs.query({ active: true, windowId: recorder.win_id }, (tabs) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(tabs);
                    }
                });
            } else {
                // Proxy through Service Worker (Offscreen Document)
                console.log('[Recorder] Requesting active tab from Service Worker');
                chrome.runtime.sendMessage({
                    command: 'get_active_tab',
                    win_id: recorder.win_id
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else if (response && response.error) {
                        reject(new Error(response.error));
                    } else if (response && response.tab) {
                        resolve([response.tab]);
                    } else {
                        reject(new Error('Invalid response from Service Worker'));
                    }
                });
            }
        });
    }

    queryActiveTab().then(function (tabs) {
        if (!tabs || tabs.length === 0) {
            logWarning("No active tabs found in Recorder.start", { win_id: recorder.win_id });
            // Reset state on failure
            context.updateState(recorder.win_id, "idle");
            if (context[recorder.win_id]) {
                try {
                    chrome.runtime.sendMessage({
                        type: 'PANEL_SET_STAT_LINE',
                        panelWindowId: context[recorder.win_id].panelId,
                        data: { txt: "Recording failed: No active tab found", type: "error" }
                    });
                } catch (e) { /* ignore */ }
            }
            return;
        }
        recorder.recording = true;
        // save starting tab index
        recorder.startTabIndex = tabs[0].index;
        // recorder.tab_id = tabs[0].id;
        // add browser events listeners
        recorder.addListeners();
        // reset frame number
        recorder.currentFrameNumber = 0;
        // notify content script that recording was started
        var recordMode = Storage.getChar("record-mode");
        // Fix: Default to 'conventional' if recordMode is empty
        if (!recordMode || recordMode === '') {
            console.warn("[iMacros] record-mode is empty in storage, defaulting to 'conventional'");
            recordMode = 'conventional';
        }
        console.log('[Recorder] Broadcasting start-recording message');
        communicator.broadcastMessage("start-recording", {
            args: {
                favorId: Storage.getBool("recording-prefer-id"),
                cssSelectors: Storage.getBool("recording-prefer-css-selectors"),
                recordMode: recordMode
            }
        }, recorder.win_id);
        // save intial commands
        recorder.recordAction("VERSION BUILD=" + Storage.getChar("version").replace(/\./g, "") + " RECORDER=CR");
        recorder.recordAction("TAB T=1");
        if (!/^chrome:\/\//.test(tabs[0].url)) {
            console.log("[iMacros MV3 Recorder] Recording initial URL: " + tabs[0].url);
            recorder.recordAction("URL GOTO=" + tabs[0].url);
        } else {
            console.log("[iMacros MV3 Recorder] Skipping chrome:// URL in initial recording");
        }
        recorder.saveState();
    }).catch(function (error) {
        logError("Failed to query tabs in Recorder.start: " + (error.message || error), { win_id: recorder.win_id });
        // Reset state on failure
        context.updateState(recorder.win_id, "idle");
        if (context[recorder.win_id]) {
            try {
                chrome.runtime.sendMessage({
                    type: 'PANEL_SET_STAT_LINE',
                    panelWindowId: context[recorder.win_id].panelId,
                    data: { txt: "Recording failed: Cannot access active tab", type: "error" }
                });
            } catch (e) { /* ignore */ }
        }
    });
};


Recorder.prototype.stop = function () {
    // console.info("stop recording");
    // notify content script that recording was stopped
    communicator.broadcastMessage("stop-recording", {}, this.win_id);
    context.updateState(this.win_id, "idle");

    this.recording = false;

    // Note: Macro saving is handled by offscreen_bg.js or bg.js after recorder.stop() is called.
    // This ensures proper tree-type detection and fallback to bookmarks when file system is unavailable.

    // Clear saved state
    if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.remove("recorder_state_" + this.win_id);
    }
    this.removeListeners();
    // remove text from badge
    badge.clearText(this.win_id);
    // MV3: Send message to panel
    try {
        chrome.runtime.sendMessage({
            type: 'PANEL_SHOW_MACRO_TREE',
            panelWindowId: context[this.win_id].panelId
        });
    } catch (e) { /* ignore */ }
};


Recorder.prototype.terminate = function () {
    if (Storage.getBool("debug"))
        console.info("terminating recorder for window " + this.win_id);
    // ensure that recorder is stopped
    if (this.recording)
        this.stop();
    else
        // If not recording, still need to clean up listeners
        this.removeListeners();
};


Recorder.prototype.beforeRecordAction = function (cmd) {
    // check for double-command
    var match_part = cmd;
    if (/^(tag .*\s+content\s*=)/i.test(cmd))
        match_part = RegExp.$1;
    if (!/^event/i.test(cmd) &&
        this.actions.length &&
        this.actions[this.actions.length - 1].indexOf(match_part) == 0) {
        // remove previously recorded element if it matches
        // with the current one
        // useful for selectboxes and double clicking
        this.popLastAction()
    }
};

Recorder.prototype.recordAction = function (cmd) {
    if (!this.actions) {
        // Recording not started or already stopped
        console.warn("[iMacros Recorder] recordAction called but actions array is undefined. Recording not active? Sending stop-recording to sync.");
        // Sync state with content script to stop it
        communicator.broadcastMessage("stop-recording", {}, this.win_id);
        return false;
    }

    if (!this.recording) {
        console.warn("[iMacros Recorder] Ignoring recordAction while recorder is idle", { action: cmd, win_id: this.win_id });
        return false;
    }

    if (typeof cmd !== "string" || cmd.length === 0) {
        console.warn("[iMacros Recorder] Ignoring invalid recordAction payload", { type: typeof cmd, win_id: this.win_id });
        return false;
    }

    this.beforeRecordAction(cmd);
    // MV3: Send message to panel
    try {
        chrome.runtime.sendMessage({
            type: 'PANEL_ADD_LINE',
            panelWindowId: context[this.win_id].panelId,
            data: { txt: cmd }
        });
    } catch (e) { /* ignore */ }
    this.actions.push(cmd);

    badge.set(this.win_id, {
        status: "recording",
        text: this.actions.length.toString()
    });

    this.afterRecordAction(cmd);
    // console.info("recorded action: "+cmd);
    this.saveState();
    return true;
}

Recorder.prototype.recordActions = function (...actions) {
    actions.forEach(this.recordAction.bind(this))
}


Recorder.prototype.afterRecordAction = function (rec) {
}

Recorder.prototype.recordEncryptionType = function () {
    let typ = Storage.getChar("encryption-type")
    if (!typ.length)
        typ = "no"
    let enc_types = {
        "no": "SET !ENCRYPTION NO",
        "stored": "SET !ENCRYPTION STOREDKEY",
        "tmpkey": "SET !ENCRYPTION TMPKEY"
    }
    let password_promise = null
    if (typ == "no") {
        password_promise = Promise.resolve({ canceled: true });
    } else if (typ == "stored") {
        let pwd = Storage.getChar("stored-password")
        // stored password is base64 encoded
        pwd = decodeURIComponent(atob(pwd))
        password_promise = Promise.resolve({ password: pwd })
    } else if (typ == "tmpkey") {
        password_promise = Rijndael.tempPassword ?
            Promise.resolve({
                password: Rijndael.tempPassword
            }) : dialogUtils.openDialog("passwordDialog.html",
                "iMacros Password Dialog",
                { type: "askPassword" })
    }

    password_promise.then(response => {
        this.recordAction(
            enc_types[response.canceled ? "no" : typ]
        )
        if (!response.canceled) {
            this.password = response.password
            if (typ == "tmpkey")
                Rijndael.tempPassword = response.password
        } else {
            this.canEncrypt = false
        }
    }).catch(err => {
        console.error("Error in password dialog:", err);
        this.canEncrypt = false;
    })
}

Recorder.prototype.onPasswordElementFocused = function (data, tab_id, callback) {
    typeof callback === "function" &&
        callback()

    if (!this.writeEncryptionType)
        return

    this.writeEncryptionType = false

    // onPasswordElementFocused is called when a password element gets focus. To
    // not break the sequence of events we defer writing encryption time until
    // we get click or keyup events. In case the focus was gained by any other
    // means, e.g. throw changing tab we write the encryption type straight
    // away.
    let cur = this.peekLastAction()
    if (cur.indexOf("EVENT TYPE=KEYDOWN") == 0)
        this.pendingEncRecord = "keydown"
    else if (cur.indexOf("EVENT TYPE=MOUSEDOWN") == 0)
        this.pendingEncRecord = "mousedown"
    else
        this.recordEncryptionType()
}

Recorder.prototype.onRecordAction = function (data, tab_id, callback) {
    if (!data || typeof data.action !== "string" || data.action.length === 0) {
        console.warn("[iMacros Recorder] Received malformed record-action payload", { hasData: !!data, tab_id: tab_id });
        typeof callback === "function" && callback({ error: "invalid-payload" });
        return;
    }

    if (!this.recording) {
        console.warn("[iMacros Recorder] Dropping record-action because recorder is not active", { tab_id: tab_id });
        typeof callback === "function" && callback({ error: "not-recording" });
        return;
    }

    console.log("[DEBUG] onRecordAction called - action:", data.action, "tab_id:", tab_id);

    if (data._frame) {
        this.checkForFrameChange(data._frame);
    }

    let in_event_mode = Storage.getChar("record-mode") == "event"
    console.log("[DEBUG] Recording action, in_event_mode:", in_event_mode);

    const recorded = this.recordAction(data.action)
    if (!recorded) {
        typeof callback === "function" && callback({ error: "record-failed" });
        return;
    }

    // test action for password element
    if (!in_event_mode && data.extra && data.extra.encrypt) {
        // handle password
        this.encryptTagCommand()
    } else if (in_event_mode && data.extra) {
        this.packAction(data.extra)
    }

    typeof callback === "function" &&   // release resources
        callback({ ok: true });
}


Recorder.prototype.removeLastLine = function (n) {
    var num = n || 1;
    // MV3: Send message to panel
    try {
        while (num--) {
            chrome.runtime.sendMessage({
                type: 'PANEL_REMOVE_LAST_LINE',
                panelWindowId: context[this.win_id].panelId
            });
        }
    } catch (e) { /* ignore */ }
};

Recorder.prototype.peekLastAction = function () {
    return this.actions.length ? this.actions[this.actions.length - 1] : ""
}

Recorder.prototype.popLastAction = function () {
    if (this.actions.length === 0) {
        console.warn("popLastAction called but action list is empty");
        return null;
    }
    this.removeLastLine()
    return this.actions.pop()
}

Recorder.prototype.popLastActions = function (n) {
    console.assert(this.actions.length >= n, "popLastActions is called" +
        " but action list doesn't have enough items")
    let arr = []
    while (n-- > 0) {
        this.removeLastLine()
        arr.push(this.actions.pop())
    }
    // Returns array in reverse chronological order: [last, second-to-last, third-to-last, ...]
    return arr
}

Recorder.prototype.packClickEvent = function (extra) {
    if (this.actions.length < 3) return;
    console.assert(this.actions.length >= 3, "click event should be " +
        "preceded by at least three actions");
    let mdown_action = "EVENT TYPE=MOUSEDOWN SELECTOR=\"" +
        extra.selector + "\""
    let mup_action = "EVENT TYPE=MOUSEUP"
    let [cur, prv, pprv] = this.popLastActions(3)
    if (pprv.indexOf(mdown_action) == 0 &&
        prv.indexOf(mup_action) == 0) {
        this.recordAction(cur)
        if (this.pendingEncRecord == "mousedown") {
            this.recordEncryptionType()
            delete this.pendingEncRecord
        }
    } else {
        this.recordActions(pprv, prv, cur)
    }
}

Recorder.prototype.packDblClickEvent = function (extra) {
    if (this.actions.length < 3) return;
    console.assert(this.actions.length >= 3, "dblclick event should be " +
        "preceded by at least three actions")
    let click_action = "EVENT TYPE=CLICK SELECTOR=\"" + extra.selector + "\""
    let [cur, prv, pprv] = this.popLastActions(3)
    if (prv.indexOf(click_action) == 0 &&
        pprv.indexOf(click_action) == 0) {
        this.recordAction(cur)
    } else {
        this.recordActions(pprv, prv, cur)
    }
}

Recorder.prototype.packMouseMoveEvent = function (extra) {
    if (this.actions.length < 2) return;
    const re = new RegExp('^events? type=mousemove\\b.+' +
        '\\points?="(\\S+)"', "i")
    let [cur, prv] = this.popLastActions(2)
    if (this.actions.length && this.prevTarget == extra.selector) {
        let m = re.exec(prv)
        if (m) {
            // Note: Modifier keys during drag operations
            // It is possible that the user presses/releases modifier keys (Shift, Ctrl, Alt)
            // in the middle of a drag operation. However, since only the final modifier state
            // typically affects the operation's outcome, we record the last modifier state.
            // This approach works correctly for most practical use cases.
            this.recordAction(
                "EVENTS TYPE=MOUSEMOVE SELECTOR=\"" + extra.selector + "\"" +
                " POINTS=\"" + m[1].toString() +
                ",(" + extra.point.x + "," + extra.point.y + ")\"" +
                (extra.modifiers ?
                    " MODIFIERS=\"" + extra.modifiers + "\"" : "")
            )
        }
    } else {
        this.prevTarget = extra.selector
        this.recordActions(prv, cur)
    }
};


Recorder.prototype.packKeyDownEvent = function (extra) {
    // basically it is only needed to save prevTarget as all the work is
    // done on keyup
    this.prevTarget = extra.selector
}

Recorder.prototype.packKeyboardEvents = function (extra) {
    if (this.actions.length < 2) return;
    // check if the just recorded keypress action can be merged with previous
    // EVENTS command (for sucessive input)
    const chars_re = new RegExp('^events? type=keypress selector=\"([^\"]+)\"' +
        ' chars?=\"([^\"]+)\"', "i")
    const keys_re = new RegExp("^events? type=keypress selector=\"([^\"]+)\"" +
        " (keys?)=(?:(\\d+)|\"([^\"]+)\")" +
        "(?: modifiers=\"([^\"]+)\")?", "i")
    const ch_re = new RegExp("^events? type=keypress selector=\"([^\"]+)\"" +
        " chars?=\"([^\"]+)\"", "i")
    const kd_re = new RegExp("^event type=keypress selector=\"([^\"]+)\"" +
        " key=(\\d+)(?: modifiers=\"([^\"]+)\")?", "i")

    let [cur, prv] = this.popLastActions(2)
    let cur_match = null
    let prv_match = null

    // first check if it is a char event and the previous EVENTS for the same
    // selectors are chars as well
    if ((cur_match = cur.match(ch_re)) &&
        (prv_match = prv.match(chars_re)) &&
        cur_match[1] == prv_match[1]) {
        let ch = imns.unwrap(cur_match[2])
        let chars = imns.unwrap(prv_match[2])
        if (this.encryptKeypressEvent && this.canEncrypt) {
            this.encryptKeypressEvent = false
            // decrypt chars from the previous event
            try {
                ch = Rijndael.decryptString(ch, this.password)
                chars = Rijndael.decryptString(chars, this.password)
            } catch (e) {
                // we can not continue if password is incorrect
                showInfo({
                    message: "Encryption type or stored password was changed" +
                        " while recording!",
                    win_id: this.win_id,
                })
                return
            }
            chars = Rijndael.encryptString(chars + ch, this.password)
        } else {
            chars += ch
        }

        this.recordAction(
            "EVENTS TYPE=KEYPRESS SELECTOR=\"" + cur_match[1] + "\"" +
            " CHARS=\"" + imns.escapeLine(chars) + "\""
        )
    }
    // then check the same for control key sequence
    else if ((cur_match = cur.match(kd_re)) &&
        (prv_match = prv.match(keys_re)) &&
        cur_match[1] == prv_match[1] &&
        cur_match[5] == prv_match[5]) {
        let keys = prv_match[2] == "KEYS" ?
            JSON.parse(prv_match[4]) : [JSON.parse(prv_match[3])]
        keys.push(parseInt(cur_match[2]))
        this.recordAction(
            "EVENTS TYPE=KEYPRESS SELECTOR=\"" + cur_match[1] + "\"" +
            " KEYS=" + "\"" + JSON.stringify(keys) + "\"" +
            (cur_match[3] && cur_match[3].length ?
                " MODIFIERS=\"" + cur_match[3] + "\"" : "")
        )
    }
    // and if all failed then just leave the commands intact
    else {
        this.recordActions(prv, cur)
    }

    if (this.pendingEncRecord == "keydown") {
        this.recordEncryptionType()
        delete this.pendingEncRecord
    }
}

Recorder.prototype.packSingleKeyPressEvent = function (extra, cur, prv, pprv) {
    // in fact, we need only one key event out of the trhee because on
    // replaying it unfolds into three commands
    this.recordAction(prv)
    this.packKeyboardEvents(extra)
}

Recorder.prototype.packKeyUpDownEvent = function (extra, cur, prv, pprv) {
    if (pprv)
        this.recordAction(pprv) // this should be left intact

    let cmd = "EVENT TYPE=KEYPRESS SELECTOR=\"" + extra.selector + "\"" +
        " KEY=" + extra.key + (extra.modifiers.length ?
            " MODIFIERS=\"" + extra.modifiers + "\"" : "")
    this.recordAction(cmd)
    this.packKeyboardEvents(extra)
}

Recorder.prototype.packKeyUpEvent = function (extra) {
    if (this.actions.length < 3) return;
    console.assert(this.actions.length >= 3, "packKeyUpEvent require " +
        "at least three recorded actions")
    if (this.prevTarget != extra.selector)
        return

    const keydown_str = "EVENT TYPE=KEYDOWN SELECTOR=\"" + extra.selector + "\""
    const keypress_re = new RegExp("EVENTS? TYPE=KEYPRESS SELECTOR=\"" +
        imns.escapeREChars(extra.selector) + "\"")

    let [cur, prv, pprv] = this.popLastActions(3)

    if (keypress_re.test(prv) && pprv.indexOf(keydown_str) == 0) {
        // it is a first key event in a sequence so just collapse three events
        // into one keypress
        this.packSingleKeyPressEvent(cur, extra, prv, pprv)
    } else if (prv.indexOf(keydown_str) == 0) {
        // this is most likely a control key
        this.packKeyUpDownEvent(extra, cur, prv, pprv)
    } else {
        // write events as is because it's not clear what to do
        this.recordActions(pprv, prv, cur)
    }
}

Recorder.prototype.packKeyPressEvent = function (extra) {
    if (!(this.encryptKeypressEvent = extra.encrypt))
        return  // do nothing

    const ch_re = new RegExp("^event type=keypress selector=\"([^\"]+)\"" +
        " char=\"([^\"]+)\"", "i")
    let cur = this.popLastAction()
    let match = cur.match(ch_re)

    if (match) {
        let ch = Rijndael.encryptString(imns.unwrap(match[2]), this.password)
        this.recordAction(
            "EVENTS TYPE=KEYPRESS SELECTOR=\"" + match[1] + "\"" +
            " CHARS=\"" + imns.escapeLine(ch) + "\""
        )
    }
}

Recorder.prototype.packAction = function (extra) {
    // console.log("packAction rec=%s, extra=%O", rec, extra);
    if (extra.pack_type == "click") {
        this.packClickEvent(extra)
    } else if (extra.pack_type == "dblclick") {
        this.packDblClickEvent(extra)
    } else if (extra.pack_type == "mousemove") {
        this.packMouseMoveEvent(extra)
    } else if (extra.pack_type == "keydown") {
        this.packKeyDownEvent(extra)
    } else if (extra.pack_type == "keyup") {
        this.packKeyUpEvent(extra)
    } else if (extra.pack_type == "keypress") {
        this.packKeyPressEvent(extra)
    }
}

Recorder.prototype.encryptTagCommand = function () {
    let cmd = this.popLastAction()
    let m = cmd.match(/^tag\b.+\bcontent=(\S+)\s*$/i)
    if (!m) {
        console.error("encryptTagCommand called but last command" +
            " has no CONTENT")
        return
    }
    let cyphertext = this.canEncrypt ?
        Rijndael.encryptString(m[1], this.password) : m[1]
    let updated_cmd = cmd.replace(/(content)=(\S+)\s*$/i, "$1=" + cyphertext)
    this.recordAction(updated_cmd)
};

Recorder.prototype.saveAs = function () {
    var rec = "SAVEAS TYPE=MHT FOLDER=* FILE=*";
    this.recordAction(rec);
};

Recorder.prototype.capture = function () {
    var rec = "SAVEAS TYPE=PNG FOLDER=* FILE=*";
    this.recordAction(rec);
};

Recorder.prototype.onQueryState = function (data, tab_id, callback) {
    var recorder = this;

    getTab(tab_id).then(function (tab) {
        if (!tab) {
            if (callback) callback({ state: "idle" });
            return;
        }
        _processTabState(tab);
    }).catch(function (err) {
        // Suppress errors about tabs API availability in Offscreen
        // logWarning("Failed to get tab in onQueryState: " + err.message, { tab_id: tab_id });
        if (callback) callback({ state: "idle" });
    });

    function _processTabState(tab) {
        if (tab.windowId != recorder.win_id) {
            if (callback) callback({ state: "idle" });
            return;
        }
        if (false && tab.index < recorder.startTabIndex) {
            // don't touch tabs left of start tab
            if (callback) callback({ state: "idle" });
        } else {
            if (recorder.recording) {
                var recordMode = Storage.getChar("record-mode");
                // Fix: Default to 'conventional' if recordMode is empty
                if (!recordMode || recordMode === '') {
                    recordMode = 'conventional';
                }
                if (callback) callback({
                    args: {
                        favorId: Storage.getBool("recording-prefer-id"),
                        cssSelectors: Storage.getBool("recording-prefer-css-selectors"),
                        recordMode: recordMode
                    },
                    state: "recording",
                    frameNumber: recorder.currentFrameNumber
                });
            } else {
                if (callback) callback({ state: "idle" });
            }
        }
    }
};


// Add listeners for recording events
// tab selection
Recorder.prototype.onTabActivated = function (activeInfo) {
    console.log("[DEBUG-REC] onTabActivated:", activeInfo);
    if (this.win_id != activeInfo.windowId) {
        console.warn("[DEBUG-REC] Window ID mismatch. Recorder:", this.win_id, "Event:", activeInfo.windowId, " - Ignored");
        return;
    }
    var recorder = this;
    getTab(activeInfo.tabId).then(function (tab) {
        if (!tab) {
            logWarning("Tab not found in onTabActivated", { tabId: activeInfo.tabId });
            return;
        }

        console.log("[DEBUG-REC] Tab info:", { index: tab.index, startIndex: recorder.startTabIndex, url: tab.url });

        // Use absolute tab index instead of relative to start tab
        var cur = tab.index;

        var cmd = "TAB T=" + (cur + 1);
        console.log("[DEBUG-REC] Recording command:", cmd);
        recorder.recordAction(cmd);
    }).catch(function (err) {
        logError("Failed to get tab in onTabActivated: " + (err.message || err), { tabId: activeInfo.tabId });
    });
};

// tab creation
Recorder.prototype.onTabCreated = function (tab) {
    if (this.win_id != tab.windowId)
        return;
    console.log("[iMacros MV3 Recorder] onTabCreated: tabId=" + tab.id + ", url=" + tab.url);

    if (!tab.url && !tab.title) { // looks like this tab is opened by web page
        console.log("[iMacros MV3 Recorder] Ignoring tab created by web page (no url/title)");
        return;
    }

    var cmd = "TAB OPEN";
    console.log("[iMacros MV3 Recorder] Recording TAB OPEN");
    this.recordAction(cmd);
};

// // tab update
Recorder.prototype.onTabUpdated = function (tab_id, changeInfo, tab) {
    const recorder = this;

    // Prefer provided tab info but fall back to querying the tab if needed
    const ensureTab = tab && 'url' in tab ?
        Promise.resolve(tab) :
        getTab(tab_id);

    ensureTab.then(function (resolvedTab) {
        if (!resolvedTab || resolvedTab.windowId !== recorder.win_id)
            return;

        // Ignore updates for tabs opened by other tabs (popup/opener tabs) to reduce noise
        if (resolvedTab.openerTabId) {
            return;
        }

        // Determine the navigated URL. changeInfo.url is the most accurate signal
        // for new top-level navigations, but fall back to tab.url to avoid
        // missing updates in environments that omit the url field.
        const navigatedUrl = changeInfo.url || resolvedTab.pendingUrl || resolvedTab.url;

        // Only record during active recording sessions to avoid restoring events
        // while the recorder is idle or still initializing.
        if (!recorder.recording || !navigatedUrl)
            return;

        // Record once per URL per tab to avoid duplicate commands when multiple
        // update events fire for the same navigation lifecycle.
        const lastRecorded = recorder.lastTabUrls.get(tab_id);
        if (lastRecorded === navigatedUrl)
            return;

        // Only capture meaningful navigations signaled by loading state or an
        // explicit URL change payload.
        const isNavigationSignal = changeInfo.status === "loading" || Boolean(changeInfo.url);
        if (!isNavigationSignal)
            return;

        recorder.lastTabUrls.set(tab_id, navigatedUrl);
        recorder.recordAction("URL GOTO=" + navigatedUrl);
    }).catch(function (err) {
        // Tab may disappear mid-update; avoid noisy logs unless debugging.
        if (Storage.getBool("debug")) {
            console.debug("onTabUpdated lookup failed:", err.message || err);
        }
    });
};


// tab closed
Recorder.prototype.onTabRemoved = function (tab_id) {
    var recorder = this;
    getTab(tab_id).then(function (tab) {
        if (!tab || recorder.win_id != tab.windowId)
            return;
        var cmd = "TAB CLOSE";
        recorder.recordAction(cmd);
    }).catch(function (err) {
        // Tab may already be removed, which is expected for this handler
        if (Storage.getBool("debug")) {
            console.debug("Tab already removed in onTabRemoved:", err.message);
        }
    });
};


// tab move - record tab reordering within the same window
Recorder.prototype.onTabMoved = function (tab_id, obj) {
    if (this.win_id != obj.windowId)
        return;

    var recorder = this;
    getTab(tab_id).then(function (tab) {
        if (!tab || tab.windowId != recorder.win_id)
            return;

        // Calculate relative tab position from start tab
        var relativeIndex = obj.toIndex - recorder.startTabIndex + 1;
        if (relativeIndex < 1) {
            console.warn("Recording limitation: Cannot move tab to the left of the start tab.");
            return;
        }

        // Record TAB MOVE command with the new position
        var cmd = "TAB MOVE=" + relativeIndex;
        recorder.recordAction(cmd);
    }).catch(function (err) {
        logError("Failed to get tab in onTabMoved: " + (err.message || err), { tab_id: tab_id });
    });
};

// tab attached - record when tab is moved into this window
Recorder.prototype.onTabAttached = function (tab_id, obj) {
    if (this.win_id != obj.newWindowId)
        return;

    console.log("[iMacros MV3 Recorder] onTabAttached: tabId=" + tab_id);
    var recorder = this;
    chrome.tabs.get(tab_id, function (tab) {
        if (chrome.runtime.lastError) {
            logError("Failed to get tab in onTabAttached: " + chrome.runtime.lastError.message, { tab_id: tab_id });
            return;
        }
        if (!tab || tab.windowId != recorder.win_id)
            return;

        // Record that a tab was attached to this window
        // Note: We record TAB OPEN since the tab appears as new to this window
        var cmd = "TAB OPEN";
        console.log("[iMacros MV3 Recorder] Recording TAB OPEN (tab attached to window)");
        recorder.recordAction(cmd);

        // If the tab has content, record the URL
        if (tab.url && !/^chrome:\/\//.test(tab.url)) {
            console.log("[iMacros MV3 Recorder] Recording URL GOTO=" + tab.url + " (attached tab)");
            recorder.recordAction("URL GOTO=" + tab.url);
        }
    });
};

// tab detached - record when tab is moved out of this window
Recorder.prototype.onTabDetached = function (tab_id, obj) {
    if (this.win_id != obj.oldWindowId)
        return;

    // When a tab is detached (moved to another window), record it as TAB CLOSE
    // since from this window's perspective, the tab is gone
    var cmd = "TAB CLOSE";
    this.recordAction(cmd);
};


Recorder.prototype.onDownloadCreated = function (dl) {
    var self = this;
    chrome.tabs.query({ active: true, windowId: this.win_id }, function (tabs) {
        if (chrome.runtime.lastError) {
            logError("Failed to query tabs in onDownloadCreated: " + chrome.runtime.lastError.message, { win_id: self.win_id });
            return;
        }
        if (!tabs || tabs.length === 0) {
            logWarning("No active tabs in onDownloadCreated", { win_id: self.win_id });
            return;
        }
        if (dl.referrer != tabs[0].url)
            return;
        var prev_rec = self.popLastAction()
        var rec = "ONDOWNLOAD FOLDER=*" +
            " FILE=+_{{!NOW:yyyymmdd_hhnnss}}" +
            " WAIT=YES";
        self.recordAction(rec);
        if (prev_rec) {
            self.recordAction(prev_rec);
        }
    });
};


Recorder.prototype.onContextMenu = function (info, tab) {
    if (!tab || this.win_id != tab.windowId)
        return;

    var self = this;
    communicator.postMessage(
        "on-rclick",
        { linkUrl: info.linkUrl, frameUrl: info.frameUrl },
        tab.id,
        function (data) {
            var fail_msg = "' Element corresponding to right click action" +
                " was not found.";
            if (!data.found) {
                self.recordAction(fail_msg);
                return;
            }
            self.checkForFrameChange(data._frame);
            var rec = "ONDOWNLOAD FOLDER=*" +
                " FILE=+_{{!NOW:yyyymmdd_hhnnss}}" +
                " WAIT=YES";
            self.recordAction(rec);
            self.recordAction(data.action);
        },
        { number: 0 });
};

Recorder.prototype.onNavigation = function (details) {
    var recorder = this;
    console.log("[DEBUG-REC] onNavigation:", {
        tabId: details.tabId,
        transitionType: details.transitionType,
        qualifiers: details.transitionQualifiers,
        url: details.url
    });

    getTab(details.tabId).then(function (tab) {
        if (!tab) {
            console.log("[DEBUG-REC] onNavigation: tab not found");
            return;
        }
        if (tab.windowId != recorder.win_id) {
            console.warn(`[DEBUG-REC] onNavigation: Window ID mismatch (Recorder: ${recorder.win_id}, Tab: ${tab.windowId}). Mismatch ignored.`);
            return;
        }

        if (details.transitionQualifiers.length &&
            details.transitionQualifiers[0] == "forward_back") {
            // Note: Chrome's webNavigation API doesn't distinguish between Back and Forward.
            // Both actions report the same "forward_back" qualifier. Since we can't determine
            // which button was pressed and there's no FORWARD command in iMacros syntax,
            // we always record BACK for both cases. This is a known limitation.
            console.log("[DEBUG-REC] Recording BACK command");
            recorder.recordAction("BACK");
        } else {
            const recordAddressBarGoto = function (reason) {
                const lastRecorded = recorder.lastTabUrls.get(details.tabId);

                if (lastRecorded === details.url) {
                    console.log(`[DEBUG-REC] Skipping duplicate URL GOTO for ${reason}:`, details.url);
                    return;
                }

                recorder.lastTabUrls.set(details.tabId, details.url);
                console.log(`[DEBUG-REC] Recording URL GOTO=${details.url} (${reason})`);
                recorder.recordAction("URL GOTO=" + details.url);
            };

            switch (details.transitionType) {
                case "typed": case "auto_bookmark":
                    recordAddressBarGoto("typed/bookmark");
                    break;
                case "link": case "generated":
                    if (details.transitionQualifiers.length &&
                        details.transitionQualifiers[0] == "from_address_bar") {
                        recordAddressBarGoto("from address bar");
                    } else {
                        console.log("[DEBUG-REC] Ignoring link/generated transition without from_address_bar");
                    }
                    break;
                case "reload":
                    console.log("[DEBUG-REC] Recording REFRESH command");
                    recorder.recordAction("REFRESH");
                    break;
                default:
                    console.log("[DEBUG-REC] Ignoring transition type:", details.transitionType);
            }
        }
    }).catch(function (err) {
        logError("Failed to get tab in onNavigation: " + (err.message || err), { tabId: details.tabId });
    });
};


// ============================================================================
// Note: Chrome Debugger Protocol Methods (Currently Disabled)
// ============================================================================
// The following methods provide Chrome Debugger Protocol integration for
// advanced event recording. They are currently disabled because:
// 1. The current implementation uses content script injection for event capture
// 2. Debugger protocol requires additional permissions and can interfere with
//    developer tools usage
// 3. Tab switching with debugger attachment is complex and error-prone
//
// These methods remain as reference for potential future implementation.
// ============================================================================

// Recorder.prototype.attachDebugger = function(tab_id) {
//     return new Promise(function(resolve, reject) {
//         chrome.debugger.attach({tabId: tab_id}, "1.1", function() {
//             if (chrome.runtime.lastError)
//                 reject(chrome.runtime.lastError);
//             else
//                 resolve();
//         });
//     });
// };

// Recorder.prototype.detachDebugger = function(tab_id) {
//     return new Promise(function(resolve, reject) {
//         chrome.debugger.detach({tabId: tab_id}, function() {
//             if (chrome.runtime.lastError)
//                 reject(chrome.runtime.lastError);
//             else
//                 resolve();
//         });
//     });
// };

// Recorder.prototype.onDebuggerDetached = function(source, reason) {
//     console.log("onDebuggerDetached, debugee %O, reason %O", source, reason);
// };

// Recorder.prototype.onDebugProtoEvent = function(source, message, params) {
//     console.log("onDebugProtoEvent, debugee %O, message %O, params %O",
//                 source, message, params);
// };

// network events
Recorder.prototype.onAuthRequired = function (details, callback) {
    // console.log("onAuthRequired: %O", details);

    // password encryption

    var enc = {};

    var typ = Storage.getChar("encryption-type");
    if (!typ.length)
        typ = "no";

    switch (typ) {
        case "no":
            enc.encrypt = false;
            if (this.writeEncryptionType) {
                this.writeEncryptionType = false;
                this.recordAction("SET !ENCRYPTION NO");
            }
            break;
        case "stored":      // get password from storage
            enc.encrypt = true;
            if (this.writeEncryptionType) {
                this.writeEncryptionType = false;
                this.recordAction("SET !ENCRYPTION STOREDKEY");
            }
            var pwd = Storage.getChar("stored-password");
            // stored password is base64 encoded
            pwd = decodeURIComponent(atob(pwd));
            enc.key = pwd;
            break;
        case "tmpkey":
            enc.encrypt = true;
            if (this.writeEncryptionType) {
                this.writeEncryptionType = false;
                this.recordAction("SET !ENCRYPTION TMPKEY");
            }

            if (!Rijndael.tempPassword) {    // ask password now
                var features = "titlebar=no,menubar=no,location=no," +
                    "resizable=yes,scrollbars=no,status=no," +
                    "width=350,height=170";
                var win = window.open("passwordDialog.html",
                    "iMacros Password Dialog", features);
                win.args = {
                    shouldProceed: true,
                    type: "loginDialog",
                    // CHEAT: passwordDialog will call auth callback
                    // with false user/pwd pair so next time onAuthRequired
                    // will have temp password
                    callback: callback
                };
                return;
            } else {
                enc.key = Rijndael.tempPassword;
            }
            break;
    }

    var features = "titlebar=no,menubar=no,location=no," +
        "resizable=yes,scrollbars=no,status=no," +
        "width=350,height=170";
    var win = window.open("loginDialog.html",
        "iMacros Login Dialog", features);
    win.args = {
        cypherData: enc,
        details: details,
        callback: callback,
        recorder: this
    };
};


// Recorder.prototype.onBeforeRequest = function(details) {
//     console.log("onBeforeReqeust: %O", details);
// };

// Recorder.prototype.onBeforeRedirect = function(details) {
//     console.log("onBeforeRedirect: %O", details);
// };


// Recorder.prototype.onBeforeSendHeaders = function(details) {
//     console.log("onBeforeSendHeaders: %O", details);
// };

// Recorder.prototype.onReqCompleted = function(details) {
//     console.log("onReqCompleted: %O", details);
// };

// Recorder.prototype.onErrorOccurred = function(details) {
//     console.log("onErrorOccured: %O", details);
// };

// Recorder.prototype.onHeadersReceived = function(details) {
//     console.log("onHeadersReceived: %O", details);
// };

// Recorder.prototype.onResponseStarted = function(details) {
//     console.log("onResponseStarted: O", details);
// };

Recorder.prototype.onSendHeaders = function (details) {
    // console.log("onSendHeaders: %O", details);
};



Recorder.prototype.addListeners = function () {
    // In Offscreen Document, chrome.tabs is not available
    if (chrome.tabs && chrome.tabs.onActivated) {
        chrome.tabs.onActivated.addListener(this.onActivated);
        chrome.tabs.onCreated.addListener(this.onCreated);
        chrome.tabs.onUpdated.addListener(this.onUpdated);
        chrome.tabs.onRemoved.addListener(this.onRemoved);
        chrome.tabs.onMoved.addListener(this.onMoved);
        chrome.tabs.onAttached.addListener(this.onAttached);
        chrome.tabs.onDetached.addListener(this.onDetached);
    } else {
        console.log('[Recorder] chrome.tabs not available - skipping tab event listeners');
    }

    if (chrome.downloads && chrome.downloads.onCreated) {
        chrome.downloads.onCreated.addListener(this._onDownloadCreated);
    }

    if (chrome.contextMenus && chrome.contextMenus.onClicked) {
        chrome.contextMenus.onClicked.addListener(this._onContextMenu);
        const cm_title = "Automate Save As command";
        // Generate unique ID for context menu item (required in MV3)
        const cm_id = `imacros-save-as-${this.win_id}`;
        this.cm_id = chrome.contextMenus.create(
            { id: cm_id, title: cm_title, contexts: ["link", "audio", "video", "image"] }
        );
    }

    // network events
    if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
        chrome.webNavigation.onCommitted.addListener(this.onCommitted);
    }
    if (chrome.webRequest && chrome.webRequest.onAuthRequired) {
        chrome.webRequest.onAuthRequired.addListener(
            this.onAuth,
            { windowId: this.win_id, urls: ["<all_urls>"] },
            ["asyncBlocking"]
        );
    }
    // chrome.webRequest.onBeforeRequest.addListener(
    //     this.onRequest,
    //     {windowId: this.win_id, urls: ["<all_urls>"]}
    // );
    // chrome.webRequest.onBeforeRedirect.addListener(
    //     this.onRedirect,
    //     {windowId: this.win_id, urls: ["<all_urls>"]},
    //     ["responseHeaders"]
    // );
    // chrome.webRequest.onBeforeSendHeaders.addListener(
    //     this.onSendHeaders,
    //     {windowId: this.win_id, urls: ["<all_urls>"]},
    //     ["requestHeaders"]
    // );
    // chrome.webRequest.onCompleted.addListener(
    //     this.onCompleted,
    //     {windowId: this.win_id, urls: ["<all_urls>"]},
    //     ["responseHeaders"]
    // );
    // chrome.webRequest.onErrorOccurred.addListener(
    //     this.onReqError,
    //     {windowId: this.win_id, urls: ["<all_urls>"]}
    // );
    // chrome.webRequest.onHeadersReceived.addListener(
    //     this.onHeaders,
    //     {windowId: this.win_id, urls: ["<all_urls>"]},
    //     ["responseHeaders"]
    // );
    // chrome.webRequest.onResponseStarted.addListener(
    //     this.onResponse,
    //     {windowId: this.win_id, urls: ["<all_urls>"]},
    //     ["responseHeaders"]
    // );
    // chrome.webRequest.onSendHeaders.addListener(
    //     this.onSend,
    //     {windowId: this.win_id, urls: ["<all_urls>"]},
    //     ["requestHeaders"]
    // );

    // Note: Debugger protocol event listeners are disabled (see section above)
    // chrome.debugger.onEvent.addListener(this.onEvent);
    // chrome.debugger.onDetach.addListener(this.onDetach);
    // this.attachDebugger(this.tab_id).then(function() {
    //     console.log("debugger attached");
    // }).catch(console.error.bind(console));
};

// remove recording listeners
Recorder.prototype.removeListeners = function () {
    // In Offscreen Document, chrome.tabs is not available
    if (chrome.tabs && chrome.tabs.onActivated) {
        chrome.tabs.onActivated.removeListener(this.onActivated);
        chrome.tabs.onCreated.removeListener(this.onCreated);
        chrome.tabs.onUpdated.removeListener(this.onUpdated);
        chrome.tabs.onRemoved.removeListener(this.onRemoved);
        chrome.tabs.onMoved.removeListener(this.onMoved);
        chrome.tabs.onAttached.removeListener(this.onAttached);
        chrome.tabs.onDetached.removeListener(this.onDetached);
    }

    if (chrome.webNavigation && chrome.webNavigation.onCommitted) {
        chrome.webNavigation.onCommitted.removeListener(this.onCommitted);
    }

    if (chrome.downloads && chrome.downloads.onCreated) {
        chrome.downloads.onCreated.removeListener(this._onDownloadCreated);
    }

    if (chrome.contextMenus && chrome.contextMenus.onClicked) {
        chrome.contextMenus.onClicked.removeListener(this._onContextMenu);
    }
    // Only remove context menu if it was created (cm_id is set)
    if (this.cm_id) {
        // Use the string ID format: imacros-save-as-{win_id}
        const cm_id = `imacros-save-as-${this.win_id}`;
        chrome.contextMenus.remove(cm_id, () => {
            if (chrome.runtime.lastError) {
                // Ignore error if menu item doesn't exist
                console.debug('Context menu removal (may not exist):', chrome.runtime.lastError.message);
            }
        });
        this.cm_id = null;
    }
    // network events
    if (chrome.webRequest && chrome.webRequest.onAuthRequired) {
        chrome.webRequest.onAuthRequired.removeListener(this.onAuth);
    }
    // chrome.webRequest.onBeforeRequest.removeListener(this.onRequest);
    // chrome.webRequest.onBeforeRedirect.removeListener(this.onRedirect);
    // chrome.webRequest.onBeforeSendHeaders.removeListener(this.onSendHeaders);
    // chrome.webRequest.onCompleted.removeListener(this.onCompleted);
    // chrome.webRequest.onErrorOccurred.removeListener(this.onReqError);
    // chrome.webRequest.onHeadersReceived.removeListener(this.onHeaders);
    // chrome.webRequest.onResponseStarted.removeListener(this.onResponse);
    // chrome.webRequest.onSendHeaders.removeListener(this.onSend);

    // Note: Debugger protocol event listeners are disabled (see section above)
    // chrome.debugger.onEvent.removeListener(this.onEvent);
    // chrome.debugger.onDetach.removeListener(this.onDetach);
    // this.detachDebugger(this.tab_id).catch(console.error.bind(console));
};
Recorder.prototype.saveState = function () {
    if (!this.win_id) return;
    if (!chrome.storage || !chrome.storage.session) return;
    const state = {
        recording: this.recording,
        actions: this.actions,
        startTabIndex: this.startTabIndex
    };
    let key = "recorder_state_" + this.win_id;
    let items = {};
    items[key] = state;
    chrome.storage.session.set(items, () => {
        if (chrome.runtime.lastError) {
            console.warn("[iMacros Recorder] Failed to save state:", chrome.runtime.lastError);
        }
    });
};

Recorder.prototype.restoreState = function () {
    if (!this.win_id) return;
    if (!chrome.storage || !chrome.storage.session) return;
    let key = "recorder_state_" + this.win_id;
    chrome.storage.session.get([key], (items) => {
        if (chrome.runtime.lastError) return;
        const state = items[key];
        if (state && state.recording) {
            console.log("[iMacros Recorder] Restoring state for window", this.win_id);
            this.recording = true;
            this.actions = state.actions || [];
            this.startTabIndex = state.startTabIndex;
            // Restore listeners
            this.addListeners();
            // Restore badge
            badge.set(this.win_id, {
                status: "recording",
                text: this.actions.length.toString()
            });
        }
    });
};
