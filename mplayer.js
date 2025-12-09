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
    if (this.RegExpTable && this.RegExpTable.compiled) return;

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
