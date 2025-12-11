/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/
try {
    importScripts(
        'utils.js',
        'badge.js',
        'promise-utils.js',
        'errorLogger.js',
        'VirtualFileService.js',
        'variable-manager.js',
        'AsyncFileIO.js',
        'communicator.js',
        'bg_common.js',
        'context.js',
        'mplayer.js',
        'mrecorder.js',
        'nm_connector.js',
        'rijndael.js',
        'bg.js'
    );
} catch (e) {
    console.error('Failed to import scripts:', e);
}

// Background Service Worker for iMacros MV3
// Handles Offscreen Document lifecycle and event forwarding


// Create Offscreen Document
// Lock to prevent concurrent Offscreen creation attempts
let creatingOffscreen = null;
async function createOffscreen() {
    // If a creation request is already in progress, return the existing promise
    if (creatingOffscreen) return creatingOffscreen;

    creatingOffscreen = (async () => {
        try {
            // Check if offscreen document already exists
            const hasDocument = await chrome.offscreen.hasDocument();
            if (hasDocument) {
                // verify if it's responding? (Optional optimization)
                // console.log('[iMacros SW] Offscreen document already exists');
                return;
            }
        } catch (e) {
            console.error('[iMacros SW] Error checking offscreen document:', e);
            // If check fails, we proceed to try creating it.
        }

        try {
            console.log('[iMacros SW] Creating offscreen document...');
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['DOM_PARSER', 'BLOBS'],
                justification: 'To run iMacros playback engine and keep state.',
            });
            console.log('[iMacros SW] Offscreen document created successfully');
        } catch (e) {
            if (e.message && e.message.includes('Only a single offscreen')) {
                console.log('[iMacros SW] Offscreen document collision (already existed)');
            } else {
                console.error('[iMacros SW] Failed to create offscreen document:', e);
                throw e; // Propagate error
            }
        }
    })();

    try {
        await creatingOffscreen;
    } finally {
        // Reset lock after completion (success or failure)
        creatingOffscreen = null;
    }
}

// Initialize on startup and install
chrome.runtime.onStartup.addListener(createOffscreen);
chrome.runtime.onInstalled.addListener(createOffscreen);

// Forward action click to Offscreen
chrome.action.onClicked.addListener(async (tab) => {
    await createOffscreen();
    chrome.runtime.sendMessage({
        target: 'offscreen',
        command: 'actionClicked',
        tab: tab
    });
});

// Global panel ID - ensure only one panel is open at a time
let globalPanelId = null;
// Flag to prevent multiple panel creations
let isCreatingPanel = false;

// Restore globalPanelId from session storage on startup
chrome.storage.session.get(['globalPanelId'], (result) => {
    if (result.globalPanelId) {
        // Verify the panel still exists
        chrome.windows.get(result.globalPanelId, (panelWin) => {
            if (!chrome.runtime.lastError && panelWin) {
                globalPanelId = result.globalPanelId;
                console.log('[iMacros SW] Restored globalPanelId from session:', globalPanelId);
            } else {
                // Panel no longer exists, clear from session storage
                chrome.storage.session.remove(['globalPanelId']);
            }
        });
    }
});

// Listen for window removal to clear globalPanelId
chrome.windows.onRemoved.addListener((windowId) => {
    if (windowId === globalPanelId) {
        console.log('[iMacros SW] Panel window closed:', windowId);
        globalPanelId = null;
        chrome.storage.session.remove(['globalPanelId']);

        // Notify Offscreen Document that panel was closed
        chrome.runtime.sendMessage({
            target: 'offscreen',
            command: 'panelClosed',
            panelId: windowId
        }).catch(() => {
            // Ignore errors if offscreen is not available
        });
    }
});

// --- Tab Event Forwarding to Offscreen ---
// The Offscreen Document does not receive chrome.tabs events, so we must forward them.

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'TAB_UPDATED',
        tabId: tabId,
        changeInfo: changeInfo,
        tab: tab
    }).catch(() => { }); // Ignore if offscreen not listening/ready
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'TAB_ACTIVATED',
        activeInfo: activeInfo
    }).catch(() => { });
});

chrome.tabs.onCreated.addListener((tab) => {
    chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'TAB_CREATED',
        tab: tab
    }).catch(() => { });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'TAB_REMOVED',
        tabId: tabId,
        removeInfo: removeInfo
    }).catch(() => { });
});

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
    chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'TAB_MOVED',
        tabId: tabId,
        moveInfo: moveInfo
    }).catch(() => { });
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
    chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'TAB_ATTACHED',
        tabId: tabId,
        attachInfo: attachInfo
    }).catch(() => { });
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
    chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'TAB_DETACHED',
        tabId: tabId,
        detachInfo: detachInfo
    }).catch(() => { });
});


// Keep-alive logic (optional, but good for stability)
// If Offscreen sends a keep-alive message, we can respond to keep SW alive
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.keepAlive) {
        sendResponse({ alive: true });
        return true;
    }

    // Handle tab creation request from Offscreen Document
    if (msg.command === "openTab") {
        const url = msg.url;
        if (url) {
            chrome.tabs.create({ url: url }, (tab) => {
                if (chrome.runtime.lastError) {
                    console.error('[iMacros SW] Failed to create tab:', chrome.runtime.lastError);
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    console.log('[iMacros SW] Tab created:', tab?.id);
                    sendResponse({ success: true, tabId: tab?.id });
                }
            });
            return true; // Will respond asynchronously
        }
    }

    // Handle panel creation request from Offscreen Document
    if (msg.command === "openPanel") {
        const win_id = msg.win_id;

        // If already creating a panel, ignore
        if (isCreatingPanel) {
            console.log('[iMacros SW] Panel creation already in progress, ignoring');
            sendResponse({ success: false, reason: 'creation_in_progress' });
            return true;
        }

        // First, check if global panel exists
        if (globalPanelId) {
            chrome.windows.get(globalPanelId, (panelWin) => {
                if (!chrome.runtime.lastError && panelWin) {
                    console.log('[iMacros SW] Global panel already exists:', globalPanelId);
                    // Panel still exists, focus it instead of creating new one
                    chrome.windows.update(globalPanelId, { focused: true });
                    sendResponse({ success: true, panelId: globalPanelId, existed: true });
                } else {
                    // Panel no longer exists, clear the ID and create new one
                    console.log('[iMacros SW] Global panel not found, creating new one');
                    globalPanelId = null;
                    chrome.storage.session.remove(['globalPanelId']);
                    createPanel(win_id, sendResponse);
                }
            });
        } else {
            // No global panel, create new one
            createPanel(win_id, sendResponse);
        }

        function createPanel(win_id, respond) {
            isCreatingPanel = true;
            // Get target window information to calculate panel position
            chrome.windows.get(win_id, (win) => {
                if (chrome.runtime.lastError) {
                    console.error('[iMacros SW] Failed to get window:', chrome.runtime.lastError);
                    isCreatingPanel = false;
                    if (respond) respond({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }

                // Default panel size and position
                let width = 210;
                let height = 600;
                let left = win.left - width;
                let top = win.top;
                if (left < 0) left = 0;

                // Create panel window with win_id parameter
                chrome.windows.create({
                    url: "panel.html?win_id=" + win_id,
                    type: "popup",
                    width: width,
                    height: height,
                    left: left,
                    top: top
                }, (panelWin) => {
                    isCreatingPanel = false; // Reset flag
                    if (chrome.runtime.lastError) {
                        console.error('[iMacros SW] Failed to create panel:', chrome.runtime.lastError);
                        if (respond) respond({ success: false, error: chrome.runtime.lastError.message });
                        return;
                    }

                    console.log('[iMacros SW] Panel created:', panelWin.id);

                    // Store as global panel ID
                    globalPanelId = panelWin.id;

                    // Notify Offscreen Document that panel was created
                    chrome.runtime.sendMessage({
                        target: "offscreen",
                        command: "panelCreated",
                        win_id: win_id,
                        panelId: panelWin.id
                    }).catch(() => { /* ignore if offscreen not ready */ });

                    // Store in session storage for persistence
                    chrome.storage.session.set({ [`panel_${win_id}`]: panelWin.id, globalPanelId: panelWin.id });

                    if (respond) respond({ success: true, panelId: panelWin.id });
                });
            });
        }

        return true;
    }

    // Handle editor window creation request from Offscreen Document
    if (msg.command === "openEditorWindow") {
        chrome.windows.create({
            url: "editor/editor.html",
            type: "popup",
            width: 640,
            height: 480
        }, (win) => {
            if (chrome.runtime.lastError) {
                console.error('[iMacros SW] Failed to create editor window:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                console.log('[iMacros SW] Editor window created:', win.id);
                sendResponse({ success: true, windowId: win.id });
            }
        });
        return true;
    }

    // Handle AFIO Proxy Request (Offscreen -> SW)
    if (msg.command === 'AFIO_CALL') {
        const payload = msg.payload || {};
        const method = msg.method;

        // Helper to reconstruct node objects
        const getNode = (obj) => {
            if (!obj || !obj._path) return null;
            return afio.openNode(obj._path);
        };

        (async () => {
            try {
                let result = {};
                // Reconstruct nodes if present in payload
                let node = getNode(payload.node);
                let src = getNode(payload.src);
                let dst = getNode(payload.dst);

                switch (method) {
                    case 'node_exists':
                        result = { exists: await node.exists() };
                        break;
                    case 'node_isDir':
                        result = { isDir: await node.isDir() };
                        break;
                    case 'node_isWritable':
                        result = { isWritable: await node.isWritable() };
                        break;
                    case 'node_isReadable':
                        result = { isReadable: await node.isReadable() };
                        break;
                    case 'node_copyTo':
                        await src.copyTo(dst);
                        break;
                    case 'node_moveTo':
                        await src.moveTo(dst);
                        break;
                    case 'node_remove':
                        await node.remove();
                        break;
                    case 'readTextFile':
                        result = { data: await afio.readTextFile(node) };
                        break;
                    case 'writeTextFile':
                        await afio.writeTextFile(node, payload.data);
                        break;
                    case 'appendTextFile':
                        await afio.appendTextFile(node, payload.data);
                        break;
                    case 'getNodesInDir':
                        const nodes = await afio.getNodesInDir(node, payload.filter);
                        result = { nodes: nodes.map(n => ({ _path: n.path, _is_dir_int: n.is_dir })) };
                        break;
                    case 'getLogicalDrives':
                        const drives = await afio.getLogicalDrives();
                        result = { nodes: drives.map(n => ({ _path: n.path, _is_dir_int: n.is_dir })) };
                        break;
                    case 'getDefaultDir':
                        const defDir = await afio.getDefaultDir(payload.name);
                        result = { node: { _path: defDir.path, _is_dir_int: defDir.is_dir } };
                        break;
                    case 'makeDirectory':
                        await node.createDirectory();
                        break;
                    case 'writeImageToFile':
                        await afio.writeImageToFile(node, payload.imageData);
                        break;
                    case 'queryLimits':
                        result = await afio.queryLimits();
                        break;
                    default:
                        throw new Error(`Unknown method: ${method}`);
                }
                sendResponse({ result: result });
            } catch (e) {
                console.error('[iMacros SW] AFIO proxy error:', e);
                sendResponse({ error: e.message || String(e) });
            }
        })();
        return true;
    }

    // Handle openDialog request (proxy for Offscreen)
    if (msg.command === "openDialog") {
        const createData = {
            url: msg.url.indexOf('://') === -1 ? chrome.runtime.getURL(msg.url) : msg.url,
            type: "popup",
            width: (msg.pos && msg.pos.width) || 400,
            height: (msg.pos && msg.pos.height) || 250
        };
        if (msg.pos && msg.pos.left) createData.left = msg.pos.left;
        if (msg.pos && msg.pos.top) createData.top = msg.pos.top;

        chrome.windows.create(createData, (win) => {
            if (chrome.runtime.lastError) {
                console.error('[iMacros SW] Failed to create dialog window:', chrome.runtime.lastError);
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                console.log('[iMacros SW] Dialog created:', win.id);
                // We return the window object structure expected by utils.js
                sendResponse({ result: win });
            }
        });
        return true;
    }

    // Handle panel close request from Offscreen Document
    if (msg.command === "closePanel") {
        const panelId = msg.panelId;
        chrome.windows.remove(panelId, () => {
            if (chrome.runtime.lastError) {
                console.error('[iMacros SW] Failed to close panel:', chrome.runtime.lastError.message);
            } else {
                console.log('[iMacros SW] Panel closed:', panelId);
            }
        });
        return true;
    }

    // Handle notification display request from Offscreen Document
    if (msg.command === "showNotification") {
        chrome.notifications.create(msg.notificationId, msg.options, (notificationId) => {
            if (chrome.runtime.lastError) {
                console.error('[iMacros SW] Failed to create notification:', chrome.runtime.lastError);
            }
        });
        return true;
    }

    // --- SEND_TO_TAB: Proxy tab messaging from Offscreen Document ---
    if (msg.command === 'SEND_TO_TAB') {
        const { tab_id, message } = msg;
        if (!tab_id || !message) {
            sendResponse({ error: 'Missing tab_id or message' });
            return true;
        }

        const injectContentScripts = async () => {
            // Best-effort injection for cases where the content script was not injected (e.g., site access off)
            try {
                const tab = await chrome.tabs.get(tab_id).catch(() => null);
                if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
                    return false;
                }

                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab_id, allFrames: true },
                        files: [
                            'utils.js',
                            'errorLogger.js',
                            'content_scripts/connector.js',
                            'content_scripts/recorder.js',
                            'content_scripts/player.js'
                        ]
                    });
                    return true;
                } catch (err) {
                    const msg = err && err.message ? err.message : err;
                    console.warn('[iMacros SW] Failed to inject content scripts:', msg);
                    return false;
                }
            } catch (e) {
                console.warn('[iMacros SW] Exception during content script injection:', e);
                return false;
            }
        };

        const sendMessageToTab = () => {
            chrome.tabs.sendMessage(tab_id, message, (response) => {
                if (chrome.runtime.lastError) {
                    // Tab may be closed or not accessible
                    const errMsg = chrome.runtime.lastError.message;
                    console.warn('[iMacros SW] SEND_TO_TAB error:', errMsg);
                    sendResponse({ error: errMsg });
                } else {
                    sendResponse(response);
                }
            });
        };

        // First attempt to send. If there is no receiver, try injecting content scripts once.
        chrome.tabs.sendMessage(tab_id, message, async (response) => {
            const lastErr = chrome.runtime.lastError;
            if (lastErr && lastErr.message && lastErr.message.includes('Receiving end does not exist')) {
                console.warn('[iMacros SW] No receiver in tab. Attempting to inject content scripts...');
                const injected = await injectContentScripts();
                if (injected) {
                    sendMessageToTab();
                } else {
                    const errorMsg = lastErr && lastErr.message ? lastErr.message : 'No receiver in tab';
                    sendResponse({ error: errorMsg, injected: false });
                }
            } else if (lastErr) {
                console.warn('[iMacros SW] SEND_TO_TAB error:', lastErr.message);
                sendResponse({ error: lastErr.message });
            } else {
                sendResponse(response);
            }
        });
        return true;
    }

    // --- BROADCAST_TO_WINDOW: Broadcast message to all tabs in a window ---
    if (msg.command === 'BROADCAST_TO_WINDOW') {
        const { win_id, message } = msg;
        if (!win_id || !message) {
            sendResponse({ error: 'Missing win_id or message' });
            return true;
        }

        chrome.tabs.query({ windowId: win_id }, (tabs) => {
            if (chrome.runtime.lastError) {
                console.error('[iMacros SW] BROADCAST_TO_WINDOW query error:', chrome.runtime.lastError);
                sendResponse({ error: chrome.runtime.lastError.message });
                return;
            }

            if (!tabs || tabs.length === 0) {
                sendResponse({ error: 'No tabs found in window' });
                return;
            }

            // Send to all tabs
            let sentCount = 0;
            tabs.forEach((tab) => {
                chrome.tabs.sendMessage(tab.id, message, () => {
                    // Ignore errors for individual tabs (may not have content script)
                    sentCount++;
                });
            });

            sendResponse({ success: true, tabCount: tabs.length });
        });
        return true;
    }

    // --- TAB_QUERY: Query tabs from Offscreen Document ---
    if (msg.command === 'TAB_QUERY') {
        chrome.tabs.query(msg.queryInfo || {}, (tabs) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ tabs: tabs });
            }
        });
        return true;
    }

    // --- TAB_GET: Get single tab info ---
    if (msg.command === 'TAB_GET') {
        chrome.tabs.get(msg.tab_id, (tab) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ tab: tab });
            }
        });
        return true;
    }

    // --- TAB_UPDATE: Update tab ---
    if (msg.command === 'TAB_UPDATE') {
        chrome.tabs.update(msg.tab_id, msg.updateProperties || {}, (tab) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ tab: tab });
            }
        });
        return true;
    }

    // --- tabs_update: Legacy alias used by macro player ---
    if (msg.command === 'tabs_update') {
        const tabId = msg.id || msg.tab_id;
        chrome.tabs.update(tabId, msg.updateProperties || {}, (tab) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ tab: tab });
            }
        });
        return true;
    }

    // --- TAB_REMOVE: Remove tab(s) ---
    if (msg.command === 'TAB_REMOVE') {
        const tabIds = Array.isArray(msg.tab_ids) ? msg.tab_ids : [msg.tab_id];
        chrome.tabs.remove(tabIds, () => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true });
            }
        });
        return true;
    }

    // --- TAB_CREATE: Create new tab ---
    if (msg.command === 'TAB_CREATE') {
        chrome.tabs.create(msg.createProperties || {}, (tab) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ tab: tab });
            }
        });
        return true;
    }

    // --- WINDOW_GET: Get window info ---
    if (msg.command === 'WINDOW_GET') {
        chrome.windows.get(msg.win_id, msg.getInfo || {}, (win) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ window: win });
            }
        });
        return true;
    }

    // --- WINDOW_UPDATE: Update window ---
    if (msg.command === 'WINDOW_UPDATE') {
        chrome.windows.update(msg.win_id, msg.updateInfo || {}, (win) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ window: win });
            }
        });
        return true;
    }

    // --- TAB_CAPTURE: Capture visible tab ---
    if (msg.command === 'TAB_CAPTURE') {
        chrome.tabs.captureVisibleTab(msg.win_id, msg.options || {}, (dataUrl) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ dataUrl: dataUrl });
            }
        });
        return true;
    }

    // Handle re-init file system request from Options page
    if (msg.command === "reinitFileSystem") {
        console.log('[iMacros SW] Forwarding reinitFileSystem to Offscreen');
        chrome.runtime.sendMessage({
            target: "offscreen",
            command: "reinitFileSystem"
        }, (response) => {
            sendResponse(response);
        });
        return true;
    }

    // --- 録画開始 (startRecording) ---
    if (msg.command === "startRecording") {
        console.log("[iMacros SW] Route: startRecording -> Offscreen");

        resolveTargetWindowId(msg.win_id, sender).then(win_id => {
            if (!win_id) {
                console.error("[iMacros SW] Cannot determine win_id for startRecording");
                sendResponse({ error: "Cannot determine window ID" });
                return;
            }

            console.log("[iMacros SW] Resolved win_id for startRecording:", win_id);

            sendMessageToOffscreen({
                command: "CALL_CONTEXT_METHOD",
                method: "recorder.start",
                win_id: win_id
            }).then(result => {
                console.log("[iMacros SW] startRecording result:", result);
            }).catch(err => {
                console.error("[iMacros SW] startRecording error:", err);
            });

            sendResponse({ success: true });
        });

        return true;
    }

    // --- 停止 (stop) ---
    if (msg.command === "stop") {
        console.log("[iMacros SW] Route: stop -> Offscreen");

        resolveTargetWindowId(msg.win_id, sender).then(win_id => {
            if (!win_id) {
                console.error("[iMacros SW] Cannot determine win_id for stop");
                sendResponse({ error: "Cannot determine window ID" });
                return;
            }

            console.log("[iMacros SW] Resolved win_id for stop:", win_id);

            sendMessageToOffscreen({
                command: "CALL_CONTEXT_METHOD",
                method: "stop",
                win_id: win_id
            }).then(result => {
                console.log("[iMacros SW] stop result:", result);
            }).catch(err => {
                console.error("[iMacros SW] stop error:", err);
            });

            sendResponse({ success: true });
        });

        return true;
    }

    // --- アクティブタブ取得 (GET_ACTIVE_TAB / get_active_tab) ---
    if (msg.command === "GET_ACTIVE_TAB" || msg.type === "GET_ACTIVE_TAB" || msg.command === "get_active_tab") {
        (async () => {
            try {
                // Determine the correct window ID
                let targetWindowId = msg.win_id;

                // If no window ID specified, try to get from sender or use current window
                if (!targetWindowId) {
                    if (sender.tab && sender.tab.windowId) {
                        targetWindowId = sender.tab.windowId;
                    }
                }

                if (!targetWindowId) {
                    // Fall back to last focused window
                    try {
                        const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
                        if (win) targetWindowId = win.id;
                    } catch (e) { /* ignore */ }
                }

                let tab = null;
                if (targetWindowId) {
                    try {
                        const tabs = await chrome.tabs.query({ active: true, windowId: targetWindowId });
                        if (tabs && tabs.length > 0) tab = tabs[0];
                    } catch (e) {
                        console.error("[iMacros SW] tabs.query failed:", e);
                    }
                }

                // If still not found, search all normal windows
                if (!tab) {
                    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
                    for (const w of windows) {
                        const tabs = await chrome.tabs.query({ active: true, windowId: w.id });
                        if (tabs && tabs.length > 0) {
                            tab = tabs[0];
                            break;
                        }
                    }
                }

                if (tab) {
                    console.log("[iMacros SW] Found active tab:", tab.id);
                    sendResponse({ tab: tab });
                } else {
                    console.warn("[iMacros SW] No active tab found");
                    sendResponse({ error: "No active tab found" });
                }
            } catch (err) {
                console.error("[iMacros SW] GET_ACTIVE_TAB error:", err);
                sendResponse({ error: err.message });
            }
        })();

        return true; // Keep channel open
    }

    // --- Helper: パネルウィンドウIDから親ウィンドウIDを解決 ---
    async function resolveTargetWindowId(msgWinId, sender) {
        // 1. メッセージに含まれるwin_idをチェック
        if (msgWinId) {
            // パネルウィンドウのIDの場合、親ウィンドウを探す
            const sessionData = await chrome.storage.session.get(null);

            // panel_XXX形式のキーから逆引き
            for (const [key, value] of Object.entries(sessionData)) {
                if (key.startsWith('panel_') && value === msgWinId) {
                    const parentWinId = parseInt(key.replace('panel_', ''), 10);
                    console.log(`[iMacros SW] Panel ${msgWinId} mapped to parent window ${parentWinId}`);
                    return parentWinId;
                }
            }

            // マッピングが見つからない場合、そのまま使う（通常のブラウザウィンドウIDの場合）
            return msgWinId;
        }

        // 2. senderからタブ情報がある場合
        if (sender.tab && sender.tab.windowId) {
            return sender.tab.windowId;
        }

        // 3. アクティブなウィンドウを取得
        try {
            const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
            if (windows.length > 0) {
                // 最初の通常ウィンドウを使用
                return windows[0].id;
            }
        } catch (e) {
            console.error("[iMacros SW] Failed to get windows:", e);
        }

        return null;
    }

    // --- 再生 (playMacro) ---
    if (msg.command === "playMacro") {
        console.log("[iMacros SW] Play request for:", msg.file_path);

        // win_idを取得（パネルウィンドウIDから親ウィンドウIDを解決）
        resolveTargetWindowId(msg.win_id, sender).then(win_id => {
            if (!win_id) {
                console.error("[iMacros SW] Cannot determine win_id for playMacro");
                sendResponse({ error: "Cannot determine window ID" });
                return;
            }

            console.log("[iMacros SW] Resolved win_id:", win_id);

            // Offscreenにファイル読み込みと再生を依頼
            sendMessageToOffscreen({
                command: "CALL_CONTEXT_METHOD",
                method: "playFile",
                win_id: win_id,
                args: [msg.file_path, msg.loop || 1]
            }).catch(err => {
                console.error("[iMacros SW] playFile error:", err);
            });

            sendResponse({ success: true });
        });

        return true;
    }

    // --- 編集 (editMacro) ---
    if (msg.command === "editMacro") {
        console.log("[iMacros SW] Edit request for:", msg.file_path);

        resolveTargetWindowId(msg.win_id, sender).then(win_id => {
            if (!win_id) {
                console.error("[iMacros SW] Cannot determine win_id for editMacro");
                sendResponse({ error: "Cannot determine window ID" });
                return;
            }

            console.log("[iMacros SW] Resolved win_id for edit:", win_id);

            // Offscreenにエディタ起動を依頼
            sendMessageToOffscreen({
                command: "CALL_CONTEXT_METHOD",
                method: "openEditor",
                win_id: win_id,
                args: [msg.file_path]
            }).then(result => {
                console.log("[iMacros SW] editMacro result:", result);
            }).catch(err => {
                console.error("[iMacros SW] editMacro error:", err);
            });

            sendResponse({ success: true });
        });

        return true;
    }

    // --- Cookie API Proxy ---
    if (msg.command === "cookies_getAll") {
        chrome.cookies.getAll(msg.details, (cookies) => {
            if (chrome.runtime.lastError) {
                console.error('[iMacros SW] cookies.getAll error:', chrome.runtime.lastError);
                sendResponse([]);
            } else {
                sendResponse(cookies);
            }
        });
        return true;
    }

    if (msg.command === "cookies_remove") {
        chrome.cookies.remove(msg.details, (details) => {
            if (chrome.runtime.lastError) {
                console.error('[iMacros SW] cookies.remove error:', chrome.runtime.lastError);
            }
            sendResponse(details);
        });
        return true;
    }

    // --- Proxy API Proxy ---
    if (msg.command === "proxy_set") {
        if (msg.config) {
            chrome.proxy.settings.set({ value: msg.config }, () => {
                if (chrome.runtime.lastError) {
                    console.error('[iMacros SW] proxy.set error:', chrome.runtime.lastError);
                }
                sendResponse({ status: "ok" });
            });
        } else {
            chrome.proxy.settings.clear({}, () => {
                if (chrome.runtime.lastError) {
                    console.error('[iMacros SW] proxy.clear error:', chrome.runtime.lastError);
                }
                sendResponse({ status: "ok" });
            });
        }
        return true;
    }

    if (msg.command === "proxy_get") {
        chrome.proxy.settings.get(msg.details || { 'incognito': false }, (config) => {
            if (chrome.runtime.lastError) {
                console.error('[iMacros SW] proxy.get error:', chrome.runtime.lastError);
                sendResponse({});
            } else {
                sendResponse(config);
            }
        });
        return true;
    }

    if (msg.type === 'QUERY_STATE') {
        const targetWin = msg.win_id;
        sendMessageToOffscreen({
            target: 'offscreen',
            type: 'QUERY_STATE',
            win_id: targetWin
        }).then((response) => {
            sendResponse(response || { ok: false });
        }).catch((error) => {
            console.warn('[iMacros SW] Failed to retrieve state from Offscreen:', error);
            sendResponse({ ok: false, error: error && error.message });
        });
        return true;
    }

    // Forward panel.js messages to Offscreen Document
    // Panel.js sends messages with types: CALL_BG_FUNCTION, CALL_CONTEXT_METHOD, etc.
    // NOTE: Content Script messages with 'topic' property are handled by communicator
    // handlers registered in bg.js - do NOT forward them here to avoid race conditions
    if (msg.type && (
        msg.type === 'CALL_BG_FUNCTION' ||
        msg.type === 'CALL_CONTEXT_METHOD' ||
        msg.type === 'SAVE_MACRO' ||
        msg.type === 'GET_RECORDER_STATE' ||
        msg.type === 'CHECK_MPLAYER_PAUSED' ||
        msg.type === 'PANEL_LOADED' ||
        msg.type === 'PANEL_CLOSING'
    )) {
        // Inject window ID so Offscreen handlers can filter correctly
        if (sender && sender.tab && sender.tab.windowId) {
            msg.win_id = sender.tab.windowId;
        }

        console.log('[iMacros SW] Forwarding message to Offscreen:', msg.type || msg.topic, 'win_id:', msg.win_id);

        // Forward to Offscreen Document with guaranteed delivery
        sendMessageToOffscreen(msg).then(response => {
            sendResponse(response);
        }).catch(error => {
            console.error('[iMacros SW] Failed to forward to Offscreen (sendMessageToOffscreen error):', error);
            sendResponse({ success: false, error: error ? error.message : "Unspecified error" });
        });
        return true; // Keep channel open for async response
    }
});

// Forward tab update events to Offscreen Document for macro player

// Global notification click listener
chrome.notifications.onClicked.addListener(function (n_id) {
    console.log('[iMacros SW] Notification clicked:', n_id);
    // Forward click event to Offscreen Document to handle logic (e.g. open editor)
    chrome.runtime.sendMessage({
        target: 'offscreen',
        command: 'notificationClicked',
        notificationId: n_id
    });
});

// =============================================================================
// Dialog Result Handlers (for popup dialogs like passwordDialog, promptDialog, etc.)
// These forward messages from dialog windows to offscreen document where dialogUtils runs
// =============================================================================

// Handle SET_DIALOG_RESULT - forward to offscreen
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SET_DIALOG_RESULT') {
        console.log('[iMacros SW] Forwarding SET_DIALOG_RESULT for window:', msg.windowId);
        sendMessageToOffscreen({
            target: 'offscreen',
            type: 'SET_DIALOG_RESULT',
            windowId: msg.windowId,
            response: msg.response
        }).then(result => {
            sendResponse(result || { success: true });
        }).catch(err => {
            console.error('[iMacros SW] SET_DIALOG_RESULT error:', err);
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }

    // Handle GET_DIALOG_ARGS - forward to offscreen
    if (msg.type === 'GET_DIALOG_ARGS') {
        console.log('[iMacros SW] Forwarding GET_DIALOG_ARGS for window:', msg.windowId);
        sendMessageToOffscreen({
            target: 'offscreen',
            type: 'GET_DIALOG_ARGS',
            windowId: msg.windowId
        }).then(result => {
            sendResponse(result || { success: false, error: 'No response from offscreen' });
        }).catch(err => {
            console.error('[iMacros SW] GET_DIALOG_ARGS error:', err);
            sendResponse({ success: false, error: err.message });
        });
        return true;
    }
});

// --- Helper to ensure Offscreen exists using our robust createOffscreen function ---
async function ensureOffscreenDocument() {
    return createOffscreen();
}

// --- [復元] Offscreen へメッセージを安全に送る関数 ---
// --- [復元] Offscreen へメッセージを安全に送る関数 ---
async function sendMessageToOffscreen(msg) {
    if (!msg.target) msg.target = 'offscreen';

    // Helper to send message
    const send = async () => {
        await ensureOffscreenDocument();
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(msg, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        });
    };

    try {
        return await send();
    } catch (e) {
        console.warn("[iMacros SW] Msg to offscreen failed, retrying once...", e.message);
        // Maybe Offscreen crashed or isn't ready. Wait a bit and force check.
        await new Promise(r => setTimeout(r, 100));
        // Force offscreen recreation could be too aggressive here if it's just 'Closing', 
        // but 'Receiving end does not exist' means it's gone.
        // creatingOffscreen is null, so ensureOffscreenDocument will check chrome.offscreen.hasDocument()

        try {
            return await send();
        } catch (e2) {
            console.error("[iMacros SW] Msg to offscreen failed permanently:", e2.message);
            // Resolve null to prevent unhandled rejections in caller, but log error
            return null;
        }
    }
}

// =============================================================================
// imacros:// URL Scheme Handler
// Provides Firefox-compatible imacros://run/?m=macro.iim functionality
// =============================================================================

// Listen for navigation attempts to imacros:// URLs
// Note: Chrome won't actually navigate to these URLs (they'll fail), but we can
// detect them via webNavigation.onBeforeNavigate and handle them appropriately
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    // Check if this is an imacros:// URL
    if (details.url && details.url.startsWith('imacros://')) {
        console.log('[iMacros SW] Intercepted imacros:// URL:', details.url);

        // Parse the imacros URL
        const imacrosMatch = details.url.match(/^imacros:\/\/run\/?(?:\?m=)?(.+)$/i);

        if (imacrosMatch) {
            let macroPath = imacrosMatch[1];
            try {
                macroPath = decodeURIComponent(macroPath);
            } catch (e) {
                // Ignore decode errors
            }

            console.log('[iMacros SW] Triggering macro execution:', macroPath);

            // Get the window ID from the tab
            const tab = await chrome.tabs.get(details.tabId);
            const windowId = tab.windowId;

            // Send message to offscreen to execute the macro
            await sendMessageToOffscreen({
                target: 'offscreen',
                command: 'runMacroByUrl',
                macroPath: macroPath,
                windowId: windowId,
                tabId: details.tabId
            });

            // Navigate back or to a blank page to prevent the error page
            try {
                await chrome.tabs.goBack(details.tabId);
            } catch (e) {
                // If goBack fails, navigate to about:blank
                await chrome.tabs.update(details.tabId, { url: 'about:blank' });
            }
        } else {
            console.warn('[iMacros SW] Unknown imacros:// URL format:', details.url);
        }
    }
}, { url: [{ schemes: ['imacros'] }] });

// Also listen for onErrorOccurred to catch failed imacros:// navigations
chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
    if (details.url && details.url.startsWith('imacros://')) {
        // Already handled in onBeforeNavigate, just log for debugging
        console.log('[iMacros SW] imacros:// navigation error (expected):', details.url);
    }
});

// Handle the runMacroByUrl command in the message listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.command === 'runMacroByUrl' && msg.target === 'background') {
        // Forward to offscreen document
        sendMessageToOffscreen({
            target: 'offscreen',
            command: 'runMacroByUrl',
            macroPath: msg.macroPath,
            windowId: msg.windowId,
            tabId: msg.tabId
        }).then(response => {
            sendResponse(response);
        }).catch(error => {
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }

    if (msg.command === 'openEditorWindow') {
        // Open the editor window
        chrome.windows.create({
            url: 'editor/editor.html',
            type: 'popup',
            width: 660,
            height: 520 // Slightly larger than content
        }, (win) => {
            console.log('[iMacros SW] Editor window created:', win.id);
        });
        return true;
    }

    // NOTE: openPanel command is handled by the main handler above (lines 221-302)
    // Do NOT add duplicate handler here - it causes panel to open twice
});
