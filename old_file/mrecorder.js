/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

"use strict";

// An object to encapsulate all recording operations
// on extension side
function Recorder(win_id) {
    this.win_id = win_id;
    this.recording = false;
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
    // this.onUpdated = this.onTabUpdated.bind(this);
    this.onRemoved = this.onTabRemoved.bind(this);
    this.onMoved = this.onTabMoved.bind(this);
    this.onAttached = this.onTabAttached.bind(this);
    this.onDetached = this.onTabDetached.bind(this);

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
    // this.onHeaders = this.onHeadersReceived.bind(this);
    // this.onResponse = this.onResponseStarted.bind(this);
    // this.onSend = this.onSendHeaders.bind(this);

    this.onCommitted = this.onNavigation.bind(this);
    this._onDownloadCreated = this.onDownloadCreated.bind(this);
    this._onContextMenu = this.onContextMenu.bind(this);
};


Recorder.prototype.checkForFrameChange = function(frame) {
    if (frame.number != this.currentFrameNumber) {
        this.currentFrameNumber = frame.number;
        if (0 && frame.name) {
            this.recordAction("FRAME NAME=\""+frame.name+"\"");
        } else {
            this.recordAction("FRAME F="+frame.number.toString());
        }
    }
};


Recorder.prototype.start = function() {
    // console.info("start recording");
    this.writeEncryptionType = true;
    this.password = null;
    this.canEncrypt = true
    context.updateState(this.win_id,"recording");
    var panel = context[this.win_id].panelWindow;
    if (panel && !panel.closed) {
        panel.showLines();
        panel.setStatLine("Recording...", "info");
    }
    // create array to store recorded actions
    this.actions = new Array();
    var recorder = this;
    chrome.tabs.query({active: true, windowId: this.win_id}, function (tabs) {
        recorder.recording = true;
        // save starting tab index
        recorder.startTabIndex = tabs[0].index;
        // recorder.tab_id = tabs[0].id;
        // add browser events listeners
        recorder.addListeners();
        // reset frame number
        recorder.currentFrameNumber = 0;
        // notify content script that recording was started
        communicator.broadcastMessage("start-recording", {
            args: {favorId: Storage.getBool("recording-prefer-id"),
                   cssSelectors: Storage.getBool("recording-prefer-css-selectors"),
                   recordMode: Storage.getChar("record-mode")}
        }, recorder.win_id);
        // save intial commands
        recorder.recordAction("VERSION BUILD=" + Storage.getChar("version").replace(/\./g, "") + " RECORDER=CR");
        if (!/^chrome:\/\//.test(tabs[0].url)) {
            recorder.recordAction("URL GOTO="+tabs[0].url);
        }
    });
};


Recorder.prototype.stop = function() {
    // console.info("stop recording");
    // notify content script that recording was stopped
    communicator.broadcastMessage("stop-recording", {}, this.win_id);
    context.updateState(this.win_id, "idle");

    this.recording = false;
    this.removeListeners();
    // remove text from badge
    badge.clearText(this.win_id);
    var panel = context[this.win_id].panelWindow;
    if (panel && !panel.closed)
        panel.showMacroTree();
};


Recorder.prototype.beforeRecordAction = function(cmd) {
    // check for double-command
    var match_part = cmd;
    if (/^(tag .*\s+content\s*=)/i.test(cmd))
        match_part = RegExp.$1;
    if (!/^event/i.test(cmd) &&
        this.actions.length &&
        this.actions[this.actions.length-1].indexOf(match_part) == 0)
    {
        // remove previously recorded element if it matches
        // with the current one
        // useful for selectboxes and double clicking
        this.popLastAction()
    }
};

Recorder.prototype.recordAction = function (cmd) {
    this.beforeRecordAction(cmd);
    var panel = context[this.win_id].panelWindow;
    this.actions.push(cmd);
    if (panel && !panel.closed) {
        panel.addLine(cmd);
    }

    badge.set(this.win_id, {
        status: "recording",
        text:  this.actions.length.toString()
    });

    this.afterRecordAction(cmd);
    // console.info("recorded action: "+cmd);
}

Recorder.prototype.recordActions = function(...actions) {
    actions.forEach(this.recordAction.bind(this))
}


Recorder.prototype.afterRecordAction = function(rec) {
}

Recorder.prototype.recordEncryptionType = function() {
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
        password_promise = Promise.resolve({canceled: true});
    } else if (typ == "stored") {
        let pwd = Storage.getChar("stored-password")
        // stored password is base64 encoded
        pwd = decodeURIComponent(atob(pwd))
        password_promise = Promise.resolve({password: pwd})
    } else if (typ == "tmpkey") {
        password_promise =  Rijndael.tempPassword ?
            Promise.resolve({
                password: Rijndael.tempPassword
            }) : dialogUtils.openDialog("passwordDialog.html",
                                        "iMacros Password Dialog",
                                        {type: "askPassword"})
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
    })
}

Recorder.prototype.onPasswordElementFocused = function(data, tab_id, callback) {
    typeof (callback) == "function" &&
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

Recorder.prototype.onRecordAction = function(data, tab_id, callback) {
    // console.log("onRecordAction, data="+JSON.stringify(data));
    typeof (callback) == "function" &&   // release resources
        callback();

    if (data._frame) {
        this.checkForFrameChange(data._frame);
    }

    let in_event_mode = Storage.getChar("record-mode") == "event"
    this.recordAction(data.action)
    // test action for password element
    if (!in_event_mode && data.extra && data.extra.encrypt) {
         // handle password
        this.encryptTagCommand()
    } else if (in_event_mode && data.extra) {
        this.packAction(data.extra)
    }
}


Recorder.prototype.removeLastLine = function(n) {
    var num = n || 1;
    var panel = context[this.win_id].panelWindow;
    if (panel && !panel.closed) {
        while (num--)
            panel.removeLastLine();
    }
};

Recorder.prototype.peekLastAction = function() {
    return this.actions.length? this.actions[this.actions.length-1] : ""
}

Recorder.prototype.popLastAction = function() {
    console.assert(this.actions.length > 0, "popLastAction is called"+
                   " but action list is empty")
    this.removeLastLine()
    return this.actions.pop()
}

Recorder.prototype.popLastActions = function(n) {
    console.assert(this.actions.length > n, "popLastActions is called"+
                   " but action list is empty")
    let arr = []
    while (n-- > 0) {
        this.removeLastLine()
        arr.push(this.actions.pop())
    }

    return arr
}

Recorder.prototype.packClickEvent = function(extra) {
    console.assert(this.actions.length >= 2, "click event should be "+
                   "preceeded by at least two actions");
    let mdown_action = "EVENT TYPE=MOUSEDOWN SELECTOR=\""+
        extra.selector+"\""
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

Recorder.prototype.packDblClickEvent = function(extra) {
    console.assert(this.actions.length >= 2, "dblclick event should be "+
                   "preceeded by at least two actions")
    let click_action = "EVENT TYPE=CLICK SELECTOR=\""+extra.selector+"\""
    let [cur, prv, pprv] = this.popLastActions(3)
    if (prv.indexOf(click_action) == 0 &&
        pprv.indexOf(click_action) == 0) {
        this.recordAction(cur)
    } else {
        this.recordActions(pprv, prv, cur)
    }
}

Recorder.prototype.packMouseMoveEvent = function(extra) {
    const re = new RegExp('^events? type=mousemove\\b.+'+
                          '\\points?="(\\S+)"', "i")
    let [cur, prv] = this.popLastActions(2)
    if (this.actions.length && this.prevTarget == extra.selector) {
        let m = re.exec(prv)
        if ( m ) {
            // TODO: I'm not sure about modifiers.
            // It is possible that user depresses Shift key
            // in the middle of drag operation.
            // However, as only final modifier affects
            // the operation, I think writing last modifier
            // will work in most practical cases.
            this.recordAction(
                "EVENTS TYPE=MOUSEMOVE SELECTOR=\""+extra.selector+"\""+
                    " POINTS=\""+m[1].toString()+
                    ",("+extra.point.x+","+extra.point.y+")\""+
                    (extra.modifiers ?
                     " MODIFIERS=\""+extra.modifiers+"\"" : "")
            )
        }
    } else {
        this.prevTarget = extra.selector
        this.recordActions(prv, cur)
    }
};


Recorder.prototype.packKeyDownEvent = function(extra) {
    // basically it is only needed to save prevTarget as all the work is
    // done on keyup
    this.prevTarget = extra.selector
}

Recorder.prototype.packKeyboardEvents = function(extra) {
    // check if the just recorded keypress action can be merged with previous
    // EVENTS command (for sucessive input)
    const chars_re = new RegExp('^events? type=keypress selector=\"([^\"]+)\"'+
                                ' chars?=\"([^\"]+)\"', "i")
    const keys_re = new RegExp("^events? type=keypress selector=\"([^\"]+)\""+
                              " (keys?)=(?:(\\d+)|\"([^\"]+)\")"+
                              "(?: modifiers=\"([^\"]+)\")?", "i")
    const ch_re = new RegExp("^events? type=keypress selector=\"([^\"]+)\""+
                             " chars?=\"([^\"]+)\"", "i")
    const kd_re = new RegExp("^event type=keypress selector=\"([^\"]+)\""+
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
                    message: "Encryption type or stored password was changed"+
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
            "EVENTS TYPE=KEYPRESS SELECTOR=\""+cur_match[1]+"\""+
                " CHARS=\""+imns.escapeLine(chars)+"\""
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
            "EVENTS TYPE=KEYPRESS SELECTOR=\""+cur_match[1]+"\""+
                " KEYS="+"\""+JSON.stringify(keys)+"\""+
                (cur_match[3] && cur_match[3].length ?
                 " MODIFIERS=\""+cur_match[3]+"\"" : "")
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

Recorder.prototype.packSingleKeyPressEvent = function(extra, cur, prv, pprv) {
    // in fact, we need only one key event out of the trhee because on
    // replaying it unfolds into three commands
    this.recordAction(prv)
    this.packKeyboardEvents(extra)
}

Recorder.prototype.packKeyUpDownEvent = function(extra, cur, prv, pprv) {
    if (pprv)
        this.recordAction(pprv) // this should be left intact

    let cmd = "EVENT TYPE=KEYPRESS SELECTOR=\""+extra.selector+"\""+
        " KEY="+extra.key+(extra.modifiers.length ?
                           " MODIFIERS=\""+extra.modifiers+"\"" : "")
    this.recordAction(cmd)
    this.packKeyboardEvents(extra)
}

Recorder.prototype.packKeyUpEvent = function(extra) {
    console.assert(this.actions.length >= 3, "packKeyUpEvent require "+
                   "at least three recorded actions")
    if (this.prevTarget != extra.selector)
        return

    const keydown_str = "EVENT TYPE=KEYDOWN SELECTOR=\""+extra.selector+"\""
    const keypress_re = new RegExp("EVENTS? TYPE=KEYPRESS SELECTOR=\""+
                                   imns.escapeREChars(extra.selector)+"\"")

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

Recorder.prototype.packKeyPressEvent = function(extra) {
    if (!(this.encryptKeypressEvent = extra.encrypt))
        return  // do nothing

    const ch_re = new RegExp("^event type=keypress selector=\"([^\"]+)\""+
                             " char=\"([^\"]+)\"", "i")
    let cur = this.popLastAction()
    let match = cur.match(ch_re)

    if (match) {
        let ch = Rijndael.encryptString(imns.unwrap(match[2]), this.password)
        this.recordAction(
            "EVENTS TYPE=KEYPRESS SELECTOR=\""+match[1]+"\""+
                " CHARS=\""+imns.escapeLine(ch)+"\""
        )
    }
}

Recorder.prototype.packAction = function(extra) {
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

Recorder.prototype.encryptTagCommand = function() {
    let cmd = this.popLastAction()
    let m = cmd.match(/^tag\b.+\bcontent=(\S+)\s*$/i)
    if (!m) {
        console.error("encryptTagCommand called but last command"+
                      " has no CONTENT")
        return
    }
    let cyphertext = this.canEncrypt ?
        Rijndael.encryptString(m[1], this.password) : m[1]
    let updated_cmd = cmd.replace(/(content)=(\S+)\s*$/i, "$1="+cyphertext)
    this.recordAction(updated_cmd)
};

Recorder.prototype.saveAs = function() {
    var rec = "SAVEAS TYPE=MHT FOLDER=* FILE=*";
    this.recordAction(rec);
};

Recorder.prototype.capture = function() {
    var rec = "SAVEAS TYPE=PNG FOLDER=* FILE=*";
    this.recordAction(rec);
};



Recorder.prototype.onQueryState = function(data, tab_id, callback) {
    var recorder = this;
    chrome.tabs.get(tab_id, function (tab) {
        if (tab.windowId != recorder.win_id)
            return;
        if (tab.index < recorder.startTabIndex) {
            // don't touch tabs left of start tab
            callback({state: "idle"});
        } else {
            if (recorder.recording) {
                callback({
                    args: {favorId: Storage.getBool("recording-prefer-id"),
                           cssSelectors: Storage.getBool("recording-prefer-css-selectors"),
                           recordMode: Storage.getChar("record-mode")},
                    state: "recording",
                    frameNumber: recorder.currentFrameNumber
                });
            } else {
                callback({state: "idle"});
            }
        }
    });
};


// Add listeners for recording events
// tab selection
Recorder.prototype.onTabActivated = function(activeInfo) {
    if (this.win_id != activeInfo.windowId)
        return;
    var recorder = this;
    chrome.tabs.get(activeInfo.tabId, function (tab) {
        var cur = tab.index - recorder.startTabIndex;
        if (cur < 0) {
            // TODO: add real warning here
            console.warn("Note: Tabs LEFT "+
                         "of the start tab are not recorded.");
            return;
        }
        var cmd = "TAB T="+(cur+1);
        recorder.recordAction(cmd);
        // recorder.detachDebugger(recorder.tab_id)
        //     .then(function() {
        //         return recorder.attachDebugger(activeInfo.tabId);
        //     }).then(function() {
        //         recorder.tab_id = activeInfo.tabId;
        //     }).catch(console.error.bind(console));
    });
};

// tab creation
Recorder.prototype.onTabCreated = function(tab) {
    if (this.win_id != tab.windowId)
        return;
    // console.log("onTabCreated, %O", tab);

    if (!tab.url && !tab.title) // looks like this tab is opened by web page
        return;

    var cmd = "TAB OPEN";
    this.recordAction(cmd);
};

// // tab update
// Recorder.prototype.onTabUpdated = function(tab_id, obj, tab) {
//     if (this.win_id != tab.windowId)
//         return;
//     chrome.tabs.get(tab_id, function (tab) {
//         // TODO: wait for they added 'type' property
//         console.log("onTabUpdated, openerTabId %s", tab.openerTabId);
//         if (obj.status == "loading" && obj.url && !tab.openerTabId) {
//             var cmd = "URL GOTO="+obj.url;
//             recorder.recordAction(cmd);
//         }
//     });
// };


// tab closed
Recorder.prototype.onTabRemoved = function(tab_id) {
    var recorder = this;
    chrome.tabs.get(tab_id, function (tab) {
        if (!tab || recorder.win_id != tab.windowId)
            return;
        var cmd = "TAB CLOSE";
        recorder.recordAction(cmd);
    });
};


// tab move, give a warning
Recorder.prototype.onTabMoved = function(tab_id, obj) {
    if (this.win_id != obj.windowId)
        return;
    // TODO: add real warning
    console.warn("tab move not supported");
};

// tab attached, give a warning
Recorder.prototype.onTabAttached = function(tab_id, obj) {
    if (this.win_id != obj.newWindowId)
        return;
    // TODO: add real warning
    console.warn("tab attachment not supported");

};

// tab detached, give a warning
Recorder.prototype.onTabDetached = function(tab_id, obj) {
    if (this.win_id != obj.oldWindowId)
        return;

    // TODO: add real warning
    console.warn("tab detachment not supported");

};


Recorder.prototype.onDownloadCreated = function(dl) {
    var self = this;
    chrome.tabs.query({active: true, windowId: this.win_id}, function (tabs) {
        if (dl.referrer != tabs[0].url)
            return;
        var prev_rec = self.popLastAction()
        var rec = "ONDOWNLOAD FOLDER=*"+
            " FILE=+_{{!NOW:yyyymmdd_hhnnss}}"+
            " WAIT=YES";
        self.recordAction(rec);
        self.recordAction(prev_rec);
    });
};


Recorder.prototype.onContextMenu = function(info, tab) {
    if (!tab || this.win_id != tab.windowId)
        return;

    var self = this;
    communicator.postMessage(
        "on-rclick",
        { linkUrl: info.linkUrl, frameUrl: info.frameUrl },
        tab.id,
        function(data) {
            var fail_msg = "' Element corresponding to right click action"+
                " was not found.";
            if (!data.found) {
                self.recordAction(fail_msg);
                return;
            }
            self.checkForFrameChange(data._frame);
            var rec = "ONDOWNLOAD FOLDER=*"+
                " FILE=+_{{!NOW:yyyymmdd_hhnnss}}"+
                " WAIT=YES";
            self.recordAction(rec);
            self.recordAction(data.action);
        },
        {number: 0});
};

Recorder.prototype.onNavigation = function(details) {
    var recorder = this;
    chrome.tabs.get(details.tabId, function(tab) {
        if (!tab || tab.windowId != recorder.win_id)
            return;
        // console.log("onNavigation: %O", details);
        if (details.transitionQualifiers.length &&
            details.transitionQualifiers[0] == "forward_back") {
            // TODO: it appeared too complicated to find out
            // if it was Back or Forward button pressed,
            // so it simply records BACK command
            // anyways, there is no FORWARD command ;)
            recorder.recordAction("BACK");
        } else {
            switch(details.transitionType) {
            case "typed": case "auto_bookmark":
                recorder.recordAction("URL GOTO="+tab.url);
                break;
            case "link": case "generated":
                if (details.transitionQualifiers.length &&
                    details.transitionQualifiers[0] == "from_address_bar") {
                    recorder.recordAction("URL GOTO="+tab.url);
                }
                break;
            case "reload":
                recorder.recordAction("REFRESH");
                break;
            }
        }
    });
};


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
Recorder.prototype.onAuthRequired = function(details, callback) {
    // console.log("onAuthRequired: %O", details);

    // password encryption

    var enc = {};

    var typ = Storage.getChar("encryption-type");
    if (!typ.length)
        typ = "no";

    switch(typ) {
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
            var features = "titlebar=no,menubar=no,location=no,"+
                "resizable=yes,scrollbars=no,status=no,"+
                "width=350,height=170";
            var win = window.open("passwordDialog.html",
                                  "iMacros Password Dialog" , features);
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

    var features = "titlebar=no,menubar=no,location=no,"+
        "resizable=yes,scrollbars=no,status=no,"+
        "width=350,height=170";
    var win = window.open("loginDialog.html",
                          "iMacros Login Dialog" , features);
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

Recorder.prototype.onSendHeaders = function(details) {
    // console.log("onSendHeaders: %O", details);
};



Recorder.prototype.addListeners = function() {
    // add listeners
    chrome.tabs.onActivated.addListener(this.onActivated);
    chrome.tabs.onCreated.addListener(this.onCreated);
    // chrome.tabs.onUpdated.addListener(this.onUpdated);
    chrome.tabs.onRemoved.addListener(this.onRemoved);
    chrome.tabs.onMoved.addListener(this.onMoved);
    chrome.tabs.onAttached.addListener(this.onAttached);
    chrome.tabs.onDetached.addListener(this.onDetached);
    chrome.downloads.onCreated.addListener(this._onDownloadCreated);
    chrome.contextMenus.onClicked.addListener(this._onContextMenu);
    const cm_title = "Automate Save As command";
    this.cm_id = chrome.contextMenus.create(
        {title: cm_title, contexts: ["link", "audio", "video", "image"]}
    );

    // network events
    chrome.webNavigation.onCommitted.addListener(this.onCommitted);
    chrome.webRequest.onAuthRequired.addListener(
        this.onAuth,
        {windowId: this.win_id, urls: ["<all_urls>"]},
        ["asyncBlocking"]
    );
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

    // Debugger protocol events
    // chrome.debugger.onEvent.addListener(this.onEvent);
    // chrome.debugger.onDetach.addListener(this.onDetach);
    // this.attachDebugger(this.tab_id).then(function() {
    //     console.log("debugger attached");
    // }).catch(console.error.bind(console));
};

// remove recording listeners
Recorder.prototype.removeListeners = function() {
    chrome.tabs.onActivated.removeListener(this.onActivated);
    chrome.tabs.onCreated.removeListener(this.onCreated);
    // chrome.tabs.onUpdated.removeListener(this.onUpdated);
    chrome.tabs.onRemoved.removeListener(this.onRemoved);
    chrome.tabs.onMoved.removeListener(this.onMoved);
    chrome.tabs.onAttached.removeListener(this.onAttached);
    chrome.tabs.onDetached.removeListener(this.onDetached);
    chrome.webNavigation.onCommitted.removeListener(this.onCommitted);
    chrome.downloads.onCreated.removeListener(this._onDownloadCreated);
    chrome.contextMenus.onClicked.removeListener(this._onContextMenu);
    chrome.contextMenus.remove(this.cm_id);
    // network events
    chrome.webRequest.onAuthRequired.removeListener(this.onAuth);
    // chrome.webRequest.onBeforeRequest.removeListener(this.onRequest);
    // chrome.webRequest.onBeforeRedirect.removeListener(this.onRedirect);
    // chrome.webRequest.onBeforeSendHeaders.removeListener(this.onSendHeaders);
    // chrome.webRequest.onCompleted.removeListener(this.onCompleted);
    // chrome.webRequest.onErrorOccurred.removeListener(this.onReqError);
    // chrome.webRequest.onHeadersReceived.removeListener(this.onHeaders);
    // chrome.webRequest.onResponseStarted.removeListener(this.onResponse);
    // chrome.webRequest.onSendHeaders.removeListener(this.onSend);

    // Debugger protocol events
    // chrome.debugger.onEvent.removeListener(this.onEvent);
    // chrome.debugger.onDetach.removeListener(this.onDetach);
    // this.detachDebugger(this.tab_id).catch(console.error.bind(console));
};
