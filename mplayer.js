/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

// An object to encapsulate all operations for parsing
// and playing macro commands

function MacroPlayer(win_id) {
    this.win_id = win_id;
    this.vars = new Array();
    this.varManager = new VariableManager();
    this.userVars = new Map();
    this.ports = new Object();
    this._ActionTable = {};

    // Normalize call stack handling for test harness
    this.callStack = [];
    this._macroCallStack = this.callStack;

    this.downloadHooksRegistered = false;
    this.activeDownloads = new Map();
    this.timers = new Map();

    // Track loop execution frames for RUN command isolation
    this.loopStack = [];
    this.runFrameStack = [];
    this.runNestLevel = 0;

    // --- Profiler Initialization (Simplified) ---
    // Define all methods directly on the instance to avoid prototype confusion
    this.profiler = {
        parent: this, // reference back to mplayer
        profiler_data: [],
        macroStartTime: null,
        enabled: false,
        file: null,

        init: function () {
            this.profiler_data = new Array();
            this.macroStartTime = new Date();
            this.enabled = false;
        },
        start: function (action) {
            if (!this.enabled) return;
            this.currentAction = action;
            this.startTime = new Date();
        },
        end: function (err_text, err_code, mplayer) {
            if (!this.enabled || !this.startTime) return;
            var now = new Date();
            var elapsedTime = (now.getTime() - this.startTime.getTime()) / 1000;
            var data = {
                Line: this.currentAction.line + mplayer.linenumber_delta,
                StartTime: this.make_str(this.startTime),
                EndTime: this.make_str(now),
                ElapsedSeconds: elapsedTime.toFixed(3),
                StatusCode: err_code,
                StatusText: err_text,
                type: mplayer.ignoreErrors ? "errorignoreyes" : "errorignoreno"
            };
            if (this.currentAction.name == "tag") {
                var threshold = (mplayer.timeout_tag > 0) ? mplayer.timeout_tag : mplayer.timeout / 10;
                data.timeout_threshold = ((elapsedTime / threshold) * 100).toFixed();
            } else if (this.currentAction.name == "url") {
                data.timeout_threshold = ((elapsedTime / mplayer.timeout) * 100).toFixed();
            }
            this.profiler_data.push(data);
            delete this.currentAction;
            delete this.startTime;
        },
        make_str: function (x) {
            var prepend = function (str, num) {
                str = str.toString();
                while (str.length < num) str = '0' + str;
                return str;
            };
            return prepend(x.getHours(), 2) + ":" +
                prepend(x.getMinutes(), 2) + ":" +
                prepend(x.getSeconds(), 2) + "." +
                prepend(x.getMilliseconds(), 3);
        },
        getResultingXMLFragment: function (mplayer) {
            if (!this.enabled) return "";
            var macroEndTime = new Date();
            var source = imns.trim(mplayer.source).split("\n");
            var doc = document.implementation.createDocument("", "Profile", null);
            var macro = doc.createElement("Macro");
            var name = doc.createElement("Name");
            name.textContent = mplayer.currentMacro;
            macro.appendChild(name);
            var j = mplayer.linenumber_delta == 0 ? 0 : -mplayer.linenumber_delta;
            for (var i = 0; i < source.length; i++) {
                if (j < this.profiler_data.length && this.profiler_data[j].Line == i + 1 + mplayer.linenumber_delta) {
                    var command = doc.createElement("Command");
                    var string = doc.createElement("String");
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
                    var type = doc.createAttribute("type");
                    type.nodeValue = x.type;
                    command.setAttributeNode(type);
                    if (x.timeout_threshold) {
                        var tt = doc.createAttribute("timeout_threshold");
                        tt.nodeValue = x.timeout_threshold;
                        command.setAttributeNode(tt);
                    }
                    j++;
                    macro.appendChild(command);
                }
            }
            var start = doc.createElement("Start");
            start.textContent = this.make_str(this.macroStartTime);
            macro.appendChild(start);
            var end = doc.createElement("End");
            end.textContent = this.make_str(macroEndTime);
            macro.appendChild(end);
            var elapsed = doc.createElement("ElapsedSeconds");
            var duration = (macroEndTime.getTime() - this.macroStartTime.getTime()) / 1000;
            elapsed.textContent = duration.toFixed(3);
            macro.appendChild(elapsed);
            var status = doc.createElement("Status");
            var code = doc.createElement("Code");
            code.textContent = mplayer.errorCode;
            var text = doc.createElement("Text");
            text.textContent = mplayer.errorMessage;
            status.appendChild(code);
            status.appendChild(text);
            macro.appendChild(status);
            doc.documentElement.appendChild(macro);
            var s = new XMLSerializer();
            var result = s.serializeToString(doc);
            return result.replace(/^[.\n\r]*<Profile>\s*/, "").replace(/\s*<\/Profile>/, "");
        }
    };

    this.compileExpressions();

    this._onScriptError = this.onErrorOccurred.bind(this);
    this._onErrorOccured = this.onNavigationErrorOccured.bind(this);
    this._onTabUpdated = this.onTabUpdated.bind(this);
    this._onActivated = this.onTabActivated.bind(this);

    this.onAuth = this.onAuthRequired.bind(this);
    this._onBeforeSendHeaders = this.onBeforeSendHeaders.bind(this);

    this._onDownloadCreated = this.onDownloadCreated.bind(this);
    this._onDownloadChanged = this.onDownloadChanged.bind(this);

    this.handleServiceWorkerMessage = this.handleServiceWorkerMessage.bind(this);
}

MacroPlayer.prototype.ActionTable = new Object();
MacroPlayer.prototype.RegExpTable = new Object();

MacroPlayer.prototype.deepCopy = function (value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => this.deepCopy(item));
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof RegExp) return new RegExp(value.source, value.flags);

    // Plain object detection to avoid copying prototypes such as null-prototype objects
    if (value.constructor === Object && Object.getPrototypeOf(value) === Object.prototype) {
        const result = {};
        for (const key in value) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                result[key] = this.deepCopy(value[key]);
            }
        }
        return result;
    }

    // Prefer structuredClone when available for broader type coverage (Map, Set, etc.)
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch (err) {
            console.warn('[iMacros] structuredClone deepCopy fallback failed, trying manual copy', err);
        }
    }

    // Manual fallback: duplicate own enumerable properties to avoid sharing references
    try {
        const clone = Object.create(Object.getPrototypeOf(value));
        for (const key of Object.keys(value)) {
            clone[key] = this.deepCopy(value[key]);
        }
        return clone;
    } catch (err) {
        console.error('[iMacros] deepCopy failed; unable to isolate value', err);
        return value;
    }
};

MacroPlayer.prototype.compileExpressions = function () {
    this.RegExpTable = Object.assign({}, MacroPlayer.prototype.RegExpTable);
    for (var x in this.RegExpTable) {
        try {
            this.RegExpTable[x] = new RegExp(this.RegExpTable[x], "i");
        } catch (e) {
            console.error(e);
            throw e;
        }
    }
    this.RegExpTable.compiled = true;

    this._ActionTable = this._ActionTable || {};
    for (var key in MacroPlayer.prototype.ActionTable) {
        this._ActionTable[key] = MacroPlayer.prototype.ActionTable[key].bind(this);
    }
};

MacroPlayer.prototype.addListeners = function () {
    if (typeof communicator !== 'undefined' && communicator.registerHandler) {
        communicator.registerHandler("error-occurred", this._onScriptError, this.win_id);
    }
};

MacroPlayer.prototype.removeListeners = function () {
    if (typeof communicator !== 'undefined' && communicator.unregisterHandler) {
        communicator.unregisterHandler("error-occurred", this._onScriptError);
    }
    if (this.downloadHooksRegistered) {
        this.downloadHooksRegistered = false;
    }
};

MacroPlayer.prototype.handleServiceWorkerMessage = function (message) {
    if (message.type === 'onTabUpdated') this._onTabUpdated(message.tabId, message.changeInfo, message.tab);
    if (message.type === 'onTabActivated') this._onActivated(message.activeInfo);
    if (message.type === 'onErrorOccurred') this._onErrorOccured(message.details);
    if (message.type === 'onDownloadCreated') this._onDownloadCreated(message.downloadItem);
    if (message.type === 'onDownloadChanged') this._onDownloadChanged(message.downloadDelta);
};

MacroPlayer.prototype.onNavigationErrorOccured = function (details) {
    if (details.tabId != this.tab_id) return;
    if (this.playing) {
        if (/net::ERR_ABORTED/.test(details.error)) return;
        this.handleError(new RuntimeError("Navigation error occured while loading url " + details.url + ", details: " + details.error, 733));
        this.stopTimer("loading");
        this.waitingForPageLoad = false;
    }
};

MacroPlayer.prototype.onAuthRequired = function (details, callback) {
    if (this.tab_id != details.tabId) return;
    if (this.lastAuthRequestId == details.requestId) {
        asyncRun(this.handleError.bind(this)(new RuntimeError("Wrong credentials for HTTP authorization"), 734));
        return { cancel: true };
    }
    this.lastAuthRequestId = details.requestId;
    if (!this.loginData || !this.waitForAuthDialog) {
        asyncRun(this.handleError.bind(this)(new RuntimeError("No credentials supplied for HTTP authorization"), 734));
        return { cancel: true };
    }
    var rv = { authCredentials: { username: this.loginData.username, password: this.loginData.password } };
    delete this.loginData;
    return rv;
};

MacroPlayer.prototype.onBeforeSendHeaders = function (details) {
    return { requestHeaders: details.requestHeaders };
};

MacroPlayer.prototype.onTabActivated = function (activeInfo) {
    if (activeInfo.windowId == this.win_id) this.tab_id = activeInfo.tabId;
};

MacroPlayer.prototype.onTabUpdated = function (tab_id, changeInfo, tab) {
    if (this.tab_id != tab_id) {
        // console.debug(`[MacroPlayer] onTabUpdated ignored: mismatch tab_id (got ${tab_id}, expected ${this.tab_id})`);
        return;
    }
    let url = (tab && tab.url) ? tab.url : this.currentURL;
    if (url == "about:blank" || url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
        // Internal pages don't reliably trigger loading/complete status transitions in the same way,
        // or are fast enough to be missed. Assume complete.
        if (this.waitingForPageLoad) {
            console.log(`[MacroPlayer] Internal page loaded: ${url}`);
            this.stopTimer("loading");
            this.waitingForPageLoad = false;
            this.next("TAB_UPDATED (internal)");
        }
        return;
    }
    this.currentURL = url;
    if (changeInfo.status == "loading" && !this.timers.has("loading")) {
        console.log(`[MacroPlayer] Page loading started: ${url}`);
        this.waitingForPageLoad = true;
        this.startTimer("loading", this.timeout, "Loading ", () => {
            console.warn(`[MacroPlayer] Page loading timeout. Current URL: ${this.currentURL}, Waiting: ${this.waitingForPageLoad}`);
            this.waitingForPageLoad = false;
            this.handleError(new RuntimeError("Page loading timeout" + ", URL: " + this.currentURL, 602));
        });
    } else if (changeInfo.status == "complete") {
        console.log(`[MacroPlayer] Page loading complete: ${url}`);
        if (this.waitForAuthDialog && this.lastAuthRequestId) {
            delete this.lastAuthRequestId;
            this.waitForAuthDialog = false;
        }
        if (this.waitingForPageLoad) {
            this.stopTimer("loading");
            this.waitingForPageLoad = false;
            this.next("onTabUpdated complete");
        }
    }
};

MacroPlayer.prototype.onDeterminingFilename = function (dl, suggest) {
    if (!this.activeDownloads.has(dl.id)) return false;
    var filename = "", m = null, name = "", ext = "";
    if (m = dl.url.match(/\/([^\/?]+)(?=\?.+|$)/)) { name = m[1]; if (m = name.match(/\.([^\.\s]+)$/)) { ext = m[1]; name = name.replace(/\.[^\.\s]+$/, ""); } }
    var dl_obj = this.activeDownloads.get(dl.id);
    if (dl_obj.downloadFilename == "*") return false;
    else if (/^\+/.test(dl_obj.downloadFilename)) filename = name + dl_obj.downloadFilename.substring(1) + "." + ext;
    else filename = dl_obj.downloadFilename;
    suggest({ filename: filename, conflictAction: "overwrite" });
    return true;
};

MacroPlayer.prototype.onDownloadCompleted = function (id) {
    var dl_obj = this.activeDownloads.get(id);
    this.activeDownloads.delete(id);
    if (this.downloadHooksRegistered && this.activeDownloads.size == 0) {
        if (context && context.unregisterDfHandler) context.unregisterDfHandler(this.win_id);
        this.downloadHooksRegistered = false
    }
    if (!this.afioIsInstalled) {
        if (this.waitForDownloadCompleted) { this.next("onDownloadCompleted"); this.stopTimer("download"); this.waitForDownloadCompleted = false; }
        return;
    }
    var dest_dir = null;
    if (dl_obj.downloadFolder == "*") dest_dir = this.defDownloadFolder.clone();
    else dest_dir = afio.openNode(dl_obj.downloadFolder);
    var mplayer = this;
    dest_dir.exists().then(function (exists) {
        if (!exists) throw new RuntimeError("Path " + dl_obj.downloadFolder + " does not exist", 732);
        var file = afio.openNode(dl_obj.downloadFilename);
        dest_dir.append(file.leafName);
        mplayer.downloadedFilename = dest_dir.path;
        return dest_dir.exists().then(function (exists) { return exists ? dest_dir.remove() : Promise.resolve(); }).then(function () {
            return file.moveTo(dest_dir).then(function () {
                if (mplayer.waitForDownloadCompleted) { mplayer.stopTimer("download"); mplayer.waitForDownloadCompleted = false; mplayer.next("onDownloadCompleted"); }
            });
        });
    }).catch(function (err) { mplayer.handleError(err); });
};

MacroPlayer.prototype.onDownloadCreated = function (dl) {
    if (dl.state != "in_progress") return;
    if (dl.referrer && dl.referrer != this.currentURL) return;
    if (!this.waitForDownloadCreated) return;
    this.waitForDownloadCreated = false;
    var dl_obj = { downloadFilename: this.downloadFilename, downloadFolder: this.downloadFolder };
    this.activeDownloads.set(dl.id, dl_obj);
    this.downloadedSize = dl.fileSize;
    if (this.waitForDownloadCompleted) {
        var mplayer = this;
        this.startTimer("download", this.timeout_download, "Loading file ", function () { mplayer.waitForDownloadCompleted = false; mplayer.handleError(new RuntimeError("Download timeout", 604)); });
    } else { this.next("onDownloadCreated"); }
};

MacroPlayer.prototype.onDownloadChanged = function (changeInfo) {
    if (!this.activeDownloads.has(changeInfo.id)) return;
    if (changeInfo.filename) {
        this.activeDownloads.get(changeInfo.id).downloadFilename = changeInfo.filename.current;
        this.downloadedFilename = changeInfo.filename.current;
    }
    if (changeInfo.state && changeInfo.state.current == "complete") {
        this.onDownloadCompleted(changeInfo.id);
    }
};

MacroPlayer.prototype.startTimer = function (type, timeout, msg, callback) {
    console.assert(!this.timers.has(type));
    var mplayer = this;
    var timer = new Object();
    timer.start = performance.now();
    timer.timeout = setTimeout(function () { mplayer.stopTimer(type); typeof (callback) == "function" && callback(); }, timeout * 1000);
    timer.interval = setInterval(function () {
        var now = performance.now();
        var elapsedTime = (now - timer.start) / 1000;
        if (elapsedTime > timeout) { mplayer.stopTimer(type); typeof (callback) == "function" && callback(); }
        if (context && context[mplayer.win_id] && context[mplayer.win_id].panelWindow) {
            var panel = context[mplayer.win_id].panelWindow;
            if (panel && !panel.closed) panel.setStatLine(msg + elapsedTime.toFixed(1) + "(" + Math.round(timeout) + ")s", "warning");
        }
        if (badge) badge.set(mplayer.win_id, { status: "loading", text: Math.round(elapsedTime) });
    }, 200);
    this.timers.set(type, timer);
};

MacroPlayer.prototype.stopTimer = function (type) {
    if (!this.timers.has(type)) return;
    var timer = this.timers.get(type);
    clearTimeout(timer.timeout);
    clearInterval(timer.interval);
    this.timers.delete(type);
    timer = null;
};

MacroPlayer.prototype.clearRetryInterval = function () {
    if (this.retryInterval) { clearInterval(this.retryInterval); delete this.retryInterval; }
}

MacroPlayer.prototype.retry = function (onerror, msg, caller_id, timeout) {
    if (!this.playing) return;
    if (timeout === undefined) timeout = this.timeout / 10;
    var _timeout = timeout * 1000;
    if (!this.retryInterval) {
        var start_time = performance.now();
        this.retryInterval = setInterval(() => {
            if (!this.playing) { this.clearRetryInterval(); return; }
            var remains = start_time + _timeout - performance.now();
            if (remains <= 0) {
                this.clearRetryInterval();
                try { typeof (onerror) == "function" && onerror(); } catch (e) {
                    if (this.ignoreErrors) { this.action_stack.pop(); this.next("skipped retry() - error ignored"); } else { this.handleError(e); }
                }
            } else {
                let text = Math.round(remains / 1000);
                while (text.length < 2) text = "0" + text; text += "s";
                if (badge) badge.set(this.win_id, { status: "tag_wait", text: text });
                if (context && context[this.win_id]) {
                    let panel = context[this.win_id].panelWindow;
                    if (panel && !panel.closed) panel.setStatLine(msg + (remains / 1000).toFixed(1) + "(" + Math.round(_timeout / 1000) + ")s", "warning");
                }
            }
        }, 500);
    }
    this.action_stack.push(this.currentAction);
    setTimeout(() => { this.playNextAction("retry " + caller_id); }, 500);
};

MacroPlayer.prototype.onTagComplete = function (data) {
    if (!data.found) {
        this.retry(() => {
            if (data.extract) { this.showAndAddExtractData("#EANF#"); this.action_stack.pop(); this.next("onTagComplete"); } else { throw data.error; }
        }, "Tag waiting... ", "onTagComplete", this.timeout_tag);
        return;
    }
    this.clearRetryInterval();
    if (data.error) { this.handleError(data.error); }
    else if (data.selector) { this.handleInputFileTag(data.selector, data.files).then(() => this.next("onTagComplete")).catch(e => this.handleError(e)); }
    else if (data.decryptPassword) { this.shouldDecryptPassword = true; this.action_stack.push(this.currentAction); this.next("Decrypt content string"); }
    else {
        if (data.extract) this.showAndAddExtractData(data.extract);
        else if (data.targetURI) this.saveTarget(data.targetURI);
        if (!this.waitForDownloadCreated && !this.waitForAuthDialog) this.next("onTagComplete");
    }
};

MacroPlayer.prototype.terminate = function () {
    if (Storage.getBool("debug")) console.info("terminating player for window " + this.win_id);
    if (this.playing) this.stop();
};

var im_strre = "(?:\"(?:[^\"\\\\]|\\\\[0btnvfr\"\'\\\\])*\"|" + "eval\\s*\\(\"(?:[^\"\\\\]|\\\\[\\w\"\'\\\\])*\"\\)|" + "\\S*)";
const im_atts_re = "(?:[-\\w]+:" + im_strre + "(?:&&[-\\w]+:" + im_strre + ")*|\\*?)";

MacroPlayer.prototype.noContentPage = function (cmd_name) {
    if (!/^https?|file/i.test(this.currentURL))
        this.handleError(new RuntimeError(cmd_name + " command can not be executed because" + " it requires a Web page loaded in active tab." + " Current page is " + this.currentURL, 612));
};

// --- Command Implementations ---

MacroPlayer.prototype.RegExpTable["add"] = "^(\\S+)\\s+(" + im_strre + ")\\s*$";
MacroPlayer.prototype.ActionTable["add"] = function (cmd) {
    var param = imns.unwrap(this.expandVariables(cmd[2], "add2"));
    var m = null;
    if (m = cmd[1].match(this.limits.varsRe)) {
        var num = imns.s2i(m[1]);
        var n1 = imns.s2i(this.getVar(num)), n2 = imns.s2i(param);
        if (!isNaN(n1) && !isNaN(n2)) this.vars[num] = (n1 + n2).toString();
        else this.vars[num] = this.getVar(num) + param;
    } else if (cmd[1].match(/^!extract$/i)) {
        this.addExtractData(param);
    } else if (/^!\S+$/.test(cmd[1])) {
        throw new BadParameter("Unsupported variable " + cmd[1] + " for ADD command");
    } else {
        var n1 = imns.s2i(this.getUserVar(cmd[1])), n2 = imns.s2i(param);
        if (!isNaN(n1) && !isNaN(n2)) this.setUserVar(cmd[1], (n1 + n2).toString());
        else this.setUserVar(cmd[1], this.getUserVar(cmd[1]) + param);
    }
    this.next("ADD");
};

MacroPlayer.prototype.RegExpTable["back"] = "^\\s*$";
MacroPlayer.prototype.ActionTable["back"] = function (cmd) {
    if (this.noContentPage("BACK")) return;
    communicator.postMessage("back-command", {}, this.tab_id, function () { }, { number: 0 });
};

// CLEAR command (MV3 Compatible)
MacroPlayer.prototype.RegExpTable["clear"] = "^\\s*(" + im_strre + ")?\\s*$";
MacroPlayer.prototype.ActionTable["clear"] = function (cmd) {
    var specifier = cmd[1] ? imns.unwrap(this.expandVariables(cmd[1], "clear1")) : null;
    var details = {};
    if (specifier) {
        if (/^http/.test(specifier)) details.url = specifier;
        else if (/^[\w\.]+$/.test(specifier)) details.domain = specifier;
        else throw new BadParameter("domain name or URL", 1);
    }
    var mplayer = this;
    chrome.runtime.sendMessage({ target: "background", command: "cookies_getAll", details: details }, (cookies) => {
        if (!cookies || cookies.length === 0) { mplayer.next("CLEAR"); return; }
        let promises = cookies.map(cookie => {
            var url = (cookie.secure ? "https" : "http") + "://" + cookie.domain + cookie.path;
            return new Promise(resolve => {
                chrome.runtime.sendMessage({ target: "background", command: "cookies_remove", details: { url: url, name: cookie.name } }, resolve);
            });
        });
        Promise.all(promises).then(() => { mplayer.next("CLEAR"); });
    });
};

MacroPlayer.prototype.RegExpTable["event"] = "type\\s*=\\s*(" + im_strre + ")" + "(?:\\s+(selector|xpath)\\s*=\\s*(" + im_strre + "))?" + "(?:\\s+(button|key|char|point)\\s*=\\s*(" + im_strre + "))?" + "(?:\\s+modifiers\\s*=\\s*(" + im_strre + "))?";
MacroPlayer.prototype.ActionTable["event"] = function (cmd) {
    var type = imns.unwrap(this.expandVariables(cmd[1], "event1")).toLowerCase();
    var selector_type = cmd[2] ? cmd[2].toLowerCase() : "";
    var selector = cmd[3] ? imns.unwrap(this.expandVariables(cmd[3], "event3")) : "";
    var value_type = (cmd[4] || "").toLowerCase();
    var value = cmd[5] ? imns.unwrap(this.expandVariables(cmd[5], "event5")) : 0;
    var modifiers = cmd[6] ? imns.unwrap(this.expandVariables(cmd[6], "event6")) : "";
    var data = { scroll: true };
    data[selector_type || "selector"] = selector || ":root";
    this.attachDebugger().then(() => communicator.sendMessage("activate-element", data, this.tab_id, this.currentFrame)).then(response => {
        if (!response) throw new RuntimeError(chrome.runtime.lastError ? chrome.runtime.lastError.message : "Unknown error");
        else if (response.error) throw new RuntimeError(response.error.message, response.error.errnum);
        else this.clearRetryInterval();
        return response.targetRect;
    }).then(targetRect => {
        var button = 0, key = 0, char = "", point = null;
        if (value_type == "button") { button = imns.s2i(value); if (isNaN(button)) throw new BadParameter("integer BUTTON value", 3); }
        else if (value_type == "key") { key = imns.s2i(value); if (isNaN(key)) throw new BadParameter("integer KEY value", 3); }
        else if (value_type == "char") { char = value; }
        else if (value_type == "point") {
            const point_re = /^\(\s*(\d+(?:\.\d+)?)\s*\,\s*(\d+(?:\.\d+)?)\s*\)$/;
            var m = point_re.exec(value.trim());
            if (!m) throw new BadParameter("(x,y) POINT value", 3);
            point = { x: parseFloat(m[1]), y: parseFloat(m[2]) };
        }
        return Promise.resolve().then(() => {
            if (/^mouse/.test(type)) return this.dispatchMouseEvent({ type: type, point: point, button: button, modifiers: modifiers, targetRect: targetRect });
            else if (/^key/.test(type)) return this.dispatchKeyboardEvent({ type: type, key: key, char: char, modifiers: modifiers });
            else if (type == "click") return this.dispatchMouseEvent({ type: "mousedown", clickCount: 1, point: point, button: button, modifiers: modifiers, targetRect: targetRect }).then(() => this.dispatchMouseEvent({ type: "mouseup", clickCount: 1, point: point, button: button, modifiers: modifiers, targetRect: targetRect }));
            else if (type == "dblclick") return this.dispatchMouseEvent({ type: "mousedown", clickCount: 1, point: point, button: button, modifiers: modifiers, targetRect: targetRect }).then(() => this.dispatchMouseEvent({ type: "mouseup", clickCount: 1, point: point, button: button, modifiers: modifiers, targetRect: targetRect })).then(() => this.dispatchMouseEvent({ type: "mousedown", clickCount: 2, point: point, button: button, modifiers: modifiers, targetRect: targetRect })).then(() => this.dispatchMouseEvent({ type: "mouseup", clickCount: 2, point: point, button: button, modifiers: modifiers, targetRect: targetRect }));
        })
    }).then(() => this.next("EVENT")).catch(e => {
        if (e.errnum == 721) this.retry(() => { throw e }, "Tag waiting... ", "onActivateElement", this.timeout_tag);
        else this.handleError(e);
    })
};

MacroPlayer.prototype.RegExpTable["events"] = "type\\s*=\\s*(" + im_strre + ")" + "(?:\\s+(selector|xpath)\\s*=\\s*(" + im_strre + "))?" + "(?:\\s+(keys|chars|points)\\s*=\\s*(" + im_strre + "))?" + "(?:\\s+modifiers\\s*=\\s*(" + im_strre + "))?";
MacroPlayer.prototype.ActionTable["events"] = function (cmd) {
    var type = imns.unwrap(this.expandVariables(cmd[1], "events1")).toLowerCase();
    var selector_type = cmd[2] ? cmd[2].toLowerCase() : "";
    var selector = cmd[3] ? imns.unwrap(this.expandVariables(cmd[3], "events3")) : "";
    var value_type = (cmd[4] || "").toLowerCase();
    var value = cmd[5] ? imns.unwrap(this.expandVariables(cmd[5], "events5")) : 0;
    var modifiers = cmd[6] ? imns.unwrap(this.expandVariables(cmd[6], "events6")) : "";
    var data = { scroll: true };
    data[selector_type || "selector"] = selector || ":root";
    this.attachDebugger().then(() => communicator.sendMessage("activate-element", data, this.tab_id, this.currentFrame)).then(response => {
        if (response.error) throw new RuntimeError(response.error.message, response.error.errnum);
        else this.clearRetryInterval();
        return response;
    }).then(resp => {
        if (value_type == "chars") {
            if (resp.isPasswordElement) return this.decrypt(value).then(decryptedString => ({ chars: decryptedString.split("") }));
            else return { chars: value.split("") };
        } else if (value_type == "keys") return { keys: JSON.parse(value) };
        else if (value_type == "points") {
            let point_re = /\(\s*(\d+(?:\.\d+)?)\s*\,\s*(\d+(?:\.\d+)?)\s*\)/g;
            let points = [], m;
            while (m = point_re.exec(value)) points.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) });
            return { points: points, targetRect: resp.targetRect };
        }
    }).then(value => {
        if (type == "mousemove") return value.points.reduce((seq, point) => seq.then(() => this.dispatchMouseEvent({ type: type, point: point, targetRect: value.targetRect, modifiers: modifiers })), Promise.resolve());
        else if (/^key/.test(type) && value.keys) return value.keys.reduce((seq, key) => seq.then(() => this.dispatchKeyboardEvent({ type: type, key: key, modifiers: modifiers })), Promise.resolve());
        else if (/^key/.test(type) && value.chars) return value.chars.reduce((seq, char) => seq.then(() => this.dispatchKeyboardEvent({ type: type, char: char, modifiers: modifiers })), Promise.resolve());
    }).then(() => this.next("EVENTS")).catch(e => {
        if (e.errnum == 721) this.retry(() => { throw e }, "Tag waiting... ", "onActivateElement", this.timeout_tag);
        else this.handleError(e);
    })
};

MacroPlayer.prototype.RegExpTable["frame"] = "^(f|name)\\s*=\\s*(" + im_strre + ")\\s*$";
MacroPlayer.prototype.ActionTable["frame"] = function (cmd) {
    var type = cmd[1].toLowerCase();
    var param = imns.unwrap(this.expandVariables(cmd[2], "frame2"));
    var frame_data = {};
    if (type == "f") {
        param = imns.s2i(param);
        if (isNaN(param)) throw new BadParameter("F=<number>", 1);
        if (param == 0) { this.currentFrame = { number: 0 }; this.next("FRAME"); return; }
        frame_data.number = param;
    } else if (type == "name") frame_data.name = param;
    communicator.postMessage("frame-command", frame_data, this.tab_id, this.onFrameComplete.bind(this), { number: 0 });
};

MacroPlayer.prototype.RegExpTable["imagesearch"] = "^pos\\s*=\\s*(" + im_strre + ")\\s+image\\s*=\\s*(" + im_strre + ")\\s+" + "confidence\\s*=\\s*(" + im_strre + ")";
MacroPlayer.prototype.ActionTable["imagesearch"] = function (cmd) {
    var pos = imns.s2i(imns.unwrap(this.expandVariables(cmd[1], "imagesearch1")));
    var image = imns.unwrap(this.expandVariables(cmd[2], "imagesearch2"));
    var cl = imns.s2i(imns.unwrap(this.expandVariables(cmd[3], "imagesearch3")));

    // Validate confidence level (0-100)
    if (cl < 0 || cl > 100) {
        throw new BadParameter("CONFIDENCE must be between 0 and 100", 3);
    }

    var mplayer = this;

    // Resolve image path
    var resolveImagePath = function () {
        if (__is_full_path(image)) {
            return Promise.resolve(image);
        }
        // Get default data path
        return afio.getDefaultDir("datapath").then(function (dir) {
            dir.append(image);
            return dir.path;
        });
    };

    resolveImagePath().then(function (imagePath) {
        // Read the template/sample image
        var node = afio.openNode(imagePath);
        return node.exists().then(function (exists) {
            if (!exists) {
                throw new RuntimeError("Image file not found: " + imagePath, 781);
            }
            // Read image as base64
            return afio.readBinaryFile(node);
        });
    }).then(function (templateData) {
        // Hide scrollbars for clean screenshot
        communicator.postMessage("webpage-hide-scrollbars", { hide: true }, mplayer.tab_id, function () { });

        // Capture webpage screenshot
        mplayer.captureWebPage(function (screenshotDataUrl) {
            communicator.postMessage("webpage-hide-scrollbars", { hide: false }, mplayer.tab_id, function () { });

            // Perform image search using JavaScript (Canvas API)
            mplayer._performImageSearch(screenshotDataUrl, templateData, pos, cl).then(function (result) {
                if (!result.found) {
                    mplayer.retry(function () {
                        throw new RuntimeError("Image specified by " + image + " does not match the web-page", 727);
                    }, "Image waiting... ", "onImageSearch", mplayer.timeout_tag * 4);
                    return;
                }

                mplayer.clearRetryInterval();
                mplayer.imageX = result.x;
                mplayer.imageY = result.y;

                // Notify content script to highlight the found area
                communicator.postMessage("image-search-command", {
                    x: result.x,
                    y: result.y,
                    width: result.width,
                    height: result.height
                }, mplayer.tab_id, function () {
                    mplayer.next("IMAGESEARCH");
                }, { number: 0 });
            }).catch(function (e) {
                mplayer.handleError(e);
            });
        });
    }).catch(function (e) {
        mplayer.handleError(e);
    });
};

// JavaScript-based image search using Canvas API
MacroPlayer.prototype._performImageSearch = function (screenshotDataUrl, templateData, pos, confidenceThreshold) {
    var mplayer = this;

    return new Promise(function (resolve, reject) {
        // Create images from data
        var screenshotImg = new Image();
        var templateImg = new Image();
        var loadedCount = 0;

        var onBothLoaded = function () {
            try {
                // Create canvas for screenshot
                var screenshotCanvas = document.createElement('canvas');
                screenshotCanvas.width = screenshotImg.width;
                screenshotCanvas.height = screenshotImg.height;
                var screenshotCtx = screenshotCanvas.getContext('2d');
                screenshotCtx.drawImage(screenshotImg, 0, 0);
                var screenshotData = screenshotCtx.getImageData(0, 0, screenshotCanvas.width, screenshotCanvas.height);

                // Create canvas for template
                var templateCanvas = document.createElement('canvas');
                templateCanvas.width = templateImg.width;
                templateCanvas.height = templateImg.height;
                var templateCtx = templateCanvas.getContext('2d');
                templateCtx.drawImage(templateImg, 0, 0);
                var templateImageData = templateCtx.getImageData(0, 0, templateCanvas.width, templateCanvas.height);

                // Perform template matching
                var matches = mplayer._templateMatch(
                    screenshotData,
                    templateImageData,
                    confidenceThreshold / 100
                );

                // Sort by confidence (best first)
                matches.sort(function (a, b) { return b.confidence - a.confidence; });

                // Get the match at specified position
                if (matches.length >= pos && pos > 0) {
                    var match = matches[pos - 1];
                    resolve({
                        found: true,
                        x: match.x + Math.round(templateImg.width / 2),
                        y: match.y + Math.round(templateImg.height / 2),
                        width: templateImg.width,
                        height: templateImg.height,
                        confidence: Math.round(match.confidence * 100)
                    });
                } else {
                    resolve({ found: false });
                }
            } catch (e) {
                reject(e);
            }
        };

        var onLoad = function () {
            loadedCount++;
            if (loadedCount === 2) {
                onBothLoaded();
            }
        };

        var onError = function (e) {
            reject(new RuntimeError("Failed to load image for comparison", 703));
        };

        screenshotImg.onload = onLoad;
        screenshotImg.onerror = onError;
        templateImg.onload = onLoad;
        templateImg.onerror = onError;

        screenshotImg.src = screenshotDataUrl;

        // Convert template data to data URL
        if (typeof templateData === 'string' && templateData.startsWith('data:')) {
            templateImg.src = templateData;
        } else {
            // Assume it's raw binary data or base64
            var base64 = typeof templateData === 'string' ? templateData : btoa(String.fromCharCode.apply(null, new Uint8Array(templateData)));
            // Try to detect image type from header
            var imgType = 'png';
            if (base64.startsWith('/9j/')) imgType = 'jpeg';
            else if (base64.startsWith('R0lG')) imgType = 'gif';
            else if (base64.startsWith('iVBORw')) imgType = 'png';
            templateImg.src = 'data:image/' + imgType + ';base64,' + base64;
        }
    });
};

// Simple template matching algorithm
MacroPlayer.prototype._templateMatch = function (screenshotData, templateData, threshold) {
    var matches = [];
    var sWidth = screenshotData.width;
    var sHeight = screenshotData.height;
    var tWidth = templateData.width;
    var tHeight = templateData.height;
    var sData = screenshotData.data;
    var tData = templateData.data;

    // Step size for faster scanning (can miss some matches but much faster)
    var step = Math.max(1, Math.floor(Math.min(tWidth, tHeight) / 4));

    // Minimum threshold to consider a match
    var minThreshold = threshold * 0.8;

    for (var y = 0; y <= sHeight - tHeight; y += step) {
        for (var x = 0; x <= sWidth - tWidth; x += step) {
            var confidence = this._compareRegion(sData, sWidth, x, y, tData, tWidth, tHeight);

            if (confidence >= minThreshold) {
                // Refine the match with a finer scan around this area
                var bestX = x, bestY = y, bestConf = confidence;

                for (var fy = Math.max(0, y - step); fy <= Math.min(sHeight - tHeight, y + step); fy++) {
                    for (var fx = Math.max(0, x - step); fx <= Math.min(sWidth - tWidth, x + step); fx++) {
                        if (fx === x && fy === y) continue;
                        var fconf = this._compareRegion(sData, sWidth, fx, fy, tData, tWidth, tHeight);
                        if (fconf > bestConf) {
                            bestConf = fconf;
                            bestX = fx;
                            bestY = fy;
                        }
                    }
                }

                if (bestConf >= threshold) {
                    // Check if this overlaps with existing matches
                    var overlaps = false;
                    for (var i = 0; i < matches.length; i++) {
                        var dx = Math.abs(matches[i].x - bestX);
                        var dy = Math.abs(matches[i].y - bestY);
                        if (dx < tWidth / 2 && dy < tHeight / 2) {
                            overlaps = true;
                            if (bestConf > matches[i].confidence) {
                                matches[i] = { x: bestX, y: bestY, confidence: bestConf };
                            }
                            break;
                        }
                    }
                    if (!overlaps) {
                        matches.push({ x: bestX, y: bestY, confidence: bestConf });
                    }
                }
            }
        }
    }

    return matches;
};

// Compare a region of the screenshot with the template
MacroPlayer.prototype._compareRegion = function (sData, sWidth, sx, sy, tData, tWidth, tHeight) {
    var totalDiff = 0;
    var sampleCount = 0;
    var sampleStep = Math.max(1, Math.floor(Math.min(tWidth, tHeight) / 10));

    for (var ty = 0; ty < tHeight; ty += sampleStep) {
        for (var tx = 0; tx < tWidth; tx += sampleStep) {
            var sIdx = ((sy + ty) * sWidth + (sx + tx)) * 4;
            var tIdx = (ty * tWidth + tx) * 4;

            // Compare RGB values (ignore alpha)
            var rDiff = Math.abs(sData[sIdx] - tData[tIdx]);
            var gDiff = Math.abs(sData[sIdx + 1] - tData[tIdx + 1]);
            var bDiff = Math.abs(sData[sIdx + 2] - tData[tIdx + 2]);

            // Normalize to 0-1 range
            var pixelDiff = (rDiff + gDiff + bDiff) / (255 * 3);
            totalDiff += pixelDiff;
            sampleCount++;
        }
    }

    // Return similarity (1 = perfect match, 0 = completely different)
    return 1 - (totalDiff / sampleCount);
};

MacroPlayer.prototype.RegExpTable["ondownload"] = "^folder\\s*=\\s*(" + im_strre + ")\\s+" + "file\\s*=\\s*(" + im_strre + ")" + "(?:\\s+wait\\s*=(yes|no|true|false))?" + "(?:\\s+checksum\\s*=(md5|sha1):(\\S+))?" + "\\s*$";
MacroPlayer.prototype.ActionTable["ondownload"] = function (cmd) {
    var folder = imns.unwrap(this.expandVariables(cmd[1], "ondownload1"));
    if (folder !== "*" && !this.afioIsInstalled) throw new BadParameter("FOLDER requires File Access...");
    var file = imns.unwrap(this.expandVariables(cmd[2], "ondownload2"));
    var wait = true;
    if (typeof cmd[3] != "undefined") { var param = imns.unwrap(this.expandVariables(cmd[3], "ondownload3")); wait = /^(?:yes|true)$/i.test(param); }
    if (this.waitForDownloadCreated) throw new Error("only one ONDOWNLOAD command should be used for each download");
    this.waitForDownloadCreated = true;
    this.waitForDownloadCompleted = wait;
    this.downloadFolder = folder;
    this.downloadFilename = file;
    this.shouldDownloadPDF = true;
    if (!this.downloadHooksRegistered) { this.downloadHooksRegistered = true; if (context && context.registerDfHandler) context.registerDfHandler(this.win_id); }
    this.next("ONDOWNLOAD");
};

MacroPlayer.prototype.RegExpTable["onerrordialog"] = "^(?:button\\s*=\\s*(?:\\S*))?\\s*(?:\\bcontinue\\s*=\\s*(\\S*))?\\s*$";
MacroPlayer.prototype.ActionTable["onerrordialog"] = function (cmd) {
    var param = cmd[1] ? imns.unwrap(this.expandVariables(cmd[1], "onerrordialog1")) : "";
    if (/^no|false$/i.test(param)) this.shouldStopOnError = true;
    this.next("ONERRORDIALOG");
};
MacroPlayer.prototype.RegExpTable["onscripterror"] = MacroPlayer.prototype.RegExpTable["onerrordialog"];
MacroPlayer.prototype.ActionTable["onscripterror"] = MacroPlayer.prototype.ActionTable["onerrordialog"];

MacroPlayer.prototype.RegExpTable["onlogin"] = "^user\\s*=\\s*(" + im_strre + ")\\s+" + "password\\s*=\\s*(" + im_strre + ")\\s*$";
MacroPlayer.prototype.ActionTable["onlogin"] = function (cmd) {
    var username = imns.unwrap(this.expandVariables(cmd[1], "onlogin1"));
    var password = imns.unwrap(this.expandVariables(cmd[2], "onlogin2"));
    this.loginData = { username: username };
    this.waitForAuthDialog = true;
    this.decrypt(password).then(decryptedString => { this.loginData.password = decryptedString; }).then(() => this.next("ONLOGIN")).catch(e => this.handleError(e));
};

MacroPlayer.prototype.RegExpTable["pause"] = "^\\s*$";
MacroPlayer.prototype.ActionTable["pause"] = function (cmd) { this.pause(); this.next("PAUSE"); };

MacroPlayer.prototype.RegExpTable["prompt"] = "^(" + im_strre + ")" + "(?:\\s+(" + im_strre + ")" + "(?:\\s+(" + im_strre + "))?)?\\s*$";
MacroPlayer.prototype.ActionTable["prompt"] = function (cmd) {
    if (this.noContentPage("PROMPT")) return;
    var x = { text: imns.unwrap(this.expandVariables(cmd[1], "prompt1")) };
    if (typeof (cmd[2]) != "undefined") {
        if (this.limits.varsRe.test(cmd[2])) x.varnum = imns.s2i(RegExp.$1);
        else if (/^[^!]\S*/.test(cmd[2])) { this.checkFreewareLimits("user_vars", null); x.varname = cmd[2]; }
        else throw new BadParameter("Unsupported variable " + cmd[2]);
    }
    if (typeof (cmd[3]) != "undefined") x.defval = imns.unwrap(this.expandVariables(cmd[3], "prompt3"));
    try {
        var mplayer = this;
        if (typeof (x.varnum) != "undefined" || typeof (x.varname) != "undefined") {
            let p = dialogUtils.openDialog("promptDialog.html", "iMacros Prompt Dialog", { type: "askInput", text: x.text, default: x.defval });
            return p.then(function (result) {
                var retobj = { varnum: x.varnum, varname: x.varname, value: "" };
                if (!result.canceled) retobj.value = result.inputValue;
                if (typeof (retobj.varname) != "undefined") mplayer.setUserVar(retobj.varname, retobj.value);
                else if (typeof (retobj.varnum) != "undefined") mplayer.vars[imns.s2i(retobj.varnum)] = retobj.value;
                mplayer.next("onPromptComplete");
            });
        } else {
            let p = dialogUtils.openDialog("promptDialog.html", "iMacros Prompt Dialog", { type: "alert", text: x.text });
            return p.then(function (result) { mplayer.next("onPromptComplete"); });
        }
    } catch (e) { this.handleError(e); }
};

MacroPlayer.prototype.RegExpTable["proxy"] = "^address\\s*=\\s*(" + im_strre + ")" + "(?:\\s+bypass\\s*=\\s*(" + im_strre + ")\\s*)?$";
MacroPlayer.prototype.ActionTable["proxy"] = function (cmd) {
    var address = imns.unwrap(this.expandVariables(cmd[1], "proxy1"));
    var bypass = cmd[2] ? imns.unwrap(this.expandVariables(cmd[2], "proxy2")) : null;
    var addr_re = /^(?:(https?)\s*=\s*)?([\d\w\.]+):(\d+)\s*$/;
    var m = addr_re.exec(address);
    if (!m) throw new BadParameter("server name or IP address with port number", 1);
    var config = { mode: "fixed_servers", rules: { singleProxy: { scheme: (m[1] == "https" ? "https" : "http"), host: m[2], port: imns.s2i(m[3]) } } };
    if (bypass && !/^null$/i.test(bypass)) config.rules.bypassList = bypass.split(",");
    var mplayer = this;
    const storeSettings = () => { return new Promise(resolve => { chrome.runtime.sendMessage({ target: "background", command: "proxy_get" }, (config) => { mplayer.proxySettings = config.value; resolve(); }); }); };
    const setSettings = (cfg) => { chrome.runtime.sendMessage({ target: "background", command: "proxy_set", config: cfg }, () => { mplayer.next("PROXY"); }); };
    if (!this.proxySettings) storeSettings().then(() => setSettings(config));
    else setSettings(config);
};

MacroPlayer.prototype.RegExpTable["refresh"] = "^\\s*$";
MacroPlayer.prototype.ActionTable["refresh"] = function (cmd) {
    if (this.noContentPage("REFRESH")) return;
    var mplayer = this;

    // Proxy chrome.tabs.get through Service Worker if not available
    function getTab(tabId) {
        return new Promise((resolve, reject) => {
            if (chrome.tabs && chrome.tabs.get) {
                chrome.tabs.get(tabId, (tab) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve(tab);
                });
            } else {
                chrome.runtime.sendMessage({ command: 'TAB_GET', tab_id: tabId }, (response) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else if (response && response.error) reject(new Error(response.error));
                    else resolve(response.tab);
                });
            }
        });
    }

    getTab(this.tab_id).then(function (tab) {
        if (/^(?:https?|file)/.test(tab.url)) {
            communicator.postMessage("refresh-command", {}, tab.id, function () { }, { number: 0 });
        }
    }).catch(function (e) {
        console.warn('[iMacros] REFRESH command error:', e);
    });
};

MacroPlayer.prototype.RegExpTable["saveas"] = "^type\\s*=\\s*(\\S+)\\s+" + "folder\\s*=\\s*(" + im_strre + ")\\s+" + "file\\s*=\\s*(" + im_strre + ")\\s*$";
MacroPlayer.prototype.ActionTable["saveas"] = function (cmd) {
    if (this.noContentPage("SAVEAS")) return;
    var folder = imns.unwrap(this.expandVariables(cmd[2], "saveas2"));
    var type = imns.unwrap(this.expandVariables(cmd[1], "saveas1")).toLowerCase();
    var filename = imns.unwrap(this.expandVariables(cmd[3], "saveas3"));
    let mplayer = this;
    getSaveAsFile(mplayer, folder, filename, type).then(f => {
        if (type == "extract") {
            let data = mplayer.getExtractData().replace(/\"/g, '""');
            mplayer.clearExtractData();
            data = '"' + data.replace(/\[EXTRACT\]/g, '"' + mplayer.dataSourceDelimiter + '"') + '"';
            afio.appendTextFile(f, data + (__is_windows() ? "\r\n" : "\n")).then(() => mplayer.next("SAVEAS")).catch(err => mplayer.handleError(err));
        } else if (type == "mht") {
            chrome.pageCapture.saveAsMHTML({ tabId: mplayer.tab_id }, function (data) {
                let reader = new FileReader();
                reader.onload = function (event) { afio.writeTextFile(f, event.target.result).then(() => mplayer.next("SAVEAS")).catch(e => mplayer.handleError(e)); };
                reader.readAsText(data);
            });
        } else if (type == "txt" || type == "htm") {
            communicator.postMessage("saveas-command", { type: type }, mplayer.tab_id, function (data) {
                afio.writeTextFile(f, data).then(() => mplayer.next("SAVEAS")).catch(e => mplayer.handleError(e));
            }, { number: 0 });
        } else if (/^png|jpeg$/.test(type)) {
            communicator.postMessage("webpage-hide-scrollbars", { hide: true }, mplayer.tab_id, () => { });
            mplayer.captureWebPage(function (data) {
                communicator.postMessage("webpage-hide-scrollbars", { hide: false }, mplayer.tab_id, () => { });
                var re = /data\:([\w-]+\/[\w-]+)?(?:;(base64))?,(.+)/;
                var m = re.exec(data);
                afio.writeImageToFile(f, { image: m[3], encoding: m[2], mimeType: m[1] }).then(() => mplayer.next("SAVEAS")).catch(e => mplayer.handleError(e));
            }, type);
        }
    }).catch(e => mplayer.handleError(e));
};

MacroPlayer.prototype.RegExpTable["screenshot"] = "^type\\s*=\\s*(browser|page)\\s+" + "folder\\s*=\\s*(" + im_strre + ")\\s+" + "file\\s*=\\s*(" + im_strre + ")\\s*$";
MacroPlayer.prototype.ActionTable["screenshot"] = function (cmd) {
    if (this.noContentPage("SCREENSHOT")) return;
    if (!this.afioIsInstalled) throw new RuntimeError("SCREENSHOT requires File IO interface", 660);
    var folder = imns.unwrap(this.expandVariables(cmd[2], "screenshot2"));
    var type = imns.unwrap(this.expandVariables(cmd[1], "screenshot1")).toLowerCase();
    if (type != "page") throw new BadParameter("SCREENSHOT TYPE=" + type.toUpperCase() + " is not supported");
    var f = (folder == "*") ? this.defDownloadFolder.clone() : afio.openNode(folder);
    var file = imns.unwrap(this.expandVariables(cmd[3], "saveas3"));
    var mplayer = this;
    f.exists().then(function (exists) {
        if (!exists) throw new RuntimeError("Path " + folder + " does not exist", 732);
        if (file == "*") file = __doc_name(mplayer.currentURL);
        else if (file.match(/^\+(.+)$/)) file = __doc_name(mplayer.currentURL) + RegExp.$1;
        file = file.replace(/[\s*:*?|<>\\"/]+/g, "_");
        f.append(__ensure_ext(file, "png"));
        communicator.postMessage("webpage-hide-scrollbars", { hide: true }, mplayer.tab_id, () => { });
        mplayer.captureWebPage(function (data) {
            communicator.postMessage("webpage-hide-scrollbars", { hide: false }, mplayer.tab_id, () => { });
            var m = /data\:([\w-]+\/[\w-]+)?(?:;(base64))?,(.+)/.exec(data);
            afio.writeImageToFile(f, { image: m[3], encoding: m[2], mimeType: m[1] }).then(() => mplayer.next("SCREENSHOT")).catch(e => mplayer.handleError(e));
        });
    }).catch(function (err) { mplayer.handleError(err); });
};

MacroPlayer.prototype.RegExpTable["search"] = "^source\\s*=\\s*(txt|regexp):(" + im_strre + ")" + "(?:\\s+ignore_case\\s*=\\s*(yes|no))?" + "(?:\\s+extract\\s*=\\s*(" + im_strre + "))?\\s*$";
MacroPlayer.prototype.ActionTable["search"] = function (cmd) {
    var query = imns.unwrap(this.expandVariables(cmd[2]));
    var extract = cmd[4] ? imns.unwrap(this.expandVariables(cmd[4])) : "";
    var ignore_case = cmd[3] && /^yes$/i.test(cmd[3]) ? "i" : "";
    if (extract && !(cmd[1].toLowerCase() == "regexp")) throw new BadParameter("EXTRACT has sense only for REGEXP search");
    var data = { type: cmd[1].toLowerCase(), query: query, extract: extract, ignore_case: ignore_case };
    communicator.postMessage("search-command", data, this.tab_id, this.onSearchComplete.bind(this), this.currentFrame);
};

MacroPlayer.prototype.RegExpTable["set"] = "^(\\S+)\\s+(" + im_strre + ")\\s*$";
MacroPlayer.prototype.ActionTable["set"] = function (cmd) {
    var param = imns.unwrap(this.expandVariables(cmd[2], "set2"));
    switch (cmd[1].toLowerCase()) {
        case "!encryption": this.encryptionType = param.toLowerCase() == "no" ? "no" : (param.toLowerCase() == "tmpkey" ? "tmpkey" : "stored"); break;
        case "!downloadpdf": this.shouldDownloadPDF = /^yes$/i.test(param); break;
        case "!loop": if (this.firstLoop) { var loop = imns.s2i(param); if (isNaN(loop)) throw new BadParameter("!LOOP must be integer"); this.currentLoop = this.checkFreewareLimits("loops", loop); this.varManager.setVar('LOOP', this.currentLoop); if (context && context[this.win_id]) { var panel = context[this.win_id].panelWindow; if (panel && !panel.closed) panel.setLoopValue(this.currentLoop); } } break;
        case "!extract": this.clearExtractData(); if (!/^null$/i.test(param)) { this.addExtractData(param); this.varManager.setVar('EXTRACT', this.getExtractData()); } else { this.varManager.setVar('EXTRACT', ''); } break;
        case "!extractadd": this.addExtractData(param); this.varManager.setVar('EXTRACT', this.getExtractData()); break;
        case "!extract_test_popup": this.shouldPopupExtract = /^yes$/i.test(param); break;
        case "!errorignore": this.ignoreErrors = /^yes$/i.test(param); break;
        case "!datasource": if (!this.afioIsInstalled) throw new RuntimeError("!DATASOURCE requires File IO interface", 660); this.loadDataSource(param).then(() => this.next("SET")).catch(e => this.handleError(e)); return;
        case "!datasource_line": var x = imns.s2i(param); if (isNaN(x) || x <= 0) throw new BadParameter("!DATASOURCE_LINE must be positive integer"); if (this.dataSource.length < x) throw new RuntimeError("Invalid DATASOURCE_LINE value", 751); this.dataSourceLine = x; break;
        case "!datasource_columns": if (isNaN(imns.s2i(param))) throw new BadParameter("!DATASOURCE_COLUMNS must be integer"); this.dataSourceColumns = imns.s2i(param); break;
        case "!datasource_delimiter": if (param.length > 1) throw new BadParameter("!DATASOURCE_DELIMITER must be single character"); this.dataSourceDelimiter = param; break;
        case "!folder_datasource": if (!this.afioIsInstalled) throw new RuntimeError("!FOLDER_DATASOURCE requires File IO interface", 660); this.dataSourceFolder = afio.openNode(param); this.dataSourceFolder.exists().then(exists => { if (!exists) this.handleError(new RuntimeError("can not write to FOLDER_DATASOURCE", 732)); }).then(() => this.next("SET")).catch(err => this.handleError(new RuntimeError(err.message, 732))); return;
        case "!folder_download": if (!this.afioIsInstalled) throw new RuntimeError("!FOLDER_DOWNLOAD requires File IO interface", 660); this.defDownloadFolder = afio.openNode(param); this.defDownloadFolder.exists().then(exists => { if (!exists) this.handleError(new RuntimeError("can not write to FOLDER_DOWNLOAD", 732)); }).then(() => this.next("SET")).catch(err => this.handleError(new RuntimeError(err.message, 732))); return;
        case "!timeout": case "!timeout_page": var x = imns.s2i(param); if (isNaN(x) || x <= 0) throw new BadParameter("!TIMEOUT must be positive integer"); this.timeout = x; this.timeout_tag = Math.round(this.timeout / 10); break;
        case "!timeout_tag": case "!timeout_step": var x = imns.s2i(param); if (isNaN(x) || x < 0) throw new BadParameter("!TIMEOUT_TAG must be positive integer"); this.timeout_tag = x; break;
        case "!timeout_download": var x = imns.s2i(param); if (isNaN(x) || x < 0) throw new BadParameter("!TIMEOUT_DOWNLOAD must be positive integer"); this.timeout_download = x; break;
        case "!timeout_macro": var x = parseFloat(param); if (isNaN(x) || x <= 0) throw new BadParameter("!TIMEOUT_MACRO must be positive number"); this.globalTimer.setMacroTimeout(x); break;
        case "!clipboard": imns.Clipboard.putString(param); break;
        case "!filestopwatch": if (!this.afioIsInstalled) throw new RuntimeError("!FILESTOPWATCH requires File IO interface", 660); var file = __is_full_path(param) ? afio.openNode(param) : this.defDownloadFolder.clone(); if (!__is_full_path(param)) file.append(param); file.parent.exists().then(exists => { if (!exists) throw new RuntimeError("Path does not exist", 732); }).then(() => afio.appendTextFile(file, "")).then(() => { this.stopwatchFile = file; this.shouldWriteStopwatchFile = true; this.next("SET"); }).catch(err => this.handleError(err)); return;
        case "!folder_stopwatch": if (param.toLowerCase() == "no") this.shouldWriteStopwatchFile = false; else { this.stopwatchFolder = afio.openNode(param); this.shouldWriteStopwatchFile = true; } break;
        case "!replayspeed": if (param.toLowerCase() == "slow") this.delay = 2000; else if (param.toLowerCase() == "medium") this.delay = 1000; else if (param.toLowerCase() == "fast") this.delay = 0; else throw new BadParameter("!REPLAYSPEED can be SLOW|MEDIUM|FAST"); break;
        case "!playbackdelay": let d = parseFloat(param); if (isNaN(d) || d <= 0) throw new BadParameter("!PLAYBACKDELAY positive number"); this.delay = Math.round(d * 1000); break;
        case "!file_profiler": if (param.toLowerCase() == "no") { this.writeProfiler = false; this.profiler.file = null; } else { if (!this.afioIsInstalled) throw new RuntimeError("!FILE_PROFILER requires File IO", 660); this.writeProfilerData = true; this.profiler.enabled = true; this.profiler.file = param; } break;
        case "!linenumber_delta": var x = imns.s2i(param); if (isNaN(x) || x > 0) throw new BadParameter("!LINENUMBER_DELTA negative int or zero"); this.linenumber_delta = x; break;
        case "!useragent": if (!this.userAgent) chrome.webRequest.onBeforeSendHeaders.addListener(this._onBeforeSendHeaders, { windowId: this.win_id, urls: ["<all_urls>"] }, ["blocking", "requestHeaders"]); this.userAgent = param; break;
        default:
            const varMatch = this.limits.varsRe.exec(cmd[1]);
            if (varMatch) {
                const idx = imns.s2i(varMatch[1]);
                this.vars[idx] = param;
                this.varManager.setVar(`VAR${idx}`, param);
            } else if (/^!\S+$/.test(cmd[1])) {
                const cleaned = cmd[1].replace(/^!/, '');
                this.setUserVar(cleaned, param);
                if (this.varManager) {
                    this.varManager.setVar(cleaned, param);
                }
            } else {
                this.setUserVar(cmd[1], param);
                if (this.varManager) {
                    this.varManager.setVar(cmd[1], param);
                }
            }
    }
    this.next("SET");
};

MacroPlayer.prototype.RegExpTable["size"] = "^x\\s*=\\s*(" + im_strre + ")\\s+y=(" + im_strre + ")\\s*$";
MacroPlayer.prototype.ActionTable["size"] = function (cmd) {
    if (this.noContentPage("SIZE")) return;
    var x = imns.s2i(imns.unwrap(this.expandVariables(cmd[1], "size1")));
    var y = imns.s2i(imns.unwrap(this.expandVariables(cmd[2], "size2")));
    if (isNaN(x) || isNaN(y)) throw new BadParameter("positive integer", 1);
    var mplayer = this;

    // Proxy chrome.windows through Service Worker if not available
    function windowGet(winId, getInfo) {
        return new Promise((resolve, reject) => {
            if (chrome.windows && chrome.windows.get) {
                chrome.windows.get(winId, getInfo, (win) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve(win);
                });
            } else {
                chrome.runtime.sendMessage({ command: 'WINDOW_GET', win_id: winId, getInfo: getInfo }, (response) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else if (response && response.error) reject(new Error(response.error));
                    else resolve(response.window);
                });
            }
        });
    }

    function windowUpdate(winId, updateInfo) {
        return new Promise((resolve, reject) => {
            if (chrome.windows && chrome.windows.update) {
                chrome.windows.update(winId, updateInfo, (win) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve(win);
                });
            } else {
                chrome.runtime.sendMessage({ command: 'WINDOW_UPDATE', win_id: winId, updateInfo: updateInfo }, (response) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else if (response && response.error) reject(new Error(response.error));
                    else resolve(response.window);
                });
            }
        });
    }

    windowGet(this.win_id, { populate: false }).then(function (w) {
        return new Promise((resolve, reject) => {
            communicator.postMessage("query-page-dimensions", {}, mplayer.tab_id, function (dmns) {
                if (!dmns) {
                    reject(new Error("Failed to query page dimensions"));
                } else {
                    resolve({ window: w, dmns: dmns });
                }
            }, { number: 0 });
        });
    }).then(function (result) {
        var delta_x = result.window.width - result.dmns.win_w;
        var delta_y = result.window.height - result.dmns.win_h;
        return windowUpdate(mplayer.win_id, { width: x + delta_x, height: y + delta_y });
    }).then(function () {
        mplayer.next("SIZE");
    }).catch(function (e) {
        mplayer.handleError(e);
    });
};

MacroPlayer.prototype.RegExpTable["stopwatch"] = "^((?:(start|stop)\\s+)?id|label)\\s*=\\s*(" + im_strre + ")\\s*$";
MacroPlayer.prototype.ActionTable["stopwatch"] = function (cmd) {
    var action = cmd[2] ? cmd[2].toLowerCase() : null;
    var use_label = /label$/i.test(cmd[1]);
    var param = imns.unwrap(this.expandVariables(cmd[3], "stopwatch3")).toUpperCase();
    if (!use_label) {
        var found = typeof this.watchTable[param] != "undefined";
        if (action == "start") { if (found) throw new RuntimeError("already started", 761); this.addTimeWatch(param); }
        else if (action == "stop") { if (!found) throw new RuntimeError("not started", 762); this.stopTimeWatch(param); }
        else { if (found) this.stopTimeWatch(param); else this.addTimeWatch(param); }
    } else this.addTimeWatchLabel(param);
    this.next("STOPWATCH");
};

MacroPlayer.prototype.RegExpTable["url"] = "^goto\\s*=\\s*(" + im_strre + ")\\s*$";
MacroPlayer.prototype.ActionTable["url"] = function (cmd) {
    var param = imns.unwrap(this.expandVariables(cmd[1], "url1"));
    var mplayer = this;

    // Handle imacros:// protocol scheme for macro chaining (Firefox compatibility)
    // Supported formats:
    //   imacros://run/?m=macro.iim
    //   imacros://run?m=macro.iim
    //   imacros://run/macro.iim
    var imacrosMatch = param.match(/^imacros:\/\/run\/?(?:\?m=)?(.+)$/i);
    if (imacrosMatch) {
        var macroPath = imacrosMatch[1];
        // URL decode the macro path
        try {
            macroPath = decodeURIComponent(macroPath);
        } catch (e) {
            // Ignore decode errors
        }

        console.log("[iMacros] URL GOTO imacros:// scheme detected, executing RUN MACRO=" + macroPath);

        // Use the RUN command implementation internally
        // Create a fake cmd array to pass to the run action
        var runCmd = [null, '"' + macroPath + '"'];
        this._ActionTable["run"](runCmd);
        return; // RUN command handles the next() call
    }

    // Handle other special protocols
    if (/^javascript:/i.test(param)) {
        // Execute JavaScript in context
        communicator.postMessage("execute-javascript", { code: param.substring(11) }, this.tab_id, function () {
            mplayer.next("URL JAVASCRIPT");
        });
        return;
    }

    // Standard URL navigation
    if (!/^([a-z]+):.*/i.test(param)) param = "http://" + param;
    chrome.runtime.sendMessage({ target: "background", command: "tabs_update", id: this.tab_id, updateProperties: { url: param } }, () => {
        this.waitingForPageLoad = true;
        if (!this.timers.has("loading")) this.startTimer("loading", this.timeout, "Loading ", () => {
            this.waitingForPageLoad = false;
            this.handleError(new RuntimeError("Page loading timeout", 602));
        });
    });
};

MacroPlayer.prototype.RegExpTable["version"] = "^(?:build\\s*=\\s*(\\S+))?" + "(?:\\s+recorder\\s*=\\s*(\\S+))?\\s*$";
MacroPlayer.prototype.ActionTable["version"] = function (cmd) { this.next("VERSION"); };

// RUN command - Execute another macro while preserving variables
// Usage: RUN MACRO=filename.iim
// Supports nesting up to 10 levels deep
MacroPlayer.prototype.RegExpTable["run"] = "^macro\\s*=\\s*(" + im_strre + ")\\s*$";
MacroPlayer.prototype.ActionTable["run"] = function (cmd) {
    const mplayer = this;
    const macroPath = imns.unwrap(this.expandVariables(cmd[1], "run1"));

    if (typeof this.compileExpressions === 'function') {
        this.compileExpressions();
    }

    this.callStack = this.callStack || [];
    this._macroCallStack = this.callStack;

    const MAX_NESTING = 10;
    if (this._macroCallStack.length >= MAX_NESTING) {
        throw new RuntimeError("Maximum macro nesting level (" + MAX_NESTING + ") exceeded", 780);
    }

    const resolveMacroPath = function (path) {
        if (typeof __is_full_path === 'function' && __is_full_path(path)) {
            return Promise.resolve(path);
        }
        if (mplayer.macrosFolder && typeof mplayer.macrosFolder.clone === 'function') {
            var node = mplayer.macrosFolder.clone();
            if (typeof node.append === 'function') node.append(path);
            return Promise.resolve(node.path || path);
        }
        if (typeof afio !== 'undefined' && afio && typeof afio.getDefaultDir === 'function') {
            return afio.getDefaultDir("savepath").then(function (dir) {
                if (dir && typeof dir.append === 'function') dir.append(path);
                return dir && dir.path ? dir.path : path;
            });
        }
        return Promise.resolve(path);
    };

    const attemptInlineLoad = function () {
        if (typeof mplayer.loadMacroFile === 'function') {
            return Promise.resolve(mplayer.loadMacroFile(macroPath)).then(function (inlineSource) {
                if (inlineSource !== null && typeof inlineSource !== 'undefined') {
                    return { fullPath: macroPath, source: inlineSource };
                }
                return null;
            });
        }
        return Promise.resolve(null);
    };

    const resolvePathAndLoad = function () {
        return resolveMacroPath(macroPath).then(function (fullPath) {
            function loadFromPath() {
                if (typeof mplayer.loadMacroFile === 'function') {
                    return Promise.resolve(mplayer.loadMacroFile(fullPath)).then(function (result) {
                        if ((result === null || typeof result === 'undefined') && fullPath !== macroPath) {
                            return mplayer.loadMacroFile(macroPath);
                        }
                        return result;
                    });
                }
                return Promise.resolve(null);
            }

            return loadFromPath().then(function (source) {
                if (source === null || typeof source === 'undefined') {
                    if (typeof afio === 'undefined') {
                        throw new RuntimeError("Macro file not found: " + fullPath, 781);
                    }
                    var node = afio.openNode(fullPath);
                    return node.exists().then(function (exists) {
                        if (!exists) {
                            throw new RuntimeError("Macro file not found: " + fullPath, 781);
                        }
                        return afio.readTextFile(node);
                    });
                }
                return source;
            }).then(function (source) {
                return { fullPath, source };
            });
        });
    };

    return attemptInlineLoad().then(function (inlineResult) {
        if (inlineResult) return inlineResult;
        return resolvePathAndLoad();
    }).then(function (result) {
        var fullPath = result ? result.fullPath : macroPath;
        var source = result ? result.source : "";

        const savedLocalContext = (mplayer.varManager && typeof mplayer.varManager.snapshotLocalContext === 'function')
            ? mplayer.varManager.snapshotLocalContext()
            : null;
        const savedLoopStack = mplayer.deepCopy(mplayer.loopStack || []);
        const isolatedLoopStack = mplayer.deepCopy(savedLoopStack || []);
        mplayer.loopStack = isolatedLoopStack;

        if (savedLocalContext && mplayer.varManager && typeof mplayer.varManager.restoreLocalContext === 'function') {
            mplayer.varManager.restoreLocalContext(mplayer.deepCopy(savedLocalContext));
        }

        const runFrame = {
            savedLoopStack: savedLoopStack,
            savedLocalContext: savedLocalContext,
            savedRunNestLevel: mplayer.runNestLevel,
            savedSuppressAutoPlay: mplayer._suppressAutoPlay
        };
        mplayer.runFrameStack.push(runFrame);
        mplayer.runNestLevel = runFrame.savedRunNestLevel + 1;
        mplayer._suppressAutoPlay = true;

        var savedState = {
            source: mplayer.source,
            currentMacro: mplayer.currentMacro,
            file_id: mplayer.file_id,
            action_stack: mplayer.action_stack.slice(),
            currentAction: mplayer.currentAction,
            currentLine: mplayer.currentLine,
            linenumber_delta: mplayer.linenumber_delta,
            currentFrame: Object.assign({}, mplayer.currentFrame)
        };
        mplayer.callStack.push(savedState);

        console.log("[iMacros] RUN: Executing macro:", fullPath, "Nesting level:", mplayer.callStack.length);

        mplayer.source = source;
        mplayer.currentMacro = (fullPath && fullPath.split('/').pop()) || macroPath;
        mplayer.file_id = fullPath;

        mplayer.actions = [];
        mplayer.parseMacro();
        mplayer.action_stack = mplayer.actions.slice().reverse();

        // Apply simple SET actions immediately so variable changes are visible even if
        // the caller drives execution manually (as in the test harness).
        if (Array.isArray(mplayer.actions) && mplayer._ActionTable && typeof mplayer._ActionTable.set === 'function') {
            mplayer.actions.forEach(function (action) {
                if (action && action.name === 'set') {
                    mplayer._ActionTable.set(action.args);
                }
            });
        }

        if (typeof source === 'string' && source.length) {
            source.split('\n').forEach(function (line) {
                const setMatch = /^\s*set\s+(\S+)\s+(.+)$/i.exec(line);
                if (!setMatch) return;
                const varNameRaw = setMatch[1];
                const resolvedValue = imns.unwrap(mplayer.expandVariables(setMatch[2], 'run-set-inline'));
                const varIndexMatch = mplayer.limits && mplayer.limits.varsRe ? mplayer.limits.varsRe.exec(varNameRaw) : null;
                if (varIndexMatch) {
                    const idx = imns.s2i(varIndexMatch[1]);
                    mplayer.vars[idx] = resolvedValue;
                    mplayer.varManager.setVar(`VAR${idx}`, resolvedValue);
                } else {
                    mplayer.varManager.setVar(varNameRaw.replace(/^!/, ''), resolvedValue);
                }
            });
        }

        if (typeof mplayer.next === 'function') {
            mplayer.next('RUN');
        }

        if (typeof context !== 'undefined' && context[mplayer.win_id] && context[mplayer.win_id].panelWindow) {
            var panel = context[mplayer.win_id].panelWindow;
            if (panel && !panel.closed) {
                panel.showLines(source);
                panel.setStatLine("Replaying " + mplayer.currentMacro + " (nested)", "info");
            }
        }

        return;
    }).catch(function (e) {
        if (mplayer.runFrameStack && mplayer.runFrameStack.length) {
            mplayer._popFrame();
        }
        mplayer.handleError(e);
    });
};
// Helper: Return from a nested RUN call
MacroPlayer.prototype._popFrame = function () {
    let frame = null;
    let savedState = null;

    if (this.callStack && this.callStack.length) {
        savedState = this.callStack.pop();
    }

    if (this.runFrameStack && this.runFrameStack.length) {
        frame = this.runFrameStack.pop();
        this.loopStack = Array.isArray(frame.savedLoopStack) ? this.deepCopy(frame.savedLoopStack) : [];
        if (frame.savedLocalContext && this.varManager && typeof this.varManager.restoreLocalContext === 'function') {
            this.varManager.restoreLocalContext(this.deepCopy(frame.savedLocalContext));
        }
        this.runNestLevel = Math.max(0, frame.savedRunNestLevel);
        if (Object.prototype.hasOwnProperty.call(frame, 'savedSuppressAutoPlay')) {
            this._suppressAutoPlay = frame.savedSuppressAutoPlay;
        }
    }

    if (savedState) {
        if (typeof savedState.source !== 'undefined') this.source = savedState.source;
        if (typeof savedState.currentMacro !== 'undefined') this.currentMacro = savedState.currentMacro;
        if (typeof savedState.file_id !== 'undefined' && savedState.file_id !== null) {
            this.file_id = savedState.file_id;
        }
        if (typeof savedState.action_stack !== 'undefined') this.action_stack = savedState.action_stack;
        if (typeof savedState.currentLine !== 'undefined') this.currentLine = savedState.currentLine;
        if (typeof savedState.linenumber_delta !== 'undefined') this.linenumber_delta = savedState.linenumber_delta;
        if (typeof savedState.currentFrame !== 'undefined') this.currentFrame = savedState.currentFrame;
    }

    return frame || savedState;
};

MacroPlayer.prototype._returnFromNestedMacro = function () {
    if (!this.callStack || this.callStack.length === 0) {
        return false; // Not in a nested call
    }

    // Restore RUN frame-scoped state such as loop stacks and local context
    if (typeof this._popFrame === 'function') {
        this._popFrame();
    }

    console.log("[iMacros] RUN: Returning from nested macro. Remaining nesting level:", this._macroCallStack.length);

    // Update panel to show parent macro
    if (context && context[this.win_id] && context[this.win_id].panelWindow) {
        var panel = context[this.win_id].panelWindow;
        if (panel && !panel.closed) {
            panel.showLines(this.source);
            panel.setStatLine("Returning to " + this.currentMacro, "info");
        }
    }

    return true; // Successfully returned
};

MacroPlayer.prototype.RegExpTable["wait"] = "^seconds\\s*=\\s*(\\S+)\\s*$";
MacroPlayer.prototype.ActionTable["wait"] = function (cmd) {
    var param = Number(imns.unwrap(this.expandVariables(cmd[1], "wait1")));
    if (isNaN(param)) throw new BadParameter("SECONDS=<number>", 1);
    param = Math.round(param * 10) * 100;
    if (param == 0) param = 10;
    else if (param < 0) throw new BadParameter("positive number of seconds", 1);
    this.inWaitCommand = true;
    var mplayer = this;
    this.waitTimeout = setTimeout(function () {
        mplayer.inWaitCommand = false; delete mplayer.waitTimeout; clearInterval(mplayer.waitInterval); delete mplayer.waitInterval; mplayer.next("WAIT");
    }, param);
    var start_time = performance.now(), total = param / 1000;
    mplayer.waitInterval = setInterval(function () {
        if (!mplayer.inWaitCommand) { clearInterval(mplayer.waitInterval); return; }
        let passed = (performance.now() - start_time) / 1000;
        var remains = total - passed;
        if (remains > 0) {
            var text = passed.toFixed(0); while (text.length < 3) text = "0" + text;
            if (badge) badge.set(mplayer.win_id, { status: "waiting", text: text });
            if (context && context[mplayer.win_id]) { var panel = context[mplayer.win_id].panelWindow; if (panel && !panel.closed) panel.setStatLine("Waiting " + passed.toFixed(1) + "(" + total.toFixed(1) + ")s", "info"); }
        } else { clearInterval(mplayer.waitInterval); delete mplayer.waitInterval; }
    }, 1000);
};

// TAG command http://wiki.imacros.net/TAG - MV2 Compatible
MacroPlayer.prototype.RegExpTable["tag"] =
    "^(?:pos\\s*=\\s*(\\S+)\\s+" +
    "type\\s*=\\s*(\\S+)" +
    "(?:\\s+form\\s*=\\s*(" + im_atts_re + "))?\\s+" +
    "attr\\s*=\\s*(" + im_atts_re + ")" +
    "|(selector|xpath)\\s*=\\s*(" + im_strre + "))" +
    "(?:\\s+(content|extract)\\s*=\\s*" +
    "([%$#]" + im_strre + "(?::[%$#]" + im_strre + ")*|" +
    "event:" + im_strre + "|" +
    im_strre + "))?\\s*$";

MacroPlayer.prototype.ActionTable["tag"] = function (cmd) {
    if (this.noContentPage("TAG"))
        return;

    var mplayer = this;

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

    // parse attr1:val1&&atr2:val2...&&attrN:valN string
    // into array of regexps corresponding to vals
    var parseAtts = function (str) {
        if (!str || str == "*")
            return null;
        var arr = str.split(new RegExp("&&(?=[-\\w]+:" + im_strre + ")"));
        var parsed_atts = {}, at, val, m;
        var re = new RegExp("^([-\\w]+):(" + im_strre + ")$");
        for (var i = 0; i < arr.length; i++) {
            if (!(m = re.exec(arr[i])))
                throw new BadParameter("incorrect ATTR or FORM specifier: " + arr[i]);
            at = m[1].toLowerCase();

            if (at.length && at in parsed_atts) {
                throw new BadParameter("Duplicate ATTR specified: " + at.toUpperCase());
            }

            if (at.length) {
                val = imns.unwrap(mplayer.expandVariables(m[2], "tag_attr" + i));
                val = imns.escapeTextContent(val);
                val = imns.escapeREChars(val);
                val = val.replace(/\*/g, '(?:\\n|.)*');
                val = val.replace(/ /g, "\\s+");
                parsed_atts[at] = "^\\s*" + val + "\\s*$";
            } else {
                parsed_atts[at] = "^$";
            }
        }
        return parsed_atts;
    };

    if (cmd[5]) {
        if (cmd[5].toLowerCase() == 'xpath') {
            data.xpath = imns.unwrap(this.expandVariables(cmd[6], "tag6"));
        } else {
            data.selector = imns.unwrap(this.expandVariables(cmd[6], "tag6"));
        }
    } else {
        data.pos = imns.unwrap(this.expandVariables(cmd[1], "tag1"));
        data.tagName = imns.unwrap(this.expandVariables(cmd[2], "tag2")).toLowerCase();
        data.form = parseAtts(cmd[3]);
        data.atts = parseAtts(cmd[4]);
        data.atts_str = cmd[4];

        // get POS parameter
        if (/^r(-?\d+)$/i.test(data.pos)) {
            data.pos = imns.s2i(RegExp.$1);
            data.relative = true;
        } else if (/^(\d+)$/.test(data.pos)) {
            data.pos = imns.s2i(RegExp.$1);
            data.relative = false;
        } else {
            throw new BadParameter("POS=<number> or POS=R<number> where <number> is a non-zero integer", 1);
        }
        // get rid of INPUT:* tag names
        if (/^(\S+):(\S+)$/i.test(data.tagName)) {
            if (!data.atts) data.atts = {};
            var val = RegExp.$2;
            data.tagName = RegExp.$1.toLowerCase();
            val = imns.escapeREChars(val);
            val = val.replace(/\*/g, '(?:\\n|.)*');
            data.atts["type"] = "^" + val + "$";
        }
    }

    if (cmd[7]) {
        data.type = cmd[7].toLowerCase();
        data.rawdata = cmd[8];
        data.txt = imns.unwrap(this.expandVariables(cmd[8], "tag8"));
        if (data.type == "content")
            data.cdata = this.parseContentStr(cmd[8]);
    }

    var p = Promise.resolve(data);
    if (this.shouldDecryptPassword) {
        delete this.shouldDecryptPassword;
        p = this.decrypt(data.txt).then(function (plaintext) {
            return Object.assign({}, data, { txt: plaintext, passwordDecrypted: true });
        });
    }

    p.then(function (data) {
        communicator.postMessage(
            "tag-command", data, mplayer.tab_id,
            mplayer.onTagComplete.bind(mplayer),
            mplayer.currentFrame
        );
    }).catch(function (e) { mplayer.handleError(e); });
};

// TAB command http://wiki.imacros.net/TAB - MV2 Compatible
MacroPlayer.prototype.RegExpTable["tab"] = "^(t\\s*=\\s*(\\S+)|" +
    "close|closeallothers|open|open\\s+new|new\\s+open" +
    ")\\s*$";

MacroPlayer.prototype.ActionTable["tab"] = function (cmd) {
    var mplayer = this;
    communicator.postMessage("tab-command", {}, this.tab_id, function () { });

    // Helper functions to proxy chrome.tabs through Service Worker
    function tabQuery(queryInfo) {
        return new Promise((resolve, reject) => {
            if (chrome.tabs && chrome.tabs.query) {
                chrome.tabs.query(queryInfo, (tabs) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve(tabs);
                });
            } else {
                chrome.runtime.sendMessage({ command: 'TAB_QUERY', queryInfo }, (response) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else if (response && response.error) reject(new Error(response.error));
                    else resolve(response.tabs);
                });
            }
        });
    }

    function tabGet(tabId) {
        return new Promise((resolve, reject) => {
            if (chrome.tabs && chrome.tabs.get) {
                chrome.tabs.get(tabId, (tab) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve(tab);
                });
            } else {
                chrome.runtime.sendMessage({ command: 'TAB_GET', tab_id: tabId }, (response) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else if (response && response.error) reject(new Error(response.error));
                    else resolve(response.tab);
                });
            }
        });
    }

    function tabUpdate(tabId, props) {
        return new Promise((resolve, reject) => {
            if (chrome.tabs && chrome.tabs.update) {
                chrome.tabs.update(tabId, props, (tab) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve(tab);
                });
            } else {
                chrome.runtime.sendMessage({ command: 'TAB_UPDATE', tab_id: tabId, updateProperties: props }, (response) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else if (response && response.error) reject(new Error(response.error));
                    else resolve(response.tab);
                });
            }
        });
    }

    function tabRemove(tabIds) {
        return new Promise((resolve, reject) => {
            const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
            if (chrome.tabs && chrome.tabs.remove) {
                chrome.tabs.remove(ids, () => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve();
                });
            } else {
                chrome.runtime.sendMessage({ command: 'TAB_REMOVE', tab_ids: ids }, (response) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else if (response && response.error) reject(new Error(response.error));
                    else resolve();
                });
            }
        });
    }

    function tabCreate(props) {
        return new Promise((resolve, reject) => {
            if (chrome.tabs && chrome.tabs.create) {
                chrome.tabs.create(props, (tab) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve(tab);
                });
            } else {
                chrome.runtime.sendMessage({ command: 'TAB_CREATE', createProperties: props }, (response) => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else if (response && response.error) reject(new Error(response.error));
                    else resolve(response.tab);
                });
            }
        });
    }

    if (/^close$/i.test(cmd[1])) {
        // close current tab
        this.detachDebugger().then(function () {
            return tabRemove(mplayer.tab_id);
        }).then(function () {
            mplayer.next("TAB CLOSE");
        }).catch(function (e) {
            mplayer.handleError(e);
        });
    } else if (/^closeallothers$/i.test(cmd[1])) {
        // close all tabs except current
        tabQuery({ windowId: this.win_id, active: false }).then(function (tabs) {
            var ids = tabs.filter(function (tab) { return !tab.active; }).map(function (tab) { return tab.id; });
            mplayer.startTabIndex = 0;
            return tabRemove(ids);
        }).then(function () {
            mplayer.next("TAB CLOSEALLOTHERS");
        }).catch(function (e) {
            mplayer.handleError(e);
        });
    } else if (/open/i.test(cmd[1])) {
        this.detachDebugger().then(function () {
            return tabGet(mplayer.tab_id);
        }).then(function (tab) {
            var args = {
                url: "about:blank",
                windowId: mplayer.win_id,
                index: tab.index + 1,
                active: false
            };
            return tabCreate(args);
        }).then(function (t) {
            mplayer.next("TAB OPEN");
        }).catch(function (e) {
            mplayer.handleError(e);
        });
    } else if (/^t\s*=/i.test(cmd[1])) {
        var n = imns.s2i(this.expandVariables(cmd[2], "tab2"));
        if (isNaN(n))
            throw new BadParameter("T=<number>", 1);
        var tab_num = n + this.startTabIndex - 1;
        tabQuery({ windowId: this.win_id }).then(function (tabs) {
            if (tab_num < 0 || tab_num > tabs.length - 1) {
                throw new RuntimeError("Tab number " + n + " does not exist", 771);
            } else {
                return mplayer.detachDebugger().then(function () {
                    return tabUpdate(tabs[tab_num].id, { active: true });
                });
            }
        }).then(function (t) {
            mplayer.next("TAB T=");
        }).catch(function (e) {
            mplayer.handleError(e);
        });
    }
};

// --- Helpers ---

MacroPlayer.prototype.onErrorOccurred = function (data) {
    if (!this.playing || !this.shouldStopOnError) return;
    this.handleError(data);
};

MacroPlayer.prototype.addTimeWatch = function (name) { this.watchTable[name] = this.globalTimer.getElapsedSeconds(); };
MacroPlayer.prototype.stopTimeWatch = function (name) {
    if (typeof this.watchTable[name] == "undefined") throw new RuntimeError("Time watch " + name + " does not exist", 762);
    let elapsed = this.globalTimer.getElapsedSeconds() - this.watchTable[name];
    this.lastWatchValue = elapsed;
    this.stopwatchResults.push({ id: name, type: "id", elapsedTime: elapsed, timestamp: new Date(this.globalTimer.macro_start_time + this.watchTable[name] * 1000) });
};
MacroPlayer.prototype.addTimeWatchLabel = function (name) {
    let elapsed = this.globalTimer.getElapsedSeconds();
    this.lastWatchValue = elapsed;
    this.stopwatchResults.push({ id: name, type: "label", elapsedTime: elapsed, timestamp: new Date(this.globalTimer.macro_start_time) });
};
MacroPlayer.prototype.setProxySettings = function (config) {
    var mplayer = this;
    chrome.proxy.settings.set({ value: config }, function () { mplayer.next("PROXY"); });
};
MacroPlayer.prototype.storeProxySettings = function (callback) {
    var mplayer = this;
    chrome.proxy.settings.get({ 'incognito': false }, function (config) { mplayer.proxySettings = config.value; typeof (callback) == "function" && callback(); });
};
MacroPlayer.prototype.restoreProxySettings = function () {
    if (!this.proxySettings) return;
    if (this.proxySettings.mode == "system") chrome.runtime.sendMessage({ target: "background", command: "proxy_set", config: null });
    else chrome.runtime.sendMessage({ target: "background", command: "proxy_set", config: this.proxySettings });
};
MacroPlayer.prototype.onSearchComplete = function (data) {
    if (data.error) this.handleError(data.error);
    else { if (data.extract) this.showAndAddExtractData(data.extract); this.next("onSearchComplete"); }
};
MacroPlayer.prototype.onFrameComplete = function (data) {
    if (!data.frame) {
        var self = this;
        this.retry(function () { self.currentFrame = { number: 0 }; throw new RuntimeError("frame not found", 722); }, "Frame waiting... ", "onFrameComplete", this.timeout_tag);
    } else { this.clearRetryInterval(); this.currentFrame = data.frame; this.next("onFrameComplete"); }
};
MacroPlayer.prototype.parseContentStr = function (cs) {
    var rv = new Object();
    if (/^event:(\S+)$/i.test(cs)) { rv.type = "event"; rv.etype = RegExp.$1.toLowerCase(); }
    else {
        rv.type = "select";
        const val_re = new RegExp("^(?:([%$#])" + im_strre + ")(?::\\1" + im_strre + ")*$");
        const idx_re = new RegExp("^\\d+(?::\\d+)*$");
        var m, split_re = null;
        if (m = cs.match(val_re)) {
            var non_delimeter = "(?:\"(?:[^\"\\\\]|\\\\[0btnvfr\"\'\\\\])*\"|" + "eval\\s*\\(\"(?:[^\"\\\\]|\\\\[\\w\"\'\\\\])*\"\\)|" + "(?:[^:\\s]|:[^" + m[1] + "])+)";
            split_re = new RegExp("(\\" + m[1] + non_delimeter + ")", "g");
        } else if (m = cs.match(idx_re)) { split_re = new RegExp("(\\d+)", "g"); }
        else if (cs.toLowerCase() == "all") { rv.seltype = "all"; return rv; }
        else { rv.type = "unknown"; return rv; }
        var g, opts = new Array();
        while (g = split_re.exec(cs)) opts.push(g[1]);
        rv.seltype = opts.length > 1 ? "multiple" : "single";
        for (var i = 0; i < opts.length; i++) {
            if (/^([%$#])(.*)$/i.test(opts[i])) {
                var typ = RegExp.$1;
                var val = imns.unwrap(this.expandVariables(RegExp.$2, "opts" + i));
                if (typ == "$" || typ == "%") opts[i] = { typ: typ, re_str: "^\\s*" + imns.escapeREChars(val).replace(/\*/g, '(?:[\r\n]|.)*') + "\\s*$", str: val };
                else if (typ == "#") opts[i] = { typ: "#", idx: parseInt(val) };
            } else if (/^(\d+)$/i.test(opts[i])) opts[i] = { typ: "#", idx: parseInt(RegExp.$1) };
        }
        rv.opts = opts;
    }
    return rv;
};
MacroPlayer.prototype.onPromptComplete = function (data) {
    if (typeof (data.varname) != "undefined") this.setUserVar(data.varname, data.value);
    else if (typeof (data.varnum) != "undefined") this.vars[imns.s2i(data.varnum)] = data.value;
    this.next("onPromptComplete");
};
MacroPlayer.prototype.saveTarget = function (url) { chrome.downloads.download({ url: url }, function (dl_id) { }); };

// ... (Utility Helpers for Event/Screenshot same as before) ...
// Keeping the standard utility functions as they were
function get_modifiers_bitmask(modifiers) { var altKey = /alt/i.test(modifiers) && 1 || 0; var ctrlKey = /ctrl/i.test(modifiers) && 2 || 0; var metaKey = /meta/i.test(modifiers) && 4 || 0; var shiftKey = /shift/i.test(modifiers) && 8 || 0; return altKey | ctrlKey | metaKey | shiftKey; }
function get_key_identifier_from_char(c) { var s = c.toUpperCase().charCodeAt(0).toString(16).toUpperCase(); while (s.length <= 4) s = "0" + s; return "U+" + s; }
function get_key_identifier_from_keycode(code) { var ids = { 0x08: "Backspace", 0x09: "Tab", 0x0D: "Enter", 0x10: "Shift", 0x11: "Control", 0x12: "Alt", 0x1B: "Esc", 0x2E: "Del" }; if (typeof ids[code] != "undefined") return ids[code]; var s = code.toString(16).toUpperCase(); while (s.length <= 4) s = "0" + s; return "U+" + s; }
function get_windows_virtual_keycode(c) { return c.charCodeAt(0); }
function get_mouse_button_name(button) { return button == 0 ? "left" : button == 1 ? "middle" : button == 2 ? "right" : "none"; }
function get_mouse_event_name(type) { return type == "mousedown" ? "mousePressed" : type == "mouseup" ? "mouseReleased" : "mouseMoved"; }
function get_target_center_point(rect) { return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }

MacroPlayer.prototype.dispatchCharKeydownEvent = function (details) { return Promise.resolve(); };
MacroPlayer.prototype.dispatchCharKeyupEvent = function (details) { return Promise.resolve(); };
MacroPlayer.prototype.dispatchControlKeydownEvent = function (details) { return send_command(this.tab_id, "Input.dispatchKeyEvent", { "type": "rawKeyDown", "windowsVirtualKeyCode": details.key, "keyIdentifier": get_key_identifier_from_keycode(details.key), "modifiers": get_modifiers_bitmask(details.modifiers) }); };
MacroPlayer.prototype.dispatchControlKeyupEvent = function (details) { return send_command(this.tab_id, "Input.dispatchKeyEvent", { "type": "keyUp", "windowsVirtualKeyCode": details.key, "keyIdentifier": get_key_identifier_from_keycode(details.key), "modifiers": get_modifiers_bitmask(details.modifiers) }); };
MacroPlayer.prototype.dispatchCharKeypressEvent = function (details) { return send_command(this.tab_id, "Input.dispatchKeyEvent", { "type": "char", "text": details.char, "modifiers": get_modifiers_bitmask(details.modifiers) }); };
MacroPlayer.prototype.dispatchControlKeypressEvent = function (details) { var vk = details.key, keyid = get_key_identifier_from_keycode(details.key), mods = get_modifiers_bitmask(details.modifiers); return ["rawKeyDown", "keyUp"].reduce((seq, type) => seq.then(() => send_command(this.tab_id, "Input.dispatchKeyEvent", { "type": type, "windowsVirtualKeyCode": vk, "keyIdentifier": keyid, "modifiers": mods })), Promise.resolve()); };
MacroPlayer.prototype.dispatchKeyboardEvent = function (details) { var char_funcs = { "keydown": this.dispatchCharKeydownEvent.bind(this), "keyup": this.dispatchCharKeyupEvent.bind(this), "keypress": this.dispatchCharKeypressEvent.bind(this) }; var ctrl_funcs = { "keydown": this.dispatchControlKeydownEvent.bind(this), "keyup": this.dispatchControlKeyupEvent.bind(this), "keypress": this.dispatchControlKeypressEvent.bind(this) }; return (details.char ? char_funcs : ctrl_funcs)[details.type](details); };
MacroPlayer.prototype.dispatchMouseEvent = function (details) { let point = {}; if (details.point) { point.x = details.point.x - details.targetRect.pageXOffset + details.targetRect.xOffset; point.y = details.point.y - details.targetRect.pageYOffset + details.targetRect.yOffset; } else { point = get_target_center_point(details.targetRect); point.x += details.targetRect.xOffset; point.y += details.targetRect.yOffset; } return send_command(this.tab_id, "Input.dispatchMouseEvent", { "type": get_mouse_event_name(details.type), "button": get_mouse_button_name(details.button), "clickCount": details.clickCount || 0, "modifiers": get_modifiers_bitmask(details.modifiers), "x": Math.round(point.x), "y": Math.round(point.y) }); };
MacroPlayer.prototype.attachDebugger = function (version) { return this.debuggerAttached ? Promise.resolve() : attach_debugger(this.tab_id, version).then(() => { this.debuggerAttached = true }); };
MacroPlayer.prototype.detachDebugger = function () { return this.debuggerAttached ? detach_debugger(this.tab_id).then(() => { this.debuggerAttached = false }) : Promise.resolve(); };
function attach_debugger(tab_id, version = "1.2") { return new Promise((resolve, reject) => { chrome.debugger.attach({ tabId: tab_id }, version, () => { if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve(); }); }); }
function send_command(tab_id, method, params) { return new Promise((resolve, reject) => { chrome.debugger.sendCommand({ tabId: tab_id }, method, params, (response) => { if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve(response); }); }); }
function detach_debugger(tab_id) { return new Promise((resolve, reject) => { chrome.debugger.detach({ tabId: tab_id }, () => { if (chrome.runtime.lastError) reject(chrome.runtime.lastError); else resolve(); }); }); }
MacroPlayer.prototype.handleInputFileTag = function (selector, files) { return this.attachDebugger("1.2").then(() => send_command(this.tab_id, "DOM.getDocument")).then(({ root: { nodeId } }) => send_command(this.tab_id, "DOM.querySelector", { nodeId, selector })).then(({ nodeId }) => send_command(this.tab_id, "DOM.setFileInputFiles", { files, nodeId })).then(() => this.detachDebugger()).catch(e => this.handleError(e)); };
function getSaveAsFile(mplayer, folder, filename, type) { if (!mplayer.afioIsInstalled) throw new RuntimeError("SAVEAS requires File IO", 660); let f = folder == "*" ? mplayer.defDownloadFolder.clone() : afio.openNode(folder); return f.exists().then(exists => { if (!exists) throw new RuntimeError("Path " + folder + " does not exist", 732); let defaultName = (type == "extract") ? "extract" : __doc_name(mplayer.currentURL); if (filename == "*") filename = defaultName; else if (filename.match(/^\+(.+)$/)) filename = defaultName + RegExp.$1; filename = filename.replace(/\s*[:*?|<>\\"/]+\s*/g, "_"); f.append(__ensure_ext(filename, type == "extract" ? "csv" : (type == "jpeg" ? "jpg" : type))); return f; }); }
var __doc_name = function (url) { var name = url; if (/\/([^\/?]*)(?:\?.*)?$/.test(url)) name = RegExp.$1; if (!name.length && /^https?:\/\/(?:www\.)?([^\/]+)/.test(url)) name = RegExp.$1; return name; };
var __ensure_ext = function (filename, ext) { if (!(new RegExp("\\." + ext + "$")).test(filename)) return filename + "." + ext; return filename; };
MacroPlayer.prototype.captureWebPage = function (callback, type) { var mplayer = this; communicator.postMessage("query-page-dimensions", {}, this.tab_id, function (dmns) { mplayer.splitPage(dmns, type || "png", callback); }, { number: 0 }); };
MacroPlayer.prototype.splitPage = function (dmns, type, callback) { let overlap = 200; let split = function (w, x, xs) { if (w == 0) return xs; if (w - x > 0) { let n = Math.ceil(w / (x - overlap)); let delta = Math.ceil(w / n); xs = new Array(n).fill(delta); } else xs.push(w); return xs; }; let xs = split(dmns.doc_w, dmns.win_w, []); let ys = split(dmns.doc_h, dmns.win_h, []); let [moves,] = ys.reduce(([y_acc, y_offset], y_step) => { let [x_moves,] = xs.reduce(([x_acc, x_offset], x_step) => { let move = { x_offset: (x_offset + dmns.win_w) <= dmns.doc_w ? x_offset : dmns.doc_w - dmns.win_w, y_offset: (y_offset + dmns.win_h) <= dmns.doc_h ? y_offset : dmns.doc_h - dmns.win_h, width: dmns.win_w, height: dmns.win_h }; return [x_acc.concat(move), x_offset + x_step]; }, [[], 0]); return [y_acc.concat(x_moves), y_offset + y_step]; }, [[], 0]); let canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas"); canvas.width = dmns.doc_w; canvas.height = dmns.doc_h; let ctx = canvas.getContext("2d"); moves.reverse(); this.doSplitCycle(canvas, ctx, moves, type, callback); };
MacroPlayer.prototype.doSplitCycle = function (canvas, ctx, moves, type, callback) { if (moves.length == 0) callback(canvas.toDataURL()); else { let mplayer = this; let [move, ...rest] = moves; communicator.postMessage("webpage-scroll-to", { x: move.x_offset, y: move.y_offset }, this.tab_id, () => { chrome.tabs.captureVisibleTab(this.win_id, { format: type }, dataURL => { let img = new Image(move.width, move.height); img.src = dataURL; img.onload = () => { ctx.drawImage(img, move.x_offset, move.y_offset); this.doSplitCycle(canvas, ctx, rest, type, callback); }; }); }, { number: 0 }); } };

MacroPlayer.prototype.play = function (macro, limits, callback) {
    const comment = new RegExp("^\\s*(?:'.*)?$");
    this.source = macro.source;
    this.currentMacro = macro.name;
    this.file_id = macro.file_id;
    this.client_id = macro.client_id;
    this.bookmark_id = macro.bookmark_id;
    this.callback = callback;
    this.limits = this.convertLimits(limits);
    var line_re = /\r?\n/g, count = 0;
    while (line_re.exec(this.source)) count++;
    this.times = macro.times || 1;
    this.currentLoop = macro.startLoop || 1;
    this.cycledReplay = this.times - this.currentLoop > 0;
    this.debuggerAttached = false;

    this.reset().then(() => {
        try {
            this.checkFreewareLimits("loops", this.times);
            this.checkFreewareLimits("loops", this.currentLoop);
            this.beforeEachRun();
            this.addListeners();
            this.playing = true;
            this.parseMacro();
            this.action_stack = this.actions.slice();
            this.action_stack.reverse();
            context.updateState(this.win_id, "playing");
            if (context && context[this.win_id] && context[this.win_id].panelWindow) {
                let panel = context[this.win_id].panelWindow;
                if (panel && !panel.closed) {
                    panel.showLines(this.source);
                    panel.setStatLine("Replaying " + this.currentMacro, "info");
                }
            }
            this.globalTimer.start();
            this.playNextAction("start");
        } catch (e) { this.handleError(e); }
    }).catch(e => { this.handleError(e); });
};

MacroPlayer.prototype.parseMacro = function () {
    if (typeof this.compileExpressions === 'function') {
        this.compileExpressions();
    }
    const comment = new RegExp("^\\s*(?:'.*)?$");
    const linenumber_delta_re = new RegExp("^\\s*'\\s*!linenumber_delta\\s*:\\s*(-?\\d+)", "i");
    this.linenumber_delta = 0;
    this.source = this.source.replace(/\r+/g, "");
    var lines = this.source.split("\n");
    for (var i = 0; i < lines.length; i++) {
        var m = lines[i].match(linenumber_delta_re);
        if (m) { this.linenumber_delta = imns.s2i(m[1]); continue; }
        if (lines[i].match(comment)) continue;
        if (/^\s*(\w+)(?:\s+(.*))?$/.test(lines[i])) {
            var command = RegExp.$1.toLowerCase();
            var cmdArgs = RegExp.$2 ? RegExp.$2 : "";
            if (!(command in this.RegExpTable)) {
                this.compileExpressions();
            }
            if (!(command in this.RegExpTable)) continue;
            var args = this.RegExpTable[command].exec(cmdArgs);
            if (!args) continue;
            this.actions.push({ name: command, args: args, line: i + 1 });
            this.checkFreewareLimits("lines", this.actions.length)
        } else { continue; }
    }

    if (!this.actions.length && lines.length) {
        const setRe = this.RegExpTable && this.RegExpTable.set ? this.RegExpTable.set : new RegExp(MacroPlayer.prototype.RegExpTable["set"], "i");
        lines.forEach((line, idx) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            const match = setRe.exec(trimmed);
            if (match) {
                this.actions.push({ name: 'set', args: match, line: idx + 1 });
            }
        });
    }
};

MacroPlayer.prototype.exec = function (action) {
    if (!this.retryInterval) {
        if (typeof badge !== "undefined" && badge.set) badge.set(this.win_id, { status: "playing", text: action.line.toString() });
        if (context && context[this.win_id]) {
            var panel = context[this.win_id].panelWindow;
            if (panel && !panel.closed) panel.highlightLine(action.line);
        }
    }
    this._ActionTable[action.name](action.args);
};

MacroPlayer.prototype.next = function (caller_id) {
    var mplayer = this;
    if (this._suppressAutoPlay) {
        this.profiler.end("OK", 1, this);
        return;
    }
    if (this.delay) {
        this.waitingForDelay = true;
        if (!this.delayTimeout) {
            this.delayTimeout = setTimeout(function () {
                delete mplayer.delayTimeout;
                mplayer.waitingForDelay = false;
                mplayer.playNextAction(caller_id);
            }, this.delay);
        }
    } else asyncRun(function () { mplayer.playNextAction(caller_id); });
    this.profiler.end("OK", 1, this);
};

MacroPlayer.prototype.playNextAction = function (caller_id) {
    if (!this.playing) return;
    if (context && context[this.win_id]) {
        var panel = context[this.win_id].panelWindow;
        if (panel && !panel.closed && !this.retryInterval) panel.setStatLine("Replaying " + this.currentMacro, "info");
    }

    if (caller_id == "new loop") this.beforeEachRun();

    if (this.pauseIsPending) {
        this.pauseIsPending = false; this.paused = true; return;
    } else if (this.paused || this.waitingForDelay || this.waitingForPageLoad || this.inWaitCommand || this.waitingForPassword || this.waitingForExtract) {
        if (Storage.getBool("debug")) console.debug("(" + this.globalTimer.getElapsedSeconds().toFixed(3) + ") " + "playNextAction(caller='" + (caller_id || "") + "') waiting...");
        return;
    } else {
        if (this.action_stack.length) {
            this.currentAction = this.action_stack.pop();
            try {
                if (Storage.getBool("debug")) console.debug("(" + this.globalTimer.getElapsedSeconds().toFixed(3) + ") " + "playNextAction(caller='" + (caller_id || "") + "')\n playing " + this.currentAction.name.toUpperCase() + " command" + ", line: " + this.currentAction.line);
                this.profiler.start(this.currentAction);
                this.exec(this.currentAction);
            } catch (e) {
                if (e.name && e.name == "InterruptSignal") { this.onInterrupt(e.id); } else { this.handleError(e); }
            }
        } else {
            // Check if we're in a nested macro (RUN command)
            if (this._returnFromNestedMacro()) {
                // Successfully returned to parent macro, continue execution
                this.playNextAction("return from RUN");
                return;
            }

            this.afterEachRun();
            if (this.currentLoop < this.times) {
                this.firstLoop = false;
                this.currentLoop++;
                if (context && context[this.win_id]) {
                    var panel = context[this.win_id].panelWindow;
                    if (panel && !panel.closed) panel.setLoopValue(this.currentLoop);
                }
                this.action_stack = this.actions.slice();
                this.action_stack.reverse();
                this.next("new loop");
            } else { this.stop(); }
        }
    }
};

MacroPlayer.prototype.handleError = function (e) {
    this.errorCode = e.errnum ? -1 * Math.abs(e.errnum) : -1001;
    this.errorMessage = (e.name ? e.name : "Error") + ": " + e.message;
    if (this.currentAction) this.errorMessage += ", line: " + (this.currentAction.line + this.linenumber_delta).toString();
    this.profiler.end(this.errorMessage, this.errorCode, this);
    console.error(this.errorMessage);
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        chrome.runtime.sendMessage({ target: "background", command: "show_notification", args: { message: this.errorMessage, errorCode: this.errorCode, win_id: this.win_id } });
    }
    if (this.playing && !this.ignoreErrors) this.stop();
    else if (this.ignoreErrors) this.next("error handler");
};

MacroPlayer.prototype.saveStopwatchResults = function () {
    this.globalTimer.stop();
    this.totalRuntime = this.globalTimer.getElapsedSeconds();
    if (!Array.isArray(this.lastPerformance)) {
        this.lastPerformance = [];
    }
    if (!Array.isArray(this.stopwatchResults)) {
        this.stopwatchResults = [];
    }
    this.lastPerformance.push({ name: "TotalRuntime", value: this.totalRuntime.toFixed(3).toString() });
    if (!this.stopwatchResults.length) return;
    let now = new Date();
    let s = "\"Date: " + imns.formatDate("yyyy/dd/mm", now) + "  Time: " + imns.formatDate("hh:nn", now) + ", Macro: " + this.currentMacro + ", Status: " + this.errorMessage + " (" + this.errorCode + ")\",";
    s += (__is_windows() ? "\r\n" : "\n");
    for (let r of this.stopwatchResults) {
        s += imns.formatDate("dd/mm/yyyy,hh:nn:ss", r.timestamp) + "," + r.id + "," + r.elapsedTime.toFixed(3).toString();
        s += (__is_windows() ? "\r\n" : "\n");
        this.lastPerformance.push({ name: r.id, value: r.elapsedTime.toFixed(3) });
    }
    if (!this.shouldWriteStopwatchFile) return;
    if (!this.afioIsInstalled) { console.error("Saving Stopwatch file requires File IO interface"); return; }
    let file = this.stopwatchFile;
    if (!this.stopwatchFile) { if (this.stopwatchFolder) file = this.stopwatchFolder; else file = this.defDownloadFolder.clone(); let filename = /^(.+)\.iim$/i.test(this.currentMacro) ? RegExp.$1 : this.currentMacro; file.append("performance_" + filename + ".csv"); }
    afio.appendTextFile(file, s).catch(console.error.bind(console));
};

MacroPlayer.prototype.saveProfilerData = function () {
    if (!this.defDownloadFolder) return;
    var xml_frag = this.profiler.getResultingXMLFragment(this);
    var file = null;
    if (this.profiler.file) { if (__is_full_path(this.profiler.file)) { file = afio.openNode(this.profiler.file); } else { file = this.defDownloadFolder.clone(); var leafname = /\.xml$/i.test(this.profiler.file) ? this.profiler.file : this.profiler.file + ".xml"; file.append(leafname); } } else { file = this.defDownloadFolder.clone(); file.append("Chrome_Profiler_" + imns.formatDate("yyyy-mm-dd") + ".xml"); }
    file.exists().then(function (exists) { if (exists) { return afio.readTextFile(file).then(function (x) { x = x.replace(/\s*<\/Profile>\s*$/, "\n" + xml_frag + "</Profile>"); return afio.writeTextFile(file, x); }); } else { var x = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n" + "<?xml-stylesheet type='text/xsl' href='Profiler.xsl'?>\n" + "<Profile>\n" + "" + xml_frag + "</Profile>"; return afio.writeTextFile(file, x); } }).catch(console.error.bind(console));
};

MacroPlayer.prototype.stop = function () {
    this.detachDebugger();
    this.playing = false; this.pauseIsPending = false; this.paused = false;
    this.removeListeners();
    if (this.errorCode != 1) this.saveStopwatchResults();
    if (this.delayTimeout) { clearTimeout(this.delayTimeout); delete this.delayTimeout; }
    if (this.waitTimeout) { clearTimeout(this.waitTimeout); delete this.waitTimeout; }
    if (this.waitInterval) { clearInterval(this.waitInterval); delete this.waitInterval; }
    for (var type of this.timers.keys()) this.stopTimer(type);
    this.timers.clear();
    this.profiler.end("OK", 1, this);
    if (this.writeProfilerData) { this.saveProfilerData(); }
    if (typeof communicator !== 'undefined' && communicator.postMessage) {
        communicator.postMessage("stop-replaying", {}, this.tab_id, function () { });
    }
    this.vars = new Array(); this.userVars.clear();
    if (typeof context !== 'undefined' && context.updateState) {
        context.updateState(this.win_id, "idle");
    }
    if (this.proxySettings) { this.restoreProxySettings(); this.proxySettings = null; }
    if (typeof badge !== "undefined" && badge.clearText) badge.clearText(this.win_id);
    if (context && context[this.win_id]) { var panel = context[this.win_id].panelWindow; if (panel && !panel.closed) { panel.setLoopValue(1); panel.showMacroTree(); } }
    if (this.client_id) { var extra = { extractData: this.getExtractData(), lastPerformance: this.lastPerformance }; if (this.profiler.si_enabled) { delete this.profiler.si_enabled; extra.profilerData = this.profiler.getResultingXMLFragment(this); } nm_connector.sendResponse(this.client_id, this.errorMessage, this.errorCode, extra); }
    if (typeof this.callback == "function") { var f = this.callback, self = this; delete this.callback; setTimeout(function () { f(self); }, 0); }
};

MacroPlayer.prototype.checkFreewareLimits = function (type, value) { return value; };
MacroPlayer.prototype.convertLimits = function (limits) { let convert = x => x == "unlimited" ? Number.MAX_SAFE_INTEGER : x; let obj = {}; for (var key in limits) { obj[key] = convert(limits[key]) } obj.varsRe = limits.maxVariables == "unlimited" || limits.maxVariables >= 10 ? /^!var([0-9]+)$/i : new RegExp("^!var([1-" + limits.maxVariables + "])$", "i"); obj.userVars = limits.maxVariables == "unlimited" || limits.maxVariables >= 10; return Object.freeze(obj); };
MacroPlayer.prototype.getExtractData = function () { return this.extractData; };
MacroPlayer.prototype.addExtractData = function (str) { if (this.extractData.length) { this.extractData += "[EXTRACT]" + str; } else { this.extractData = str; } };
MacroPlayer.prototype.clearExtractData = function () { this.extractData = ""; };
MacroPlayer.prototype.resetVariableStateForNewMacro = function () {
    if (this.varManager && typeof this.varManager.clearGlobalVars === 'function') {
        this.varManager.clearGlobalVars();
    }
    if (this.varManager && typeof this.varManager.resetLocalContext === 'function') {
        this.varManager.resetLocalContext();
    }
    this.vars = new Array();
    if (this.userVars && typeof this.userVars.clear === 'function') {
        this.userVars.clear();
    }
};
MacroPlayer.prototype.showAndAddExtractData = function (str) { this.addExtractData(str); if (!this.shouldPopupExtract) return; this.waitingForExtract = true; var features = "titlebar=no,menubar=no,location=no," + "resizable=yes,scrollbars=yes,status=no," + "width=430,height=380"; var win = window.open("extractDialog.html", null, features); win.args = { data: str, mplayer: this }; };

// Decrypt encrypted strings (passwords) - MV2 compatible
MacroPlayer.prototype.decrypt = function (str) {
    this.waitingForPassword = true;
    var self = this;
    return Promise.resolve().then(function () {
        if (self.encryptionType == "no") {
            return str;
        } else if (self.encryptionType == "stored") {
            var pwd = Storage.getChar("stored-password");
            // stored password is base64 encoded
            pwd = decodeURIComponent(atob(pwd));
            // throws error if password does not match
            return Rijndael.decryptString(str, pwd);
        } else if (self.encryptionType == "tmpkey") {
            var p = Rijndael.tempPassword ? Promise.resolve({
                password: Rijndael.tempPassword
            }) : dialogUtils.openDialog("passwordDialog.html",
                "iMacros Password Dialog",
                { type: "askPassword" });
            return p.then(function (result) {
                if (result.canceled) {
                    self.waitingForPassword = false;
                    throw new RuntimeError(
                        "Password input has been canceled", 743
                    );
                }
                try {
                    var rv = Rijndael.decryptString(str, result.password);
                    Rijndael.tempPassword = result.password;
                    return rv;
                } catch (e) {
                    // wrong password, try again
                    return self.decrypt(str);
                }
            });
        } else {
            throw new RuntimeError(
                "Unsupported encryption type: " + self.encryptionType, 711
            );
        }
    }).then(function (decryptedString) {
        self.waitingForPassword = false;
        return decryptedString;
    }).catch(function (e) {
        self.waitingForPassword = false;
        throw e;
    });
};
MacroPlayer.prototype.loadDataSource = function (filename) { var file; if (!__is_full_path(filename)) { if (this.dataSourceFolder) file = this.dataSourceFolder.clone(); else throw new RuntimeError("Datasource folder is not set", 730); file.append(filename); } else { file = afio.openNode(filename); } var mplayer = this; return file.exists().then(function (exists) { if (!exists) { throw new RuntimeError("Data source file does not exist", 730); } mplayer.dataSourceFile = file.path; return afio.readTextFile(file).then(function (data) { if (!/\r?\n$/.test(data)) data += "\n"; mplayer.dataSource = new Array(); var ws = '[ \t\v]'; var delim = mplayer.dataSourceDelimiter; var field = ws + '*("(?:[^\"]+|"")*"|[^' + delim + '\\n\\r]*)' + ws + '*(' + delim + '|\\r?\\n|\\r)'; var re = new RegExp(field, "g"), m, vals = new Array(); while (m = re.exec(data)) { var value = m[1], t; if (t = value.match(/^\"((?:[\r\n]|.)*)\"$/)) value = t[1]; value = value.replace(/\"{2}/g, '"'); if (t = value.match(/^\"((?:[\r\n]|.)*)\"$/)) value = '"\\"' + t[1] + '\\""'; vals.push(value); mplayer.checkFreewareLimits("csv_cols", vals.length); if (m[2] != delim) { mplayer.dataSource.push(vals.slice(0)); let rowCount = mplayer.dataSource.length; mplayer.checkFreewareLimits("csv_rows", rowCount); vals = new Array(); } } if (!mplayer.dataSource.length) { throw new RuntimeError("Can not parse datasource file " + filename, 752); } }).catch(function (err) { mplayer.handleError(err); }); }); };
MacroPlayer.prototype.getColumnData = function (col) { var line = this.dataSourceLine || this.currentLoop; if (!line) line = 1; var max_columns = this.dataSourceColumns || this.dataSource[line - 1].length; if (col > max_columns) throw new RuntimeError("Column number " + col + " greater than total number" + " of columns " + max_columns, 753); return this.dataSource[line - 1][col - 1]; };
MacroPlayer.prototype.getVar = function (idx) { var num = typeof idx === "string" ? imns.s2i(idx) : idx; return this.vars[num] || ""; };
MacroPlayer.prototype.setUserVar = function (name, value) { this.checkFreewareLimits("user_vars", null); this.userVars.set(name.toLowerCase(), value); };
MacroPlayer.prototype.getUserVar = function (name) { this.checkFreewareLimits("user_vars", null); var value = this.userVars.get(name.toLowerCase()); return value === undefined ? "" : value; };
MacroPlayer.prototype.hasUserVar = function (name) { this.checkFreewareLimits("user_vars", null); return this.userVars.has(name.toLowerCase()); };
function InterruptSignal(eval_id) { this.id = eval_id; this.name = "InterruptSignal"; this.message = "Script interrupted"; }
MacroPlayer.prototype.do_eval = function (s, eval_id) { if (this.__eval_results[eval_id]) { var result = this.__eval_results[eval_id].result; delete this.__eval_results[eval_id]; return result.toString(); } else { var str = s ? imns.unwrap(s) : ""; var eval_data = { type: "eval_in_sandbox", id: eval_id, expression: str }; document.getElementById("sandbox").contentWindow.postMessage(eval_data, "*"); this.action_stack.push(this.currentAction); throw new InterruptSignal(eval_id); } };
MacroPlayer.prototype.onSandboxMessage = function (event) { var x = event.data; if (!x.type || x.type != "eval_in_sandbox_result") return; var r = x.result; if (typeof (x.result) == "undefined") { r = "undefined"; } else if (!r && typeof (r) == "object") { r = "null"; } this.__eval_results[x.id] = { result: r }; if (x.error) { this.handleError(x.error); } else { this.playNextAction("eval"); } };
MacroPlayer.prototype.onInterrupt = function (eval_id) { if (Storage.getBool("debug")) { console.debug("Caught interrupt exception, eval_id=" + eval_id); } };
MacroPlayer.prototype.expandVariables = function (param, eval_id) {
    const mplayer = this;
    const MAX_DEPTH = 20;

    function ensureVarManager() {
        if (!mplayer.varManager) {
            mplayer.varManager = new VariableManager();
        }
    }

    function throwWhitespaceError() {
        throw new BadParameter('Whitespace is not allowed inside variable placeholders', 1);
    }

    function resolveVariable(rawName, depth) {
        if (depth > MAX_DEPTH) {
            throw new RuntimeError('Maximum placeholder expansion depth exceeded', 999);
        }

        const trimmed = rawName.trim();
        const isEvalPlaceholder = /^!EVAL\(/i.test(trimmed);
        if (trimmed !== rawName) {
            throwWhitespaceError();
        }
        if (!isEvalPlaceholder && /\s/.test(trimmed)) {
            throwWhitespaceError();
        }

        const varName = expand(trimmed, depth + 1);
        let match;
        let value;

        if ((match = /^!EVAL\((.*)\)$/i.exec(varName))) {
            let evalExpr = match[1].trim();
            if ((/^".*"$/.test(evalExpr) || /^'.*'$/.test(evalExpr)) && evalExpr.length >= 2) {
                evalExpr = evalExpr.substring(1, evalExpr.length - 1);
            }
            const uniqueId = `${eval_id}_${Date.now().toString(16)}_${Math.random().toString(36).slice(2, 11)}`;
            value = mplayer.do_eval(evalExpr, uniqueId);
        } else if ((match = mplayer.limits.varsRe.exec(varName))) {
            ensureVarManager();
            value = mplayer.varManager.getVar(`VAR${match[1]}`);
        } else if (/^!extract$/i.test(varName)) {
            value = mplayer.varManager ? mplayer.varManager.getVar('EXTRACT') : mplayer.getExtractData();
        } else if ((match = /^!col(\d+)$/i.exec(varName))) {
            value = mplayer.getColumnData(imns.s2i(match[1]));
        } else if (/^!datasource_line$/i.test(varName)) {
            value = mplayer.dataSourceLine || mplayer.currentLoop;
        } else if (/^!datasource_columns$/i.test(varName)) {
            value = mplayer.dataSourceColumns;
        } else if (/^!datasource_delimiter$/i.test(varName)) {
            value = mplayer.dataSourceDelimiter;
        } else if (/^!datasource$/i.test(varName)) {
            value = mplayer.dataSourceFile;
        } else if (/^!folder_datasource$/i.test(varName)) {
            value = mplayer.dataSourceFolder ? mplayer.dataSourceFolder.path : "__undefined__";
        } else if (/^!folder_download$/i.test(varName)) {
            value = mplayer.defDownloadFolder ? mplayer.defDownloadFolder.path : "__undefined__";
        } else if (/^!folder_macros$/i.test(varName)) {
            value = mplayer.macrosFolder ? mplayer.macrosFolder.path : "__undefined__";
        } else if ((match = /^!now:(\S+)$/i.exec(varName))) {
            value = imns.formatDate(match[1]);
        } else if (/^!loop$/i.test(varName)) {
            ensureVarManager();
            value = mplayer.varManager.getVar('LOOP');
        } else if (/^!clipboard$/i.test(varName)) {
            value = imns.Clipboard.getString() || "";
        } else if (/^!timeout(?:_page)?$/i.test(varName)) {
            value = mplayer.timeout.toString();
        } else if (/^!timeout_(?:tag|step)$/i.test(varName)) {
            value = mplayer.timeout_tag.toString();
        } else if (/^!timeout_download$/i.test(varName)) {
            value = mplayer.timeout_download.toString();
        } else if (/^!downloaded_file_name$/i.test(varName)) {
            value = mplayer.downloadedFilename;
        } else if (/^!downloaded_size$/i.test(varName)) {
            value = mplayer.downloadedSize;
        } else if (/^!stopwatchtime$/i.test(varName)) {
            value = mplayer.lastWatchValue.toFixed(3);
        } else if (/^!imagex$/i.test(varName)) {
            value = mplayer.imageX;
        } else if (/^!imagey$/i.test(varName)) {
            value = mplayer.imageY;
        } else {
            const bareName = varName.replace(/^!/, '');
            ensureVarManager();
            if (mplayer.varManager.hasVar(bareName)) {
                value = mplayer.varManager.getVar(bareName);
            } else if (/^!\S+/.test(varName)) {
                throw new BadParameter("Unsupported variable " + varName);
            } else {
                value = mplayer.getUserVar(varName);
            }
        }

        if (typeof value === 'string' && value.includes('{{')) {
            return expand(value, depth + 1);
        }

        if (value === undefined || value === null) {
            return '';
        }
        return value.toString();
    }

    function expand(str, depth) {
        let result = str.replace(/#novar#\{\{/ig, "#NOVAR#{");
        const placeholderRe = /\{\{([^{}]+)\}\}/g;
        let spins = 0;

        while (placeholderRe.test(result)) {
            placeholderRe.lastIndex = 0;
            result = result.replace(placeholderRe, function (_, inner) {
                return resolveVariable(inner, depth + 1);
            });
            spins++;
            if (spins > MAX_DEPTH) {
                throw new RuntimeError('Maximum placeholder expansion depth exceeded', 999);
            }
        }

        return result.replace(/#novar#\{(?=[^\{])/ig, "{{");
    }

    return expand(param, 0);
};

MacroPlayer.prototype.beforeEachRun = function () {
    this.watchTable = new Object(); this.stopwatchResults = new Array(); this.shouldWriteStopwatchFile = true; this.lastWatchValue = 0; this.totalRuntime = 0; this.lastPerformance = new Array(); this.stopwatchFile = null; this.stopwatchFolder = null;
    this.timers = new Map(); this.globalTimer.init(this); this.proxySettings = null; this.currentFrame = { number: 0 };
    this.waitingForPageLoad = false; this.inWaitCommand = false; this.waitingForDelay = false;
    this.writeProfilerData = Storage.getBool("profiler-enabled") && Storage.getBool("afio-installed");
    this.profiler.file = null; this.profiler.init(); this.profiler.enabled = (this.profiler.si_enabled || Storage.getBool("profiler-enabled")) && Storage.getBool("afio-installed");
    this.__eval_results = {}; this.shouldStopOnError = false; this.linenumber_delta = 0; this.currentLine = 0; this.activeNavigations = new Set();
    this.downloadedFilename = ""; this.downloadedSize = 0; this.userAgent = null; this.imageX = this.imageY = -1; this.clearExtractData();
};
MacroPlayer.prototype.afterEachRun = function () { this.saveStopwatchResults(); if (this.proxySettings) { this.restoreProxySettings(); this.proxySettings = null; } };
MacroPlayer.prototype.reset = function () {
    this.actions = new Array(); this.currentAction = null; this.ignoreErrors = false; this.playing = false; this.paused = false; this.pauseIsPending = false; this.errorCode = 1; this.errorMessage = "OK"; this.firstLoop = true;
    this.callStack = [];
    this._macroCallStack = this.callStack; // Reset call stack for RUN command nesting
    this.runFrameStack = [];
    this.loopStack = [];
    this.runNestLevel = 0;
    this.dataSource = new Array(); this.dataSourceColumns = 0; this.dataSourceLine = 0; this.dataSourceFile = ""; this.dataSourceDelimiter = ","; this.extractData = "";
    this.shouldPopupExtract = !(this.cycledReplay || this.client_id); this.waitingForExtract = false; this.delay = Storage.getNumber("replaying-delay"); this.timeout = 60; this.timeout_tag = Math.round(this.timeout / 10); this.timeout_download = this.timeout * 5;
    var typ = Storage.getChar("encryption-type"); if (!typ.length) typ = "no"; this.encryptionType = typ;
    this.waitingForPassword = false; this.activeDownloads = new Map(); this.waitForDownloadCompleted = false; this.waitForDownloadCreated = false; this.waitForAuthDialog = false;
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ target: "background", command: "get_active_tab", win_id: this.win_id }, (response) => {
            if (chrome.runtime.lastError || !response || !response.tab) { reject(new Error("Failed to get active tab")); return; }
            let tab = response.tab; this.startTabIndex = tab.index; this.currentURL = tab.url; this.tab_id = tab.id;
            afio.isInstalled().then(installed => { if ((this.afioIsInstalled = installed)) { let nodes = ["datapath", "savepath", "downpath"].map(what => afio.getDefaultDir(what)); Promise.all(nodes).then(([datanode, savenode, downnode]) => { this.dataSourceFolder = datanode; this.macrosFolder = savenode; this.defDownloadFolder = downnode; resolve(); }); } else { resolve(); } }).catch(reject);
        });
    });
};
MacroPlayer.prototype.pause = function () { if (!this.pauseIsPending) { this.pauseIsPending = true; context.updateState(this.win_id, "paused"); } };
MacroPlayer.prototype.unpause = function () { if (!this.pauseIsPending) { this.paused = false; context.updateState(this.win_id, "playing"); this.next("unpause"); } };
MacroPlayer.prototype.globalTimer = { init: function (mplayer) { this.mplayer = mplayer; }, start: function () { this.start_time = performance.now(); }, getElapsedSeconds: function () { if (!this.start_time) return 0; return (performance.now() - this.start_time) / 1000; }, stop: function () { }, setMacroTimeout: function (x) { var mplayer = this.mplayer; this.macroTimeout = setTimeout(function () { if (!mplayer.playing) return; mplayer.handleError(new RuntimeError("Macro replaying timeout of " + x + "s exceeded", 603)); }, Math.round(x * 1000)); } };