/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.

MV2 background/offscreen bridge: preserves original responsibilities for
panel ↔ engine routing while delegating MV3-restricted APIs to the service
worker via explicit messaging.
*/

//
// Config
/* global FileSyncBridge, afio, communicator */
"use strict";

//
// Common logic moved to bg_common.js
// Ensure handler registration only runs when the helper is available.
//

// Global handler for panel updates (called from bg_common.js)
window.updatePanels = function () {
    try {
        for (var x in context) {
            var panel = context[x].panelWindow;
            if (panel && !panel.closed) {
                // Ensure we access the iframe correctly. 
                // Note: panelWindow is the window object of panel.html
                var treeFrame = panel.frames["tree-iframe"];
                if (treeFrame && treeFrame.contentDocument) {
                    treeFrame.contentDocument.defaultView.location.reload();
                }
            }
        }
    } catch (e) {
        console.warn("Failed to update panels in offscreen:", e);
    }
};



// Attempt to register shared handlers that are already loaded via offscreen.html.
// Avoid using importScripts here because the offscreen document runs in a window
// context (not a worker), which caused "importScripts is not defined" and
// duplicate script execution errors in MV3.
(function registerSharedHandlers() {
    const registerFn = window.registerSharedBackgroundHandlers;
    if (typeof registerFn === "function") {
        registerFn(window);
        return;
    }

    // If the helpers are missing, log a clear error rather than attempting to
    // re-import scripts that are already included in offscreen.html.
    console.error("registerSharedBackgroundHandlers is not available; shared background handlers not registered");
})();

// called from panel
// we use it to find and set win_id for that panel
// NOTE: unfortnunately, it seems there is no more straightforward way
// because on Windows chrome.windows.onCreated is fired too early for
// panel's DOM window be fully constructed
function onPanelLoaded(panel, panelWindowId) {
    // If panelWindowId is provided, use it to find the matching win_id
    if (panelWindowId) {
        for (var win_id in context) {
            win_id = parseInt(win_id);
            if (!isNaN(win_id) && context[win_id].panelId === panelWindowId) {
                context[win_id].panelWindow = panel;
                return win_id;
            }
        }
    }

    // Enhanced error logging with context details
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
    // Only handle messages targeting offscreen
    if (request.target !== 'offscreen') return;

    const msgLabel = request.type || request.command;
    console.log('[iMacros Offscreen] Received message:', msgLabel, request);

    // Handle quick state query from Service Worker or panel
    if (request.type === 'QUERY_STATE') {
        const winId = request.win_id;
        const ctx = (typeof context !== 'undefined' && context) ? context[winId] : null;

        let state = 'idle';
        const response = { state };

        if (ctx) {
            if (ctx.recorder && ctx.recorder.recording) {
                state = 'recording';
                const recordMode = Storage.getChar("record-mode") || 'conventional';
                response.state = state;
                response.args = {
                    favorId: Storage.getBool("recording-prefer-id"),
                    cssSelectors: Storage.getBool("recording-prefer-css-selectors"),
                    recordMode: recordMode
                };
                response.frameNumber = ctx.recorder.currentFrameNumber;
            } else if (ctx.mplayer && ctx.mplayer.playing) {
                state = 'playing';
                response.state = state;
                response.currentMacro = ctx.mplayer.currentMacro || null;
            } else {
                response.state = 'idle';
            }
        }

        if (sendResponse) {
            sendResponse(response);
        }
        return true;
    }

    // Handle panel creation completion from Service Worker
    if (request.command === 'panelCreated') {
        const win_id = request.win_id;
        if (context[win_id]) {
            context[win_id].panelId = request.panelId;
            console.log(`[iMacros Offscreen] Panel ID set: ${request.panelId} for window ${win_id}`);
        }
        if (sendResponse) sendResponse({ success: true });
        return true;
    }

    // Handle panel closed notification from Service Worker
    if (request.command === 'panelClosed') {
        const panelId = request.panelId;
        // Clear panelId from all contexts that have this panel
        for (let win_id in context) {
            if (context[win_id] && context[win_id].panelId === panelId) {
                console.log(`[iMacros Offscreen] Clearing panelId for window ${win_id}`);
                delete context[win_id].panelId;
                delete context[win_id].panelWindow;
            }
        }
        if (sendResponse) sendResponse({ success: true });
        return true;
    }

    // Handle tab events from Service Worker and forward to mplayer and recorder
    if (['TAB_UPDATED', 'TAB_ACTIVATED', 'TAB_CREATED', 'TAB_REMOVED', 'TAB_MOVED', 'TAB_ATTACHED', 'TAB_DETACHED', 'WEB_NAVIGATION_ERROR', 'WEB_NAVIGATION_COMMITTED'].includes(request.type)) {
        for (let win_id in context) {
            if (context[win_id]) {
                const mplayer = context[win_id].mplayer;
                const recorder = context[win_id].recorder;
                const req = request;

                try {
                    if (req.type === 'TAB_UPDATED') {
                        if (mplayer && mplayer.onTabUpdated) mplayer.onTabUpdated(req.tabId, req.changeInfo, req.tab);
                    } else if (req.type === 'TAB_ACTIVATED') {
                        if (mplayer && mplayer.onTabActivated) mplayer.onTabActivated(req.activeInfo);
                        if (recorder && recorder.onActivated) recorder.onActivated(req.activeInfo);
                    } else if (req.type === 'TAB_CREATED') {
                        if (recorder && recorder.onCreated) recorder.onCreated(req.tab);
                    } else if (req.type === 'TAB_REMOVED') {
                        if (recorder && recorder.onRemoved) recorder.onRemoved(req.tabId);
                    } else if (req.type === 'TAB_MOVED') {
                        if (recorder && recorder.onMoved) recorder.onMoved(req.tabId, req.moveInfo);
                    } else if (req.type === 'TAB_ATTACHED') {
                        if (recorder && recorder.onAttached) recorder.onAttached(req.tabId, req.attachInfo);
                    } else if (req.type === 'TAB_DETACHED') {
                        if (recorder && recorder.onDetached) recorder.onDetached(req.tabId, req.detachInfo);
                    } else if (req.type === 'WEB_NAVIGATION_ERROR') {
                        if (mplayer && mplayer.onNavigationErrorOccured) mplayer.onNavigationErrorOccured(req.details);
                    } else if (req.type === 'WEB_NAVIGATION_COMMITTED') {
                        if (recorder && recorder.onCommitted) recorder.onCommitted(req.details);
                    }
                } catch (e) {
                    console.error(`[iMacros Offscreen] Error handling ${req.type} for win_id ${win_id}:`, e);
                }
            }
        }
        if (sendResponse) sendResponse({ success: true });
        return true;
    }

    // Handle forwarded messages from Service Worker (e.g. from Content Scripts)
    if (request.command === 'FORWARD_MESSAGE') {
        const { topic, data, tab_id, win_id } = request;

        // Check if communicator is available
        if (typeof communicator !== 'undefined') {
            const msg = { topic: topic, data: data };
            // Manually execute handlers for this topic and window
            if (communicator.handlers && communicator.handlers[topic]) {
                communicator._execHandlers(msg, tab_id, win_id, sendResponse);
            } else {
                console.debug('[iMacros Offscreen] No handler for forwarded message:', topic);
                if (sendResponse) sendResponse({ success: false, error: 'No handler found' });
            }
        }
        return true;
    }

    // Handle imacros:// URL scheme - run macro by URL
    if (request.command === 'runMacroByUrl') {
        const macroPath = request.macroPath;
        const windowId = request.windowId;

        console.log('[iMacros Offscreen] runMacroByUrl:', macroPath, 'windowId:', windowId);

        // Ensure context exists for this window
        if (!context[windowId]) {
            context[windowId] = {};
        }

        // Check if there's already an active mplayer
        if (context[windowId].mplayer && context[windowId].mplayer.playing) {
            // Macro is already playing, queue this one by using the RUN command internally
            console.log('[iMacros Offscreen] Macro already playing, using RUN command to chain');
            const mplayer = context[windowId].mplayer;
            // Create a synthetic RUN action
            const runCmd = [null, '"' + macroPath + '"'];
            try {
                mplayer._ActionTable["run"](runCmd);
                if (sendResponse) sendResponse({ success: true, message: 'Macro queued via RUN command' });
            } catch (e) {
                console.error('[iMacros Offscreen] Error queueing macro:', e);
                if (sendResponse) sendResponse({ success: false, error: e.message });
            }
            return true;
        }

        // No macro playing, start fresh execution
        // Resolve and load the macro file
        afio.getDefaultDir("savepath").then(function (dir) {
            let fullPath = macroPath;
            if (!__is_full_path(macroPath)) {
                dir.append(macroPath);
                fullPath = dir.path;
            }

            const node = afio.openNode(fullPath);
            return node.exists().then(function (exists) {
                if (!exists) {
                    throw new Error('Macro file not found: ' + fullPath);
                }
                return afio.readTextFile(node).then(function (source) {
                    // Create macro object
                    const macro = {
                        name: node.leafName || macroPath,
                        source: source,
                        file_id: fullPath,
                        times: 1,
                        startLoop: 1
                    };

                    // Get or create mplayer
                    if (!context[windowId].mplayer) {
                        context[windowId].mplayer = new MacroPlayer(windowId);
                    }

                    const mplayer = context[windowId].mplayer;
                    const limits = { maxVariables: 'unlimited', loops: 'unlimited' };

                    // Play the macro
                    mplayer.play(macro, limits, function () {
                        console.log('[iMacros Offscreen] Macro execution completed:', macroPath);
                    });

                    if (sendResponse) sendResponse({ success: true, message: 'Macro started' });
                });
            });
        }).catch(function (e) {
            console.error('[iMacros Offscreen] Error loading macro:', e);
            if (sendResponse) sendResponse({ success: false, error: e.message });
        });

        return true;
    }

    if (request.command === 'reinitFileSystem') {
        if (typeof afio !== 'undefined' && afio.reinitFileSystem) {
            afio.reinitFileSystem().then(() => {
                console.log('[iMacros Offscreen] FileSystemAccessService re-initialized');
                sendResponse({ success: true });
            }).catch(err => {
                console.error('[iMacros Offscreen] Failed to re-init FS:', err);
                sendResponse({ success: false, error: err.message });
            });
        } else {
            sendResponse({ success: false, error: 'afio or reinitFileSystem not available' });
        }
        return true;
    }

    // --- Handlers for panel.js commands ---

    if (request.command === 'startRecording') {
        const win_id = request.win_id;
        console.log('[Offscreen] Received startRecording for window:', win_id);

        const start = () => executeContextMethod(win_id, 'recorder.start', sendResponse, []);

        if (!context[win_id]) {
            context.init(win_id).then(start).catch(err => {
                sendResponse({ success: false, error: err.message || String(err) });
            });
        } else {
            start();
        }
        return true;
    }

    if (request.command === 'playMacro') {
        const win_id = request.win_id;
        const filePath = request.file_path;
        const loop = request.loop || 1;
        console.log('[Offscreen] Received playMacro:', filePath, 'loop:', loop);

        if (!context[win_id]) {
            context.init(win_id).then(() => {
                // Clean path and resolve absolute path logic required
                // Re-use logic from CALL_CONTEXT_METHOD "playFile"
                const req = { command: 'CALL_CONTEXT_METHOD', method: 'playFile', args: [filePath, loop], win_id: win_id };
                // Dispatch to existing handler logic (refactoring would be better but this is safe)
                // Or better, just call executeContextMethod directly if scope allows
                // Since executeContextMethod is defined inside onMessage scope in previous blocks, 
                // we need to access it. Ah, executeContextMethod is defined below in the same scope.
                executeContextMethod(win_id, 'playFile', sendResponse, [filePath, loop]);
            }).catch(err => {
                sendResponse({ success: false, error: err.message || String(err) });
            });
        } else {
            executeContextMethod(win_id, 'playFile', sendResponse, [filePath, loop]);
        }
        return true;
    }

    if (request.command === 'stop') {
        const win_id = request.win_id;
        console.log('[Offscreen] Received stop command for window:', win_id);

        // Function to stop a specific context (even if state flags got out of sync)
        const stopContext = (ctx, id) => {
            let stoppedPlayer = false;
            let stoppedRecorder = false;

            if (ctx.mplayer) {
                console.log(`[Offscreen] Stopping mplayer for window ${id}`);
                try {
                    if (typeof ctx.mplayer.stop === 'function') {
                        ctx.mplayer.stop();
                        stoppedPlayer = true;
                    }
                } catch (err) {
                    console.error(`[Offscreen] Failed to stop mplayer for window ${id}:`, err);
                }
            }
            if (ctx.recorder) {
                console.log(`[Offscreen] Stopping recorder for window ${id}`);
                try {
                    if (typeof ctx.recorder.stop === 'function') {
                        ctx.recorder.stop();
                        stoppedRecorder = true;
                    }
                } catch (err) {
                    console.error(`[Offscreen] Failed to stop recorder for window ${id}:`, err);
                }
            }
            return { stoppedPlayer, stoppedRecorder };
        };

        if (context[win_id]) {
            // Try to stop specific window
            executeContextMethod(win_id, 'stop', sendResponse, []);
        } else {
            // Fallback: Check ALL contexts for any active player/recorder and stop them
            // This handles cases where window IDs might be mismatched
            console.warn('[Offscreen] Stop target window not found. Scanning all contexts...');
            const stoppedDetails = [];
            for (let id in context) {
                if (context.hasOwnProperty(id) && context[id]) {
                    const { stoppedPlayer, stoppedRecorder } = stopContext(context[id], id);
                    if (stoppedPlayer || stoppedRecorder) {
                        stoppedDetails.push({ id, stoppedPlayer, stoppedRecorder });
                    }
                }
            }
            if (stoppedDetails.length > 0) {
                sendResponse({ success: true, message: "Stopped active processes in other windows", details: stoppedDetails });
            } else {
                sendResponse({ success: false, message: "No active processes found to stop" });
            }
        }
        return true;
    }

    if (request.command === 'pause') {
        const win_id = request.win_id;
        console.log('[Offscreen] Received pause command');
        const runPause = () => executeContextMethod(win_id, 'pause', sendResponse, []);

        if (!context[win_id]) {
            context.init(win_id).then(runPause).catch(err => {
                sendResponse({ success: false, error: err.message || String(err) });
            });
        } else {
            runPause();
        }
        return true;
    }

    if (request.command === 'unpause') {
        const win_id = request.win_id;
        console.log('[Offscreen] Received unpause command');
        const runUnpause = () => executeContextMethod(win_id, 'unpause', sendResponse, []);

        if (!context[win_id]) {
            context.init(win_id).then(runUnpause).catch(err => {
                sendResponse({ success: false, error: err.message || String(err) });
            });
        } else {
            runUnpause();
        }
        return true;
    }

    if (request.command === 'editMacro') {
        const win_id = request.win_id;
        const filePath = request.file_path;
        console.log('[Offscreen] Received editMacro:', filePath);
        if (!context[win_id]) {
            context.init(win_id).then(() => {
                executeContextMethod(win_id, 'openEditor', sendResponse, [filePath]);
            });
        } else {
            executeContextMethod(win_id, 'openEditor', sendResponse, [filePath]);
        }
        return true;
    }

    // --- End panel.js handlers ---

    if (request.command === 'EVAL_REQUEST') {
        pendingEvalRequests.set(request.requestId, sendResponse);
        const frame = document.getElementById('eval_sandbox');
        if (frame && frame.contentWindow) {
            frame.contentWindow.postMessage(request, '*');
        } else {
            pendingEvalRequests.delete(request.requestId);
            sendResponse({ success: false, error: "Sandbox frame not found" });
        }
        return true; // Keep channel open
    }

    try {
        // Handle panel.js message types
        if (request.type === 'CALL_BG_FUNCTION') {
            const functionName = request.functionName;
            const args = request.args || [];

            try {
                // Call the global function by name
                if (typeof window[functionName] === 'function') {
                    const result = window[functionName](...args);

                    // Check if result is a Promise
                    if (result && typeof result.then === 'function') {
                        result.then(value => {
                            sendResponse({ success: true, result: value });
                        }).catch(err => {
                            sendResponse({ success: false, error: err.message || String(err) });
                        });
                    } else {
                        sendResponse({ success: true, result: result });
                    }
                } else {
                    sendResponse({ success: false, error: `Function ${functionName} not found` });
                }
            } catch (err) {
                sendResponse({ success: false, error: err.message || String(err) });
            }
            return true; // Always keep channel open for async response
        }

        if (request.type === 'CALL_CONTEXT_METHOD') {
            const win_id = request.win_id;
            const objectPath = request.objectPath;
            const methodName = request.methodName;
            const args = request.args || [];

            try {
                if (!context[win_id]) {
                    sendResponse({ success: false, error: `Context not found for window ${win_id}` });
                    return true;
                }

                const obj = context[win_id][objectPath];
                if (!obj) {
                    sendResponse({ success: false, error: `Object ${objectPath} not found in context` });
                    return true;
                }

                if (typeof obj[methodName] !== 'function') {
                    sendResponse({ success: false, error: `Method ${methodName} not found on ${objectPath}` });
                    return true;
                }

                const result = obj[methodName](...args);

                // Check if result is a Promise
                if (result && typeof result.then === 'function') {
                    result.then(value => {
                        sendResponse({ success: true, result: value });
                    }).catch(err => {
                        sendResponse({ success: false, error: err.message || String(err) });
                    });
                } else {
                    sendResponse({ success: true, result: result });
                }
            } catch (err) {
                sendResponse({ success: false, error: err.message || String(err) });
            }
            return true; // Always keep channel open for async response
        }

        // ★追加: command形式のCALL_CONTEXT_METHOD処理
        if (request.command === 'CALL_CONTEXT_METHOD') {
            const win_id = request.win_id;
            const method = request.method; // 例: "recorder.start" または "stop"

            console.log(`[Offscreen] CALL_CONTEXT_METHOD: ${method} for window ${win_id}`);

            try {
                if (!context[win_id]) {
                    context.init(win_id).then(() => {
                        executeContextMethod(win_id, method, sendResponse, request.args);
                    }).catch(err => {
                        sendResponse({ success: false, error: `Failed to initialize context: ${err.message || String(err)}` });
                    });
                    return true;
                }

                executeContextMethod(win_id, method, sendResponse, request.args);
            } catch (err) {
                sendResponse({ success: false, error: err.message || String(err) });
            }
            return true;
        }

        function executeContextMethod(win_id, method, sendResponse, args) {
            if (method === "recorder.start") {
                console.log("[Offscreen] Starting recorder...");
                const rec = context[win_id].recorder;
                if (!rec) {
                    sendResponse({ success: false, error: `Recorder not initialized for window ${win_id}` });
                    return;
                }
                try {
                    rec.start();
                    sendResponse({ success: true });
                } catch (e) {
                    console.error('[Offscreen] Error starting recorder:', e);
                    sendResponse({ success: false, error: e && e.message ? e.message : String(e) });
                }
            } else if (method === "stop") {
                console.log("[Offscreen] Stopping...");
                let stoppedPlayer = false;
                let stoppedRecorder = false;

                if (context[win_id].mplayer) {
                    try {
                        if (typeof context[win_id].mplayer.stop === 'function') {
                            context[win_id].mplayer.stop();
                            stoppedPlayer = true;
                        }
                    } catch (e) {
                        console.error('[Offscreen] Error stopping mplayer:', e);
                    }
                }

                if (context[win_id].recorder) {
                    try {
                        if (typeof context[win_id].recorder.stop === 'function') {
                            context[win_id].recorder.stop();
                            stoppedRecorder = true;
                        }
                    } catch (e) {
                        console.error('[Offscreen] Error stopping recorder:', e);
                    }
                }

                sendResponse({ success: true, stoppedPlayer, stoppedRecorder });
            } else if (method === "pause") {
                console.log("[Offscreen] Pausing/Unpausing player...");
                const mplayer = context[win_id].mplayer;
                if (!mplayer) {
                    sendResponse({ success: false, error: 'mplayer not available for pause' });
                    return;
                }

                const pausedState = mplayer.paused;
                console.log('[Offscreen] Current paused state:', pausedState);

                if (pausedState) {
                    if (typeof mplayer.unpause === 'function') {
                        try {
                            mplayer.unpause();
                            sendResponse({ success: true, resumed: true });
                        } catch (e) {
                            console.error('[Offscreen] Error unpausing mplayer:', e);
                            sendResponse({ success: false, error: 'Error unpausing mplayer', details: String(e) });
                        }
                    } else {
                        sendResponse({ success: false, error: 'unpause method not available' });
                    }
                } else {
                    if (typeof mplayer.pause === 'function') {
                        try {
                            mplayer.pause();
                            sendResponse({ success: true, resumed: false });
                        } catch (e) {
                            console.error('[Offscreen] Error pausing mplayer:', e);
                            sendResponse({ success: false, error: 'Error pausing mplayer', details: String(e) });
                        }
                    } else {
                        sendResponse({ success: false, error: 'pause method not available' });
                    }
                }
            } else if (method === "unpause") {
                console.log("[Offscreen] Unpausing player...");
                const mplayer = context[win_id].mplayer;
                if (!mplayer) {
                    sendResponse({ success: false, error: 'mplayer not available for unpause' });
                    return;
                }

                if (!mplayer.paused) {
                    sendResponse({ success: false, error: 'mplayer is not paused' });
                    return;
                }

                if (typeof mplayer.unpause === 'function') {
                    try {
                        mplayer.unpause();
                        sendResponse({ success: true, resumed: true });
                    } catch (e) {
                        console.error('[Offscreen] Error unpausing mplayer:', e);
                        sendResponse({ success: false, error: 'Error unpausing mplayer', details: String(e) });
                    }
                } else {
                    sendResponse({ success: false, error: 'unpause method not available' });
                }
            } else if (method === "mplayer.play") {
                console.log("[Offscreen] Calling mplayer.play with:", args[0].name);
                const mplayer = context[win_id].mplayer;
                // args: [macro, limits]
                mplayer.play(args[0], args[1]).catch(e => {
                    console.error("[Offscreen] Play error:", e);
                });
                sendResponse({ success: true });
            } else if (method === "playFile") {
                // ★追加: パスからファイルを読んで再生する
                let filePath = args[0];
                const loops = args[1] || 1;
                console.log("[Offscreen] Reading and playing file (original path):", filePath);

                // ★パスクリーニング: "iMacrosMV3-main-main/Macros/" -> "Macros/"
                filePath = filePath.replace(/^[^\/]+\/Macros\//, 'Macros/');
                console.log("[Offscreen] Cleaned path:", filePath);

                // ★重要: 相対パスを絶対パスに変換
                // File System Access APIのルートディレクトリを取得
                if (!filePath.startsWith('/') && !filePath.match(/^[a-zA-Z]:/)) {
                    // 相対パスの場合、File System Access APIのルートハンドルのパスを取得
                    // FileSystemAccessService経由でルートパスを取得
                    if (typeof FileSystemAccessService !== 'undefined' && FileSystemAccessService.getRootPath) {
                        FileSystemAccessService.getRootPath().then(rootPath => {
                            // ルートパス + 相対パス
                            filePath = rootPath + '/' + filePath;
                            console.log("[Offscreen] Resolved absolute path:", filePath);
                            return readAndPlayFile(filePath, loops, win_id, sendResponse);
                        }).catch(err => {
                            console.error("[Offscreen] Failed to get root path:", err);
                            // フォールバック: そのまま試す
                            readAndPlayFile(filePath, loops, win_id, sendResponse);
                        });
                    } else {
                        // FileSystemAccessServiceが使えない場合、そのまま試す
                        console.warn("[Offscreen] FileSystemAccessService not available, using path as-is");
                        readAndPlayFile(filePath, loops, win_id, sendResponse);
                    }
                } else {
                    // 既に絶対パス
                    readAndPlayFile(filePath, loops, win_id, sendResponse);
                }

                // ヘルパー関数: ファイル読み込みと再生
                function readAndPlayFile(absolutePath, loops, win_id, sendResponse) {
                    const node = afio.openNode(absolutePath);

                    afio.readTextFile(node).then(source => {
                        console.log("[Offscreen] File read success. Playing...");

                        const macro = {
                            source: source,
                            name: node.leafName,
                            file_id: absolutePath,
                            times: loops
                        };

                        // Ensure context is initialized before playing
                        var contextPromise = context[win_id] && context[win_id]._initialized
                            ? Promise.resolve(context[win_id])
                            : context.init(win_id);

                        return contextPromise.then(function (ctx) {
                            console.log("[Offscreen] Context initialized, calling mplayer.play");
                            // 制限を取得して再生
                            return getLimits().then(limits => {
                                return ctx.mplayer.play(macro, limits);
                            });
                        });
                    }).then(() => {
                        console.log("[Offscreen] Macro play completed");
                        sendResponse({ success: true });
                    }).catch(err => {
                        console.error("[Offscreen] File read/play error:", err);
                        sendResponse({ success: false, error: err.message || String(err) });
                    });
                }
            } else if (method === "openEditor") {
                // ★追加: ファイルパスからエディタを開く
                let filePath = args[0];
                console.log("[Offscreen] Opening editor for file:", filePath);

                // パスクリーニング
                filePath = filePath.replace(/^[^\/]+\/Macros\//, 'Macros/');
                console.log("[Offscreen] Cleaned path for editor:", filePath);

                const node = afio.openNode(filePath);

                afio.readTextFile(node).then(source => {
                    console.log("[Offscreen] File read for editor success");

                    const macro = {
                        source: source,
                        name: node.leafName,
                        file_id: filePath
                    };

                    // エディタを開く（edit関数を使用）
                    console.log("[Offscreen] Calling edit() to open editor");
                    edit(macro, false, 0);
                    sendResponse({ success: true });
                }).catch(err => {
                    console.error("[Offscreen] File read for editor error:", err);
                    sendResponse({ success: false, error: err.message || String(err) });
                });
            } else {
                sendResponse({ success: false, error: `Unknown method: ${method}` });
            }
        }

        if (request.type === 'SAVE_MACRO') {
            try {
                save(request.macro, request.overwrite, function (result) {
                    sendResponse({ success: true, result: result });
                });
            } catch (err) {
                sendResponse({ success: false, error: err.message || String(err) });
            }
            return true;
        }

        if (request.type === 'GET_RECORDER_STATE') {
            const win_id = request.win_id;
            try {
                if (!context[win_id] || !context[win_id].recorder) {
                    sendResponse({ success: false, error: `Recorder not found for window ${win_id}` });
                    return true;
                }

                const recorder = context[win_id].recorder;
                sendResponse({
                    success: true,
                    recording: recorder.recording || false,
                    actions: recorder.actions || []
                });
            } catch (err) {
                sendResponse({ success: false, error: err.message || String(err) });
            }
            return true;
        }

        switch (request.command) {
            case 'actionClicked':
                handleActionClicked(request.tab);
                break;

            case 'notificationClicked':
                var n_id = request.notificationId;
                var w_id = parseInt(n_id);
                if (isNaN(w_id) || !context[w_id] || !context[w_id].info_args)
                    break;
                var info = context[w_id].info_args;
                if (info.errorCode == 1)
                    break;    // we have plain Info message; nothing to do

                // for error messages since we have only one 'button'
                // we most probably want look at macro code,
                edit(info.macro, true);
                break;
        }
    } catch (e) {
        console.error('[iMacros Offscreen] Error handling message:', e);
    }

    if (sendResponse) sendResponse({ success: true });
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
                recorder.stop();
                var recorded_macro = recorder.actions.join("\n");
                var macro = {
                    source: recorded_macro, win_id: win_id,
                    name: "#Current.iim"
                };

                console.log('[iMacros MV3] Recording stopped, saving macro with', recorder.actions.length, 'actions');

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
            Object.values(limits).every(x => x == "unlimited")
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

    const missingGlobals = [];
    const presentGlobals = [];

    // Helper function to safely check if a global exists
    // Avoids eval() for security reasons
    function globalExists(name) {
        // Check globalThis first (works for var/function declarations)
        if (typeof globalThis[name] !== 'undefined') {
            return true;
        }

        // In service worker context, also check self
        if (typeof self !== 'undefined' && typeof self[name] !== 'undefined') {
            return true;
        }

        // Fallback: try direct access (works for const/let in same scope)
        // This is safe because we're only checking existence, not executing
        try {
            // Use Function constructor instead of eval for better security
            // This still accesses the global scope but is more controlled
            return new Function('return typeof ' + name + ' !== "undefined"')();
        } catch (e) {
            return false;
        }
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

// Listen for PLAY_MACRO message from beforePlay.js
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.type === 'PLAY_MACRO') {
        const { macro, win_id } = message;

        // Ensure context is initialized (handles service worker restart)
        const ctxPromise = context[win_id] && context[win_id]._initialized
            ? Promise.resolve(context[win_id])
            : context.init(win_id);

        ctxPromise.then(ctx => {
            return getLimits().then(
                limits => asyncRun(function () {
                    try {
                        ctx.mplayer.play(macro, limits);
                        sendResponse({ success: true });
                    } catch (err) {
                        logError("Failed to play macro: " + err.message, {
                            win_id: win_id,
                            macro_name: macro.name
                        });
                        sendResponse({ success: false, error: err.message });
                    }
                })
            );
        }).catch(err => {
            logError("Failed to initialize context or play macro: " + err.message, {
                win_id: win_id,
                macro_name: macro.name
            });
            sendResponse({ success: false, error: err.message });
        });

        return true; // Keep message channel open for async response
    }
});

// Listen for preference messages
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.type === 'GET_PREFERENCE') {
        try {
            let value;
            switch (message.valueType) {
                case 'string':
                    value = Storage.getChar(message.key);
                    break;
                case 'number':
                    value = Storage.getNumber(message.key);
                    break;
                default:
                    value = Storage.getBool(message.key);
            }
            sendResponse({ success: true, value: value });
        } catch (err) {
            logError("Failed to get preference: " + err.message, { key: message.key });
            sendResponse({ success: false, error: err.message });
        }
    } else if (message.type === 'SET_PREFERENCE') {
        try {
            switch (message.valueType) {
                case 'string':
                    Storage.setChar(message.key, message.value);
                    break;
                case 'number':
                    Storage.setNumber(message.key, message.value);
                    break;
                default:
                    Storage.setBool(message.key, message.value);
            }
            sendResponse({ success: true });
        } catch (err) {
            logError("Failed to set preference: " + err.message, { key: message.key });
            sendResponse({ success: false, error: err.message });
        }
        return true; // Keep message channel open for async response
    }
    return false; // Not our message
});


// Override edit function to use message passing for MV3
// This replaces the window.open based implementation from bg.js which doesn't work in Offscreen Document
globalScope.edit = function (macro, overwrite, line) {
    console.log("[iMacros Offscreen] Requesting Service Worker to open editor for:", macro.name);

    // Check if chrome.storage is available
    if (typeof chrome === 'undefined' || !chrome.storage) {
        console.error("[iMacros Offscreen] chrome.storage not available");
        return;
    }

    const sessionStorage = chrome.storage.session;
    const localStorage = chrome.storage.local;
    const primaryStorage = sessionStorage || localStorage;
    const fallbackStorage = primaryStorage === sessionStorage ? localStorage : null;

    if (!primaryStorage) {
        console.error("[iMacros Offscreen] No storage backend available for editor launch");
        return;
    }

    const editorData = {
        "currentMacroToEdit": macro,
        "editorOverwriteMode": overwrite,
        "editorStartLine": line || 0
    };

    function persistEditorData(targetStorage, onSuccess, onFailure) {
        targetStorage.set(editorData, function () {
            if (chrome.runtime.lastError) {
                onFailure(chrome.runtime.lastError);
                return;
            }
            onSuccess();
        });
    }

    function requestEditorWindow() {
        // Request Service Worker to open the editor window
        chrome.runtime.sendMessage({
            command: "openEditorWindow"
        });
    }

    persistEditorData(primaryStorage, requestEditorWindow, function (error) {
        if (fallbackStorage && primaryStorage === sessionStorage) {
            console.warn("[iMacros Offscreen] Session storage failed, falling back to local storage:", error);
            persistEditorData(fallbackStorage, requestEditorWindow, function (fallbackError) {
                console.error("[iMacros Offscreen] Failed to save macro data for editor even in local storage:", fallbackError);
            });
        } else {
            console.error("[iMacros Offscreen] Failed to save macro data for editor:", error);
        }
    });
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

    // listen to restart-server command from content script
    // (fires after t.html?pipe=<pipe> page is loaded)
    chrome.runtime.onMessage.addListener(
        function (req, sender, sendResponse) {
            // clean up request
            if (req.command == "restart-server") {
                // Note: Double-restart is avoided by checking if currentPipe differs from req.pipe.
                // Only restart the server if the pipe name has changed.
                sendResponse({ status: "OK" });
                if (nm_connector.currentPipe != req.pipe) {
                    nm_connector.stopServer();
                    if (Storage.getBool("debug"))
                        console.info("Restarting server, pipe=" + req.pipe);
                    nm_connector.startServer(req.pipe);
                    nm_connector.currentPipe = req.pipe;
                }
                return true; // Required for async response
            }
            // MV3: Handle getDialogArgs request from editor window
            else if (req.command == "getDialogArgs") {
                var win_id = req.win_id;
                if (win_id != null &&
                    typeof dialogUtils !== "undefined" &&
                    dialogUtils &&
                    typeof dialogUtils.getDialogArgs === "function") {
                    try {
                        var args = dialogUtils.getDialogArgs(win_id);
                        sendResponse({ success: true, args: args });
                    } catch (e) {
                        console.error("[iMacros] Failed to get dialog args for window " + win_id + ":", e);
                        sendResponse({ success: false, error: e.message });
                    }
                } else {
                    sendResponse({ success: false, error: "Invalid window ID or dialogUtils not available" });
                }
                return true; // Required for async response
            }
            // MV3: Handle setDialogArgs request from editor window
            else if (req.command == "setDialogArgs") {
                var targetWinId = req.win_id;
                var dialogArgs = req.args;
                if (targetWinId != null &&
                    dialogArgs &&
                    typeof dialogUtils !== "undefined" &&
                    dialogUtils &&
                    typeof dialogUtils.setArgs === "function") {
                    try {
                        // Create a mock window object with the ID
                        var mockWin = { id: targetWinId };
                        dialogUtils.setArgs(mockWin, dialogArgs);
                        sendResponse({ success: true });
                    } catch (e) {
                        console.error("[iMacros] Failed to set dialog args for window " + targetWinId + ":", e);
                        sendResponse({ success: false, error: e.message });
                    }
                } else {
                    sendResponse({ success: false, error: "Invalid window ID, args, or dialogUtils not available" });
                }
                return true; // Required for async response
            }
            // MV3: Handle save request from editor window
            else if (req.command == "save") {
                var save_data = req.data;
                var overwrite = req.overwrite;
                if (save_data && typeof save === "function") {
                    try {
                        save(save_data, overwrite, function (result) {
                            if (result && result.error) {
                                sendResponse({ success: false, error: result.error });
                            } else {
                                sendResponse({ success: true, result: result });
                            }
                        });
                    } catch (e) {
                        console.error("[iMacros] Failed to save:", e);
                        sendResponse({ success: false, error: e.message });
                    }
                } else {
                    sendResponse({ success: false, error: "Invalid save data or save function not available" });
                }
                return true; // Required for async response
            }
        }
    );
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
                    showNotification(win_id, args);
                }
            });
        } else {
            showNotification(win_id, args);
        }
    }).catch(err => {
        logError("Failed to initialize context in showInfo: " + err.message, { win_id: win_id });
    });
}

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
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type === 'CHECK_MPLAYER_PAUSED') {
        var win_id = request.win_id;
        if (!context[win_id]) {
            // Try to initialize context if not found
            context.init(win_id).then(() => {
                if (context[win_id] && context[win_id].mplayer) {
                    sendResponse({ success: true, isPaused: context[win_id].mplayer.paused });
                } else {
                    sendResponse({ success: false, error: "Context initialized but mplayer missing for win_id: " + win_id });
                }
            }).catch(err => {
                sendResponse({ success: false, error: "Context not found and initialization failed: " + err.message });
            });
            return true; // async response
        }
        var mplayer = context[win_id].mplayer;
        sendResponse({ success: true, isPaused: mplayer && mplayer.paused });
        return true; // async response
    }

    // Handle dialog interactions (PROMPT, etc.)
    if (request.type === 'SET_DIALOG_RESULT') {
        try {
            dialogUtils.setDialogResult(request.windowId, request.response);
            sendResponse({ success: true });
        } catch (e) {
            console.error('[iMacros MV3] Error setting dialog result:', e);
            sendResponse({ success: false, error: e.toString() });
        }
        return true;
    }

    if (request.type === 'GET_DIALOG_ARGS') {
        try {
            var args = dialogUtils.getArgs(request.windowId);
            sendResponse({ success: true, args: args });
        } catch (e) {
            console.error('[iMacros MV3] Error getting dialog args:', e);
            sendResponse({ success: false, error: e.toString() });
        }
        return true;
    }

    // Handle panel initialization
    if (request.type === 'PANEL_LOADED') {
        try {
            const panelWindowId = request.panelWindowId;

            // Find which browser window this panel belongs to
            // by checking which context has this panelId
            let found_win_id = null;
            for (let win_id in context) {
                win_id = parseInt(win_id);
                if (!isNaN(win_id) && context[win_id].panelId === panelWindowId) {
                    found_win_id = win_id;
                    break;
                }
            }

            if (found_win_id !== null) {
                console.log(`[iMacros MV3] Panel loaded for window ${found_win_id}, panel window ID: ${panelWindowId}`);
                sendResponse({ success: true, win_id: found_win_id });
            } else {
                console.error(`[iMacros MV3] Could not find context for panel window ID: ${panelWindowId}`);
                sendResponse({ success: false, error: 'Context not found for panel window' });
            }
        } catch (e) {
            console.error('[iMacros MV3] Error handling PANEL_LOADED:', e);
            sendResponse({ success: false, error: e.toString() });
        }
        return true;
    }

    if (request.type === 'PANEL_CLOSING') {
        try {
            const win_id = request.win_id;
            const panelBox = request.panelBox;

            if (context[win_id]) {
                // Save panel position
                if (panelBox) {
                    Storage.setObject("panel-box", panelBox);
                }

                // Mark panel as closing to avoid auto-reopen loops
                context[win_id].panelClosing = true;

                console.log(`[iMacros MV3] Panel closing for window ${win_id}`);
            }
            sendResponse({ success: true });
        } catch (e) {
            console.error('[iMacros MV3] Error handling PANEL_CLOSING:', e);
            sendResponse({ success: false, error: e.toString() });
        }
        return true;
    }
});
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
if (typeof chrome.notifications === 'undefined' || !chrome.notifications.create) {
    chrome.notifications = {
        create: function (notificationId, options, callback) {
            chrome.runtime.sendMessage({
                target: "background",
                command: "show_notification",
                args: options // Pass options directly
            }, function (response) {
                if (callback) callback(response);
            });
        },
        clear: function (notificationId, callback) {
            // Optional: implement clear logic
            if (callback) callback();
        }
    };
}
