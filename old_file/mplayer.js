
/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/


// An object to encapsulate all operations for parsing
// and playing macro commands

function MacroPlayer(win_id) {
    this.win_id = win_id;
    this.vars = new Array();
    this.userVars = new Map();
    this.ports = new Object();
    this._ActionTable = new Object();
    this.compileExpressions();

    this._onScriptError = this.onErrorOccurred.bind(this);
    // this._onBeforeNavigate = this.onBeforeNavigate.bind(this);
    // this._onCompleted = this.onNavigationCompleted.bind(this);
    this._onErrorOccured = this.onNavigationErrorOccured.bind(this);
    // this._onCommitted = this.onNavigationCommitted.bind(this);
    // this._onCreatedNavTarget = this.onCreatedNavigationTarget.bind(this);
    // this._onDOMLoaded = this.onDOMContentLoaded.bind(this);
    // this._onRefFragUpdated = this.onReferenceFragmentUpdated.bind(this);
    this._onTabUpdated = this.onTabUpdated.bind(this);
    this._onActivated = this.onTabActivated.bind(this);

    // bindings to monitor network activity
    this.onAuth = this.onAuthRequired.bind(this);
    // this.onRequest = this.onBeforeRequest.bind(this);
    // this.onRedirect = this.onBeforeRedirect.bind(this);
    this._onBeforeSendHeaders = this.onBeforeSendHeaders.bind(this);
    // this.onCompleted = this.onReqCompleted.bind(this);
    // this.onReqError = this.onErrorOccurred.bind(this);
    // this.onHeaders = this.onHeadersReceived.bind(this);
    // this.onResponse = this.onResponseStarted.bind(this);
    // this._onSendHeaders = this.onSendHeaders.bind(this);

    // handle sandbox messages
    window.addEventListener("message", this.onSandboxMessage.bind(this));

    // listeners for download events
    this._onDownloadCreated = this.onDownloadCreated.bind(this);
    this._onDownloadChanged = this.onDownloadChanged.bind(this);
}


// A table to hold the code for processing a command
MacroPlayer.prototype.ActionTable = new Object();
MacroPlayer.prototype.RegExpTable = new Object();



// compile actions regexps
MacroPlayer.prototype.compileExpressions = function () {
    if (!this.RegExpTable.compiled) {
        for (var x in this.RegExpTable) {
            try {
                this.RegExpTable[x] = new RegExp(this.RegExpTable[x], "i");
            } catch (e) {
                console.error(e);
                throw e;
            }
        }
        this.RegExpTable.compiled = true;
    }
    for (var x in MacroPlayer.prototype.ActionTable) {
        this._ActionTable[x] = MacroPlayer.prototype.ActionTable[x].bind(this);
    }
};



// add listener for various events
MacroPlayer.prototype.addListeners = function() {
    communicator.registerHandler("error-occurred",
                                 this._onScriptError, this.win_id);
    chrome.tabs.onUpdated.addListener(this._onTabUpdated);
    chrome.tabs.onActivated.addListener(this._onActivated);

    // use WebNavigation interface to trace download events

    // chrome.webNavigation.onBeforeNavigate.addListener(this._onBeforeNavigate);
    // chrome.webNavigation.onCompleted.addListener(this._onCompleted);
    chrome.webNavigation.onErrorOccurred.addListener(this._onErrorOccured);

    // chrome.webNavigation.onCommitted.addListener(this._onCommitted);
    // chrome.webNavigation.onCreatedNavigationTarget.addListener(
    //     this._onCreatedNavTarget
    // );
    // chrome.webNavigation.onDOMContentLoaded.addListener(
    //     this._onDOMLoaded
    // );
    // chrome.webNavigation.onReferenceFragmentUpdated.addListener(
    //     this._onRefFragUpdated
    // );

    // network events
    // chrome.webRequest.onBeforeRequest.addListener(
    //     this.onRequest,
    //     {
    //         windowId: this.win_id,
    //         urls: ["<all_urls>"]// ,
    //         // types: ["main_frame", "sub_frame"]
    //     }
    // );
    // chrome.webRequest.onBeforeRedirect.addListener(
    //     this.onRedirect,
    //     {windowId: this.win_id, urls: ["<all_urls>"]},
    //     ["responseHeaders"]
    // );
    // chrome.webRequest.onBeforeSendHeaders.addListener(
    //     this._onBeforeSendHeaders,
    //     {windowId: this.win_id, urls: ["<all_urls>"]},
    //     ["blocking", "requestHeaders"]
    // );
    // chrome.webRequest.onCompleted.addListener(
    //     this.onCompleted,
    //     {
    //         windowId: this.win_id,
    //         urls: ["<all_urls>"]
    //     }
    // );
    // chrome.webRequest.onErrorOccurred.addListener(
    //     this.onReqError,
    //     {
    //         windowId: this.win_id,
    //         urls: ["<all_urls>"]
    //     }
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
    //     this._onSendHeaders,
    //     {windowId: this.win_id, urls: ["<all_urls>"]},
    //     ["requestHeaders"]
    // );
};

MacroPlayer.prototype.removeListeners = function() {
    communicator.unregisterHandler("error-occurred", this._onScriptError);
    chrome.tabs.onUpdated.removeListener(this._onTabUpdated);
    chrome.tabs.onActivated.removeListener(this._onActivated);
    // chrome.webNavigation.onBeforeNavigate.removeListener(this._onBeforeNavigate);
    // chrome.webNavigation.onCompleted.removeListener(this._onCompleted);
    chrome.webNavigation.onErrorOccurred.removeListener(this._onErrorOccured);

    // chrome.webNavigation.onCommitted.removeListener(this._onCommitted);
    // chrome.webNavigation.onCreatedNavigationTarget.removeListener(
    //     this._onCreatedNavTarget
    // );
    // chrome.webNavigation.onDOMContentLoaded.removeListener(
    //     this._onDOMLoaded
    // );
    // chrome.webNavigation.onReferenceFragmentUpdated.removeListener(
    //     this._onRefFragUpdated
    // );

    // network events
    // chrome.webRequest.onBeforeRequest.removeListener(this.onRequest);
    // chrome.webRequest.onBeforeRedirect.removeListener(this.onRedirect);
    if (this.userAgent) {
        chrome.webRequest.onBeforeSendHeaders.removeListener(
            this._onBeforeSendHeaders
        );
    }
    // chrome.webRequest.onCompleted.removeListener(this.onCompleted);
    // chrome.webRequest.onErrorOccurred.removeListener(this.onReqError);
    // chrome.webRequest.onHeadersReceived.removeListener(this.onHeaders);
    // chrome.webRequest.onResponseStarted.removeListener(this.onResponse);
    // chrome.webRequest.onSendHeaders.removeListener(this._onSendHeaders);
};


// MacroPlayer.prototype.onBeforeNavigate = function(details) {
//     if (details.tabId != this.tab_id)
//         return;
//     console.log("onBeforeNavigate: %O", details);
// };


// MacroPlayer.prototype.reviseActiveNavigations = function() {
//     var count = this.activeNavigations.size;
//     if (count == 0) {
//         if (this.afterCompleteTimeout) {
//             // we're waiting for navigation completion after
//             // onTabUpdated with 'complete' fired
//             clearTimeout(this.afterCompleteTimeout);
//             this.afterCompleteTimeout = null;
//         }
//         this.activeNavigations.clear();
//         this.waitingForPageLoad = false;
//         this.stopTimer("loading");
//         if (!this.waitForDownloadCompleted && !this.waitForDownloadCreated)
//             this.next("Page load complete2, url="+this.currentURL);
//     }

//     return count;
// };

// MacroPlayer.prototype.onNavigationCompleted = function(details) {
//     if (details.tabId != this.tab_id)
//         return;
//     console.log("onNavigationCompleted: %O", details);

//     if (this.playing && /^(?:https?|file)/.test(details.url)) {
//         this.activeNavigations.delete(details.frameId+":"+details.processId);
//         this.reviseActiveNavigations();
//     }
// };


MacroPlayer.prototype.onNavigationErrorOccured = function(details) {
    if (details.tabId != this.tab_id)
        return;

    // console.error("onNavigationErrorOccured: %O", details);
    if (this.playing) {
        // workaround for #223, see crbug.com/117043
        if (/net::ERR_ABORTED/.test(details.error)) {
            // var navigation = details.frameId+":"+details.processId;
            // this.activeNavigations.delete(navigation);
            // this.reviseActiveNavigations();
            return;
        }

        this.handleError(new RuntimeError(
            "Navigation error occured while loading url "+
                details.url+", details: "+details.error, 733));
        this.stopTimer("loading");
        this.waitingForPageLoad = false;
        // this.activeNavigations.clear();
        return;
    }
};



// MacroPlayer.prototype.onNavigationCommitted = function(details) {
//     if (details.tabId != this.tab_id)
//         return;

//     console.log("onNavigationCommitted: %O", details);

//     if (this.playing && /^(?:https?|file)/.test(details.url)) {
//         this.waitingForPageLoad = true;
//         this.activeNavigations.add(details.frameId+":"+details.processId);
//         if (!this.timers.has("loading")) {
//             var mplayer = this;
//             this.startTimer("loading", this.timeout, "Loading ", function() {
//                 mplayer.waitingForPageLoad = false;
//                 mplayer.handleError(
//                     new RuntimeError("Page loading timeout"+
//                                      ", URL: "+mplayer.currentURL, 602));
//             });
//         }
//     }
// };


// MacroPlayer.prototype.onCreatedNavigationTarget = function(details) {
//     console.log("onCreatedNavigationTarget: %O", details);
// };


// MacroPlayer.prototype.onDOMContentLoaded = function(details) {
//     console.log("onDOMContentLoaded: %O", details);
// };

// MacroPlayer.prototype.onReferenceFragmentUpdated = function(details) {
//     console.log("onReferenceFragmentUpdated: %O", details);
// };




// network events
MacroPlayer.prototype.onAuthRequired = function(details, callback) {
    // console.log("onAuthRequired: %O", details);
    if (this.tab_id != details.tabId)
        return;
    if (this.lastAuthRequestId == details.requestId) {
        asyncRun(this.handleError.bind(this)(new RuntimeError(
            "Wrong credentials for HTTP authorization"
        ), 734));
        return {cancel: true};
    }
    this.lastAuthRequestId = details.requestId;
    if (!this.loginData || !this.waitForAuthDialog) {
        asyncRun(this.handleError.bind(this)(new RuntimeError(
            "No credentials supplied for HTTP authorization"
        ), 734));
        return {cancel: true};
    }
    var rv = {
        authCredentials: {
            username: this.loginData.username,
            password: this.loginData.password
        }
    };
    delete this.loginData;

    return rv;
};


// MacroPlayer.prototype.onBeforeRequest = function(details) {
//     console.log("onBeforeRequest: %O", details);
// };

// MacroPlayer.prototype.onBeforeRedirect = function(details) {
//     console.log("onBeforeRedirect: %O", details);
// };


MacroPlayer.prototype.onBeforeSendHeaders = function(details) {
    // console.log("onBeforeSendHeaders: %O", details);
    for (var i = 0; i < details.requestHeaders.length; i++)
        if (details.requestHeaders[i].name == 'User-Agent') {
            details.requestHeaders[i].value = this.userAgent;
            break;
        }
    return {requestHeaders: details.requestHeaders};
};

// MacroPlayer.prototype.onReqCompleted = function(details) {
//     console.log("onReqCompleted: %O", details);
// };


// MacroPlayer.prototype.onErrorOccurred = function(details) {
//     console.log("onErrorOccured: %O", details);
// };

// MacroPlayer.prototype.onHeadersReceived = function(details) {
//     console.log("onHeadersReceived: %O", details);
// };

// MacroPlayer.prototype.onResponseStarted = function(details) {
//     console.log("onResponseStarted: %O", details);
// };

// MacroPlayer.prototype.onSendHeaders = function(details) {
//     console.log("onSendHeaders: %O", details);
// };


MacroPlayer.prototype.onTabActivated = function(activeInfo) {
    if (activeInfo.windowId == this.win_id) {
        // console.log("onTabActivated, tabId="+activeInfo.tabId);
        (this.eventMode? attach_debugger(activeInfo.tabId) : Promise.resolve())
            .then(() => (this.tab_id = activeInfo.tabId))
    }
};


// listen to page load events
MacroPlayer.prototype.onTabUpdated = function(tab_id, obj, tab) {
    if (this.tab_id != tab_id)
        return;
    // console.log("onTabUpdated, changeInfo=%O, tab=%O", obj, tab);
    if (tab.url == "about:blank") // ignore about:blank urls
        return;
    this.currentURL = tab.url;
    if (obj.status == "loading" && !this.timers.has("loading")) {
        this.waitingForPageLoad = true;
        this.startTimer("loading", this.timeout, "Loading ", function() {
            mplayer.waitingForPageLoad = false;
            mplayer.handleError(
                new RuntimeError("Page loading timeout"+
                                 ", URL: "+mplayer.currentURL, 602));
        });
        // We need to catch "loading" event as early as possible
        // onTabUpdated may be fired too late in some cases.
        // For example, Amazon search box triggers page load event
        // where onTabUpdated reports 'complete' prematurely and
        // the next TAG commad may be executed before search results
        // appeared on the page
    } else if (obj.status == "complete") {
        if (this.waitForAuthDialog && this.lastAuthRequestId) {
            delete this.lastAuthRequestId;
            this.waitForAuthDialog = false;
            chrome.webRequest.onAuthRequired.removeListener(this.onAuth);
        }
        if (this.waitingForPageLoad) {
            this.waitingForPageLoad = false;
            this.stopTimer("loading");
            this.next("onTabUpdated, status = complete");
        }
        return;

        // if (this.waitingForPageLoad && this.activeNavigations.size != 0) {
        //     // there are some loadings in queue, start timeout
        //     // to let them finish (in 5s)
        //     var mplayer = this;
        //     this.afterCompleteTimeout = setTimeout(function() {
        //         mplayer.waitingForPageLoad = false;
        //         mplayer.stopTimer("loading");
        //         if (!mplayer.waitForDownloadCompleted &&
        //             !mplayer.waitForDownloadCreated)
        //             mplayer.next("Page load complete1, url="+
        //                          mplayer.currentURL);
        //     }, 5000);
        // }
    }
};


MacroPlayer.prototype.startTimer = function(type, timeout, msg, callback) {
    // only one timer of the type at a time is allowed
    console.assert(!this.timers.has(type));

    var mplayer = this;

    var timer = new Object();
    timer.start = performance.now();

    timer.timeout = setTimeout(function() {
        mplayer.stopTimer(type);
        typeof(callback) == "function" && callback();
    } , timeout*1000);

    timer.interval = setInterval(function() {
        var now = performance.now();
        var elapsedTime = (now - timer.start)/1000;
        if (elapsedTime > timeout) {
            mplayer.stopTimer(type);
            typeof(callback) == "function" && callback();
        }
        // change panel/badge text
        var panel = context[mplayer.win_id].panelWindow;
        if (panel && !panel.closed) {
            panel.setStatLine(msg+elapsedTime.toFixed(1)+
                              "("+Math.round(timeout)+")s",
                              "warning");
        }

        badge.set(mplayer.win_id, {
            status: "loading",
            text: Math.round(elapsedTime) // make sure it is integer
        });

    }, 200);

    this.timers.set(type, timer);
};

MacroPlayer.prototype.stopTimer = function(type) {
    if (!this.timers.has(type))
        return;
    var timer = this.timers.get(type);
    clearTimeout(timer.timeout);
    clearInterval(timer.interval);
    this.timers.delete(type);
    timer = null;
};


MacroPlayer.prototype.clearRetryInterval = function() {
    if (this.retryInterval) {
        clearInterval(this.retryInterval);
        delete this.retryInterval;
    }
}

MacroPlayer.prototype.retry = function(onerror, msg, caller_id, timeout) {
    if (!this.playing)
    return;

    if (timeout === undefined) {
        timeout = this.timeout/10;
    }
    var _timeout = timeout*1000; // ms
    if (!this.retryInterval) {
        var start_time = performance.now();
        this.retryInterval = setInterval(() => {
            if (!this.playing) {
                this.clearRetryInterval()
                return
            }
            var remains = start_time +
                _timeout - performance.now();
            if (remains <= 0) {
                this.clearRetryInterval();
                try {
                    typeof(onerror) == "function" && onerror();
                } catch(e) {
                    if (this.ignoreErrors) {
                        this.action_stack.pop();
                        this.next("skipped retry() - error ignored");
                    } else {
                        this.handleError(e);
                    }
        }
            } else {
                // set badge text
                let text = Math.round(remains/1000);
                while(text.length < 2)
                    text = "0"+text;
                text += "s";
                badge.set(this.win_id, {
                    status: "tag_wait",
                    text: text
                });

                // set panel text
                let panel = context[this.win_id].panelWindow;
                if (panel && !panel.closed) {
                    panel.setStatLine(msg+(remains/1000).toFixed(1)+
                                      "("+Math.round(_timeout/1000)+")s",
                                      "warning");
                }
            }
        }, 500);
    }
    this.action_stack.push(this.currentAction);
    setTimeout(() => {
        this.playNextAction("retry "+caller_id);
    }, 500);
};


// handle messages from content-scripts
MacroPlayer.prototype.onTagComplete = function(data) {
    if (!data.found) {
        this.retry(() => {
            if (data.extract) {
                this.showAndAddExtractData("#EANF#");
                this.action_stack.pop();
        this.next("onTagComplete");
            } else {
        throw data.error;
            }
        }, "Tag waiting... ", "onTagComplete", this.timeout_tag);

        return;
    }

    this.clearRetryInterval();

    if (data.error) {
        this.handleError(data.error);
    } else if (data.selector) {
        this.handleInputFileTag(data.selector, data.files)
            .then(() => this.next("onTagComplete"))
            .catch(e => this.handleError(e))
    } else if (data.decryptPassword) {
        this.shouldDecryptPassword = true
        this.action_stack.push(this.currentAction)
        this.next("Decrypt content string")
    } else {
        if (data.extract) {
            this.showAndAddExtractData(data.extract);
        } else if (data.targetURI) {
            this.saveTarget(data.targetURI);
        }
        // .next() will be called in onDownloadCreated otherwise
        if (!this.waitForDownloadCreated && !this.waitForAuthDialog)
            this.next("onTagComplete");
    }
};


// MacroPlayer.prototype.onContentChange = function(data, tab_id, callback) {
//     typeof (callback) == "function" &&   // release resources
//         callback();

//     if (this.tab_id != tab_id)
//         return;
//     var mplayer = this;
//     chrome.tabs.get(tab_id, function(tab) {
//         if (!tab) return;
//         if (Storage.getBool("debug"))
//             console.debug("content-change, url "+tab.url);

//         // This is for TAG commands acting on <a> elements
//         // because tab.onUpdated() is fired too late
//         if (mplayer.playing) {
//             mplayer.waitingForPageLoad = true;
//         }
//     });
// };


MacroPlayer.prototype.terminate = function() {
    if (Storage.getBool("debug"))
        console.info("terminating player for window "+this.win_id);
    // ensure that player is stopped
    if (this.playing)
        this.stop();
};


// a pattern to match a double quoted string or eval() command
// or a non-whitespace char sequence
var im_strre = "(?:\"(?:[^\"\\\\]|\\\\[0btnvfr\"\'\\\\])*\"|"+
    "eval\\s*\\(\"(?:[^\"\\\\]|\\\\[\\w\"\'\\\\])*\"\\)|"+
    "\\S*)";

// const im_strre = "(?:\"(?:[^\"\\\\]|\\\\[0btnvfr\"\'\\\\])*\"|\\S*)";


MacroPlayer.prototype.noContentPage = function(cmd_name) {
    if (!/^https?|file/i.test(this.currentURL))
        this.handleError(
            new RuntimeError(
                cmd_name+" command can not be executed because"+
                    " it requires a Web page loaded in active tab."+
                    " Current page is "+this.currentURL, 612
            )
        );
};


// ADD command http://wiki.imacros.net/ADD
// regexp for parsing ADD command
MacroPlayer.prototype.RegExpTable["add"] =
    "^(\\S+)\\s+("+im_strre+")\\s*$";

MacroPlayer.prototype.ActionTable["add"] = function (cmd) {
    var param = imns.unwrap(this.expandVariables(cmd[2], "add2"));
    var m = null;

    if ( m = cmd[1].match(this.limits.varsRe) ) {
        var num = imns.s2i(m[1]);
        var n1 = imns.s2i(this.getVar(num)), n2 = imns.s2i(param);
        if ( !isNaN(n1) && !isNaN(n2) ) {
            this.vars[num] = (n1 + n2).toString();
        } else {
            this.vars[num] = this.getVar(num) + param;
        }
    } else if ( arr = cmd[1].match(/^!extract$/i) ) {
        this.addExtractData(param);
    } else if (/^!\S+$/.test(cmd[1])) {
        throw new BadParameter("Unsupported variable "+cmd[1]+
                               " for ADD command");
    } else {
        var n1 = imns.s2i(this.getUserVar(cmd[1])), n2 = imns.s2i(param);
        if ( !isNaN(n1) && !isNaN(n2) ) {
            this.setUserVar(cmd[1], (n1 + n2).toString());
        } else {
            this.setUserVar(cmd[1], this.getUserVar(cmd[1])+param);
        }
    }

    this.next("ADD");
};


MacroPlayer.prototype.RegExpTable["back"] = "^\\s*$";

MacroPlayer.prototype.ActionTable["back"] = function (cmd) {
    if (this.noContentPage("BACK"))
        return;

    chrome.tabs.get(this.tab_id, function(tab) {
        if (/^(?:https?|file)/.test(tab.url))
            communicator.postMessage("back-command", {}, tab.id,
                                     function() {},
                                     {number: 0});
    });
    // mplayer.next() will be called on load-complete event
};


// CLEAR command http://wiki.imacros.net/CLEAR
// I added new optional parameter to the command which restricts
// cookies removal to specified domain/url
MacroPlayer.prototype.RegExpTable["clear"] = "^\\s*("+im_strre+")?\\s*$";

MacroPlayer.prototype.ActionTable["clear"] = function (cmd) {
    var specifier = cmd[1] ?
        imns.unwrap(this.expandVariables(cmd[1], "clear1")) : null;
    var details = {};
    if (specifier) {
        if (/^http/.test(specifier)) {
            details.url = specifier;
        } else if (/^[\w\.]+$/.test(specifier)) {
            details.domain = specifier;
        } else {
            throw new BadParameter("domain name or URL", 1);
        }
    }

    var mplayer = this;
    chrome.cookies.getAll(details, function(cookies) {
        cookies.forEach(function(cookie) {
            // TODO: check if we should omit storeId here.
            // As for now I think that only current execution context
            // store's cookies should be removed
            var url = (cookie.secure? "https" : "http")+"://"+
                cookie.domain+cookie.path;
            chrome.cookies.remove({url: url, name: cookie.name});
        });
        mplayer.next("CLEAR");
    });
};


// EVENT command
MacroPlayer.prototype.RegExpTable["event"] =
    "type\\s*=\\s*("+im_strre+")"+
    "(?:\\s+(selector|xpath)\\s*=\\s*("+im_strre+"))?"+
    "(?:\\s+(button|key|char|point)\\s*=\\s*("+im_strre+"))?"+
    "(?:\\s+modifiers\\s*=\\s*("+im_strre+"))?";

MacroPlayer.prototype.attachDebugger = function(version) {
    return this.debuggerAttached ?
        Promise.resolve() : attach_debugger(this.tab_id, version).then(() => {
            this.debuggerAttached = true
        })
}

MacroPlayer.prototype.detachDebugger = function() {
    return this.debuggerAttached ?
        detach_debugger(this.tab_id).then(() => {
            this.debuggerAttached = false
        }) : Promise.resolve()
}

function attach_debugger(tab_id, version = "1.2") {
    return new Promise(function(resolve, reject) {
        chrome.debugger.attach({tabId: tab_id}, version, function() {
            if (chrome.runtime.lastError)
                reject(chrome.runtime.lastError);
            else
                resolve();
        });
    });
}

function send_command(tab_id, method, params) {
    return new Promise(function(resolve, reject) {
        chrome.debugger.sendCommand(
            {tabId: tab_id}, method, params,
            function(response) {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve(response);
            }
        );
    });
}

function detach_debugger(tab_id) {
    return new Promise(function(resolve, reject) {
        chrome.debugger.detach({tabId: tab_id}, function() {
            if (chrome.runtime.lastError)
                reject(chrome.runtime.lastError);
            else
                resolve();
        });
    });
}

function get_modifiers_bitmask(modifiers) {
    var altKey = /alt/i.test(modifiers) && 1 || 0;
    var ctrlKey = /ctrl/i.test(modifiers) && 2 || 0;
    var metaKey = /meta/i.test(modifiers) && 4 || 0;
    var shiftKey = /shift/i.test(modifiers) && 8 || 0;
    return altKey | ctrlKey | metaKey | shiftKey;
}

function get_key_identifier_from_char(c) {
    var keyCode = c.toUpperCase().charCodeAt(0);
    var s = keyCode.toString(16).toUpperCase();
    while (s.length <= 4)
        s = "0" + s;
    return "U+" + s;
}

function get_key_identifier_from_keycode(code) {
    // the table is build based on https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key#Key_values_on_Windows_(and_char_values_of_IE)
    var ids = {
        0x08: "Backspace",
        0x09: "Tab",
        0x0C: "Clear",
        0x0D: "Enter",
        0x10: "Shift",
        0x11: "Control",
        0x12: "Alt",
        0x13: "Pause",
        0x14: "CapsLock",
        0x15: "KanaMode",
        0x17: "JunjaMode",
        0x18: "HanjaMode",
        0x19: "KanjiMode",
        0x1B: "Esc",
        0x1C: "Convert",
        0x1D: "Nonconvert",
        0x1E: "Accept",
        0x1F: "ModeChange",
        0x21: "PageUp",
        0x22: "PageDown",
        0x23: "End",
        0x24: "Home",
        0x25: "Left",
        0x26: "Up",
        0x27: "Right",
        0x28: "Down",
        0x29: "Select",
        0x2B: "Execute",
        0x2C: "PrintScreen",
        0x2D: "Insert",
        0x2E: "Del",
        0x2F: "Help",
        0x5B: "Win",
        0x5C: "Win",
        0x5D: "Apps",
        0x70: "F1",
        0x71: "F2",
        0x72: "F3",
        0x73: "F4",
        0x74: "F5",
        0x75: "F6",
        0x76: "F7",
        0x77: "F8",
        0x78: "F9",
        0x79: "F10",
        0x7A: "F11",
        0x7B: "F12"
    };

    if (typeof ids[code] != "undefined")
        return ids[code];
    // else return Unicode value
    var s = code.toString(16).toUpperCase();
    while (s.length <= 4)
        s = "0" + s;
    return "U+" + s;
}

function get_windows_virtual_keycode(c) {
    // NOTE: It looks like Chrome uses Unicode code point as keyCode
    // for non-ASCII characters as well
    var keyCode = c.charCodeAt(0);
    return keyCode;
}

MacroPlayer.prototype.dispatchCharKeydownEvent = function(details) {
    return Promise.resolve()
    // var vk = get_windows_virtual_keycode(details.char);
    // var keyid = get_key_identifier_from_char(details.char);
    // var modifiers = get_modifiers_bitmask(details.modifiers);
    // var mplayer = this;
    // return [
    //     {"type": "rawKeyDown",
    //      "windowsVirtualKeyCode": vk,
    //      "keyIdentifier": keyid,
    //      "modifiers": modifiers}
    // ].reduce(function(seq, opts) {
    //     return seq.then(function() {
    //         return send_command(mplayer.tab_id, "Input.dispatchKeyEvent", opts);
    //     });
    // }, Promise.resolve());
};

MacroPlayer.prototype.dispatchCharKeyupEvent = function(details) {
    return Promise.resolve()
    // var vk = get_windows_virtual_keycode(details.char);
    // var keyid = get_key_identifier_from_char(details.char);
    // var modifiers = get_modifiers_bitmask(details.modifiers);
    // var mplayer = this;
    // return send_command(mplayer.tab_id, "Input.dispatchKeyEvent", {
    //     "type": "keyUp",
    //     "windowsVirtualKeyCode": vk,
    //     "keyIdentifier": keyid,
    //     "modifiers": modifiers
    // });
};


MacroPlayer.prototype.dispatchControlKeydownEvent = function(details) {
    var vk = details.key;
    var keyid = get_key_identifier_from_keycode(details.key);
    var modifiers = get_modifiers_bitmask(details.modifiers);
    var mplayer = this;
    return send_command(mplayer.tab_id, "Input.dispatchKeyEvent", {
        "type": "rawKeyDown",
        "windowsVirtualKeyCode": vk,
        "keyIdentifier": keyid,
        "modifiers": modifiers
    });
};

MacroPlayer.prototype.dispatchControlKeyupEvent = function(details) {
    var vk = details.key;
    var keyid = get_key_identifier_from_keycode(details.key);
    var modifiers = get_modifiers_bitmask(details.modifiers);
    var mplayer = this;
    return send_command(mplayer.tab_id, "Input.dispatchKeyEvent", {
        "type": "keyUp",
        "windowsVirtualKeyCode": vk,
        "keyIdentifier": keyid,
        "modifiers": modifiers
    });
};

MacroPlayer.prototype.dispatchCharKeypressEvent = function(details) {
    var vk = get_windows_virtual_keycode(details.char);
    var keyid = get_key_identifier_from_char(details.char);
    var modifiers = get_modifiers_bitmask(details.modifiers);
    var mplayer = this;
    return [
        {"type": "char",
         "text": details.char,
         "modifiers": modifiers}
    ].reduce(function(seq, opts) {
        return seq.then(function() {
            return send_command(mplayer.tab_id, "Input.dispatchKeyEvent", opts);
        });
    }, Promise.resolve());
};

MacroPlayer.prototype.dispatchControlKeypressEvent = function(details) {
    var vk = details.key;
    var keyid = get_key_identifier_from_keycode(details.key);
    var modifiers = get_modifiers_bitmask(details.modifiers);
    var mplayer = this;
    return ["rawKeyDown", "keyUp"]
        .reduce(function(seq, type) {
            return seq.then(function() {
                return send_command(mplayer.tab_id, "Input.dispatchKeyEvent", {
                    "type": type,
                    "windowsVirtualKeyCode": vk,
                    "keyIdentifier": keyid,
                    "modifiers": modifiers
                });
            });
        }, Promise.resolve());
};

MacroPlayer.prototype.dispatchKeyboardEvent = function(details) {
    var char_funcs = {
        "keydown": this.dispatchCharKeydownEvent.bind(this),
        "keyup": this.dispatchCharKeyupEvent.bind(this),
        "keypress": this.dispatchCharKeypressEvent.bind(this)
    };
    var ctrl_funcs = {
        "keydown": this.dispatchControlKeydownEvent.bind(this),
        "keyup": this.dispatchControlKeyupEvent.bind(this),
        "keypress": this.dispatchControlKeypressEvent.bind(this)
    };
    return (details.char ? char_funcs : ctrl_funcs)[details.type](details);
};

function get_mouse_button_name(button) {
    if (button == -1)
        return "none";
    else if (button == 0)
        return "left";
    else if (button == 1)
        return "middle";
    else if (button == 2)
        return "right";
    else
        return "none"; // TODO: should we handle other buttons as well?
}

function get_mouse_event_name(type) {
    if (type == "mousedown")
        return "mousePressed";
    else if (type == "mouseup")
        return "mouseReleased";
    else
        return "mouseMoved";
}

function get_target_center_point(rect) {
    return {
        x: rect.left+rect.width/2,
        y: rect.top+rect.height/2,
    };
}

MacroPlayer.prototype.dispatchMouseEvent = function(details) {
    let point = {}
    if (details.point) {
        point.x = details.point.x-details.targetRect.pageXOffset+
            details.targetRect.xOffset
        point.y = details.point.y-details.targetRect.pageYOffset+
            details.targetRect.yOffset
    } else {
        point = get_target_center_point(details.targetRect)
        point.x += details.targetRect.xOffset
        point.y += details.targetRect.yOffset
    }
    point.x = Math.round(point.x)
    point.y = Math.round(point.y)
    var type = get_mouse_event_name(details.type);
    return send_command(this.tab_id, "Input.dispatchMouseEvent", {
        "type": type,
        "button": get_mouse_button_name(details.button),
        "clickCount": details.clickCount || 0,
        "modifiers": get_modifiers_bitmask(details.modifiers),
        "x": point.x,
        "y": point.y
    });
};


MacroPlayer.prototype.ActionTable["event"] = function (cmd) {
    var type = imns.unwrap(this.expandVariables(cmd[1], "event1")).toLowerCase();
    var selector_type = cmd[2] ? cmd[2].toLowerCase() : "";
    var selector = cmd[3] ? imns.unwrap(this.expandVariables(cmd[3], "event3")) : "";
    var value_type = (cmd[4] || "").toLowerCase();
    var value = cmd[5] ? imns.unwrap(this.expandVariables(cmd[5], "event5")) : 0;
    var modifiers = cmd[6] ?
        imns.unwrap(this.expandVariables(cmd[6], "event6")) : "";

    var data = {scroll: true};
    data[selector_type || "selector"] = selector || ":root";

    this.attachDebugger().then(
        () => communicator.sendMessage(
            "activate-element", data, this.tab_id, this.currentFrame
        )
    ).then(response => {
        if (!response) {
            throw new RuntimeError(chrome.runtime.lastError.message);
        }
        else if (response.error)
            throw new RuntimeError(
                response.error.message, response.error.errnum
            )
        else
            this.clearRetryInterval()
        return response.targetRect
    }).then(targetRect => {
        var button = 0;
        var key = 0;
        var char = "";
        var point = null;

        if (!value_type) {
            ; // do nothing
        } else if (value_type == "button") {
            button = imns.s2i(value);
            if (isNaN(button))
                throw new BadParameter("integer BUTTON value", 3);
        } else if (value_type.toLowerCase() == "key") {
            key = imns.s2i(value);
            if (isNaN(key))
                throw new BadParameter("integer KEY value", 3);
        } else if (value_type.toLowerCase() == "char") {
            char = value;
        } else if (value_type.toLowerCase() == "point") {
            const point_re =
                /^\(\s*(\d+(?:\.\d+)?)\s*\,\s*(\d+(?:\.\d+)?)\s*\)$/;
            var m = null;
            if ( !(m = point_re.exec(value.trim())) )
                throw new BadParameter("(x,y) POINT value", 3);
            point = {x: parseFloat(m[1]), y: parseFloat(m[2])};
        }
        return Promise.resolve().then(() => {
            if (/^mouse/.test(type)) {
                var details = {
                    type: type,
                    point: point,
                    button: button,
                    modifiers: modifiers,
                    targetRect: targetRect
                };
                return this.dispatchMouseEvent(details);
            } else if (/^key/.test(type)) {
                var details = {
                    type: type,
                    key: key,
                    char: char,
                    modifiers: modifiers
                };
                return this.dispatchKeyboardEvent(details);
            } else if (type == "click") {
                // click is a result of mousedown/up
                return [
                    {clickCount: 1, type: "mousedown"},
                    {clickCount: 1, type: "mouseup"}
                ].map(x => ({
                    type: x.type,
                    clickCount: x.clickCount,
                    point: point,
                    button: button,
                    modifiers: modifiers,
                    targetRect: targetRect
                })).reduce((seq, details) => seq.then(
                    () => this.dispatchMouseEvent(details)
                ) , Promise.resolve())
            } else if (type == "dblclick") {
                // dblclick is a result of two mousedown/up
                return [
                    {clickCount: 1, type: "mousedown"},
                    {clickCount: 1, type: "mouseup"},
                    {clickCount: 2, type: "mousedown"},
                    {clickCount: 2, type: "mouseup"}
                ].map(x => ({
                    type: x.type,
                    clickCount: x.clickCount,
                    point: point,
                    button: button,
                    modifiers: modifiers,
                    targetRect: targetRect
                })).reduce((seq, details) => seq.then(
                    () => this.dispatchMouseEvent(details)
                ) , Promise.resolve())
            }
        })
    }).then(() => this.next("EVENT")).catch(e => {
        if (e.errnum == 721)    // if element not found
            this.retry(
                () => {
                    throw e
                }, "Tag waiting... ", "onActivateElement", this.timeout_tag
            )
        else
            this.handleError(e)
    })
};


MacroPlayer.prototype.RegExpTable["events"] =
        "type\\s*=\\s*("+im_strre+")"+
        "(?:\\s+(selector|xpath)\\s*=\\s*("+im_strre+"))?"+
        "(?:\\s+(keys|chars|points)\\s*=\\s*("+im_strre+"))?"+
        "(?:\\s+modifiers\\s*=\\s*("+im_strre+"))?";

MacroPlayer.prototype.ActionTable["events"] = function (cmd) {
    var type = imns.unwrap(this.expandVariables(cmd[1], "events1")).toLowerCase();
    var selector_type = cmd[2] ? cmd[2].toLowerCase() : "";
    var selector = cmd[3] ? imns.unwrap(this.expandVariables(cmd[3], "events3")) : "";
    var value_type = (cmd[4] || "").toLowerCase();
    var value = cmd[5] ? imns.unwrap(this.expandVariables(cmd[5], "events5")) : 0;
    var modifiers = cmd[6] ?
        imns.unwrap(this.expandVariables(cmd[6], "events6")) : "";
    var data = {scroll: true};
    data[selector_type || "selector"] = selector || ":root";
    this.attachDebugger().then(
        () => communicator.sendMessage(
            "activate-element", data, this.tab_id, this.currentFrame
        )
    ).then(response => {
        if (response.error)
            throw new RuntimeError(
                response.error.message, response.error.errnum
            )
        else
            this.clearRetryInterval()

        return response
    }).then(resp => {
        // parse value
        if (value_type.toLowerCase() == "chars") {
            if (resp.isPasswordElement) {
                return this.decrypt(value).then(decryptedString => ({
                    chars: decryptedString.split("")
                }))
            } else {
                return {chars: value.split("")}
            }
        } else if (value_type.toLowerCase() == "keys") {
            let keys_re = /\[\d+(?:\s*,\s*\d+)*\]/
                if ( !keys_re.test(value.trim()) )
                    throw new BadParameter("[k1,..,kn] as KEYS value", 3);
            return {keys: JSON.parse(value)}
        } else if (value_type.toLowerCase() == "points") {
            let points_re = /^(?:\s*\(\d+(?:\.\d+)?\s*\,\s*\d+(?:\.\d+)?\s*\)(?:\s*,\s*)?)+$/
                if ( !points_re.test(value.trim()) )
                    throw new BadParameter("(x,y)[,(x,y)] as POINTS value", 3);
            let point_re = /\(\s*(\d+(?:\.\d+)?)\s*\,\s*(\d+(?:\.\d+)?)\s*\)/g
            let points = []
            while(m = point_re.exec(value)) {
                points.push({x: parseFloat(m[1]), y: parseFloat(m[2])});
            }
            return {points: points, targetRect: resp.targetRect}
        }
    }).then(value => {
        if (type == "mousemove") {
            return value.points.map(point => ({
                type: type,
                point: point,
                targetRect: value.targetRect,
                modifiers: modifiers
            })).reduce((seq, details) => seq.then(
                () => this.dispatchMouseEvent(details)
            ) , Promise.resolve())
        } else if (/^key/.test(type) && value.keys) {
            return value.keys.map(key => ({
                type: type,
                key: key,
                modifiers: modifiers
            })).reduce((seq, details) => seq.then(
                () => this.dispatchKeyboardEvent(details)
            ) , Promise.resolve())
        } else if (/^key/.test(type) && value.chars) {
            return value.chars.map(char => ({
                type: type,
                char: char,
                modifiers: modifiers
            })).reduce((seq, details) => seq.then(
                () => this.dispatchKeyboardEvent(details)
            ), Promise.resolve())
        } else {
            throw RuntimeError("Can not process event type "+type, 711)
        }
    }).then(
        () => this.next("EVENTS")
    ).catch(e => {
        if (e.errnum == 721)    // if element not found
            this.retry(
                () => {
                    throw e
                }, "Tag waiting... ", "onActivateElement", this.timeout_tag
            )
        else
            this.handleError(e)
    })
};


MacroPlayer.prototype.decrypt = function(str) {
    this.waitingForPassword = true
    return Promise.resolve().then(() => {
        if (this.encryptionType == "no") {
            return str
        } else if (this.encryptionType == "stored") {
            let pwd = Storage.getChar("stored-password")
            // stored password is base64 encoded
            pwd = decodeURIComponent(atob(pwd))
            // throws error if password does not match
            return Rijndael.decryptString(str, pwd)
        } else if (this.encryptionType == "tmpkey") {
            let p = Rijndael.tempPassword ? Promise.resolve({
                password: Rijndael.tempPassword
            }) : dialogUtils.openDialog("passwordDialog.html",
                                        "iMacros Password Dialog",
                                        {type: "askPassword"})
            return p.then(result => {
                if (result.canceled) {
                    this.waitingForPassword = false
                    throw new RuntimeError(
                        "Password input has been canceled", 743
                    )
                }
                try {
                    let rv = Rijndael.decryptString(str, result.password)
                    Rijndael.tempPassword = result.password
                    return rv
                } catch(e) {
                    // wrong password, try again
                    return this.decrypt(str)
                }
            })
        } else {
            throw new RuntimeError(
                "Unsupported encryption type: "+this.encryptionType, 711
            )
        }
    }).then(decryptedString => {
        this.waitingForPassword = false
        return decryptedString
    }).catch(e => {
        this.waitingForPassword = false
        throw e
    })
}

// FRAME command http://wiki.imacros.net/FRAME
MacroPlayer.prototype.RegExpTable["frame"] =
    "^(f|name)\\s*=\\s*("+im_strre+")\\s*$";

MacroPlayer.prototype.onFrameComplete = function(data) {
    if (!data.frame) {
        var self = this;
        this.retry(function() {
            self.currentFrame = {number: 0};
            throw new RuntimeError("frame "+param+" not found", 722);
        }, "Frame waiting... ", "onFrameComplete", this.timeout_tag);
    } else {
        this.clearRetryInterval();
        this.currentFrame = data.frame;
        this.next("onFrameComplete");
    }
};

MacroPlayer.prototype.ActionTable["frame"] = function (cmd) {
    var type = cmd[1].toLowerCase();
    var param = imns.unwrap(this.expandVariables(cmd[2], "frame2"));
    var frame_data = new Object();

    if (type == "f") {
        param = imns.s2i(param);
        if (isNaN(param))
            throw new BadParameter("F=<number>", 1);

        // shortcut for main frame
        if (param == 0) {
            this.currentFrame = {number: 0};
            this.next("FRAME");
            return;
        }
    }

    if (type == "f")
        frame_data.number = param;
    else if (type == "name")
        frame_data.name = param;

    var self = this;

    communicator.postMessage("frame-command", frame_data, this.tab_id,
                             this.onFrameComplete.bind(this),
                             {number: 0});
};



// IMAGESEARCH command http://wiki.imacros.net/IMAGESEARCH
MacroPlayer.prototype.RegExpTable["imagesearch"] =
    "^pos\\s*=\\s*("+im_strre+
    ")\\s+image\\s*=\\s*("+im_strre+")\\s+"+
    "confidence\\s*=\\s*("+im_strre+")";

MacroPlayer.prototype.ActionTable["imagesearch"] = function (cmd) {
    var pos = imns.s2i(imns.unwrap(
        this.expandVariables(cmd[1], "imagesearch1")
    ));
    var image = imns.unwrap(this.expandVariables(cmd[2], "imagesearch2"));
    var cl = imns.s2i(imns.unwrap(
        this.expandVariables(cmd[3], "imagesearch3")
    ));

    if (!__is_windows()) {
        throw new UnsupportedCommand("IMAGESEARCH");
    }

    if (!this.afioIsInstalled) {
        throw new RuntimeError(
            "IMAGESEARCH command requires File IO interface", 660
        );
    }

    if (!__is_full_path(image)) {
        // NOTE: we assume here that defdatapath is already set which
        // may not be true under some (rare) circumstances
        var default_dir = afio.openNode(localStorage["defdatapath"]);
    default_dir.append(image);
    image = default_dir.path;
    }

    var mplayer = this;
    communicator.postMessage("webpage-hide-scrollbars",{hide: true}, mplayer.tab_id,()=>{});
    this.captureWebPage(function(_) {
        communicator.postMessage("webpage-hide-scrollbars",{hide: false}, mplayer.tab_id,()=>{});
    // chrome.tabs.captureVisibleTab(this.win_id, {format: "png"}, function(_) {
        const host = "com.ipswitch.imacros.host";
        var msg_no_free_beer = "This feature requires"+
            " the iMacros image recognition library,"+
            " which is part of the commercial iMacros Standard"+
            " and Enterprise Editions";
        var re = /data\:([\w-]+\/[\w-]+)?(?:;(base64))?,(.+)/;
        var m = re.exec(_);
        if (!m) {
            mplayer.handleError(
                new RuntimeError("Can not parse image data"+_), 701
            );
            return;
        }
        console.assert(m[1] == "image/png");
        var request = {
            type: "do_image_search",
            image_data: m[3],
            sample_path: image,
            pos: pos-1,         // zero-based index expected
            cl: cl
        };
        chrome.runtime.sendNativeMessage(host, request, function(result) {
            if (chrome.runtime.lastError) {
                var nf = "Specified native messaging host not found";
                if (chrome.runtime.lastError.message.match(nf)) {
                    mplayer.handleError(
                        new RuntimeError(msg_no_free_beer), 702
                    );
                } else {
                    mplayer.handleError(chrome.runtime.lastError);
                }
                return;
            }

            if (result.type == "error") {
                mplayer.handleError(new RuntimeError(result.error), 703);
                return;
            }

            if(!result.found) {
                mplayer.retry(function() {
                    throw new RuntimeError(
                        "Image specified by "+image+
                            " does not match the web-page", 727);
                }, "Image waiting... ", "onImageSearch", mplayer.timeout_tag*4);
                return;
            }
            mplayer.clearRetryInterval();
            communicator.postMessage(
                "image-search-command",
                result, mplayer.tab_id,
                function() {
                    mplayer.imageX = result.x;
                    mplayer.imageY = result.y;
                    mplayer.next("IMAGESEARCH");
                },
                {number: 0}
            );
        });
    });
};



// ONDOWNLOAD command http://wiki.imacros.net/ONDOWNLOAD
MacroPlayer.prototype.RegExpTable["ondownload"] =
    "^folder\\s*=\\s*("+im_strre+")\\s+"+
    "file\\s*=\\s*("+im_strre+")"+
    "(?:\\s+wait\\s*=(yes|no|true|false))?"+
    "(?:\\s+checksum\\s*=(md5|sha1):(\\S+))?"+
    "\\s*$";

MacroPlayer.prototype.ActionTable["ondownload"] = function (cmd) {
    var obj = new Object();
    var wait = true;
    var folder = imns.unwrap(this.expandVariables(cmd[1], "ondownload1"));
    
    if (folder !== "*" && !this.afioIsInstalled) {
        throw new BadParameter("FOLDER requires File Access for iMacros Extensions. Specify FOLDER=* to save file to the browser's default download folder.");
    }
    
    var file = imns.unwrap(this.expandVariables(cmd[2], "ondownload2"));
    if (typeof cmd[3] != "undefined") {
        var param = imns.unwrap(this.expandVariables(cmd[3], "ondownload3"));
        wait = /^(?:yes|true)$/i.test(param);
    }
    if (typeof cmd[4] != "undefined") {
        // TODO: add checksum check support to afio.exe?
        throw new UnsupportedCommand("ONDOWNLOAD ... CHECKSUM=");
        // if (!wait) {
        //     throw new BadParameter("CHECKSUM requires WAIT=YES", 3);
        // }
        // this.downloadCheckAlg = imns.unwrap(
        //     this.expandVariables(cmd[4], "ondownload4")
        // );
        // this.downloadChecksum = imns.unwrap(
        //     this.expandVariables(cmd[5], "ondownload5")
        // ).toLowerCase();
    }

    // a sanity check to ensure that only one ONDOWNLOAD was set for an action
    if (this.waitForDownloadCreated) {
        throw new Error("only one ONDOWNLOAD command should be used for each download");
    }

    this.waitForDownloadCreated = true;
    this.waitForDownloadCompleted = wait;
    this.downloadFolder = folder;
    this.downloadFilename = file;
    this.shouldDownloadPDF = true;
    if (!this.downloadHooksRegistered) {
        this.downloadHooksRegistered = true
        chrome.downloads.onCreated.addListener(this._onDownloadCreated);
        chrome.downloads.onChanged.addListener(this._onDownloadChanged);
        context.registerDfHandler(this.win_id);
    }
    this.next("ONDOWNLOAD");
};

// a handler passed to a singleton onDeterminingFilename event listener
// stored in context object
MacroPlayer.prototype.onDeterminingFilename = function(dl, suggest) {
    if (!this.activeDownloads.has(dl.id))
        return false;

    //  Get file name and extension from the source uri.
    var filename = "", m = null, name = "", ext = "";
    if ( m = dl.url.match(/\/([^\/?]+)(?=\?.+|$)/) ) {
    name = m[1];
    if (m = name.match(/\.([^\.\s]+)$/)) {
        ext = m[1];
        name = name.replace(/\.[^\.\s]+$/, "");
    }
    }
    var dl_obj = this.activeDownloads.get(dl.id);
    if (dl_obj.downloadFilename == "*") {
        return false;
    } else if (/^\+/.test(dl_obj.downloadFilename)) {
    filename = name+dl_obj.downloadFilename.substring(1)+"."+ext;
    } else {
        // TODO: I'm not sure if we should replace the provided extension
    // if (/\.[^\.\s]+$/i.test(this.downloadFilename))
    //     filename = this.downloadFilename.replace(/\.[^\.\s]+$/, "."+ext);
    // else
    filename = dl_obj.downloadFilename;
    }
    // NOTE: I guess "overwrite" is the proper action here since user
    // should know best if any name conflicts are possible
    suggest({filename: filename, conflictAction: "overwrite"});

    return true;
};



MacroPlayer.prototype.onDownloadCompleted = function(id) {
    // console.log("onDownloadCompleted, id=%d", id);
    var dl_obj = this.activeDownloads.get(id);
    this.activeDownloads.delete(id);

    // do cleanup
    if (this.downloadHooksRegistered && this.activeDownloads.size == 0) {
        chrome.downloads.onCreated.removeListener(this._onDownloadCreated);
        chrome.downloads.onChanged.removeListener(this._onDownloadChanged);
        context.unregisterDfHandler(this.win_id);
        this.downloadHooksRegistered = false
    }

    if (!this.afioIsInstalled) {
        if (this.waitForDownloadCompleted) {
            this.next("onDownloadCompleted");
            this.stopTimer("download");
            this.waitForDownloadCompleted = false;
        }
        return;
    }
    var dest_dir = null;
    if (dl_obj.downloadFolder == "*") {
        dest_dir = this.defDownloadFolder.clone()
    } else {
        dest_dir = afio.openNode(dl_obj.downloadFolder);
    }
    var mplayer = this;
    dest_dir.exists().then(function(exists) {
        if (!exists)
            throw new RuntimeError("Path "+folder+" does not exist", 732);

        var file = afio.openNode(dl_obj.downloadFilename);
        dest_dir.append(file.leafName);
        // set !DOWNLOADED_FILE_NAME
        mplayer.downloadedFilename = dest_dir.path;
        // console.log("onDownloadCompleted, id=%d, file=%s, dest=%s", id,
        //             file.path, dest_dir.path);
        return dest_dir.exists().then(function(exists) {
            // a workaroud  for Windows - remove existing file before moving
            // the downloaded file
            return exists ?  dest_dir.remove() : Promise.resolve();
        }).then(function() {
            return file.moveTo(dest_dir).then(function() {
                if (mplayer.waitForDownloadCompleted) {
                    mplayer.stopTimer("download");
                    mplayer.waitForDownloadCompleted = false;
                    mplayer.next("onDownloadCompleted");
                }
            });
        });
    }).catch(function(err) {
        mplayer.handleError(err);
    });
};


MacroPlayer.prototype.onDownloadCreated = function(dl) {
    // console.log("onDownloadCreated %O", dl);
    if (dl.state != "in_progress")
        return;
    if (dl.referrer && dl.referrer != this.currentURL)
        return;
    console.assert(this.waitForDownloadCreated);
    // a scary warning to handle messed up cases where TAG command
    // that triggers a download precedes ONDOWNLOAD command (see #414)
    if (!this.waitForDownloadCreated) {
        this.handleError(new Error(
            "A download is started but no matching ONDOWNLOAD command was found"
        ));
        return;
    }
    this.waitForDownloadCreated = false;

    // NOTE: it is not guaranteed that this is 'our' download because other
    // tabs with the very same URL may initiate a download at the same time
    var dl_obj = {
        downloadFilename: this.downloadFilename,
        downloadFolder: this.downloadFolder
    };
    this.activeDownloads.set(dl.id, dl_obj);
    this.downloadedSize = dl.fileSize;
    if (this.waitForDownloadCompleted) {
        var mplayer = this;
        this.startTimer(
            "download",
            this.timeout_download,
            "Loading file ",
            function() {
                mplayer.waitForDownloadCompleted = false;
                mplayer.handleError(
                    new RuntimeError("Download timeout", 604));
            });
    } else {
        this.next("onDownloadCreated");
    }
};

MacroPlayer.prototype.onDownloadChanged = function(changeInfo) {
    // console.log("onDownloadChanged %O", changeInfo);
    if (!this.activeDownloads.has(changeInfo.id))
        return;

    if (changeInfo.filename) {
        this.activeDownloads.get(changeInfo.id).downloadFilename =
            changeInfo.filename.current;
        // set !DOWNLOADED_FILE_NAME
        this.downloadedFilename = changeInfo.filename.current;
    }
    if (changeInfo.state && changeInfo.state.current == "complete") {
        this.onDownloadCompleted(changeInfo.id);
    }
};

MacroPlayer.prototype.saveTarget = function(url) {
    var self = this;
    chrome.downloads.download({url: url}, function(dl_id) {
        // NOTE: The download object will be set inside
        // onDownloadCreated handler
        // console.log("download id=%d", dl_id);
        // var dl_obj = {
        //     downloadFilename: this.downloadFilename,
        //     downloadFolder: this.downloadFolder
        // };
        // self.activeDownloads.set(dl_id, dl_obj);
    });
};

// ONERRORDIALOG command http://wiki.imacros.net/ONERRORDIALOG

MacroPlayer.prototype.RegExpTable["onerrordialog"] =
    "^(?:button\\s*=\\s*(?:\\S*))?\\s*(?:\\bcontinue\\s*=\\s*(\\S*))?\\s*$"

MacroPlayer.prototype.ActionTable["onerrordialog"] = function (cmd) {
    var param = cmd[1] ? imns.unwrap(this.expandVariables(cmd[1], "onerrordialog1")) : "";
    if (/^no|false$/i.test(param)) {
        this.shouldStopOnError = true;
    }

    this.next("ONERRORDIALOG");
};


MacroPlayer.prototype.onErrorOccurred = function(data) {
    if (!this.playing || !this.shouldStopOnError)
        return;

    this.handleError(data);
};

// TODO: maybe onscripterror should have another syntax?
// now these are plain references
MacroPlayer.prototype.RegExpTable["onscripterror"] =
    MacroPlayer.prototype.RegExpTable["onerrordialog"];


MacroPlayer.prototype.ActionTable["onscripterror"] =
    MacroPlayer.prototype.ActionTable["onerrordialog"];



// ONLOGIN command http://wiki.imacros.net/ONLOGIN
MacroPlayer.prototype.RegExpTable["onlogin"] =
    "^user\\s*=\\s*("+im_strre+")\\s+"+
    "password\\s*=\\s*("+im_strre+")\\s*$";

MacroPlayer.prototype.ActionTable["onlogin"] = function (cmd) {
    var username = imns.unwrap(this.expandVariables(cmd[1], "onlogin1"));
    var password = imns.unwrap(this.expandVariables(cmd[2], "onlogin2"));
    this.loginData = {
        username: username
    }
    this.waitForAuthDialog = true;
    chrome.webRequest.onAuthRequired.addListener(
        this.onAuth,
        {windowId: this.win_id, urls: ["<all_urls>"]},
        ["blocking"]
    );
    this.decrypt(password).then(decryptedString => {
        this.loginData.password = decryptedString
    }).then(() => this.next("ONLOGIN")).catch(e => this.handleError(e))
};


// PAUSE command http://wiki.imacros.net/PAUSE
MacroPlayer.prototype.RegExpTable["pause"] = "^\\s*$";

MacroPlayer.prototype.ActionTable["pause"] = function (cmd) {
    this.pause();
    this.next("PAUSE");
};


// PROMPT command http://wiki.imacros.net/PROMPT
MacroPlayer.prototype.RegExpTable["prompt"] =
    "^("+im_strre+")"+
    "(?:\\s+("+im_strre+")"+
    "(?:\\s+("+im_strre+"))?)?\\s*$";

MacroPlayer.prototype.ActionTable["prompt"] = function (cmd) {
    if (this.noContentPage("PROMPT"))
        return;

    var x = {};
    x.text = imns.unwrap(this.expandVariables(cmd[1], "prompt1"));

    if (typeof(cmd[2]) != "undefined") {
        if (this.limits.varsRe.test(cmd[2])) {
            x.varnum = imns.s2i(RegExp.$1);
        } else if (/^[^!]\S*/.test(cmd[2])) {
            this.checkFreewareLimits("user_vars", null);
            x.varname = cmd[2];
        } else {
            throw new BadParameter("Unsupported variable "+cmd[2]);
        }
    }

    if (typeof(cmd[3]) != "undefined") {
        x.defval = imns.unwrap(this.expandVariables(cmd[3], "prompt3"));
    }

    try {
        if (typeof (x.varnum) != "undefined" ||
            typeof (x.varname) != "undefined") {
            var mplayer = this;
            let p = dialogUtils.openDialog("promptDialog.html",
                "iMacros Prompt Dialog",
                { type: "askInput", text: x.text, default: x.defval });
            return p.then(function (result) {
                var retobj = {varnum: x.varnum, varname: x.varname};
                retobj.value = "";
                if (!result.canceled) {
                    retobj.value = result.inputValue;
                }
                if (typeof (retobj.varname) != "undefined") {
                    mplayer.setUserVar(retobj.varname, retobj.value);
                } else if (typeof (retobj.varnum) != "undefined") {
                    mplayer.vars[imns.s2i(retobj.varnum)] = retobj.value;
                }
                mplayer.next("onPromptComplete");
                return
            })
        } else {
            var mplayer = this;
            let p = dialogUtils.openDialog("promptDialog.html",
                "iMacros Prompt Dialog",
                { type: "alert", text: x.text });
            return p.then(function (result) {
                mplayer.next("onPromptComplete");
                return
            })

        }

    } catch (e) {
        this.handleError(e);
    }
};

MacroPlayer.prototype.onPromptComplete = function(data) {
    if (typeof(data.varname) != "undefined") {
        this.setUserVar(data.varname, data.value);
    } else if (typeof(data.varnum) != "undefined") {
        this.vars[imns.s2i(data.varnum)] = data.value;
    }
    this.next("onPromptComplete");
};


// PROXY command http://wiki.imacros.net/PROXY
MacroPlayer.prototype.RegExpTable["proxy"] =
    "^address\\s*=\\s*("+im_strre+")"+
    "(?:\\s+bypass\\s*=\\s*("+im_strre+")\\s*)?$";


MacroPlayer.prototype.setProxySettings = function(config) {
    // set new proxy settings
    var mplayer = this;
    chrome.proxy.settings.set(
        {value: config},
        function() {
            mplayer.next("PROXY");
        }
    );
};

MacroPlayer.prototype.storeProxySettings = function(callback) {
    var mplayer = this;
    // first we should store old settings
    chrome.proxy.settings.get(
        {'incognito': false},
        function(config) {
            mplayer.proxySettings = config.value;
            typeof(callback) == "function" && callback();
        }
    );
};


MacroPlayer.prototype.restoreProxySettings = function() {
    if (!this.proxySettings)
        return;
    if (this.proxySettings.mode == "system") {
        chrome.proxy.settings.clear({});
    } else {
        chrome.proxy.settings.set(
            {value: this.proxySettings, 'incognito': false},
            function() {}
        );
    }
};


// for possible bypass values see
// http://code.google.com/chrome/extensions/experimental.proxy.html#bypass_list

MacroPlayer.prototype.ActionTable["proxy"] = function (cmd) {
    var address = imns.unwrap(this.expandVariables(cmd[1], "proxy1"));
    var bypass = cmd[2]? imns.unwrap(this.expandVariables(cmd[2], "proxy2")):
        null;

    if (!chrome.proxy) {
        throw new RuntimeError("PROXY command can not be executed because"+
                               " chrome.proxy module unavailable", 610);
    }

    var addr_re = /^(?:(https?)\s*=\s*)?([\d\w\.]+):(\d+)\s*$/;
    var m = addr_re.exec(address);
    if (!m) {
        throw new BadParameter("server name or IP address with port number", 1);
    }

    var https = (m[1] == "https");
    var server = m[2];
    var port = imns.s2i(m[3]);

    var config = {
        mode: "fixed_servers",
        rules: {
            singleProxy: {}
        }
    };

    config.rules.singleProxy["scheme"] = https ? "https" : "http";
    config.rules.singleProxy["host"] = server;
    config.rules.singleProxy["port"] = port;

    if (bypass) {
        if (!/^null$/i.test(bypass)) {
            config.rules.bypassList = bypass.split(",");
        }
    }
    var mplayer = this;
    if (!this.proxySettings)
        this.storeProxySettings(function() {
            mplayer.setProxySettings(config);
        });
    else
       this.setProxySettings(config);

};


// REFRESH command http://wiki.imacros.net/REFRESH
MacroPlayer.prototype.RegExpTable["refresh"] = "^\\s*$";

MacroPlayer.prototype.ActionTable["refresh"] = function (cmd) {
    if (this.noContentPage("REFRESH"))
        return;

    chrome.tabs.get(this.tab_id, function(tab) {
        if (/^(?:https?|file)/.test(tab.url))
            communicator.postMessage("refresh-command", {}, tab.id,
                                     function() {},
                                     {number: 0});
    });
    // mplayer.next() will be called on load-complete event
};


// utility functions for next two commands

// get file name of the page, e.g. index.html
var __doc_name = function(url) {
    // use the location file name if present
    var name = url;
    if (/\/([^\/?]*)(?:\?.*)?$/.test(url))
        name = RegExp.$1;
    // if name is empy use server name
    if (!name.length) {
        if (/^https?:\/\/(?:www\.)?([^\/]+)/.test(url))
            name = RegExp.$1;
    }

    return name;
};


// ensure that filename has an extension or add .ext
var __ensure_ext = function(filename, ext) {
    if (!(new RegExp("\\."+ext+"$")).test(filename)) {
        return filename+"."+ext;
    } else {
        return filename;
    }
};


// SAVEAS command http://wiki.imacros.net/SAVEAS
MacroPlayer.prototype.RegExpTable["saveas"] =
    "^type\\s*=\\s*(\\S+)\\s+"+
    "folder\\s*=\\s*("+im_strre+")\\s+"+
    "file\\s*=\\s*("+im_strre+")\\s*$";

function getSaveAsFile(mplayer, folder, filename, type) {
    if (!mplayer.afioIsInstalled)
        throw new RuntimeError(
            "SAVEAS requires File IO interface installed", 660
        );

    let f = folder == "*" ?
        mplayer.defDownloadFolder.clone() : afio.openNode(folder)

    return f.exists().then(function(exists) {
        if (!exists) {
            throw new RuntimeError("Path "+folder+" does not exist", 732);
        }
        let defaultName = (type == "extract") ? "extract" : __doc_name(mplayer.currentURL);
        if (filename == "*") {
            filename = defaultName;
        } else if (filename.match(/^\+(.+)$/)) {
            filename = defaultName + RegExp.$1;
        }
        // replace illegal file name characters < > : " / \ | ? * by underscores
        var re = new RegExp('\\s*[:*?|<>\\"/]+\\s*', "g");
        filename = filename.replace(re, "_");
        if (type == "extract") {
            f.append(__ensure_ext(filename, "csv"));
        } else if (type == "mht") {
            f.append(__ensure_ext(filename, "mht"));
        } else if (type == "txt" || type == "htm") {
            f.append(__ensure_ext(filename, type));
        } else if (/^png|jpeg$/.test(type)) {
            f.append(__ensure_ext(filename, type == "jpeg"? "jpg": "png"));
        } else {
            throw new BadParameter("iMacros for Chrome supports only "+
                                   "MHT|HTM|TXT|EXTRACT|PNG|JPEG SAVEAS types")
        }

        return f;
    });
}

MacroPlayer.prototype.ActionTable["saveas"] = function (cmd) {
    if (this.noContentPage("SAVEAS"))
        return;

    var folder = imns.unwrap(this.expandVariables(cmd[2], "saveas2"));
    var type = imns.unwrap(this.expandVariables(cmd[1], "saveas1")).
        toLowerCase();
    var filename = imns.unwrap(this.expandVariables(cmd[3], "saveas3"));

    let mplayer = this;
    getSaveAsFile(mplayer, folder, filename, type).then(f => {
        if (type == "extract") {
            let data = mplayer.getExtractData();
            mplayer.clearExtractData();
            data = data.replace(/\"/g, '""');
            data = '"'+data.replace(/\[EXTRACT\]/g, '"'+
                                    mplayer.dataSourceDelimiter+
                                    '"')+'"';
            afio.appendTextFile(f, data+(__is_windows() ? "\r\n" : "\n"))
                .then(() => mplayer.next("SAVEAS"))
                .catch(err => mplayer.handleError(err));
        } else if (type == "mht") {
            chrome.pageCapture.saveAsMHTML(
                {tabId: mplayer.tab_id},
                function(data) {
                    let reader = new FileReader();
                    reader.onload = function(event) {
                        afio.writeTextFile(f, event.target.result)
                            .then(() => mplayer.next("SAVEAS"))
                            .catch(e => mplayer.handleError(e));
                    };
                    reader.onerror = function(event) {
                        mplayer.handleError(event.target.error);
                    };
                    reader.readAsText(data);
                }
            )
        } else if (type == "txt" || type == "htm") {
            // NOTE: both txt and htm save only topmost frame data
            communicator.postMessage(
                "saveas-command", {type: type}, mplayer.tab_id,
                function(data) {
                    afio.writeTextFile(f, data)
                        .then(() => mplayer.next("SAVEAS"))
                        .catch(e => mplayer.handleError(e));
                },
                {number: 0}
            );
        } else if (/^png|jpeg$/.test(type)) {
            communicator.postMessage("webpage-hide-scrollbars",{hide: true}, mplayer.tab_id,()=>{});
            mplayer.captureWebPage(function(data) {
                communicator.postMessage("webpage-hide-scrollbars",{hide: false}, mplayer.tab_id,()=>{});
                var re = /data\:([\w-]+\/[\w-]+)?(?:;(base64))?,(.+)/;
                var m = re.exec(data);
                var imageData = {
                    image: m[3],
                    encoding: m[2],
                    mimeType: m[1]
                };
                afio.writeImageToFile(f, imageData)
                    .then(() => mplayer.next("SAVEAS"))
                    .catch(e => mplayer.handleError(e));
            }, type);
        }
    }).catch(e => mplayer.handleError(e))
};


// SCREENSHOT command
MacroPlayer.prototype.RegExpTable["screenshot"] =
    "^type\\s*=\\s*(browser|page)\\s+"+
    "folder\\s*=\\s*("+im_strre+")\\s+"+
    "file\\s*=\\s*("+im_strre+")\\s*$";

MacroPlayer.prototype.doSplitCycle = function(canvas, ctx, moves, type, callback) {
    if (moves.length == 0) {
        callback(canvas.toDataURL())
    } else {
        let mplayer = this
        let [move, ...rest] = moves
        communicator.postMessage(
            "webpage-scroll-to",
            {x: move.x_offset, y: move.y_offset},
            this.tab_id,
            () => {
                chrome.tabs.captureVisibleTab(
                    this.win_id, {format: type}, dataURL => {
                        let img = new Image(move.width, move.height)
                        img.src = dataURL
                        img.onload = () => {                            
                            ctx.drawImage(img, move.x_offset, move.y_offset);
                            this.doSplitCycle(canvas, ctx, rest, type, callback)
                        }
                    }
                )
            }, {number: 0}
        )
    }
};

MacroPlayer.prototype.splitPage = function(dmns, type, callback) {
    let overlap = 200; // minimum overlap, to avoid sticky headers.
    let split = function(w, x, xs) {
        if (w == 0) {
            return xs
        } else {
            if(w - x > 0) {
                let n = Math.ceil(w / (x-overlap));
                let delta = Math.ceil(w/n);
                xs = new Array(n).fill(delta);
            } else {
                xs.push(w)
            }            
            return xs
        }
    }
    // steps to perform in x-direction
    let xs = split(dmns.doc_w, dmns.win_w, [])
    // steps to perform in y-direction
    let ys = split(dmns.doc_h, dmns.win_h, [])
    // the two above combined and flattened
    let [moves, ] = ys.reduce(([y_acc, y_offset], y_step) => {
        let [x_moves, ] = xs.reduce(([x_acc, x_offset], x_step) => {
            let move = {
                // if this is the last piece, make the offset as large as its size, so that it sits at the end.
                x_offset: (x_offset + dmns.win_w) <=  dmns.doc_w ? x_offset : dmns.doc_w - dmns.win_w,
                y_offset: (y_offset + dmns.win_h) <=  dmns.doc_h ? y_offset : dmns.doc_h - dmns.win_h,
                width: dmns.win_w,
                height:  dmns.win_h
            }
            return [x_acc.concat(move), x_offset + x_step]
        }, [[], 0])
        return [y_acc.concat(x_moves), y_offset + y_step]
    }, [[], 0])
    let canvas = document.createElementNS("http://www.w3.org/1999/xhtml",
                      "canvas");
    canvas.style.width = dmns.doc_w+"px";
    canvas.style.height = dmns.doc_h+"px";
    canvas.width = dmns.doc_w;
    canvas.height = dmns.doc_h;
    let ctx = canvas.getContext("2d");
    // Start from the end. If starting from the beginning, sticky headers appear, avoiding sticky footers instead.
    moves.reverse();  
    this.doSplitCycle(canvas, ctx, moves, type, callback);
};

MacroPlayer.prototype.captureWebPage = function(callback, type) {
    var mplayer = this;
    communicator.postMessage(
        "query-page-dimensions",
        {}, this.tab_id,
        function(dmns) {
            mplayer.splitPage(dmns, type || "png",  callback);
        },
        {number: 0}
    );
};

MacroPlayer.prototype.ActionTable["screenshot"] = function (cmd) {
    if (this.noContentPage("SCREENSHOT"))
        return;
    if (!this.afioIsInstalled)
        throw new RuntimeError("SCREENSHOT requires File IO interface", 660);

    var folder = imns.unwrap(this.expandVariables(cmd[2], "screenshot2"));
    var type = imns.unwrap(this.expandVariables(cmd[1], "screenshot1")).
        toLowerCase();
    if (type != "page") {
        throw new BadParameter("SCREENSHOT TYPE="+type.toUpperCase()+
                             " is not supported");
    }

    var f = null;
    if (folder == "*") {
        f = this.defDownloadFolder.clone()
    } else {
        f = afio.openNode(folder);
    }

    var file = imns.unwrap(this.expandVariables(cmd[3], "saveas3")), t;

    var mplayer = this;
    f.exists().then(function(exists) {
        if (!exists) {
            throw new RuntimeError("Path "+folder+" does not exist", 732)
        }

        if (file == "*") {
            file = __doc_name(mplayer.currentURL);
        } else if (t = file.match(/^\+(.+)$/)) {
            file = __doc_name(mplayer.currentURL) + t[1];
        }

        // replace illegal file name characters < > : " / \ | ? * by underscores
        var re = new RegExp('\\s*[:*?|<>\\"/]+\\s*', "g");
        file = file.replace(re, "_");
        f.append(__ensure_ext(file, "png"));
        communicator.postMessage("webpage-hide-scrollbars",{hide: true}, mplayer.tab_id,()=>{});
        mplayer.captureWebPage(function(data) {
            communicator.postMessage("webpage-hide-scrollbars",{hide: false}, mplayer.tab_id,()=>{});
            var re = /data\:([\w-]+\/[\w-]+)?(?:;(base64))?,(.+)/;
            var m = re.exec(data);
            var imageData = {
                image: m[3],
                encoding: m[2],
                mimeType: m[1]
            };
            afio.writeImageToFile(f, imageData).then(function() {
                mplayer.next("SCREENSHOT");
            }).catch(function(e) {
                mplayer.handleError(e);
            });
        });
    }).catch(function(err) {
        mplayer.handleError(err);
    });
};


// SEARCH command
MacroPlayer.prototype.RegExpTable["search"] =
    "^source\\s*=\\s*(txt|regexp):("+im_strre+")"+
    "(?:\\s+ignore_case\\s*=\\s*(yes|no))?"+
    "(?:\\s+extract\\s*=\\s*("+im_strre+"))?\\s*$";

MacroPlayer.prototype.ActionTable["search"] = function (cmd) {
    var query = imns.unwrap(this.expandVariables(cmd[2]));
    var extract = cmd[4] ? imns.unwrap(this.expandVariables(cmd[4])) : "";
    var ignore_case = cmd[3] && /^yes$/i.test(cmd[3]) ? "i" : "";
    var search_re;

    // check if EXTRACT is present
    if (extract && !(cmd[1].toLowerCase() == "regexp"))
        throw new BadParameter("EXTRACT has sense only for REGEXP search");

    var data = {
        type: cmd[1].toLowerCase(),
        query: query,
        extract: extract,
        ignore_case: ignore_case
    };

    communicator.postMessage("search-command", data, this.tab_id,
                             this.onSearchComplete.bind(this),
                             this.currentFrame);
};


MacroPlayer.prototype.onSearchComplete = function(data) {
    if (data.error) {
        this.handleError(data.error);
    } else {
        if (data.extract)
            this.showAndAddExtractData(data.extract);
        this.next("onSearchComplete");
    }
};


// SET command http://wiki.imacros.net/SET
MacroPlayer.prototype.RegExpTable["set"] =
    "^(\\S+)\\s+("+im_strre+")\\s*$";


MacroPlayer.prototype.ActionTable["set"] = function (cmd) {
    var param = imns.unwrap(this.expandVariables(cmd[2], "set2"));
    var mplayer = this;
    switch(cmd[1].toLowerCase()) {
    case "!encryption":
        switch(param.toLowerCase()) {
        case "no":
            this.encryptionType = "no"; break;
        case "storedkey": case "yes":
            this.encryptionType = "stored"; break;
        case "tmpkey":
            this.encryptionType = "tmpkey"; break;
        default:
            throw new BadParameter("!ENCRYPTION can be only "+
                                   "YES|NO|STOREDKEY|TMPKEY");
        }

        break;
    case "!downloadpdf":
        // TODO: not very clear what to do with that command
        this.shouldDownloadPDF = /^yes$/i.test(param); break;
    case "!loop":
        if (this.firstLoop) {
            loop = imns.s2i(param)
            if (isNaN(loop))
                throw new BadParameter("!LOOP must be integer");
            this.currentLoop = this.checkFreewareLimits("loops", loop)
            var panel = context[this.win_id].panelWindow;
            if (panel && !panel.closed)
                panel.setLoopValue(this.currentLoop);
        }
        break;
    case "!extract":
        this.clearExtractData();
        if (!/^null$/i.test(param))
            this.addExtractData(param);
        break;
    case "!extractadd":
        this.addExtractData(param); break;
    case "!extract_test_popup":
        this.shouldPopupExtract = /^yes$/i.test(param); break;
    case "!errorignore":
        this.ignoreErrors = /^yes$/i.test(param); break;
    case "!datasource":
        if (!this.afioIsInstalled) {
            throw new RuntimeError(
                "!DATASOURCE requires File IO interface", 660
            );
        }
        this.loadDataSource(param)
            .then(() => this.next("SET"))
            .catch(e => this.handleError(e))
        return;
    case "!datasource_line":
        var x = imns.s2i(param);
        if (isNaN(x) || x <= 0)
            throw new BadParameter("!DATASOURCE_LINE must be positive integer");
        if (this.dataSource.length < x)
            throw new RuntimeError("Invalid DATASOURCE_LINE value: "+
                                   param, 751);
        this.dataSourceLine = x;
        break;
    case "!datasource_columns":
        if (isNaN(imns.s2i(param)))
                throw new BadParameter("!DATASOURCE_COLUMNS must be integer");
        this.dataSourceColumns = imns.s2i(param);
        break;
    case "!datasource_delimiter":
        if (param.length > 1)
            throw new BadParameter("!DATASOURCE_DELIMITER must be single character");
        this.dataSourceDelimiter = param;
        break;
    case "!folder_datasource":
        if (!this.afioIsInstalled) {
            throw new RuntimeError(
                "!FOLDER_DATASOURCE requires File IO interface", 660
            );
        }
        this.dataSourceFolder = afio.openNode(param);
        this.dataSourceFolder.exists().then(exists => {
            if (!exists) {
                this.handleError( new RuntimeError(
                    "can not write to FOLDER_DATASOURCE: "+
                        param+" does not exist or not accessible.", 732
                ));
            }
        }).then(() => {
            this.next("SET");
        }).catch(err => {
            this.handleError(new RuntimeError(
                "can not open FOLDER_DATASOURCE: "+
                    param+", error "+err.message, 732
            ));
        });
        return;
    case "!folder_download":
        if (!this.afioIsInstalled) {
            throw new RuntimeError(
                "!FOLDER_DOWNLOAD requires File IO interface", 660
            );
        }
        this.defDownloadFolder = afio.openNode(param);
        this.defDownloadFolder.exists().then(exists => {
            if (!exists) {
                this.handleError( new RuntimeError(
                    "can not write to FOLDER_DOWNLOAD: "+
                        param+" does not exist or not accessible.", 732
                ));
            }
        }).then(() => {
            this.next("SET");
        }).catch(err => {
            this.handleError(new RuntimeError(
                "can not open FOLDER_DOWNLOAD: "+
                    param+", error "+err.message, 732
            ));
        });
        return;
    case "!timeout": case "!timeout_page":
        var x = imns.s2i(param);
        if (isNaN(x) || x <= 0)
            throw new BadParameter("!TIMEOUT must be positive integer");
        this.timeout = x;
        this.timeout_tag = Math.round(this.timeout/10);
        break;
    case "!timeout_tag": case "!timeout_step":
        var x = imns.s2i(param);
        if (isNaN(x) || x < 0)
            throw new BadParameter("!TIMEOUT_TAG must be positive integer");
        this.timeout_tag = x;
        break;
    case "!timeout_download":
        var x = imns.s2i(param);
        if (isNaN(x) || x < 0)
            throw new BadParameter("!TIMEOUT_DOWNLOAD must be positive integer");
        this.timeout_download = x;
        break;
    case "!timeout_macro":
        var x = parseFloat(param);
        if (isNaN(x) || x <= 0)
            throw new BadParameter("!TIMEOUT_MACRO must be positive number");
        this.globalTimer.setMacroTimeout(x);
        break;
    case "!clipboard":
        imns.Clipboard.putString(param);
        break;
    case "!filestopwatch":
        if (!this.afioIsInstalled)
            throw new RuntimeError(
                "!FILESTOPWATCH requires File IO interface", 660
            );
        var filename = param, file;
        if (__is_full_path(filename) ) { // full path
            file = afio.openNode(filename);
        } else {
            file = this.defDownloadFolder.clone()
            file.append(filename);
        }
        var parent = file.parent;
        var mplayer = this;
        parent.exists().then(function(exists) {
            if (!exists)
                throw new RuntimeError("Path "+parent.path+
                                       " does not exists", 732);
        }).then(function() {
            return afio.appendTextFile(file, "").catch(function(e) {
                    var reason = "";
                    if (/ACCESS_DENIED/.test(e.toString()))
                        reason = ", access denied";
                   throw new RuntimeError(
                        "can not write to STOPWATCH file: "+
                            file.path+reason, 731);
            });
        }).then(function() {
            mplayer.stopwatchFile = file;
            mplayer.shouldWriteStopwatchFile = true;
            mplayer.next("SET");
        }).catch(function(err) {
            mplayer.handleError(err);
        });
        return;
    case "!folder_stopwatch":
        if (param.toLowerCase() == "no") {
            this.shouldWriteStopwatchFile = false;
        } else {
            this.stopwatchFolder = afio.openNode(param);
        // TODO: isWritable is buggy on Windows as it can only check files
        // if (!this.stopwatchFolder.isWritable) {
            //  throw new RuntimeError("can not write to STOPWATCH folder: "+
            //                            "access denied", 731);
            // }
            this.shouldWriteStopwatchFile = true;
    }
        break;
    case "!replayspeed":
        switch(param.toLowerCase()) {
            case "slow":
                this.delay = 2000; break;
            case "medium":
                this.delay = 1000; break;
            case "fast":
                this.delay = 0; break;
            default:
                throw new BadParameter("!REPLAYSPEED can be SLOW|MEDIUM|FAST");
            }
        break;
    case "!playbackdelay":
        let newDelay = parseFloat(param)
        if (isNaN(newDelay) || newDelay <= 0)
            throw new BadParameter("!PLAYBACKDELAY should be a"+
                                   " positive number of seconds");
        this.delay = Math.round(newDelay*1000);
        break;
    case "!file_profiler":
        if (param.toLowerCase() == "no") {
            this.writeProfiler = false;
            this.profiler.file = null;
        } else {
            if (!this.afioIsInstalled) {
                throw new RuntimeError(
                    "!FILE_PROFILER requires File IO interface", 660
                );
            }
            this.writeProfilerData = true;
            this.profiler.enabled = true;
            this.profiler.file = param;
        }
        break;

    case "!linenumber_delta":
        var x = imns.s2i(param);
        if (isNaN(x) || x > 0)
            throw new BadParameter("!LINENUMBER_DELTA must be negative integer or zero");
        this.linenumber_delta = x;
        break;
    case "!useragent":
        if (!this.userAgent) { // we don't want to register more than one handler
            chrome.webRequest.onBeforeSendHeaders.addListener(
                this._onBeforeSendHeaders,
                {windowId: this.win_id, urls: ["<all_urls>"]},
                ["blocking", "requestHeaders"]
            );
        }
        this.userAgent = param;
        break;
    default:
        if (this.limits.varsRe.test(cmd[1])) {
            this.vars[imns.s2i(RegExp.$1)] = param;
        } else if (/^!\S+$/.test(cmd[1])) {
            throw new BadParameter("Unsupported variable "+cmd[1]);
        } else {
            this.setUserVar(cmd[1], param);
        }
    }
    this.next("SET");
};


// SIZE command http://wiki.imacros.net/SIZE
MacroPlayer.prototype.RegExpTable["size"] =
    "^x\\s*=\\s*("+im_strre+")\\s+y=("+im_strre+")\\s*$";

MacroPlayer.prototype.ActionTable["size"] = function (cmd) {
    if (this.noContentPage("SIZE"))
        return;
    var x = imns.s2i(imns.unwrap(this.expandVariables(cmd[1], "size1")));
    var y = imns.s2i(imns.unwrap(this.expandVariables(cmd[2], "size2")));
    if (isNaN(x))
        throw new BadParameter("positive integer", 1)
    if (isNaN(y))
        throw new BadParameter("positive integer", 2)

    var mplayer = this;
    chrome.windows.get(this.win_id, {populate: false}, function(w) {
        communicator.postMessage(
            "query-page-dimensions",
            {}, mplayer.tab_id,
            function(dmns) {
                var delta_x = w.width - dmns.win_w;
                var delta_y = w.height - dmns.win_h;
                chrome.windows.update(
                    mplayer.win_id,
                    {width: x+delta_x, height: y+delta_y},
                    function() {
                        mplayer.next("SIZE");
                    }
                );
            },
            {number: 0}
        );
    });
};

// STOPWATCH command http://wiki.imacros.net/STOPWATCH
MacroPlayer.prototype.RegExpTable["stopwatch"] =
    "^((?:(start|stop)\\s+)?id|label)\\s*=\\s*("+im_strre+")\\s*$";

// add new time watch
MacroPlayer.prototype.addTimeWatch = function(name) {
    this.watchTable[name] = this.globalTimer.getElapsedSeconds();
};


MacroPlayer.prototype.stopTimeWatch = function(name) {
    if (typeof this.watchTable[name] == "undefined")
        throw new RuntimeError("Time watch "+name+" does not exist", 762);
    let elapsed = this.globalTimer.getElapsedSeconds() - this.watchTable[name];
    this.lastWatchValue = elapsed;
    let stamp = new Date(this.globalTimer.macro_start_time + this.watchTable[name]*1000); // time when this timewWatch started
    let x = {id: name, type: "id", elapsedTime: elapsed, timestamp: stamp};
    this.stopwatchResults.push(x);
};


MacroPlayer.prototype.addTimeWatchLabel = function(name) {
    let elapsed = this.globalTimer.getElapsedSeconds();
    this.lastWatchValue = elapsed;
    let stamp = new Date(this.globalTimer.macro_start_time);  // time when the macro started
    let x = {id: name, type: "label", elapsedTime: elapsed, timestamp: stamp};
    this.stopwatchResults.push(x);
};


// command handler
MacroPlayer.prototype.ActionTable["stopwatch"] = function (cmd) {
    var action = cmd[2] ? cmd[2].toLowerCase() : null;
    var use_label = /label$/i.test(cmd[1]);
    var param = imns.unwrap(this.expandVariables(cmd[3], "stopwatch3"));

    // make the watch name uppercase to be compatible with IE version
    param = param.toUpperCase();

    if (!use_label) { // Need a pair of STOPWATCH commands to start and stop the clock, respectively.
        var found = typeof this.watchTable[param] != "undefined";
        switch (action) {
        case "start":
            if (found)
                throw new RuntimeError("stopwatch id="+param+
                                       " already started", 761);
            this.addTimeWatch(param);
            break;
        case "stop":
            if (!found)
                throw new RuntimeError("stopwatch id="+param+
                                       " wasn't started", 762);
            this.stopTimeWatch(param);
            break;
        default:                // old syntax
            if (found)
                this.stopTimeWatch(param);
            else
                this.addTimeWatch(param);
            break;
        }
    } else { // only one STOPWATCH command to stop the clock. Start time is at macro start.
        // save time in sec since macro was started
        this.addTimeWatchLabel(param);
    }
    this.next("STOPWATCH");
};


MacroPlayer.prototype.globalTimer = {
    init: function(mplayer) {
        this.mplayer = mplayer;
        if (this.macroTimeout) {
            clearTimeout(this.macroTimeout);
            this.macroTimeout = null;
        }
    },

    start: function() {
        this.start_time = performance.now(); // attention: this property is in milliseconds!  Relative, since document start.      
        this.macro_start_time = Date.now();  // macro start time in milliseconds, absolute (epoch)
    },

    getElapsedSeconds: function() {
        if (!this.start_time)
            return 0;
        var now = performance.now();
        return (now - this.start_time)/1000;
    },

    setMacroTimeout: function(x) {
        var mplayer = this.mplayer;
        this.macroTimeout = setTimeout( function () {
            if (!mplayer.playing)
                return;
            mplayer.handleError(
                new RuntimeError("Macro replaying timeout of "+x+
                                 "s exceeded", 603)
            );
        }, Math.round(x*1000));
    },

    stop: function() {
        if (this.macroTimeout) {
            clearTimeout(this.macroTimeout);
            this.macroTimeout = null;
        }
    }
};



// TAG command http://wiki.imacros.net/TAG

// regexp for matching att1:"val1"&&att2:val2.. sequence
const im_atts_re = "(?:[-\\w]+:"+im_strre+"(?:&&[-\\w]+:"+im_strre+")*|\\*?)";

MacroPlayer.prototype.RegExpTable["tag"] =
    "^(?:pos\\s*=\\s*(\\S+)\\s+"+
    "type\\s*=\\s*(\\S+)"+
    "(?:\\s+form\\s*=\\s*("+im_atts_re+"))?\\s+"+
    "attr\\s*=\\s*("+im_atts_re+")"+
    "|(selector|xpath)\\s*=\\s*("+im_strre+"))"+
           //"|xpath \\s*=\\s*("+im_strre+"))"+
    "(?:\\s+(content|extract)\\s*=\\s*"+
    "([%$#]"+im_strre+"(?::[%$#]"+im_strre+")*|"+
    "event:"+im_strre+"|"+
    im_strre+"))?\\s*$";

MacroPlayer.prototype.ActionTable["tag"] = function (cmd) {
    if (this.noContentPage("TAG"))
        return;

    // form message to send to content-script
    var data = {
        pos: 0,
        relative: false,
        tagName: "",
        form: null,
        atts: null,
        xpath: null,
        selector: null,
        type: "",
        txt: null,
        cdata: null,
        scroll: true,
        download_pdf: this.shouldDownloadPDF,
        highlight: true
    };

    var isPasswordElement = false;
    // parse attr1:val1&&atr2:val2...&&attrN:valN string
    // into array of regexps corresponding to vals
    const parseAtts = str => {
        if (!str || str == "*")
            return null;
        var arr = str.split(new RegExp("&&(?=[-\\w]+:"+im_strre+")"));
        var parsed_atts = new Object(), at, val, m;
        const re = new RegExp("^([-\\w]+):("+im_strre+")$");
        for (var i = 0; i < arr.length; i++) {
            if (!(m = re.exec(arr[i])))
                throw new BadParameter("incorrect ATTR or FORM specifier: "
                                       +arr[i]);
            at = m[1].toLowerCase();

            if (at.length && at in parsed_atts) {
                throw new BadParameter("Duplicate ATTR specified: " + at.toUpperCase());
            }

            if (at.length) {
                val = imns.unwrap(this.expandVariables(m[2], "tag_attr"+i));
                // While replaying:
                // 1. remove all leading/trailing whitespaces
                // 2. remove all linebreaks in the target string
                val = imns.escapeTextContent(val);
                val = imns.escapeREChars(val);
                val = val.replace(/\*/g, '(?:\n|.)*');
                // 3. treat all <SP> as a one or more whitespaces
                val = val.replace(/ /g, "\\s+");
                parsed_atts[at] = "^\\s*"+val+"\\s*$";
            } else {
                parsed_atts[at] = "^$";
            }
        }

        return parsed_atts;
    };

    if (cmd[5]) {
        if (cmd[5].toLowerCase() == 'xpath') {
            data.xpath = imns.unwrap(this.expandVariables(cmd[6], "tag6"));
        }
        else {
            data.selector = imns.unwrap(this.expandVariables(cmd[6], "tag6"));
        }

    } else {
        data.pos = imns.unwrap(this.expandVariables(cmd[1], "tag1"));
        data.tagName = imns.unwrap(this.expandVariables(cmd[2], "tag2")).
               toLowerCase();
        data.form = parseAtts(cmd[3]);
        data.atts = parseAtts(cmd[4]);
        data.atts_str = cmd[4]; // for error message

        // get POS parameter
        if (/^r(-?\d+)$/i.test(data.pos)) {
            data.pos = imns.s2i(RegExp.$1);
            data.relative = true;
        } else if (/^(\d+)$/.test(data.pos)) {
            data.pos = imns.s2i(RegExp.$1);
            data.relative = false;
        } else {
            throw new BadParameter("POS=<number> or POS=R<number>"+
                                   "where <number> is a non-zero integer", 1);
        }
        // get rid of INPUT:* tag names
        if (/^(\S+):(\S+)$/i.test(data.tagName)) {
            if (!data.atts)
                data.atts = new Object();
            var val = RegExp.$2;
            data.tagName = RegExp.$1.toLowerCase();
            val = imns.escapeREChars(val);
            val = val.replace(/\*/g, '(?:\n|.)*');
            data.atts["type"] = "^"+val+"$";
        }

    }
    if (cmd[7]) {
        data.type = cmd[7].toLowerCase();
        data.rawdata = cmd[8];
        data.txt = imns.unwrap(this.expandVariables(cmd[8], "tag8"));
        if (data.type == "content")
            data.cdata = this.parseContentStr(cmd[8]);
    }

    let p = Promise.resolve(data)
    if (this.shouldDecryptPassword) {
        delete this.shouldDecryptPassword
        p = this.decrypt(data.txt).then(
            plaintext => Object.assign(
                {}, data, {txt: plaintext, passwordDecrypted: true}
            )
        )
    }

    p.then(data => communicator.postMessage(
        "tag-command", data, this.tab_id,
        this.onTagComplete.bind(this),
        this.currentFrame
    )).catch(e => this.handleError(e));
};


MacroPlayer.prototype.parseContentStr = function(cs) {
    var rv = new Object();
    if (/^event:(\S+)$/i.test(cs)) {
        rv.type = "event";
        var etype = RegExp.$1.toLowerCase();
        switch(etype) {
        case "saveitem": case "savepictureas":
        case "savetargetas": case "savetarget":
        case "mouseover": case "fail_if_found":
            rv.etype = etype;
            break;
        default:
            throw new RuntimeError("Unknown event type "+etype+
                                   " for tag command.", 711);
        }
    } else {
        rv.type = "select";
        // regexp for testing if content is $goo:$foo
        const val_re = new RegExp(
            "^(?:([%$#])"+im_strre+")(?::\\1"+im_strre+")*$"
        );
        const idx_re = new RegExp("^\\d+(?::\\d+)*$");

        var m, split_re = null;
        // build regexp for splitting content into values
        if(m = cs.match(val_re)) {
            var non_delimeter =
                "(?:\"(?:[^\"\\\\]|\\\\[0btnvfr\"\'\\\\])*\"|"+
                "eval\\s*\\(\"(?:[^\"\\\\]|\\\\[\\w\"\'\\\\])*\"\\)|"+
                "(?:[^:\\s]|:[^"+m[1]+"])+)";
            split_re = new RegExp("(\\"+m[1]+non_delimeter+")", "g");
        } else if (m = cs.match(idx_re)) {
            split_re = new RegExp("(\\d+)", "g");
        } else if (cs.toLowerCase() =="all") {
            rv.seltype = "all";
            return rv;
        } else {
            // could be some data for input elements
            rv.type = "unknown";
            return rv;
        }

        // split content into values
        var g, opts = new Array();
        while(g = split_re.exec(cs)) {
            opts.push(g[1]);
        }
        rv.seltype = opts.length > 1 ? "multiple" : "single";

        for (var i = 0; i < opts.length; i++) {
            if (/^([%$#])(.*)$/i.test(opts[i])) {
                var typ = RegExp.$1;
                var val = RegExp.$2;
                val = imns.unwrap(this.expandVariables(val, "opts"+i));
                if (typ == "$" || typ == "%") {
                    var re_str = "^\\s*"+imns.escapeREChars(val).
                        replace(/\*/g, '(?:[\r\n]|.)*')+"\\s*$";
                    opts[i] = {typ: typ, re_str: re_str, str: val};
                } else if (typ == "#") {
                    var idx = parseInt(val);
                    if (isNaN(idx))
                        throw new RuntimeError(
                            "Wrong CONTENT specifier "+cs, 711);
                    opts[i] = {typ: "#", idx: idx};
                }
            } else if (/^(\d+)$/i.test(opts[i])) { // indexes 1:2:...
                var idx = parseInt(RegExp.$1);
                if (isNaN(idx))
                    throw new RuntimeError("Wrong CONTENT specifier "+cs,
                                           711);
                opts[i] = {typ: "#", idx: idx};
            }
        }

        rv.opts = opts;
    }

    return rv;
};


MacroPlayer.prototype.handleInputFileTag = function(selector, files) {
    return this.attachDebugger("1.2")
        .then(() => send_command(this.tab_id, "DOM.getDocument"))
        .then(({root: {nodeId}}) => send_command(
            this.tab_id,
            "DOM.querySelector",
            {nodeId, selector}
        ))
        .then(({nodeId}) => send_command(
            this.tab_id,
            "DOM.setFileInputFiles",
            {files, nodeId}
        ))
        .then(() => this.detachDebugger())
        .catch(e => this.handleError(e))
}

// VERSION command http://wiki.imacros.net/VERSION
MacroPlayer.prototype.RegExpTable["version"] = "^(?:build\\s*=\\s*(\\S+))?"+
    "(?:\\s+recorder\\s*=\\s*(\\S+))?\\s*$";
MacroPlayer.prototype.ActionTable["version"] = function (cmd) {
    // do nothing
    this.next("VERSION");
};



// URL command http://wiki.imacros.net/URL
MacroPlayer.prototype.RegExpTable["url"] =
    "^goto\\s*=\\s*("+im_strre+")\\s*$";

MacroPlayer.prototype.ActionTable["url"] = function (cmd) {
    var param = imns.unwrap(this.expandVariables(cmd[1], "url1")),
        scheme = null;

    if (!/^([a-z]+):.*/i.test(param)) {
        param = "http://"+param;
    }
    // Test for javascript: URLs and execute it
    var jsRegex = RegExp("^javascript:\\(?(.+)\\)?$");
    if (jsRegex.test(param)) {
        let matches = jsRegex.exec(param);
        let scriptCode = matches[1];
        chrome.tabs.executeScript(this.tab_id, { code: scriptCode }, () => { this.next("URL"); });
    } else {
        chrome.tabs.update(
            this.tab_id, {url: param},
            () => {
                if (/^javascript:/.test(param)) {
                    // somewhat ugly hack for javascript: urls
                    this.next("URL");
                } else {
                    this.waitingForPageLoad = true;

                    if (!this.timers.has("loading"))
                        this.startTimer(
                            "loading", this.timeout, "Loading ", () => {
                                this.waitingForPageLoad = false;
                                this.handleError(new RuntimeError(
                                    "Page loading timeout"+
                                        ", URL: "+this.currentURL, 602
                                ));
                            }
                        )
                }
            }
        );
    }
};




// TAB command http://wiki.imacros.net/TAB
MacroPlayer.prototype.RegExpTable["tab"] = "^(t\\s*=\\s*(\\S+)|"+
    "close|closeallothers|open|open\\s+new|new\\s+open"+
    ")\\s*$";

MacroPlayer.prototype.ActionTable["tab"] = function (cmd) {
    communicator.postMessage("tab-command", {}, this.tab_id, () => {})
    if (/^close$/i.test(cmd[1])) { // close current tab
        this.detachDebugger().then(() => chrome.tabs.remove(
            this.tab_id, () => this.next("TAB CLOSE")
        ))
    } else if (/^closeallothers$/i.test(cmd[1])) {
        //close all tabs except current
        chrome.tabs.query(
            {windowId: this.win_id, active: false},
            tabs => {
                let ids = tabs.filter(tab => !tab.active).map(tab => tab.id)
                this.startTabIndex = 0
                chrome.tabs.remove(
                    ids, () => this.next("TAB CLOSEALLOTHERS")
                )
            })
    } else if (/open/i.test(cmd[1])) {
        this.detachDebugger().then(() => {
            chrome.tabs.get(this.tab_id, tab => {
                let args = {
                    url: "about:blank",
                    windowId: this.win_id,
                    index: tab.index+1,
                    active: false
                }
                chrome.tabs.create(args, t => this.next("TAB OPEN"))
            })
        })
    } else if (/^t\s*=/i.test(cmd[1])) {
        let n = imns.s2i(this.expandVariables(cmd[2], "tab2"))
        if (isNaN(n))
            throw new BadParameter("T=<number>", 1)
        let tab_num = n+this.startTabIndex-1
        chrome.tabs.query({windowId: this.win_id}, tabs => {
            if (tab_num < 0 || tab_num > tabs.length-1) {
                this.handleError(
                    new RuntimeError("Tab number "+n+" does not exist", 771)
                )
            } else {
                this.detachDebugger().then(() => chrome.tabs.update(
                    tabs[tab_num].id, {active: true},
                    t => this.next("TAB T=")
                ))
            }
        })
    }
};



// WAIT command http://wiki.imacros.net/WAIT
MacroPlayer.prototype.RegExpTable["wait"] = "^seconds\\s*=\\s*(\\S+)\\s*$";

MacroPlayer.prototype.ActionTable["wait"] = function (cmd) {
    var param = Number(imns.unwrap(this.expandVariables(cmd[1], "wait1")));

    if (isNaN(param))
        throw new BadParameter("SECONDS=<number>", 1);
    param = Math.round(param*10)*100; // get number of ms
    if (param == 0)
        param = 10;
    else if (param < 0)
        throw new BadParameter("positive number of seconds", 1);
    this.inWaitCommand = true;
    var mplayer = this;

    this.waitTimeout = setTimeout(function () {
        mplayer.inWaitCommand = false;
        delete mplayer.waitTimeout;
        clearInterval(mplayer.waitInterval);
        delete mplayer.waitInterval;
        mplayer.next("WAIT");
    }, param);

    // show timer
    var start_time = performance.now();
    var total = param/1000;
    mplayer.waitInterval = setInterval(function () {
        if (!mplayer.inWaitCommand) {
            clearInterval(mplayer.waitInterval);
            return;
        }
        let passed = (performance.now() - start_time)/1000
        var remains = total - passed
        if (remains > 0) {
            var text = passed.toFixed(0);
            while(text.length < 3)
                text = "0"+text;
            badge.set(mplayer.win_id, {
                status: "waiting",
                text: text
            });

            var panel = context[mplayer.win_id].panelWindow;
            if (panel && !panel.closed) {
                panel.setStatLine("Waiting "+passed.toFixed(1)+
                                  "("+total.toFixed(1)+")s", "info");
            }
        } else {
            clearInterval(mplayer.waitInterval);
            delete mplayer.waitInterval;
        }
    }, 1000);
};





MacroPlayer.prototype.beforeEachRun = function() {
    // stopwatch-related properties
    this.watchTable = new Object();
    this.stopwatchResults = new Array();
    this.shouldWriteStopwatchFile = true; // default is true
    // last stopwatch value for !STOPWATCHTIME
    this.lastWatchValue = 0;
    this.totalRuntime = 0;
    this.lastPerformance = new Array();
    this.stopwatchFile = null;  // FILESTOPWATCH
    this.stopwatchFolder = null; // FOLDER_STOPWATCH
    // init runtime and waiting timers
    this.timers = new Map();
    this.globalTimer.init(this);
    this.proxySettings = null;
    this.currentFrame = {number: 0};
    // clear waiting flags
    this.waitingForPageLoad = false;
    this.inWaitCommand = false;
    this.waitingForDelay = false;
    // Profiler Log feature
    this.writeProfilerData = Storage.getBool("profiler-enabled") && Storage.getBool("afio-installed");
    this.profiler.file = null;
    // reset profiler
    this.profiler.init();
    this.profiler.enabled = (this.profiler.si_enabled ||
        Storage.getBool("profiler-enabled")) && Storage.getBool("afio-installed");
    // eval expressions storage
    this.__eval_results = {};
    // script errors
    this.shouldStopOnError = false;
    // delta for line numbers in error reports and profiler data
    this.linenumber_delta = 0;
    // reset current line
    this.currentLine = 0;
    // rest navigation pool
    this.activeNavigations = new Set();
    // !DOWNLOADED_FILE_NAME and !DOWNLOADED_SIZE
    this.downloadedFilename = "";
    this.downloadedSize = 0;
    this.userAgent = null;
    // coordinates of the center of an image found by IMAGESEARCH command
    this.imageX = this.imageY = -1;
    // clear extract data
    this.clearExtractData();
};


MacroPlayer.prototype.afterEachRun = function() {
    // form lastPerformance and save STOPWATCH results
    this.saveStopwatchResults();

    // restore proxy settings
    if (this.proxySettings) {
        this.restoreProxySettings();
        this.proxySettings = null;
    }
};


// reset all defaults, should be called on every play
MacroPlayer.prototype.reset = function() {
    // this.vars = new Array();
    // this.userVars = new Map();

    // clear actions array
    this.actions = new Array();
    this.currentAction = null;

    // reset state variables
    this.ignoreErrors = false;
    this.playing = false;
    this.paused = false;
    this.pauseIsPending = false;

    // last error code and message
    this.errorCode = 1;
    this.errorMessage = "OK";
    this.firstLoop = true;

    // datasources
    this.dataSource = new Array();
    this.dataSourceColumns = 0;
    this.dataSourceLine = 0;
    this.dataSourceFile = "";
    this.dataSourceDelimiter = ",";

    // extraction
    this.extractData = "";
    // show extract popup by default only when not looping and not
    // playing from scripting interface
    this.shouldPopupExtract = !(this.cycledReplay || this.client_id);
    this.waitingForExtract = false;
    // replaying delay
    this.delay = Storage.getNumber("replaying-delay"); // milliseconds

    // default timeout tag wait time
    // TODO: maybe store it in localStorage
    this.timeout = 60;  // seconds
    this.timeout_tag = Math.round(this.timeout/10);
    this.timeout_download = this.timeout*5;

    // encryption type
    var typ = Storage.getChar("encryption-type");
    if (!typ.length)
        typ = "no";
    this.encryptionType = typ;

    this.waitingForPassword = false;

    // downloads state
    this.activeDownloads = new Map();
    this.waitForDownloadCompleted = false;
    this.waitForDownloadCreated = false;
    // HTTP authorization expected
    this.waitForAuthDialog = false;

    return new Promise((resolve, reject) => {
        chrome.tabs.query({active: true, windowId: this.win_id}, tabs => {
            this.startTabIndex = tabs[0].index;
            this.currentURL = tabs[0].url;
            this.tab_id = tabs[0].id;
            // test for afio
            afio.isInstalled().then(installed => {
                if ((this.afioIsInstalled = installed)) {
                    let nodes = ["datapath", "savepath", "downpath"].
                        map(what => afio.getDefaultDir(what))
                    Promise.all(nodes).then(([datanode, savenode, downnode]) => {
                        this.dataSourceFolder = datanode
                        this.macrosFolder = savenode
                        this.defDownloadFolder = downnode
                    })
                }
            }).then(resolve).catch(reject) // the only reason for that clumsy
                                           // statement is that
                                           // chrome.tabs.query expects a
                                           // callback
        })});
};


MacroPlayer.prototype.pause = function() {
    if (!this.pauseIsPending) {
        this.pauseIsPending = true
        context.updateState(this.win_id, "paused")
    }
};

MacroPlayer.prototype.unpause = function () {
    if (!this.pauseIsPending) {
        this.paused = false
        context.updateState(this.win_id, "playing")
        this.next("unpause")
    }
};



// Start macro replaying
// @macro is a macro name
// @loopnum - positive integer
// which should be used to specify cycled replaying
MacroPlayer.prototype.play = function(macro, limits, callback) {
    // console.info("Playing macro %O, limits %O", macro, limits);
    const comment = new RegExp("^\\s*(?:'.*)?$");
    this.source = macro.source;
    this.currentMacro = macro.name;

    // save macro id for "Edit" on error dialog
    this.file_id = macro.file_id;
    this.client_id = macro.client_id;
    this.bookmark_id = macro.bookmark_id;
    // save reference to callback
    this.callback = callback;
    this.limits = this.convertLimits(limits)
    // count lines
    var line_re = /\r?\n/g, count = 0;
    while (line_re.exec(this.source))
        count++;
    // TODO: check macro length

    // check number of loops
    this.times = macro.times || 1;
    this.currentLoop = macro.startLoop || 1;
    this.cycledReplay = this.times - this.currentLoop > 0;
    // debugger should be attached at least once for every page if there is an
    // event command
    this.debuggerAttached = false;

    this.reset().then(() => {
        this.checkFreewareLimits("loops", this.times)
        this.checkFreewareLimits("loops", this.currentLoop)
        this.beforeEachRun();
        this.addListeners();
        // we should set before parsing so parse errors can be reported
        this.playing = true;
        this.parseMacro();
    }).then(() => {
        // prepare stack of actions
        this.action_stack = this.actions.slice();
        this.action_stack.reverse();
        context.updateState(this.win_id,"playing");
        var panel = context[this.win_id].panelWindow;
        if (panel && !panel.closed) {
            panel.showLines(this.source);
            panel.setStatLine("Replaying "+self.currentMacro, "info");
        }
        // start replaying
        this.globalTimer.start();
        this.playNextAction("start");
    }).catch(e => this.handleError(e));

};



// parse macro
MacroPlayer.prototype.parseMacro = function() {
    const comment = new RegExp("^\\s*(?:'.*)?$");
    const linenumber_delta_re =
            new RegExp("^\\s*'\\s*!linenumber_delta\\s*:\\s*(-?\\d+)", "i");
    this.linenumber_delta = 0;  // workaround for #381
    // check macro syntax and form list of actions
    this.source = this.source.replace(/\r+/g, ""); // remove \r symbols if any
    var lines = this.source.split("\n");
    for (var i = 0; i < lines.length; i++) {
        // check for !linenubmer_delta
        var m = lines[i].match(linenumber_delta_re);
        if (m) {
            this.linenumber_delta = imns.s2i(m[1]);
            continue;
        }
        if (lines[i].match(comment)) { // skip comments and empty lines
            continue;
        }

        if (/^\s*(\w+)(?:\s+(.*))?$/.test(lines[i])) {
            var command = RegExp.$1.toLowerCase();
            var arguments = RegExp.$2 ? RegExp.$2 : "";
            // check if command is known
            if (!(command in this.RegExpTable))
                throw new SyntaxError("unknown command: "+
                                      command.toUpperCase()+
                                      " at line "+(i+1+this.linenumber_delta));
            // parse arguments
            var args = this.RegExpTable[command].exec(arguments);
            if ( !args )
                throw new SyntaxError("wrong format of "+
                                      command.toUpperCase()+" command"+
                                      " at line "+(i+1+this.linenumber_delta));
            // put parsed action into action list
            this.actions.push({name: command,
                               args: args, line: i+1});
            this.checkFreewareLimits("lines", this.actions.length)

        } else {
            throw new SyntaxError("can not parse macro line "+
                                  (i+1+this.linenumber_delta)
                                  +": "+lines[i]);
        }
    }
};



// exec current action
MacroPlayer.prototype.exec = function(action) {
    if (!this.retryInterval) {
        badge.set(this.win_id, {
            status: "playing",
            text: action.line.toString()
        });

        // highlight action
        var panel = context[this.win_id].panelWindow;
        if (panel && !panel.closed)
            panel.highlightLine(action.line);
    }

    this._ActionTable[action.name](action.args);
};

// delayed start of next action
MacroPlayer.prototype.next = function(caller_id) {
    var mplayer = this;
    if (this.delay) {
        this.waitingForDelay = true;
        if (!this.delayTimeout) {
            this.delayTimeout = setTimeout(function () {
                delete mplayer.delayTimeout;
                mplayer.waitingForDelay = false;
                mplayer.playNextAction(caller_id);
            }, this.delay);
        }
    } else {
        asyncRun(function() {mplayer.playNextAction(caller_id);});
    }
    // stop profile timer
    this.profiler.end("OK", 1, this);
};


MacroPlayer.prototype.playNextAction = function(caller_id) {
    if (!this.playing)
        return;

    var panel = context[this.win_id].panelWindow;
    if (panel && !panel.closed && !this.retryInterval) {
        panel.setStatLine("Replaying "+this.currentMacro, "info");
    }

    // call "each run" initialization routine
    if (caller_id == "new loop")
        this.beforeEachRun();

    if ( this.pauseIsPending ) { // check if player should be paused
        this.pauseIsPending = false;
        this.paused = true;
        return;
    } else if ( this.paused ||
                this.waitingForDelay ||    // replaying delay
                this.waitingForPageLoad || // a page is loading
                this.inWaitCommand ||     // we are in WAIT
                this.waitingForPassword || // asking for a password
                this.waitingForExtract     // extract dialog
              ) {
        if (Storage.getBool("debug"))
            console.debug("("+this.globalTimer.getElapsedSeconds().toFixed(3)+") "+
                          "playNextAction(caller='"+(caller_id || "")+"')"+
                          ", waiting for: "+
                          (this.waitingForDelay ? "delay, " : "")+
                          (this.waitingForPageLoad ? "page load, " : "")+
                          (this.waitingForPassword ? "password, " : "")+
                          (this.waitingForExtract ? "extract, " : "")+
                          (this.inWaitCommand ? "in wait, ": ""));
        // waiting for something
        return;
    }  else {
        // fetch next action
        if ( this.action_stack.length ) {
            this.currentAction = this.action_stack.pop();
            try {
                if (Storage.getBool("debug"))
                    console.debug(
                        "("+this.globalTimer.getElapsedSeconds().toFixed(3)+") "+
                            "playNextAction(caller='"+(caller_id || "")+
                            "')\n playing "+
                            this.currentAction.name.toUpperCase()+
                            " command"+
                            ", line: "+this.currentAction.line
                    );
                this.profiler.start(this.currentAction);
                this.exec(this.currentAction);
                // profiler.end() is called from next() method
            } catch (e) {
                if (e.name && e.name == "InterruptSignal") {
                    this.onInterrupt(e.id);
                } else {
                    this.handleError(e);
                }
            }
        } else {
            this.afterEachRun();
            if (this.currentLoop < this.times) {
                this.firstLoop = false;
                this.currentLoop++;
                var panel = context[this.win_id].panelWindow;
                if (panel && !panel.closed)
                    panel.setLoopValue(this.currentLoop);
                this.action_stack = this.actions.slice();
                this.action_stack.reverse();
                this.next("new loop");
            } else {
                // no more actions left
                this.stop();
            }
        }
    }
};



// handle error
MacroPlayer.prototype.handleError = function (e) {
    this.errorCode = e.errnum ? -1*Math.abs(e.errnum) : -1001;
    this.errorMessage = (e.name ? e.name : "Error")+": "+e.message;
    if (this.currentAction) {
        this.errorMessage += ", line: "+
            (this.currentAction.line+this.linenumber_delta).toString();
    }
    // save profiler data for the broken action
    this.profiler.end(this.errorMessage, this.errorCode, this);
    console.error(this.errorMessage);
    var args = {
        message: this.errorMessage,
        errorCode: this.errorCode,
        win_id: this.win_id,
        macro: {
            source: this.source,
            name: this.currentMacro,
            file_id: this.file_id,
            bookmark_id: this.bookmark_id
        }
    };
    showInfo(args);
    if (this.playing && !this.ignoreErrors) {
        this.stop();
    } else if(this.ignoreErrors) {
        this.next("error handler");
    }
};



// form lastPerformance and save STOPWATCH results
MacroPlayer.prototype.saveStopwatchResults = function() {
    // ensure that macro timeout is cleared
    this.globalTimer.stop();

    // save total run time
    this.totalRuntime = this.globalTimer.getElapsedSeconds();

    // make all values look like 00000.000
    var format = function(x) {
        var m = x.toFixed(3).match(/^(\d+)\.(\d{3})/);
        var s = m[1];
        while (s.length < 5)
            s = "0"+s;

        return s+"."+m[2];
    };

    this.lastPerformance.push(
        {
            name: "TotalRuntime",
            value: this.totalRuntime.toFixed(3).toString()
        }
    );

    if (!this.stopwatchResults.length)
        return;

    // "Date: 2009/11/12  Time: 15:32, Macro: test1.iim, Status: OK (1)"
    let now = new Date();
    let d = imns.formatDate("yyyy/dd/mm", now);
    let t = imns.formatDate("hh:nn", now);

    let newline = __is_windows() ? "\r\n" : "\n";
    let s = "\"Date: "+d+"  Time: "+t+
        ", Macro: "+this.currentMacro+
        ", Status: "+this.errorMessage+" ("+this.errorCode+")\",";
    s += newline;
    for (let r of this.stopwatchResults) {
        let timestamp = imns.formatDate("dd/mm/yyyy,hh:nn:ss", r.timestamp);
        s += timestamp+","+r.id+","+r.elapsedTime.toFixed(3).toString();
        s += newline;
        this.lastPerformance.push(
            {
                name: r.id,
                value: r.elapsedTime.toFixed(3)
            }
        );
    }

    if (!this.shouldWriteStopwatchFile)
        return;

    if (!this.afioIsInstalled) {
        console.error("Saving Stopwatch file requires File IO interface");
        return;
    }

    let file = this.stopwatchFile;
    if (!this.stopwatchFile) {
        if (this.stopwatchFolder)
            file = this.stopwatchFolder;
        else
            file = this.defDownloadFolder.clone()
        let filename = /^(.+)\.iim$/i.test(this.currentMacro) ?
            RegExp.$1 : this.currentMacro;
        file.append("performance_"+filename+".csv");
    }

    afio.appendTextFile(file, s).catch(console.error.bind(console));
};


MacroPlayer.prototype.profiler = {
    // make string representation of Date object
    make_str: function(x) {
        var prepend = function(str, num) {
            str = str.toString();
            var x = imns.s2i(str), y = imns.s2i(num);
            if (isNaN(x) || isNaN(y))
                return;
            while (str.length < num)
                str = '0'+str;
            return str;
        };
        var str = prepend(x.getHours(), 2)+":"+
            prepend(x.getMinutes(), 2)+":"+
            prepend(x.getSeconds(), 2)+"."+
            prepend(x.getMilliseconds(), 3);
        return str;
    },

    init: function() {
        this.profiler_data = new Array();
        this.macroStartTime = new Date();
        this.enabled = false;
    },


    start: function(action) {
        if (!this.enabled)
            return;
        this.currentAction = action;
        this.startTime = new Date();
    },


    end: function(err_text, err_code, mplayer) {
        if (!this.enabled || !this.startTime)
            return;
        var now = new Date();
        var elapsedTime = (now.getTime()-this.startTime.getTime())/1000;

        // form new profiler data object
        var data = {
            Line: this.currentAction.line+mplayer.linenumber_delta,
            StartTime: this.make_str(this.startTime),
            EndTime: this.make_str(now),
            ElapsedSeconds: elapsedTime.toFixed(3),
            StatusCode: err_code,
            StatusText: err_text,
            type: mplayer.ignoreErrors ? "errorignoreyes" : "errorignoreno"
        };

        // add timeout_threshold value if applicable
        if (this.currentAction.name == "tag") {
            var threshold = (mplayer.timeout_tag > 0) ?
                mplayer.timeout_tag : mplayer.timeout/10;
            // get threshold in percents of timeout_tag
            data.timeout_threshold =
                ((elapsedTime/threshold)*100).toFixed();
        } else if (this.currentAction.name == "url") {
            // get threshold in percents of timeout_page
            data.timeout_threshold =
                ((elapsedTime/mplayer.timeout)*100).toFixed();
        }
        // console.log("new profiler data, %O", data);
        this.profiler_data.push(data);

        // clear start data
        delete this.currentAction;
        delete this.startTime;
    },

    getResultingXMLFragment: function(mplayer) {
        if (!this.enabled)
            return "";
        var macroEndTime = new Date();
        var source = imns.trim(mplayer.source).split("\n");
        var doc = document.implementation.createDocument("", "Profile", null);
        var macro = doc.createElement("Macro");
        var name = doc.createElement("Name");
        name.textContent = mplayer.currentMacro;
        macro.appendChild(name);

        var lastStartTime = null; // this is for start/end time of comments

        // this is a counter for profiler_data[]
        var j = mplayer.linenumber_delta == 0 ? 0 : -mplayer.linenumber_delta;
        for (var i = 0; i < source.length; i++) {
            if (j < this.profiler_data.length &&
                this.profiler_data[j].Line == i+1+mplayer.linenumber_delta) {
                var command = doc.createElement("Command");
                var string = doc.createElement("String");
                // first set String node
                string.textContent = imns.trim(source[i]);
                command.appendChild(string);
                var x = this.profiler_data[j];
                for (var y in x) {
                    if (y != "type" && y != "timeout_threshold") {
                        var z = doc.createElement(y);
                        z.textContent = x[y];
                        command.appendChild(z);
                    }
                }
                // set 'type' attribute
                var type = doc.createAttribute("type");
                type.nodeValue = x.type;
                command.setAttributeNode(type);
                // set 'timeout_threshold' attribute
                if (x.timeout_threshold) {
                    var tt = doc.createAttribute("timeout_threshold");
                    tt.nodeValue = x.timeout_threshold;
                    command.setAttributeNode(tt);
                }
                lastStartTime = x.StartTime;
                j++;
                // now append the resulting node to "Macro"
                macro.appendChild(command);
            }
        }

        // add total nodes
        var start = doc.createElement("Start"); // macro start time
        start.textContent = this.make_str(this.macroStartTime);
        var end = doc.createElement("End"); // macro end time
        end.textContent = this.make_str(macroEndTime);
        var elapsed = doc.createElement("ElapsedSeconds"); // macro duration
        var duration = (macroEndTime.getTime()-
                        this.macroStartTime.getTime())/1000;
        elapsed.textContent = duration.toFixed(3);
        var status = doc.createElement("Status"); // error code and text
        var code = doc.createElement("Code");
        code.textContent = mplayer.errorCode;
        var text = doc.createElement("Text");
        text.textContent = mplayer.errorMessage;

        status.appendChild(code);
        status.appendChild(text);
        macro.appendChild(start);
        macro.appendChild(end);
        macro.appendChild(elapsed);
        macro.appendChild(status);

        doc.documentElement.appendChild(macro);
        var s = new XMLSerializer();
        var result = s.serializeToString(doc);

        return result.replace(/^[.\n\r]*<Profile>\s*/, "").
            replace(/\s*<\/Profile>/, "");
    }
};


MacroPlayer.prototype.saveProfilerData = function() {
    if(!this.defDownloadFolder)
        return;
    var xml_frag = this.profiler.getResultingXMLFragment(this);
    var file = null;
    if (this.profiler.file) { // file was set with !FILE_PROFILER
        if (__is_full_path(this.profiler.file)) {
            file = afio.openNode(this.profiler.file);
        } else {
            file = this.defDownloadFolder.clone()
            var leafname = /\.xml$/i.test(this.profiler.file)?
                this.profiler.file : this.profiler.file+".xml";
            file.append(leafname);
        }
    } else {
        file = this.defDownloadFolder.clone()
        file.append("Chrome_Profiler_"+imns.formatDate("yyyy-mm-dd")+".xml");
    }

    file.exists().then(function(exists) {
        if (exists) {
            return afio.readTextFile(file).then(function(x) {
                x = x.replace(/\s*<\/Profile>\s*$/, "\n"+xml_frag+"</Profile>");
                return afio.writeTextFile(file, x);
            });
        } else {
            var x = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"+
                "<?xml-stylesheet type='text/xsl' href='Profiler.xsl'?>\n"+
                "<Profile>\n"+
                "<!--Profiled with iMacros for Chrome "+
                Storage.getChar("version")+" on "+(new Date())+"-->";
            x += xml_frag;
            x += "</Profile>";
            return afio.writeTextFile(file, x);
        }
    }).catch(console.error.bind(console));
};


MacroPlayer.prototype.stop = function() {    // Stop playing
    this.detachDebugger()
    this.playing = false
    this.pauseIsPending = false
    this.paused = false
    this.removeListeners();
    if (this.errorCode != 1) // save stopwatch result in case of error
        this.saveStopwatchResults();

    // clear wait and delay timeout if any
    if (this.delayTimeout) {
        clearTimeout(this.delayTimeout);
        delete this.delayTimeout;
    }
    if (this.waitTimeout) {
        clearTimeout(this.waitTimeout);
        delete this.waitTimeout;
    }
    if (this.waitInterval) {
        clearInterval(this.waitInterval);
        delete this.waitInterval;
    }
    for (var type of this.timers.keys())
        this.stopTimer(type);
    this.timers.clear();

    // stop profile timer
    // NOTE: handleError() saves data from broken action
    this.profiler.end("OK", 1, this);
    // write profiler data if any
    if (this.writeProfilerData) {
        this.saveProfilerData();
    }

    // tell content script do some clean-up
    communicator.postMessage("stop-replaying", {}, this.tab_id,
                             function() {});

    // clear user-set variables
    this.vars = new Array();
    this.userVars.clear();    
    context.updateState(this.win_id,"idle");

    // restore proxy settings
    if (this.proxySettings) {
        this.restoreProxySettings();
        this.proxySettings = null;
    }

    // remove badge text
    badge.clearText(this.win_id);

    // reset panel
    var panel = context[this.win_id].panelWindow;
    if (panel && !panel.closed)
        panel.setLoopValue(1);

    // show macro tree
    if (panel && !panel.closed)
        panel.showMacroTree();

    if (this.client_id) {
        var extra = {
            extractData: this.getExtractData(),
            lastPerformance: this.lastPerformance
        };
        if (this.profiler.si_enabled) {
            delete this.profiler.si_enabled;
            extra.profilerData =
                this.profiler.getResultingXMLFragment(this);
        }
        nm_connector.sendResponse(
            this.client_id,
            this.errorMessage,
            this.errorCode,
            extra
        );
    }

    if (typeof this.callback == "function") {
        var f = this.callback, self = this;
        delete this.callback;
        setTimeout(function() {f(self);}, 0);
    }
};


MacroPlayer.prototype.checkFreewareLimits = function(type, value) {
    let check = (max, msg) => {
        if (value <= max) {
            return value
        } else {
            throw new FreewareLimit(msg + " " + value + " exceeds max value " + max)
        }
    }
    if(!this.limits) 
        return value;
    switch(type) {
    case "lines":
        return check(this.limits.maxMacroLen, "macro length")
    case "loops":
        return check(this.limits.maxIterations, "number of iterations")
    case "csv_rows":
        return check(this.limits.maxCSVRows, "number of CSV rows")
    case "csv_cols":
        return check(this.limits.maxCSVCols, "number of CSV columns")
    case "user_vars":
        if (!this.limits.userVars) {
            throw new FreewareLimit("user defined variables not allowed."+
                                    " Maximum number of variables is " +
                                    this.limits.maxVariables)
        } else {
            return value
        }
    }
}

MacroPlayer.prototype.convertLimits = function(limits) {
    // { "maxVariables" : number|"unlimited",
    //   "maxCSVRows" : number|"unlimited",
    //   "maxCSVCols" : number|"unlimited",
    //   "maxMacroLen" : number|"unlimited",
    //   "maxIterations" : number|"unlimited" }

    let convert = x => x == "unlimited" ? Number.MAX_SAFE_INTEGER : x
    let obj = {}
    for (key in limits) {
        obj[key] = convert(limits[key])
    }
    obj.varsRe = limits.maxVariables == "unlimited" || limits.maxVariables >= 10 ?
        /^!var([0-9]+)$/i : new RegExp("^!var([1-"+limits.maxVariables+"])$", "i");
    obj.userVars = limits.maxVariables == "unlimited" || limits.maxVariables >= 10;

    return Object.freeze(obj)
}

// functions to manipulate extraction results
MacroPlayer.prototype.getExtractData = function () {
    return this.extractData;
};

MacroPlayer.prototype.addExtractData = function(str) {
    if ( this.extractData.length ) {
        this.extractData += "[EXTRACT]"+str;
    } else {
        this.extractData = str;
    }
};

MacroPlayer.prototype.clearExtractData = function() {
    this.extractData = "";
};


// Show Popup for extraction
MacroPlayer.prototype.showAndAddExtractData = function(str) {
    this.addExtractData(str);
    if (!this.shouldPopupExtract)
        return;
    this.waitingForExtract = true;
    var features = "titlebar=no,menubar=no,location=no,"+
        "resizable=yes,scrollbars=yes,status=no,"+
        "width=430,height=380";
    var win = window.open("extractDialog.html",
        null, features);
    win.args = {
        data: str,
        mplayer: this
    };
};



// Datasources
MacroPlayer.prototype.loadDataSource = function(filename) {
    var file;
    if (!__is_full_path(filename)) {
        if (this.dataSourceFolder)
            file = this.dataSourceFolder.clone();
        else
            throw new RuntimeError("Datasource folder is not set", 730)

        file.append(filename);
    } else {
        file = afio.openNode(filename);
    }
    var mplayer = this;
    return file.exists().then(function(exists) {
        if (!exists) {
            throw new RuntimeError("Data source file does not exist", 730)
        }
        mplayer.dataSourceFile = file.path;
        return afio.readTextFile(file).then(function(data) {
            if (!/\r?\n$/.test(data))
                data += "\n";     // add \n to make regexp not so complicated
            mplayer.dataSource = new Array();
            // regexp to match single data field
            // based on http://edoceo.com/utilitas/csv-file-format
            var ws = '[ \t\v]';   // non-crlf whitespace,
            // TODO: should we include all Unicode ws?
            var delim = mplayer.dataSourceDelimiter;
            var field = ws+'*("(?:[^\"]+|"")*"|[^'+delim+'\\n\\r]*)'+ws+
                '*('+delim+'|\\r?\\n|\\r)';
            var re = new RegExp(field, "g"), m, vals = new Array();
            while (m = re.exec(data)) {
                var value = m[1], t;
                if (t = value.match(/^\"((?:[\r\n]|.)*)\"$/))
                    value = t[1];   // unquote the line
                value = value.replace(/\"{2}/g, '"'); // normalize double quotes
                // HACK: every {{!COLn}} variable is "unwrap()-ped" in
                // command handlers so we have to do some trickery to
                // preserve double-quoted strings
                // see fx #362
                if (t = value.match(/^\"((?:[\r\n]|.)*)\"$/))
                    value = '"\\"'+t[1]+'\\""';
                vals.push(value);
                mplayer.checkFreewareLimits("csv_cols", vals.length)
                if (m[2] != delim) {
                    mplayer.dataSource.push(vals.slice(0));
                    let rowCount = mplayer.dataSource.length
                    mplayer.checkFreewareLimits("csv_rows", rowCount)
                    vals = new Array();
                }
            }

            if (!mplayer.dataSource.length) {
                    throw new RuntimeError("Can not parse datasource file "+
                                           filename, 752)
            }
        }).catch(function(err) {
            mplayer.handleError(err);
        });
    });
};


MacroPlayer.prototype.getColumnData = function (col) {
    var line =  this.dataSourceLine || this.currentLoop;

    if (!line)
        line = 1;

    var max_columns = this.dataSourceColumns || this.dataSource[line-1].length;
    if (col > max_columns)
        throw new RuntimeError("Column number "+col+
                               " greater than total number"+
                               " of columns "+max_columns, 753);

    return this.dataSource[line-1][col-1];
};


// functions to access built-in VARiables
MacroPlayer.prototype.getVar = function(idx) {
    var num = typeof idx === "string" ? imns.s2i(idx) : idx;
    return this.vars[num] || "";
};

// functions to access user defined variables
MacroPlayer.prototype.setUserVar = function(name, value) {
    this.checkFreewareLimits("user_vars", null);
    this.userVars.set(name.toLowerCase(), value);
};

MacroPlayer.prototype.getUserVar = function(name) {
    this.checkFreewareLimits("user_vars", null);
    var value = this.userVars.get(name.toLowerCase());
    return value === undefined ? "" : value;
};

MacroPlayer.prototype.hasUserVar = function(name) {
    this.checkFreewareLimits("user_vars", null);
    return this.userVars.has(name.toLowerCase());
};




function InterruptSignal(eval_id) {
    this.id = eval_id;
    this.name = "InterruptSignal";
    this.message = "Script interrupted";
}

MacroPlayer.prototype.do_eval = function (s, eval_id) {
    // check if we already eval-ed the expression
    if (this.__eval_results[eval_id]) {
        var result = this.__eval_results[eval_id].result;
        delete this.__eval_results[eval_id];
        return result.toString();
    } else {
        // there was no expression result so send it to sandbox
        var str = s ? imns.unwrap(s) : "";
        var eval_data = {
            type: "eval_in_sandbox",
            id: eval_id,
            expression: str
        };

        document.getElementById("sandbox").contentWindow.postMessage(eval_data, "*");
        // we should put previos action back to stack
        this.action_stack.push(this.currentAction);
        // interrupt macro execution to wait for sandbox answer
        throw new InterruptSignal(eval_id);
    }
};


MacroPlayer.prototype.onSandboxMessage = function(event) {
    var x = event.data;
    if (!x.type || x.type != "eval_in_sandbox_result")
        return;
    
    var r = x.result;
    // convert undefined or null result to a string value
    if (typeof(x.result) == "undefined") {
        r = "undefined";
    } else if (!r && typeof(r) == "object") {
        r = "null";
    }
    // store the result
    this.__eval_results[x.id] = {
        result: r
    };

    if (x.error) {
        this.handleError(x.error);
    } else {
        this.playNextAction("eval");
    }
};

MacroPlayer.prototype.onInterrupt = function(eval_id) {
    if (Storage.getBool("debug")) {
        console.debug("Caught interrupt exception, eval_id="+eval_id);
    }
};

// This function substitutes all occurrences of
// {{varname}} with the variable value
// Use '#NOVAR#{{' to insert '{{'
// (the function would fail if a variable contains '#novar#{' string)
MacroPlayer.prototype.expandVariables = function(param, eval_id) {
    // first replace all #NOVAR#{{ by #NOVAR#{
    param = param.replace(/#novar#\{\{/ig, "#NOVAR#{");
    // substitute {{vars}}
    var mplayer = this;
    var handleVariable = function (match_str, var_name) {
        var t = null;
        if ( t = var_name.match(mplayer.limits.varsRe) ) {
            return mplayer.getVar(t[1]);
        } else if ( t = var_name.match(/^!extract$/i) ) {
            return mplayer.getExtractData();
        } else if ( t = var_name.match(/^!urlcurrent$/i) ) {
            return mplayer.currentURL;
        } else if ( t = var_name.match(/^!col(\d+)$/i) ) {
            return mplayer.getColumnData(imns.s2i(t[1]));
        } else if ( t = var_name.match(/^!datasource_line$/i) ) {
            return mplayer.dataSourceLine || mplayer.currentLoop;
        } else if ( t = var_name.match(/^!datasource_columns$/i) ) {
            return mplayer.dataSourceColumns;
        } else if ( t = var_name.match(/^!datasource_delimiter$/i) ) {
            return mplayer.dataSourceDelimiter;
        } else if ( t = var_name.match(/^!datasource$/i) ) {
            return mplayer.dataSourceFile;
        } else if ( t = var_name.match(/^!folder_datasource$/i) ) {
            return mplayer.dataSourceFolder ?
                mplayer.dataSourceFolder.path : "__undefined__";
        } else if ( t = var_name.match(/^!folder_download$/i) ) {
            return mplayer.defDownloadFolder ?
                mplayer.defDownloadFolder.path : "__undefined__";
        } else if ( t = var_name.match(/^!folder_macros$/i) ) {
            return mplayer.macrosFolder ?
                mplayer.macrosFolder.path : "__undefined__";
        } else if ( t = var_name.match(/^!now:(\S+)$/i) ) {
            return imns.formatDate(t[1]);
        } else if ( t = var_name.match(/^!loop$/i) ) {
            return mplayer.currentLoop;
        } else if ( t = var_name.match(/^!clipboard$/i) ) {
            return imns.Clipboard.getString() || "";
        }  else if ( t = var_name.match(/^!timeout(?:_page)?$/i) ) {
            return mplayer.timeout.toString();
        } else if ( t = var_name.match(/^!timeout_(?:tag|step)$/i) ) {
            return mplayer.timeout_tag.toString();
        } else if ( t = var_name.match(/^!timeout_download$/i) ) {
            return mplayer.timeout_download.toString();
        } else if ( t = var_name.match(/^!downloaded_file_name$/i) ) {
            return mplayer.downloadedFilename;
        } else if ( t = var_name.match(/^!downloaded_size$/i) ) {
            return mplayer.downloadedSize;
        } else if ( t = var_name.match(/^!stopwatchtime$/i) ) {
            // convert to d+\.d{3} format
            var value = mplayer.lastWatchValue.toFixed(3);
            return value;
        } else if ( t = var_name.match(/^!imagex$/i) ) {
            return mplayer.imageX;
        } else if ( t = var_name.match(/^!imagey$/i) ) {
            return mplayer.imageY;
        } else if ( t = var_name.match(/^!\S+$/) ) {
            throw new BadParameter("Unsupported variable "+var_name);
        } else {                // a user-defined variable
            return mplayer.getUserVar(var_name);
        }
    };


    // check for "eval" command
    var eval_re = new RegExp("^eval\\s*\\((.*)\\)$", "i");
    var match = null;
    if (match = eval_re.exec(param)) {
        var escape = function (s) {
            var x = s.toString();
            return x.replace(/"/g, "\\\\\"").
                replace(/'/g, "\\\\\'").
                replace(/\n/g, "\\\\n").
                replace(/\r/g, "\\\\r");
        };
        var js_str = match[1].replace(/\{\{(\S+?)\}\}/g, function(m, s) {
            return escape(handleVariable(m, s))
        });
        // substitute all #novar#{ by {{
        js_str = js_str.replace(/#novar#\{(?=[^\{])/ig, "{{");
        param = this.do_eval(js_str, eval_id);
    } else {
        param = param.replace(/\{\{(\S+?)\}\}/g, handleVariable);
        // substitute all #novar#{ by {{
        param = param.replace(/#novar#\{(?=[^\{])/ig, "{{");
    }

    return param;
};
