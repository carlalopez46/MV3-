/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.

MV2 background/offscreen bridge: preserves original responsibilities for
panel ↔ engine routing while delegating MV3-restricted APIs to the service
worker via explicit messaging.
*/

//
// Config
/* global FileSyncBridge, afio, communicator, dialogUtils */
"use strict";

// Virtual filesystem fallback for RUN and related file lookups when the native
// connector is unavailable. This keeps nested macros working in MV3 by letting
// MacroPlayer pull sources from the chunked VirtualFileService storage.
const virtualFileService = typeof VirtualFileService === "function" ? new VirtualFileService() : null;
let vfsReadyPromise = null;
// Track in-flight play requests per window to avoid duplicate execution.
const playInFlight = new Set();
const recentPlayStarts = new Map();
const DUPLICATE_PLAY_START_WINDOW_MS = 1500;
const DUPLICATE_PLAY_START_MAX_ENTRIES = 200;
const DUPLICATE_PLAY_START_PRUNE_AGE_MS = DUPLICATE_PLAY_START_WINDOW_MS * 4;
const OFFSCREEN_INSTANCE_ID = Math.random().toString(36).slice(2, 8);

if (typeof globalThis.afioCache === "undefined") {
    console.warn("[iMacros Offscreen] afioCache not found, using polyfill that reports not installed");
    globalThis.afioCache = {
        isInstalled: () => Promise.resolve(false)
    };
}

function createRequestId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `off-${OFFSCREEN_INSTANCE_ID}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

console.log('[iMacros Offscreen] Instance ID:', OFFSCREEN_INSTANCE_ID);

// Initialize SecurityManager
if (typeof SecurityManager !== 'undefined' && typeof SecurityManager.init === 'function') {
    SecurityManager.init().then(key => {
        console.info("[offscreen_bg.js] SecurityManager initialized.");
    }).catch(err => {
        console.error("[offscreen_bg.js] Failed to initialize SecurityManager:", err);
    });
}

function notifyAsyncError(win_id, message) {
    if (typeof notifyPanelStatLine === 'function') {
        notifyPanelStatLine(win_id, message, "error");
        return;
    }
    if (typeof showNotification === 'function') {
        showNotification(win_id, { errorCode: 0, message: message });
    }
}

function isDuplicatePlayStart(winId, macroPath, sourceLabel) {
    if (!winId || !macroPath) {
        console.debug(`[iMacros Offscreen] Duplicate play start guard skipped (${sourceLabel})`, {
            winId,
            macroPath
        });
        return false;
    }
    const key = `${winId}:${macroPath}`;
    const now = Date.now();
    const last = recentPlayStarts.get(key);
    if (typeof last === 'number' && now - last < DUPLICATE_PLAY_START_WINDOW_MS) {
        return true;
    }
    return false;
}

function recordPlayStart(winId, macroPath) {
    if (!winId || !macroPath) {
        return;
    }
    const key = `${winId}:${macroPath}`;
    const now = Date.now();
    recentPlayStarts.set(key, now);
    if (recentPlayStarts.size > DUPLICATE_PLAY_START_MAX_ENTRIES) {
        for (const [entryKey, timestamp] of recentPlayStarts.entries()) {
            if (typeof timestamp !== 'number' || now - timestamp > DUPLICATE_PLAY_START_PRUNE_AGE_MS) {
                recentPlayStarts.delete(entryKey);
            }
        }
        while (recentPlayStarts.size > DUPLICATE_PLAY_START_MAX_ENTRIES) {
            const oldestKey = recentPlayStarts.keys().next().value;
            if (!oldestKey) break;
            recentPlayStarts.delete(oldestKey);
        }
    }
}

async function ensureVirtualFileService() {
    if (!virtualFileService) {
        return null;
    }
    if (!vfsReadyPromise) {
        vfsReadyPromise = typeof virtualFileService.init === "function" ? virtualFileService.init() : Promise.resolve();
    }
    return vfsReadyPromise;
}

function installVirtualRunHook() {
    if (!virtualFileService || typeof MacroPlayer === "undefined") {
        return;
    }

    const proto = MacroPlayer.prototype;
    if (proto.loadMacroFile && proto.loadMacroFile.__virtualHookInstalled) {
        return;
    }

    const originalLoader = proto.loadMacroFile;
    proto.loadMacroFile = async function (resolvedPath) {
        await ensureVirtualFileService();
        try {
            const content = await virtualFileService.readTextFile(resolvedPath);
            const name = resolvedPath ? resolvedPath.split(/[\\/]/).pop() : "";
            return {
                name: name || resolvedPath,
                source: content,
                file_id: resolvedPath
            };
        } catch (err) {
            // Fall back to the previous loader or signal failure by returning null
            if (typeof originalLoader === "function") {
                return originalLoader.call(this, resolvedPath);
            }
            return null;
        }
    };
    proto.loadMacroFile.__virtualHookInstalled = true;
}

// Initialize the virtual RUN hook immediately so MacroPlayer can resolve
// nested macros from the virtual filesystem without relying on the native host.
installVirtualRunHook();

// Global handler for panel updates (called from bg_common.js)
window.updatePanels = function () {
    try {
        for (var x in context) {
            var panel = context[x].panelWindow;
            if (panel && !panel.closed) {
                // Locate the tree iframe by id (name is not set in panel.html)
                var iframeEl = panel.document && panel.document.getElementById('tree-iframe');
                var treeFrame = iframeEl ? iframeEl.contentWindow : null;

                if (treeFrame && treeFrame.document) {
                    treeFrame.location.reload();
                }
            }
        }
    } catch (e) {
        console.warn("Failed to update panels in offscreen:", e);
    }
};

// Attempt to register shared handlers that are already loaded via offscreen.html.
(function registerSharedHandlers() {
    const registerFn = window.registerSharedBackgroundHandlers;
    if (typeof registerFn === "function") {
        registerFn(window);
        return;
    }
    console.error("registerSharedBackgroundHandlers is not available; shared background handlers not registered");
})();

// called from panel
function onPanelLoaded(panel, panelWindowId) {
    if (panelWindowId) {
        for (var win_id in context) {
            win_id = parseInt(win_id);
            if (!isNaN(win_id) && context[win_id].panelId === panelWindowId) {
                context[win_id].panelWindow = panel;
                return win_id;
            }
        }
    }

    const contextPanelIds = {};
    for (var id in context) {
        const numId = parseInt(id);
        if (!isNaN(numId) && context[numId]) {
            contextPanelIds[numId] = context[numId].panelId || 'undefined';
        }
    }
    console.error("Can not find windowId for panel %O with panelWindowId %s. Context panelIds: %O",
        panel, panelWindowId, contextPanelIds);
    throw new Error("Can not find windowId for panel!");
}

// EVAL Sandbox handling
const pendingEvalRequests = new Map();

window.addEventListener('message', (event) => {
    const response = event.data;
    if (response.requestId && pendingEvalRequests.has(response.requestId)) {
        const sendResponse = pendingEvalRequests.get(response.requestId);
        pendingEvalRequests.delete(response.requestId);
        sendResponse(response);
    }
});

// Message listener for Offscreen Document
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.target !== 'offscreen') return;

    const type = request.type || request.command;
    const win_id = parseInt(request.win_id || request.windowId);

    if (type === 'CALL_CONTEXT_METHOD') {
        executeContextMethod(win_id, request.method || request.methodName, sendResponse, request.args, request.requestId);
        return true;
    }

    if (type === 'QUERY_STATE') {
        const ctx = context[win_id];
        let state = 'idle';
        const response = { state, success: true };
        if (ctx) {
            if (ctx.recorder && ctx.recorder.recording) {
                response.state = 'recording';
                const recordMode = Storage.getChar("record-mode") || 'conventional';
                response.args = {
                    favorId: Storage.getBool("recording-prefer-id"),
                    cssSelectors: Storage.getBool("recording-prefer-css-selectors"),
                    recordMode: recordMode
                };
                response.frameNumber = ctx.recorder.currentFrameNumber;
            } else if (ctx.mplayer && ctx.mplayer.playing) {
                response.state = 'playing';
            }
        }
        sendResponse(response);
        return true;
    }

    if (type === 'TAB_UPDATED') {
        const ctx = context[win_id];
        if (ctx && ctx.recorder && ctx.recorder.recording) {
            if (typeof ctx.recorder.onTabUpdated === 'function') {
                ctx.recorder.onTabUpdated(request.tab_id);
            }
        }
        return false;
    }

    if (type === 'GET_DIALOG_ARGS' || type === 'getDialogArgs') {
        const tryGetArgs = (attemptsLeft) => {
            if (typeof dialogUtils === 'undefined') {
                sendResponse({ success: false, error: "dialogUtils undefined" });
                return;
            }
            try {
                const args = dialogUtils.getDialogArgs(win_id);
                sendResponse({ success: true, args: args });
            } catch (e) {
                if (attemptsLeft > 0) setTimeout(() => tryGetArgs(attemptsLeft - 1), 200);
                else sendResponse({ success: false, error: e.message });
            }
        };
        tryGetArgs(30);
        return true;
    }

    if (type === 'SET_DIALOG_RESULT' || type === 'setDialogArgs') {
        if (typeof dialogUtils !== 'undefined') {
            if (type === 'SET_DIALOG_RESULT') dialogUtils.setDialogResult(win_id, request.result || request.response);
            else {
                var mockWin = { id: win_id };
                dialogUtils.setArgs(mockWin, request.args);
            }
            sendResponse({ success: true });
        } else {
            sendResponse({ success: false, error: "dialogUtils undefined" });
        }
        return true;
    }

    if (type === 'panelCreated') {
        if (context[win_id]) context[win_id].panelId = request.panelId;
        sendResponse({ success: true });
        return true;
    }

    if (type === 'panelClosed' || request.command === 'panelClosed') {
        const panelId = request.panelId;
        for (let id in context) {
            if (context[id] && context[id].panelId === panelId) {
                delete context[id].panelId;
                delete context[id].panelWindow;
            }
        }
        sendResponse({ success: true });
        return true;
    }

    if (['DOWNLOAD_CREATED', 'DOWNLOAD_CHANGED'].includes(type)) {
        const targetWinIds = win_id ? [win_id] : Object.keys(context);
        for (let target_id of targetWinIds) {
            const ctx = context[target_id];
            if (ctx && ctx.mplayer) {
                if (type === 'DOWNLOAD_CREATED' && ctx.mplayer.onDownloadCreated) ctx.mplayer.onDownloadCreated(request.downloadItem);
                if (type === 'DOWNLOAD_CHANGED' && ctx.mplayer.onDownloadChanged) ctx.mplayer.onDownloadChanged(request.downloadDelta);
            }
        }
        sendResponse({ success: true });
        return true;
    }

    const tabEvents = ['TAB_ACTIVATED', 'TAB_CREATED', 'TAB_REMOVED', 'TAB_MOVED', 'TAB_ATTACHED', 'TAB_DETACHED', 'WEB_NAVIGATION_ERROR', 'WEB_NAVIGATION_COMMITTED'];
    if (tabEvents.includes(type)) {
        for (let id in context) {
            const ctx = context[id];
            if (ctx) {
                const m = ctx.mplayer, r = ctx.recorder;
                if (type === 'TAB_ACTIVATED') { if (m?.onTabActivated) m.onTabActivated(request.activeInfo); if (r?.onActivated) r.onActivated(request.activeInfo); }
                else if (type === 'TAB_CREATED' && r?.onCreated) r.onCreated(request.tab);
                else if (type === 'TAB_REMOVED' && r?.onRemoved) r.onRemoved(request.tabId);
                else if (type === 'TAB_MOVED' && r?.onMoved) r.onMoved(request.tabId, request.moveInfo);
                else if (type === 'TAB_ATTACHED' && r?.onAttached) r.onAttached(request.tabId, request.attachInfo);
                else if (type === 'TAB_DETACHED' && r?.onDetached) r.onDetached(request.tabId, request.detachInfo);
                else if (type === 'WEB_NAVIGATION_ERROR' && m?.onNavigationErrorOccurred) m.onNavigationErrorOccurred(request.details);
                else if (type === 'WEB_NAVIGATION_COMMITTED' && r?.onCommitted) r.onCommitted(request.details);
            }
        }
        sendResponse({ success: true });
        return true;
    }

    if (type === 'FORWARD_MESSAGE' || request.command === 'FORWARD_MESSAGE') {
        if (typeof communicator !== 'undefined') communicator._execHandlers({ topic: request.topic, data: request.data }, request.tab_id, request.win_id, sendResponse);
        else sendResponse({ success: false, error: 'Communicator not available' });
        return true;
    }

    if (type === 'runMacroByUrl' || request.command === 'runMacroByUrl') {
        executeContextMethod(win_id, 'playFile', sendResponse, [request.macroPath]);
        return true;
    }

    if (type === 'reinitFileSystem' || request.command === 'reinitFileSystem') {
        if (typeof afio !== 'undefined' && afio.reinitFileSystem) {
            afio.reinitFileSystem().then(() => sendResponse({ success: true })).catch(err => sendResponse({ success: false, error: err.message }));
        } else sendResponse({ success: false, error: 'afio or reinitFileSystem not available' });
        return true;
    }

    if (type === 'EVAL_REQUEST' || request.command === 'EVAL_REQUEST') {
        pendingEvalRequests.set(request.requestId, sendResponse);
        const frame = document.getElementById('eval_sandbox');
        if (frame?.contentWindow) frame.contentWindow.postMessage(request, '*');
        else { pendingEvalRequests.delete(request.requestId); sendResponse({ success: false, error: "Sandbox frame not found" }); }
        return true;
    }

    if (type === 'CALL_BG_FUNCTION') {
        if (typeof window[request.functionName] === 'function') {
            try {
                const res = window[request.functionName](...(request.args || []));
                if (res && typeof res.then === 'function') res.then(v => sendResponse({ success: true, result: v })).catch(e => sendResponse({ success: false, error: e.message || String(e) }));
                else sendResponse({ success: true, result: res });
            } catch (e) { sendResponse({ success: false, error: e.message || String(e) }); }
        } else sendResponse({ success: false, error: `Function ${request.functionName} not found` });
        return true;
    }

    if (type === 'SAVE_MACRO' || type === 'save') {
        try {
            save(request.macro || request.data, request.overwrite, function (result) {
                if (result && result.error) sendResponse({ success: false, error: result.error });
                else sendResponse({ success: true, result: result });
            });
        } catch (err) { sendResponse({ success: false, error: err.message || String(err) }); }
        return true;
    }

    if (type === 'CHECK_MPLAYER_PAUSED') {
        if (!context[win_id]) {
            context.init(win_id).then(() => {
                sendResponse({ success: true, isPaused: context[win_id]?.mplayer?.paused || false });
            }).catch(e => sendResponse({ success: false, error: e.message }));
            return true;
        }
        sendResponse({ success: true, isPaused: context[win_id]?.mplayer?.paused || false });
        return false;
    }

    if (type === 'PANEL_LOADED') {
        let found = null;
        for (let id in context) if (context[id].panelId === request.panelWindowId) { found = id; break; }
        if (found) sendResponse({ success: true, win_id: parseInt(found) });
        else sendResponse({ success: false, error: 'Context not found' });
        return true;
    }

    if (type === 'PANEL_CLOSING') {
        if (context[win_id]) {
            if (request.panelBox) Storage.setObject("panel-box", request.panelBox);
            context[win_id].panelClosing = true;
        }
        sendResponse({ success: true });
        return true;
    }

    if (type === 'PLAY_MACRO' || type === 'PLAY_MACRO_NOMINAL') {
        getLimits().then(limits => {
            context[win_id].mplayer.play(request.macro, limits);
            sendResponse({ success: true });
        }).catch(e => sendResponse({ success: false, error: e.message }));
        return true;
    }

    if (type === 'GET_PREFERENCE' || type === 'SET_PREFERENCE') {
        try {
            if (type === 'GET_PREFERENCE') {
                let v;
                if (request.valueType === 'string') v = Storage.getChar(request.key);
                else if (request.valueType === 'number') v = Storage.getNumber(request.key);
                else v = Storage.getBool(request.key);
                sendResponse({ success: true, value: v });
            } else {
                if (request.valueType === 'string') Storage.setChar(request.key, request.value);
                else if (request.valueType === 'number') Storage.setNumber(request.key, request.value);
                else Storage.setBool(request.key, request.value);
                sendResponse({ success: true });
            }
        } catch (e) { sendResponse({ success: false, error: e.message }); }
        return true;
    }

    if (type === 'restart-server') {
        sendResponse({ status: "OK" });
        if (nm_connector.currentPipe != request.pipe) {
            nm_connector.stopServer();
            nm_connector.startServer(request.pipe);
            nm_connector.currentPipe = request.pipe;
        }
        return true;
    }

    return false;
});

// Refactored action handler
function handleActionClicked(tab) {
    var win_id = tab.windowId;

    // Defensive check for Storage object
    if (typeof Storage === 'undefined' || !Storage.getBool) {
        console.error('[iMacros Offscreen] Storage object not available yet');
        return;
    }

    if (Storage.getBool("show-updated-badge")) {
        doAfterUpdateAction();
        return;
    }

    // Ensure context is initialized before processing
    var contextPromise = context[win_id] && context[win_id]._initialized
        ? Promise.resolve(context[win_id])
        : context.init(win_id);

    contextPromise.then(function (ctx) {
        var mplayer = ctx.mplayer;
        var recorder = ctx.recorder;

        if (ctx.state === "idle") {
            // MV3: Use panelId instead of panelWindow (DOM reference not available in Offscreen)
            if (!ctx.panelId) {
                openPanel(win_id);
            } else {
                // Panel is open, request Service Worker to close it
                chrome.runtime.sendMessage({
                    command: "closePanel",
                    panelId: ctx.panelId
                });
                delete ctx.panelId;
            }
        } else if (ctx.state === "paused") {
            if (mplayer.paused) {
                // Switch to the tab where macro was paused before unpausing
                if (ctx.pausedTabId && chrome.tabs && chrome.tabs.update) {
                    chrome.tabs.update(ctx.pausedTabId, { active: true }, function () {
                        if (chrome.runtime.lastError) {
                            logError("Failed to switch to paused tab: " + chrome.runtime.lastError.message, { pausedTabId: ctx.pausedTabId });
                        }
                        mplayer.unpause();
                    });
                } else {
                    mplayer.unpause();
                }
            }
        } else {
            if (mplayer.playing) {
                mplayer.stop();
            } else if (recorder && recorder.recording) {
                console.log(`[offscreen_bg] Saving macro. Recorder actions: ${recorder.actions ? recorder.actions.length : 'undefined'}`);
                // Actions must be copied BEFORE calling stop(), as stop() clears the actions array
                var recorded_actions = (recorder.actions || []).slice();
                recorder.stop();
                var recorded_macro = recorded_actions.join("\n");
                var macro = {
                    source: recorded_macro, win_id: win_id,
                    name: "#Current.iim"
                };

                console.log('[iMacros MV3] Recording stopped, saving macro with', recorded_actions.length, 'actions');

                var treeType = Storage.getChar("tree-type");

                if (treeType === "files") {
                    afioCache.isInstalled().then(function (installed) {
                        if (installed) {
                            afio.getDefaultDir("savepath").then(function (node) {
                                node.append("#Current.iim");
                                macro.file_id = node.path;
                                console.log('[iMacros MV3] Saving #Current.iim to Files tab at:', node.path);

                                afio.writeTextFile(node, recorded_macro).then(function () {
                                    console.log('[iMacros MV3] #Current.iim saved successfully');
                                    edit(macro, true);
                                }).catch(function (err) {
                                    logError('Failed to write #Current.iim: ' + err.message, {
                                        context: 'recording_stop',
                                        path: node.path,
                                        error: err
                                    });
                                    edit(macro, true);
                                });
                            }).catch(function (err) {
                                logError('Failed to get save path for #Current.iim: ' + err.message, {
                                    context: 'recording_stop',
                                    tree_type: 'files',
                                    error: err
                                });
                                console.warn('[iMacros MV3] Falling back to bookmark save for #Current.iim');
                                delete macro.file_id;
                                save(macro, true, function () {
                                    edit(macro, true);
                                });
                            });
                        } else {
                            console.log('[iMacros MV3] File system unavailable, saving #Current.iim to bookmarks');
                            save(macro, true, function () {
                                edit(macro, true);
                            });
                        }
                    }).catch(function (err) {
                        logError('Failed to check file system installation: ' + err.message, {
                            context: 'recording_stop',
                            tree_type: 'files',
                            error: err
                        });
                        console.warn('[iMacros MV3] Falling back to bookmark save for #Current.iim');
                        save(macro, true, function () {
                            edit(macro, true);
                        });
                    });
                } else {
                    console.log('[iMacros MV3] Saving #Current.iim to Bookmarks tab');
                    save(macro, true, function () {
                        edit(macro, true);
                    });
                }
            }
        }
    }).catch(err => {
        logError("Failed to initialize context in action.onClicked: " + err.message, { win_id: win_id });
    });
}

// Helper for opening a new tab (single authoritative definition)
function addTab(url, win_id) {
    var args = { url: url };
    if (win_id)
        args.windowId = parseInt(win_id);

    chrome.tabs.create(args, function (tab) {
        if (chrome.runtime.lastError) {
            console.error("Error creating tab:", chrome.runtime.lastError);
        }
    });
}

function showInfo(args) {
    var win_id = args.win_id;

    // Ensure context is initialized before showing info
    var contextPromise = context[win_id] && context[win_id]._initialized
        ? Promise.resolve(context[win_id])
        : context.init(win_id);

    contextPromise.then(function (ctx) {
        ctx.info_args = args;
        // MV3: Send message to panel instead of direct access
        // We check if panelId exists, but we can't check if window is actually open/closed synchronously
        if (ctx.panelId) {
            chrome.runtime.sendMessage({
                type: 'PANEL_SHOW_INFO',
                panelWindowId: ctx.panelId,
                data: { args: args }
            }, function (response) {
                if (chrome.runtime.lastError || !response || !response.success) {
                    // Panel might be closed or not listening, fall back to notification
                    // Request Service Worker to show notification
                    chrome.runtime.sendMessage({
                        command: "showNotification",
                        notificationId: win_id.toString(),
                        options: {
                            type: "basic",
                            title: (args.errorCode == 1 ? "iMacros" : "iMacros Error"),
                            message: args.message,
                            iconUrl: "skin/logo48.png",
                            isClickable: true
                        }
                    });
                }
            });
        } else {
            // Request Service Worker to show notification
            chrome.runtime.sendMessage({
                command: "showNotification",
                notificationId: win_id.toString(),
                options: {
                    type: "basic",
                    title: (args.errorCode == 1 ? "iMacros" : "iMacros Error"),
                    message: args.message,
                    iconUrl: "skin/logo48.png",
                    isClickable: true
                }
            });
        }
    }).catch(err => {
        logError("Failed to initialize context in showInfo: " + err.message, { win_id: win_id });
    });
}


function addSampleBookmarkletMacro(name, parentId, content) {
    return new Promise(function (resolve, reject) {
        chrome.bookmarks.getChildren(parentId, function (a) {
            if (chrome.runtime.lastError) {
                logError("Failed to get bookmark children in addSampleBookmarkletMacro: " + chrome.runtime.lastError.message, { parentId: parentId, name: name });
                return reject(chrome.runtime.lastError);
            }
            // Check if sample macro with this name already exists
            var existingMacro = null;
            for (var x of a) {
                if (x.title == name) {
                    existingMacro = x;
                    break;
                }
            }

            if (existingMacro) {
                // Auto-overwrite sample macros to keep them up-to-date
                // Service workers don't support confirm() dialog
                console.log("[iMacros] Updating existing sample macro: " + name);
                createBookmark(
                    parentId, name,
                    makeBookmarklet(name, content),
                    existingMacro.id,
                    true  // Explicit overwrite (ignored when bookmark_id is set, but clarifies intent)
                ).then(resolve, reject);
            } else {
                // No existing macro, create a new one
                createBookmark(
                    parentId, name,
                    makeBookmarklet(name, content),
                    null,
                    false
                ).then(resolve, reject);
            }
        });
    });
}

function xhr(path) {
    let url = chrome.runtime.getURL(path)
    return fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
            }
            return response.text()
        })
}









// regexp to update bookmarked macros to newer version (e_m64)
var strre = "(?:[^\"\\\\]|\\\\[0btnvfr\"\'\\\\])+";
var bm_update_re = new RegExp('^javascript\\:\\(function\\(\\) ' +
    '\\{try\\{var ((?:e_)?m(?:64)?) = "(' + strre + ')"' +
    ', (n(?:64)?) = "(' + strre + ')";' +
    '.+;evt\.initEvent');
// recursive function which walks through bookmarks tree
function updateBookmarksTree(tree) {
    if (!tree)
        return;

    tree.forEach(function (x) {
        if (x.url) {
            var match = bm_update_re.exec(x.url);
            if (match) {
                var source, name;
                switch (match[1]) {
                    case "m":
                        source = decodeURIComponent(imns.unwrap(match[2]));
                        break;
                    case "m64": case "e_m64":
                        source = decodeURIComponent(atob(match[2]));
                        break;
                }
                if (match[3] == "n") {
                    name = decodeURIComponent(match[4]);
                } else if (match[3] == "n64") {
                    name = decodeURIComponent(atob(match[4]));
                }
                chrome.bookmarks.update(
                    x.id, { url: makeBookmarklet(name, source) },
                    function () {
                        if (chrome.runtime.lastError) {
                            logError("Failed to update bookmark in updateBookmarksTree: " + chrome.runtime.lastError.message, { bookmark_id: x.id });
                        }
                    }
                );
            }
        } else {
            updateBookmarksTree(x.children);
        }
    });
}


function doAfterUpdateAction() {
    Storage.setBool("show-updated-badge", false);
    // chrome.windows is not available in Offscreen Document
    if (typeof chrome.windows !== 'undefined' && chrome.windows.getAll) {
        chrome.windows.getAll({ populate: false }, function (ws) {
            if (chrome.runtime.lastError) {
                logError("Failed to get all windows in doAfterUpdateAction: " + chrome.runtime.lastError.message);
                return;
            }
            if (ws) {
                ws.forEach(function (win) {
                    badge.clearText(win.id);
                });
            }
        });
    } else {
        console.log('[iMacros] chrome.windows not available - skipping badge clear in doAfterUpdateAction');
    }
    // open update page
    link(getRedirFromString("updated"));
    // Auto-install demo macros to keep them up-to-date
    // Service workers don't support confirm() dialog
    console.log("[iMacros] Installing latest versions of demo macros");
    // update bookmarked macros for newer version if any
    if (typeof chrome.bookmarks !== 'undefined' && chrome.bookmarks.getTree) {
        chrome.bookmarks.getTree(function (tree) {
            if (chrome.runtime.lastError) {
                logError("Failed to get bookmark tree in doAfterUpdateAction: " + chrome.runtime.lastError.message);
                return;
            }
            updateBookmarksTree(tree);
        });
    } else {
        console.warn('[iMacros] chrome.bookmarks API not available, skipping bookmarks update');
    }
    installSampleBookmarkletMacros().then(function () {
        return afioCache.isInstalled().then(function (installed) {
            return installed ?
                installSampleMacroFiles()
                    .then(installAddressCsv)
                    .then(installProfilerXsl)
                : Promise.resolve();
        });
    }).catch(console.error.bind(console));
}

//制限解除
function getLimits() {
    let defaultLimits = {
        maxVariables: 99999,
        maxCSVRows: 99999,
        maxCSVCols: 99999,
        maxMacroLen: 99999,
        maxIterations: 99999
    }

    return afioCache.isInstalled().then(
        installed => {
            if (installed) {
                return afio.queryLimits().then(limits => {
                    // Merge limits with defaultLimits to ensure all fields are present
                    // queryLimits might only return storage limits, not execution limits
                    return Object.assign({}, defaultLimits, limits);
                }).catch(() => defaultLimits)
            } else {
                return defaultLimits
            }
        })
}

function isPersonalVersion() {
    return getLimits()
        //制限解除
        .then(limits =>
            Object.values(limits).every(x => x === "unlimited")
            //return Promise.resolve(true);
        )
}



// MV3 Service Worker Initialization
// Note: Service workers don't have window.load events or chrome.windows.getCurrent().
// Context is initialized lazily when needed (via context.init() calls throughout the code)
// and automatically when windows are created (via chrome.windows.onCreated listener in context.js)

// Validate required global objects
// NOTE: This check verifies that all required dependencies are available.
// In MV3 service worker environments, variables declared with 'const' or 'let'
// at the top level won't appear in globalThis, so we also check the global scope
// directly. All dependencies should be declared with 'var' or 'function', or
// explicitly assigned to globalThis to ensure they're accessible.
(function () {
    const requiredGlobals = [
        'Storage', 'context', 'imns', 'afio',
        'communicator', 'badge', 'nm_connector',
        'Rijndael', 'ErrorLogger'
    ];

    // Some dependencies are defined with top-level const, which are not exposed on
    // globalThis/window. Provide explicit lexical checks so the validation logic
    // does not incorrectly report them as missing.
    const lexicalChecks = {
        context: () => typeof context !== 'undefined',
        communicator: () => typeof communicator !== 'undefined',
        badge: () => typeof badge !== 'undefined',
        nm_connector: () => typeof nm_connector !== 'undefined'
    };

    const missingGlobals = [];
    const presentGlobals = [];

    // Helper function to safely check if a global exists
    // MV3: Cannot use eval() or new Function() in extension pages
    // We rely on globalThis/self which cover all globals declared with var/function
    function globalExists(name) {
        if (lexicalChecks[name]) {
            try {
                if (lexicalChecks[name]()) {
                    return true;
                }
            } catch (e) {
                // Ignore ReferenceError and continue with other checks
            }
        }

        // Check globalThis first (works for var/function declarations)
        if (typeof globalThis !== 'undefined' && typeof globalThis[name] !== 'undefined') {
            return true;
        }

        // In service worker context, also check self
        if (typeof self !== 'undefined' && typeof self[name] !== 'undefined') {
            return true;
        }

        // In window context, check window
        if (typeof window !== 'undefined' && typeof window[name] !== 'undefined') {
            return true;
        }

        // If not found via globalThis/self/window, assume not available
        // Note: const/let at module scope won't appear on globalThis, but all our
        // dependencies are declared with var or function, so this should be sufficient
        return false;
    }

    for (const name of requiredGlobals) {
        if (globalExists(name)) {
            presentGlobals.push(name);
        } else {
            missingGlobals.push(name);
        }
    }

    if (missingGlobals.length > 0) {
        console.error(`[iMacros CRITICAL] Missing global objects: ${missingGlobals.join(', ')}`);
        console.error('[iMacros] This may indicate a script loading order issue or missing dependency.');
    } else {
        console.log('[iMacros MV3] All required global objects are present:', presentGlobals.join(', '));
    }
})();

// Ensure context is initialized
(async function ensureContextInitialized() {
    // context object itself should be defined by context.js
    if (typeof context === 'undefined') {
        console.error('[iMacros CRITICAL] context object not defined. context.js might not be loaded.');
        return;
    }

    // Check if context.init is available
    if (typeof context.init !== 'function') {
        console.error('[iMacros CRITICAL] context.init is not a function.');
        return;
    }

    console.log('[iMacros MV3] context global object verified.');
})();

// listen to run-macro command from content script
// Handler will check if context is initialized before processing
communicator.registerHandler("run-macro", function (data, tab_id) {
    chrome.tabs.get(tab_id, function (t) {
        if (chrome.runtime.lastError) {
            logError("Failed to get tab in run-macro handler: " + chrome.runtime.lastError.message, { tab_id: tab_id });
            return;
        }
        if (!t) {
            logWarning("Tab not found in run-macro handler", { tab_id: tab_id });
            return;
        }
        var w_id = t.windowId;

        // Ensure context is initialized before processing
        var contextPromise = context[w_id] && context[w_id]._initialized
            ? Promise.resolve(context[w_id])
            : context.init(w_id);

        contextPromise.then(function (ctx) {
            // ★修正: マクロ再生中の二重実行を防止
            if (ctx.mplayer && ctx.mplayer.playing) {
                console.warn('[iMacros Offscreen] run-macro ignored: macro already playing', { win_id: w_id });
                return;
            }
            // Note: We only use mplayer.playing check here, not playInFlight,
            // because run-macro doesn't have a completion callback to clear playInFlight.
            // playInFlight is used by playFile and runMacroByUrl which have proper lifecycle management.

            if (Storage.getBool("before-play-dialog")) {
                data.win_id = w_id;
                dialogUtils.openDialog("beforePlay.html", "iMacros", data, { width: 400, height: 140 })
                    .catch(err => {
                        logError("Failed to open before play dialog: " + err.message, { win_id: w_id });
                    });
            } else {
                getLimits().then(
                    limits => asyncRun(function () {
                        context[w_id].mplayer.play(data, limits);
                    })
                ).catch(err => {
                    logError("Failed to get limits or play macro in run-macro handler: " + err.message, { win_id: w_id });
                });
            }
        }).catch(err => {
            logError("Failed to initialize context in run-macro handler: " + err.message, { win_id: w_id });
        });
    });
});




// Override edit function to use message passing for MV3
// This replaces the window.open based implementation from bg.js which doesn't work in Offscreen Document
globalScope.edit = function (macro, overwrite, line) {
    console.log("[iMacros Offscreen] Requesting Service Worker to open editor for:", macro.name);
    console.log("[iMacros Offscreen] Macro source length:", macro.source ? macro.source.length : "undefined");

    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        console.error("[iMacros Offscreen] chrome.runtime messaging not available");
        return;
    }

    const editorData = {
        "currentMacroToEdit": macro,
        "editorOverwriteMode": overwrite,
        "editorStartLine": line || 0
    };

    // Helper to send message
    const sendOpenEditorMessage = (data) => {
        chrome.runtime.sendMessage({
            command: "openEditorWindow",
            editorData: data
        }, (response) => {
            if (chrome.runtime.lastError || (response && response.success === false)) {
                const errorMsg = (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
                    (response && response.error) ||
                    "Unknown error opening editor";

                console.error("[iMacros Offscreen] Failed to open editor:", errorMsg);
                return;
            }
            // Success - editor window opened
            console.log("[iMacros Offscreen] Editor window requested successfully");
        });
    };

    // Safely check for storage availability
    let storage = null;
    try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            if (chrome.storage.session) storage = chrome.storage.session;
            else if (chrome.storage.local) storage = chrome.storage.local;
        }
    } catch (e) {
        console.error("[iMacros Offscreen] Error accessing chrome.storage properties:", e);
    }

    if (!storage) {
        console.warn("[iMacros Offscreen] No storage backend available/accessible in Offscreen. Relying on Background persistence.");
        sendOpenEditorMessage(editorData);
    } else {
        try {
            storage.set(editorData, () => {
                if (chrome.runtime.lastError) {
                    console.error("[iMacros Offscreen] Failed to save editor data to storage:", chrome.runtime.lastError.message);
                } else {
                    console.log("[iMacros Offscreen] Editor data saved to storage. Opening window...");
                }
                // Send message regardless of storage result (background.js might also try to save, which is fine)
                sendOpenEditorMessage(editorData);
            });
        } catch (e) {
            console.error("[iMacros Offscreen] Exception writing to storage:", e);
            sendOpenEditorMessage(editorData);
        }
    }
};

// Override save function if needed (bg.js implementation usually works if it uses message passing/afio, but let's be sure)
// Actually bg.js 'save' delegates to 'save_file' or 'saveToBookmark'.
// 'save_file' uses 'afio' which works in Offscreen.
// 'saveToBookmark' uses chrome.bookmarks which might NOT work in Offscreen (Wait, Offscreen HAS bookmarks permission? Yes usually).
// Let's check chrome.bookmarks access. It is available in Offscreen documents since Chrome 110+.
// So bg.js 'save' might work fine, except for the 'saveAs' dialog which uses window.open.
// If 'save' needs to open a dialog (e.g. valid file_id not present), it will fail.
// But valid file_id should be present for existing files.
// For new files (recording), we might need to handle 'save' carefully.


// Wait for localStorage cache to load before running startup checks
// This prevents bg.js from seeing empty cache and incorrectly treating every startup as first install
(async function () {
    try {
        // Ensure localStorage is initialized
        if (globalThis.localStorageInitPromise) {
            await globalThis.localStorageInitPromise;
            console.log('[iMacros] localStorage cache ready, running startup checks');
        } else {
            console.log('[iMacros] localStorage polyfill already available');
        }
    } catch (err) {
        logError('Failed to initialize localStorage: ' + err.message);
        console.error('[iMacros] localStorage initialization error:', err);
    }

    // Verify Storage object is available before proceeding
    if (typeof Storage === 'undefined' || !Storage.getBool) {
        logError('CRITICAL: Storage object is not properly initialized');
        console.error('[iMacros CRITICAL] Storage.getBool not available');
        return;
    }

    // check if it is the first run
    if (!Storage.getBool("already-installed")) {
        Storage.setBool("already-installed", true);
        setDefaults();
        // get version number (safe for Offscreen Document)
        try {
            if (typeof chrome.runtime.getManifest === 'function') {
                Storage.setChar("version", chrome.runtime.getManifest().version);
            } else {
                Storage.setChar("version", "10.1.1"); // Fallback version
            }
        } catch (e) {
            console.warn("[iMacros] Failed to get manifest version:", e);
            Storage.setChar("version", "10.1.1");
        }
        installSampleBookmarkletMacros().catch(console.error.bind(console));
        // open welcome page (via Service Worker if tabs API not available)
        if (typeof chrome.tabs !== 'undefined' && chrome.tabs.create) {
            chrome.tabs.create({
                url: getRedirFromString("welcome")
            }, function (tab) {
                if (chrome.runtime.lastError) {
                    console.error("Error creating welcome tab:", chrome.runtime.lastError);
                }
            });
        } else {
            // In Offscreen Document, request Service Worker to open the tab
            chrome.runtime.sendMessage({
                command: 'openTab',
                url: getRedirFromString("welcome")
            }).catch(err => {
                console.warn('[iMacros] Failed to request welcome tab creation:', err);
            });
        }
    } else {
        // chrome.runtime.getManifest is not available in Offscreen Document
        if (typeof chrome.runtime.getManifest === 'function') {
            var version = chrome.runtime.getManifest().version;
            // check if macro was updated
            if (version != Storage.getChar("version")) {
                Storage.setChar("version", version);
                onUpdate();
            }
        } else {
            console.log("[iMacros] chrome.runtime.getManifest not available in Offscreen Document, skipping version check");
        }
    }

    // set default directories
    if (!Storage.getBool("default-dirs-set")) {
        afioCache.isInstalled().then(function (installed) {
            if (!installed)
                return;
            var dirs = ["datapath", "savepath", "downpath"];
            return dirs.reduce(function (seq, d) {
                return seq.then(function () {
                    return afio.getDefaultDir(d).then(function (node) {
                        Storage.setChar("def" + d, node.path);
                        return ensureDirectoryExists(node);
                    });
                });
            }, Promise.resolve()).then(installSampleMacroFiles)
                .then(installAddressCsv)
                .then(installProfilerXsl)
                .then(function () {
                    Storage.setBool("default-dirs-set", true);
                });
        }).catch(console.error.bind(console));
    }

    // Note: Native messaging server is started unconditionally for file system access.
    // The server (iMacrosApp or afio.exe) handles file operations and is required
    // for features like SAVEAS, file-based macros, and CSV operations.
    nm_connector.startServer();

    // Set afio-installed
    afioCache.isInstalled().then(function (installed) {
        Storage.setBool("afio-installed", installed);
    }).catch(err => {
        logError("Failed to check afio installation status: " + err.message);
        Storage.setBool("afio-installed", false);
    });

})();


function showNotification(win_id, args) {
    var opt = {
        type: "basic",
        title: (args.errorCode == 1 ? "iMacros" : "iMacros Error"),
        message: args.message,
        iconUrl: "skin/logo48.png",
        isClickable: true,
        priority: 2
    };

    // MV3 Fix: Proxy notification to Service Worker
    chrome.runtime.sendMessage({
        target: "background",
        command: "showNotification",
        notificationId: win_id.toString(),
        options: opt
    }, function (response) {
        if (chrome.runtime.lastError) {
            console.error("[Offscreen] Failed to send notification request:", chrome.runtime.lastError);
        }
    });
}

// Global notification click listener
if (chrome.notifications && chrome.notifications.onClicked) {
    chrome.notifications.onClicked.addListener(function (n_id) {
        var w_id = parseInt(n_id);
        if (isNaN(w_id) || !context[w_id] || !context[w_id].info_args)
            return;
        var info = context[w_id].info_args;
        if (info.errorCode == 1)
            return;    // we have plain Info message; nothing to do

        // for error messages since we have only one 'button'
        // we most probably want look at macro code,
        edit(info.macro, true);
    });
} else {
    console.log("[iMacros] chrome.notifications API not available in Offscreen Document");
}

// NOTE: showInfo function is already defined above (around line 980)
// Do not duplicate it here

// MV3 Note: Service workers don't have "unload" events.
// nm_connector.stopServer() doesn't need explicit calling in service workers.
// However, resource cleanup (dockInterval, panelWindow) is handled via
// chrome.windows.onRemoved listener below and in context.js.

// remove panel when its parent window is closed
// remove panel when its parent window is closed
if (typeof chrome.windows !== 'undefined' && chrome.windows.onRemoved) {
    chrome.windows.onRemoved.addListener(function (win_id) {
        if (!context[win_id])
            return;
        var panel = context[win_id].panelWindow;
        if (panel && !panel.closed) {
            panel.close();
        }
        // Clear dock interval to prevent memory leak
        if (context[win_id].dockInterval) {
            clearInterval(context[win_id].dockInterval);
            context[win_id].dockInterval = null;
        }
    });
} else {
    console.log("[iMacros] chrome.windows.onRemoved not available in Offscreen Document");
}

// Inject content scripts into existing tabs on installation/update
if (chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(async () => {
        console.log('[iMacros MV3] Extension installed/updated, initializing...');

        // Initialize context for all open windows to ensure message handlers are registered
        try {
            const windows = await chrome.windows.getAll({ populate: false });
            for (const win of windows) {
                if (win.type === 'normal') {
                    context.init(win.id).then(() => {
                        console.log(`[iMacros MV3] Context initialized for window ${win.id}`);
                    }).catch(err => {
                        console.error(`[iMacros MV3] Failed to initialize context for window ${win.id}:`, err);
                    });
                }
            }
        } catch (err) {
            console.error('[iMacros MV3] Error initializing windows:', err);
        }

        const contentScripts = [
            "utils.js",
            "errorLogger.js",
            "content_scripts/connector.js",
            "content_scripts/recorder.js",
            "content_scripts/player.js"
        ];

        try {
            const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*", "file://*/*"] });
            for (const tab of tabs) {
                // Skip restricted URLs
                if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:")) {
                    continue;
                }

                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id, allFrames: true },
                        files: contentScripts
                    });
                    console.log(`[iMacros MV3] Injected content scripts into tab ${tab.id} (${tab.url})`);
                } catch (err) {
                    // Ignore errors for tabs where injection is not allowed (e.g. restricted domains)
                    // or if the tab was closed during the process
                    // Use info level to avoid cluttering logs with expected errors
                    console.info(`[iMacros MV3] Failed to inject scripts into tab ${tab.id}: ${err.message}`);
                }
            }
        } catch (err) {
            console.error('[iMacros MV3] Error querying tabs for script injection:', err);
        }
    });
} else {
    console.log("[iMacros] chrome.runtime.onInstalled not available in Offscreen Document");
}

// Polyfill createAttribute for XML documents in Service Worker environment
// The native DOMParser in Service Workers might produce XML documents that lack createAttribute
if (typeof XMLDocument !== 'undefined' && !XMLDocument.prototype.createAttribute) {
    XMLDocument.prototype.createAttribute = function (name) {
        return this.createAttributeNS(null, name);
    };
}

// Add message listener for panel requests
// Service Worker Startup: Restore context for all open windows
// This is crucial because Service Worker memory is cleared on idle.
// Note: This only runs in Service Worker context, not in Offscreen Document
if (typeof chrome.windows !== 'undefined' && chrome.windows.getAll) {
    (async function restoreContexts() {
        try {
            // Wait for context object to be defined
            if (typeof context === 'undefined' || typeof context.init !== 'function') {
                console.warn('[iMacros MV3] Context not ready during startup restoration');
                return;
            }

            const windows = await chrome.windows.getAll({ populate: false });
            for (const win of windows) {
                if (win.type === 'normal') {
                    // Initialize context if missing
                    if (!context[win.id]) {
                        console.log(`[iMacros MV3] Restoring context for window ${win.id}`);
                        context.init(win.id).catch(err => {
                            console.error(`[iMacros MV3] Failed to restore context for window ${win.id}:`, err);
                        });
                    }
                }
            }
        } catch (err) {
            console.error('[iMacros MV3] Error restoring contexts:', err);
        }
    })();
} else {
    console.log('[iMacros] chrome.windows API not available - skipping context restoration (Offscreen Document)');
}

// Add this wrapper to offscreen_bg.js to handle notifications via Service Worker
if (typeof chrome.notifications === 'undefined') {
    chrome.notifications = {};
}
if (!chrome.notifications.create) {
    chrome.notifications.create = function (notificationId, options, callback) {
        chrome.runtime.sendMessage({
            target: "background",
            command: "showNotification",
            options: options,
            notificationId: notificationId
        }, function (response) {
            if (callback) callback(response);
        });
    };
}
if (!chrome.notifications.clear) {
    chrome.notifications.clear = function (notificationId, callback) {
        // Optional: implement clear logic
        if (callback) callback();
    };
}

/*
 * Execute a method on a context object (mplayer, recorder, etc.)
 * Used by background.js to proxy commands to Offscreen Document.
 */
function executeContextMethod(win_id, method, sendResponse, args = [], requestId = null) {
    if (!context[win_id] && method !== 'stop') {
        if (sendResponse) sendResponse({ success: false, error: `Context not found for window ${win_id}` });
        return true;
    }

    // Special handlers for specific MV3 operations
    if (method === "recorder.start") {
        try {
            if (context[win_id].mplayer && context[win_id].mplayer.playing) {
                context[win_id].mplayer.stop();
            }
        } catch (e) { }
        const rec = context[win_id].recorder;
        if (!rec) {
            sendResponse({ success: false, error: `Recorder not initialized for window ${win_id}` });
            return true;
        }
        try { rec.start(); sendResponse({ success: true }); }
        catch (e) { sendResponse({ success: false, error: e.message || String(e) }); }
        return true;
    }

    if (method === "stop") {
        if (win_id) playInFlight.delete(win_id);
        const stopOne = (ctx) => {
            if (ctx.mplayer) try { ctx.mplayer.stop(); } catch (e) { }
            if (ctx.recorder) try { ctx.recorder.stop(); } catch (e) { }
        };
        if (context[win_id]) {
            stopOne(context[win_id]);
            sendResponse({ success: true });
        } else {
            for (let id in context) stopOne(context[id]);
            sendResponse({ success: true, message: "Stopped all" });
        }
        return true;
    }

    if (method === "playFile") {
        if (typeof afio === 'undefined') {
            sendResponse({ success: false, error: 'AFIO not available' });
            return true;
        }
        let filePath = args[0];
        if (playInFlight.has(win_id) || (context[win_id] && context[win_id].mplayer && context[win_id].mplayer.playing) || isDuplicatePlayStart(win_id, filePath, "playFile")) {
            sendResponse({ success: false, error: 'Already playing or duplicate' });
            return true;
        }
        recordPlayStart(win_id, filePath);
        playInFlight.add(win_id);
        afio.openFile(filePath).then(file => {
            context[win_id].mplayer.play(file, args[1], result => {
                playInFlight.delete(win_id);
                sendResponse({ success: true, result });
            });
        }).catch(err => {
            playInFlight.delete(win_id);
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    // Generic fallback for other methods
    const parts = method.split('.');
    let obj = context[win_id];
    let funcName = parts.pop();

    for (const part of parts) {
        if (obj[part]) obj = obj[part];
        else {
            if (obj === context[win_id] && parts.length === 1) {
                if (obj.mplayer && typeof obj.mplayer[funcName] === 'function') { obj = obj.mplayer; break; }
                else if (obj.recorder && typeof obj.recorder[funcName] === 'function') { obj = obj.recorder; break; }
            }
            if (sendResponse) sendResponse({ success: false, error: `Object ${part} not found` });
            return true;
        }
    }

    if (obj === context[win_id] && typeof obj[funcName] !== 'function') {
        if (obj.mplayer && typeof obj.mplayer[funcName] === 'function') obj = obj.mplayer;
        else if (obj.recorder && typeof obj.recorder[funcName] === 'function') obj = obj.recorder;
    }

    if (typeof obj[funcName] === 'function') {
        try {
            const result = obj[funcName].apply(obj, args);
            if (result && typeof result.then === 'function') {
                result.then(val => sendResponse({ success: true, result: val }))
                    .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
            } else {
                sendResponse({ success: true, result });
            }
        } catch (err) {
            sendResponse({ success: false, error: err.message || String(err) });
        }
    } else {
        sendResponse({ success: false, error: `Method ${method} not found` });
    }
}
