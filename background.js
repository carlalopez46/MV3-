/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/
// Minimal localStorage shim to prevent ReferenceErrors during early importScripts
// execution in the MV3 service worker environment. A more complete polyfill is
// provided in utils.js, but we need this guard so that utils.js itself can load
// without the platform-provided localStorage API.
if (typeof globalThis.localStorage === 'undefined') {
    const memoryStore = new Map();
    globalThis.localStorage = {
        getItem: (key) => (memoryStore.has(key) ? memoryStore.get(key) : null),
        setItem: (key, value) => memoryStore.set(key, String(value)),
        removeItem: (key) => {
            memoryStore.delete(key);
        },
        clear: () => memoryStore.clear(),
        key: (index) => Array.from(memoryStore.keys())[index] ?? null,
        get length() {
            return memoryStore.size;
        },
        __isMinimalLocalStorageShim: true,
        __isInMemoryShim: true,
    };
}

try {
    importScripts(
        'utils.js',
        'badge.js',
        'promise-utils.js',
        'errorLogger.js',
        'VirtualFileService.js',
        'variable-manager.js',
        'AsyncFileIO.js',
        'mv3_messaging_bus.js',
        'mv3_state_machine.js'
    );
} catch (e) {
    console.error('Failed to import scripts:', e);
    throw e;
}

// Hydrate localStorage polyfill from chrome.storage.local
// This is critical for MV3 Service Workers where localStorage is not available
(function hydrateLocalStoragePolyfill() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(null, function(items) {
            if (chrome.runtime.lastError) {
                console.warn('[iMacros SW] Failed to hydrate localStorage polyfill:', chrome.runtime.lastError);
                return;
            }
            if (items && typeof _localStorageData !== 'undefined') {
                // Only hydrate keys with the localStorage namespace prefix
                // This avoids polluting localStorage with unrelated extension data
                var prefix = (typeof _LOCALSTORAGE_PREFIX === 'string') ? _LOCALSTORAGE_PREFIX : '__imacros_ls__:';
                var hydratedCount = 0;
                Object.keys(items).forEach(function(storageKey) {
                    if (storageKey.indexOf(prefix) !== 0) return;
                    var key = storageKey.slice(prefix.length);
                    _localStorageData[key] = String(items[storageKey]);
                    hydratedCount++;
                });
                console.log('[iMacros SW] localStorage polyfill hydrated with', hydratedCount, 'items');
            }
        });
    }
})();

// Background Service Worker for iMacros MV3
// Handles Offscreen Document lifecycle and event forwarding


// ---------------------------------------------------------
// MV3 infrastructure (message bus + state machine)
// ---------------------------------------------------------
const messagingBus = new MessagingBus(chrome.runtime, chrome.tabs, {
    maxRetries: 3,
    backoffMs: 150,
    ackTimeoutMs: 500
});

const sessionStorage = chrome.storage ? chrome.storage.session : null;
const localStorage = chrome.storage ? chrome.storage.local : null;
const storageCandidates = [sessionStorage, localStorage].filter(Boolean);

function removeFromSessionOrLocal(keys) {
    if (!storageCandidates.length) return Promise.reject(new Error('Storage not available'));
    return performStorageWithFallback('remove', keys);
}

function setInSessionOrLocal(items) {
    if (!storageCandidates.length) return Promise.reject(new Error('Storage not available'));
    return performStorageWithFallback('set', items);
}

function getFromSessionOrLocal(keys) {
    if (!storageCandidates.length) return Promise.reject(new Error('Storage not available'));
    return performStorageWithFallback('get', keys);
}

async function performStorageWithFallback(method, payload) {
    let lastError = null;
    for (const storage of storageCandidates) {
        if (!storage || typeof storage[method] !== 'function') continue;
        try {
            if (method === 'get') {
                return await new Promise((resolve, reject) => {
                    storage.get(payload, (result) => {
                        if (chrome.runtime && chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                            return;
                        }
                        resolve(result || {});
                    });
                });
            }

            await new Promise((resolve, reject) => {
                storage[method](payload, () => {
                    if (chrome.runtime && chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                        return;
                    }
                    resolve(true);
                });
            });
            return true;
        } catch (error) {
            console.warn(`[iMacros SW] Storage ${method} failed on preferred backend, attempting fallback:`, error);
            lastError = error;
        }
    }
    throw lastError || new Error(`Storage ${method} failed`);
}

const executionStateStorage = sessionStorage || localStorage;
const clearStaleExecutionState = executionStateStorage === localStorage
    ? removeFromSessionOrLocal(['executionState']).catch((error) => {
        console.warn('[iMacros SW] Failed to clear persisted execution state on startup:', error);
    })
    : Promise.resolve(true);

const executionState = new ExecutionStateMachine({
    storage: executionStateStorage,
    alarmNamespace: chrome.alarms,
    heartbeatMinutes: 1 // Chrome MV3 periodic alarms clamp values below 1 minute up to 1 minute
});

clearStaleExecutionState.finally(() => {
    executionState.hydrate().catch((error) => {
        console.warn('[iMacros SW] Failed to hydrate execution state:', error);
    });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    executionState.handleAlarm(alarm).catch((error) => {
        console.warn('[iMacros SW] Heartbeat persistence failed:', error);
    });
});

function logForwardingError(context, error) {
    const message = error && error.message ? error.message : String(error);
    console.warn(`[iMacros SW] ${context} forwarding failed:`, message, error);
}

function removeWindowWithLog(windowId, context) {
    return new Promise((resolve) => {
        if (!chrome.windows || typeof chrome.windows.remove !== 'function') {
            resolve();
            return;
        }
        chrome.windows.remove(windowId, () => {
            if (chrome.runtime && chrome.runtime.lastError) {
                console.warn(`[iMacros SW] Failed to remove ${context} window during cleanup:`, chrome.runtime.lastError);
            }
            resolve();
        });
    });
}

async function transitionState(phase, meta, context) {
    try {
        await executionState.transition(phase, meta);
        return true;
    } catch (error) {
        console.warn(`[iMacros SW] State transition failed during ${context}:`, error);
        return false;
    }
}

async function forwardToOffscreen(payload) {
    try {
        await ensureOffscreenDocument();
    } catch (error) {
        console.warn('[iMacros SW] Failed to ensure offscreen document before forwarding:', error);
        throw error;
    }
    return messagingBus.sendRuntime({ target: 'offscreen', ...payload });
}

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

// Initialize on startup and install with guarded error handling to avoid unhandled rejections
const logOffscreenError = (context, error) => {
    console.error(`[iMacros SW] Failed to create offscreen during ${context}:`, error);
};

chrome.runtime.onStartup.addListener(() => {
    createOffscreen().catch((error) => logOffscreenError('onStartup', error));
});

chrome.runtime.onInstalled.addListener((details) => {
    const reason = details && details.reason ? `onInstalled:${details.reason}` : 'onInstalled';
    createOffscreen().catch((error) => logOffscreenError(reason, error));
});

function persistEditorLaunchData(editorData) {
    if (editorData === null || typeof editorData !== 'object' || Array.isArray(editorData)) {
        return Promise.reject(new Error('Editor launch payload must be an object'));
    }
    return setInSessionOrLocal(editorData);
}

// Forward action click to Offscreen
    chrome.action.onClicked.addListener(async (tab) => {
        try {
            await createOffscreen();
        } catch (error) {
            logOffscreenError('action.onClicked', error);
            return;
        }
    try {
        const transitioned = await transitionState('playing', { source: 'action_click', tabId: tab?.id }, 'action click');
        if (!transitioned) {
            console.warn('[iMacros SW] actionClicked: state transition failed');
            return;
        }
        await forwardToOffscreen({
            command: 'actionClicked',
            tab: tab
        });
    } catch (error) {
        logForwardingError('actionClicked', error);
    }
});

// Global panel ID - ensure only one panel is open at a time
let globalPanelId = null;
// Flag to prevent multiple panel creations
let isCreatingPanel = false;

// Restore globalPanelId from storage on startup
getFromSessionOrLocal(['globalPanelId']).then((result) => {
    if (result.globalPanelId) {
        // Verify the panel still exists
        chrome.windows.get(result.globalPanelId, (panelWin) => {
            if (!chrome.runtime.lastError && panelWin) {
                globalPanelId = result.globalPanelId;
                console.log('[iMacros SW] Restored globalPanelId from storage:', globalPanelId);
            } else {
                // Panel no longer exists, clear from storage
                removeFromSessionOrLocal(['globalPanelId']).catch((storageError) => {
                    console.warn('[iMacros SW] Failed to clear stale globalPanelId from storage:', storageError);
                });
            }
        });
    }
}).catch((error) => {
    console.warn('[iMacros SW] Failed to read globalPanelId from storage:', error);
});

// Listen for window removal to clear globalPanelId
chrome.windows.onRemoved.addListener(async (windowId) => {
    if (windowId === globalPanelId) {
        console.log('[iMacros SW] Panel window closed:', windowId);
        globalPanelId = null;
        try {
            await removeFromSessionOrLocal(['globalPanelId']);
        } catch (error) {
            console.warn('[iMacros SW] Failed to remove panel id from storage:', error);
        }
        await transitionState('idle', { source: 'panelClosed', windowId }, 'panel close');

        // Notify Offscreen Document that panel was closed
        try {
            await forwardToOffscreen({
                command: 'panelClosed',
                panelId: windowId
            });
        } catch (error) {
            logForwardingError('panelClosed', error);
        }
    }
});

// --- Tab Event Forwarding to Offscreen ---
// The Offscreen Document does not receive chrome.tabs events, so we must forward them.

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    forwardToOffscreen({
        type: 'TAB_UPDATED',
        tabId: tabId,
        changeInfo: changeInfo,
        tab: tab
    }).catch((error) => logForwardingError('TAB_UPDATED', error));
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    forwardToOffscreen({
        type: 'TAB_ACTIVATED',
        activeInfo: activeInfo
    }).catch((error) => logForwardingError('TAB_ACTIVATED', error));
});

chrome.tabs.onCreated.addListener((tab) => {
    forwardToOffscreen({
        type: 'TAB_CREATED',
        tab: tab
    }).catch((error) => logForwardingError('TAB_CREATED', error));
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    forwardToOffscreen({
        type: 'TAB_REMOVED',
        tabId: tabId,
        removeInfo: removeInfo
    }).catch((error) => logForwardingError('TAB_REMOVED', error));
});

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
    forwardToOffscreen({
        type: 'TAB_MOVED',
        tabId: tabId,
        moveInfo: moveInfo
    }).catch((error) => logForwardingError('TAB_MOVED', error));
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
    forwardToOffscreen({
        type: 'TAB_ATTACHED',
        tabId: tabId,
        attachInfo: attachInfo
    }).catch((error) => logForwardingError('TAB_ATTACHED', error));
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
    forwardToOffscreen({
        type: 'TAB_DETACHED',
        tabId: tabId,
        detachInfo: detachInfo
    }).catch((error) => logForwardingError('TAB_DETACHED', error));
});

// Forward download events to Offscreen Document for ONDOWNLOAD command support
// Track active downloads with correlation data for routing to correct MacroPlayer
const activeDownloadCorrelation = new Map();

if (chrome.downloads && chrome.downloads.onCreated) {
    chrome.downloads.onCreated.addListener((downloadItem) => {
        // Include correlation data if available
        const correlation = activeDownloadCorrelation.get(downloadItem.id) || {};
        forwardToOffscreen({
            type: 'DOWNLOAD_CREATED',
            downloadItem: downloadItem,
            win_id: correlation.win_id,
            tab_id: correlation.tab_id
        }).catch((error) => logForwardingError('DOWNLOAD_CREATED', error));
    });
}

if (chrome.downloads && chrome.downloads.onChanged) {
    chrome.downloads.onChanged.addListener((downloadDelta) => {
        // Include correlation data if available
        const correlation = activeDownloadCorrelation.get(downloadDelta.id) || {};
        forwardToOffscreen({
            type: 'DOWNLOAD_CHANGED',
            downloadDelta: downloadDelta,
            win_id: correlation.win_id,
            tab_id: correlation.tab_id
        }).catch((error) => logForwardingError('DOWNLOAD_CHANGED', error));

        // Clean up correlation data when download completes or is interrupted
        if (downloadDelta.state && (downloadDelta.state.current === 'complete' || downloadDelta.state.current === 'interrupted')) {
            activeDownloadCorrelation.delete(downloadDelta.id);
        }
    });
}


// Keep-alive logic (optional, but good for stability)
// If Offscreen sends a keep-alive message, we can respond to keep SW alive
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const isTrustedSender = sender && sender.id === chrome.runtime.id;
    const isOffscreenSender = isTrustedSender && typeof sender.url === 'string' && sender.url.endsWith('/offscreen.html');
    const rejectInvalidSender = () => {
        sendResponse({ error: 'invalid sender' });
        return true;
    };

    const isValidTabId = (value) => Number.isInteger(value) && value >= 0;
    const isValidObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

    if (msg.keepAlive) {
        sendResponse({ alive: true });
        return true;
    }

    if (msg.command === 'UPDATE_EXECUTION_STATE' && typeof msg.state === 'string') {
        executionState.transition(msg.state, msg.meta || {}).then((snapshot) => {
            sendResponse({ success: true, state: snapshot });
        }).catch((error) => {
            console.error('[iMacros SW] Failed to update execution state:', error);
            sendResponse({ success: false, error: error && error.message ? error.message : String(error) });
        });
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
                    removeFromSessionOrLocal(['globalPanelId']).catch((error) => {
                        console.warn('[iMacros SW] Failed to clear stale globalPanelId during recreation:', error);
                    });
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
                }, async (panelWin) => {
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
                    try {
                        const transitioned = await transitionState('editing', { panelId: panelWin.id, windowId: win_id }, 'panel creation');
                        if (!transitioned) {
                            throw new Error('State transition failed during panel creation');
                        }

                        await forwardToOffscreen({
                            command: "panelCreated",
                            win_id: win_id,
                            panelId: panelWin.id
                        });
                    } catch (error) {
                        logForwardingError('panelCreated', error);
                        await transitionState('idle', { source: 'panelCreateRollback', windowId: win_id }, 'panel creation rollback');
                        globalPanelId = null;
                        try {
                            await removeFromSessionOrLocal(['globalPanelId', `panel_${win_id}`]);
                        } catch (storageError) {
                            console.warn('[iMacros SW] Failed to clear panel ids during rollback:', storageError);
                        }
                        await removeWindowWithLog(panelWin.id, 'panel');
                        if (respond) respond({ success: false, error: error && error.message ? error.message : String(error) });
                        return;
                    }

                    // Store in storage for persistence
                    try {
                        await setInSessionOrLocal({ [`panel_${win_id}`]: panelWin.id, globalPanelId: panelWin.id });
                    } catch (error) {
                        console.warn('[iMacros SW] Exception while persisting panel ID to storage:', error);
                    }

                    if (respond) respond({ success: true, panelId: panelWin.id });
                });
            });
        }

        return true;
    }

    // Handle editor window creation request from Offscreen Document
    if (msg.command === "openEditorWindow") {
        const editorData = msg.editorData;

        const persistPromise = editorData ? persistEditorLaunchData(editorData) : Promise.resolve();

        persistPromise.then(() => {
            chrome.windows.create({
                url: "editor/editor.html",
                type: "popup",
                width: 640,
                height: 480
            }, async (win) => {
                if (chrome.runtime.lastError) {
                    console.error('[iMacros SW] Failed to create editor window:', chrome.runtime.lastError);
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    console.log('[iMacros SW] Editor window created:', win.id);
                    try {
                        const transitioned = await transitionState('editing', { windowId: win.id, source: 'editor' }, 'editor creation');
                        if (!transitioned) {
                            await transitionState('idle', { source: 'editor rollback' }, 'editor creation rollback');
                            await removeWindowWithLog(win.id, 'editor');
                            sendResponse({ success: false, error: 'State transition failed during editor creation' });
                            return;
                        }
                        sendResponse({ success: true, windowId: win.id });
                    } catch (error) {
                        console.error('[iMacros SW] Editor state transition failed:', error);
                        await transitionState('idle', { source: 'editor rollback' }, 'editor creation rollback');
                        await removeWindowWithLog(win.id, 'editor');
                        sendResponse({ success: false, error: error && error.message ? error.message : String(error) });
                    }
                }
            });
        }).catch((error) => {
            console.error('[iMacros SW] Failed to persist editor data:', error);
            sendResponse({ success: false, error: error && error.message ? error.message : String(error) });
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

    // --- UPDATE_BADGE: Proxy badge updates from Offscreen Document ---
    if (msg.type === 'UPDATE_BADGE') {
        const { method, winId, arg } = msg;
        const actionApi = chrome.action || chrome.browserAction;

        if (!actionApi) {
            console.warn('[iMacros SW] No action API available for badge update');
            return false;
        }

        // Helper to iterate all tabs in a window
        const forAllTabs = (win_id, callback) => {
            chrome.windows.getAll({ populate: true }, (windows) => {
                if (chrome.runtime.lastError) {
                    console.warn('[iMacros SW] Error getting windows:', chrome.runtime.lastError.message);
                    return;
                }
                windows.forEach((win) => {
                    if (win.id === win_id && Array.isArray(win.tabs)) {
                        win.tabs.forEach((tab) => callback(tab));
                    }
                });
            });
        };

        switch (method) {
            case 'setBackgroundColor':
                forAllTabs(winId, (tab) => {
                    try {
                        actionApi.setBadgeBackgroundColor({ tabId: tab.id, color: arg });
                    } catch (e) { /* ignore */ }
                });
                break;
            case 'setText':
                forAllTabs(winId, (tab) => {
                    try {
                        actionApi.setBadgeText({ tabId: tab.id, text: arg || '' });
                    } catch (e) { /* ignore */ }
                });
                break;
            case 'setIcon':
                forAllTabs(winId, (tab) => {
                    try {
                        actionApi.setIcon({ tabId: tab.id, path: arg });
                    } catch (e) { /* ignore */ }
                });
                break;
            default:
                console.warn('[iMacros SW] Unknown badge method:', method);
        }
        return false; // No response needed
    }

    // --- SCRIPTING_EXECUTE: Proxy chrome.scripting.executeScript from Offscreen Document ---
    if (msg.command === 'SCRIPTING_EXECUTE') {
        if (!isOffscreenSender) {
            return rejectInvalidSender();
        }

        const { tabId, func, args } = msg;
        if (!isValidTabId(tabId) || typeof func !== 'string' || (args !== undefined && !Array.isArray(args))) {
            sendResponse({ error: 'invalid input' });
            return true;
        }
        if (!chrome.scripting || !chrome.scripting.executeScript) {
            sendResponse({ error: 'chrome.scripting not available' });
            return true;
        }

        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: new Function('return (' + func + ')(...arguments)'),
            args: args || []
        }, (results) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, results: results });
            }
        });
        return true;
    }

    // --- DEBUGGER_ATTACH: Proxy chrome.debugger.attach from Offscreen Document ---
    if (msg.command === 'DEBUGGER_ATTACH') {
        if (!isOffscreenSender) {
            return rejectInvalidSender();
        }

        const { tabId, version } = msg;
        if (!isValidTabId(tabId) || (version !== undefined && typeof version !== 'string')) {
            sendResponse({ error: 'invalid input' });
            return true;
        }
        if (!chrome.debugger || !chrome.debugger.attach) {
            sendResponse({ error: 'chrome.debugger not available' });
            return true;
        }

        chrome.debugger.attach({ tabId: tabId }, version || '1.2', () => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true });
            }
        });
        return true;
    }

    // --- DEBUGGER_SEND_COMMAND: Proxy chrome.debugger.sendCommand from Offscreen Document ---
    if (msg.command === 'DEBUGGER_SEND_COMMAND') {
        if (!isOffscreenSender) {
            return rejectInvalidSender();
        }

        const { tabId, method, params } = msg;
        if (!isValidTabId(tabId) || typeof method !== 'string' || (params !== undefined && !isValidObject(params))) {
            sendResponse({ error: 'invalid input' });
            return true;
        }
        if (!chrome.debugger || !chrome.debugger.sendCommand) {
            sendResponse({ error: 'chrome.debugger not available' });
            return true;
        }

        chrome.debugger.sendCommand({ tabId: tabId }, method, params || {}, (result) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, result: result });
            }
        });
        return true;
    }

    // --- DEBUGGER_DETACH: Proxy chrome.debugger.detach from Offscreen Document ---
    if (msg.command === 'DEBUGGER_DETACH') {
        if (!isOffscreenSender) {
            return rejectInvalidSender();
        }

        const { tabId } = msg;
        if (!isValidTabId(tabId)) {
            sendResponse({ error: 'invalid input' });
            return true;
        }
        if (!chrome.debugger || !chrome.debugger.detach) {
            sendResponse({ error: 'chrome.debugger not available' });
            return true;
        }

        chrome.debugger.detach({ tabId: tabId }, () => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true });
            }
        });
        return true;
    }

    // --- DOWNLOADS_DOWNLOAD: Proxy chrome.downloads.download from Offscreen Document ---
    if (msg.command === 'DOWNLOADS_DOWNLOAD') {
        if (!isOffscreenSender) {
            return rejectInvalidSender();
        }

        const { options, win_id, tab_id } = msg;
        if (!isValidObject(options) || (win_id !== undefined && !isValidTabId(win_id)) || (tab_id !== undefined && !isValidTabId(tab_id))) {
            sendResponse({ error: 'invalid input' });
            return true;
        }
        if (!chrome.downloads || !chrome.downloads.download) {
            sendResponse({ error: 'chrome.downloads not available' });
            return true;
        }

        chrome.downloads.download(options || {}, (downloadId) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                // Store correlation data for routing download events to correct MacroPlayer
                if (downloadId && (win_id || tab_id)) {
                    activeDownloadCorrelation.set(downloadId, { win_id, tab_id });
                }
                sendResponse({ success: true, downloadId: downloadId });
            }
        });
        return true;
    }

    // --- COOKIES_CLEAR: Proxy chrome.cookies for CLEAR command from Offscreen Document ---
    if (msg.command === 'COOKIES_CLEAR') {
        const { details } = msg;
        if (!chrome.cookies || !chrome.cookies.getAll) {
            sendResponse({ error: 'chrome.cookies not available' });
            return true;
        }

        chrome.cookies.getAll(details || {}, (cookies) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
                return;
            }

            if (!cookies || cookies.length === 0) {
                sendResponse({ success: true, removed: 0 });
                return;
            }

            // Use Promise.all with timeout for robust completion tracking
            const COOKIE_REMOVAL_TIMEOUT_MS = 10000; // 10 second timeout
            let responded = false;

            const removePromises = cookies.map((cookie) => {
                return new Promise((resolve) => {
                    // Strip leading dot from domain (e.g., ".example.com" -> "example.com")
                    const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
                    const url = (cookie.secure ? "https" : "http") + "://" + domain + cookie.path;
                    chrome.cookies.remove({ url: url, name: cookie.name }, (details) => {
                        // Check for errors and resolve with success status
                        if (chrome.runtime.lastError) {
                            console.warn('[iMacros SW] Cookie removal failed:', cookie.name, chrome.runtime.lastError.message);
                            resolve(false);
                        } else {
                            resolve(details !== null);
                        }
                    });
                });
            });

            // Timeout fallback to prevent indefinite waiting
            const timeoutPromise = new Promise((resolve) => {
                setTimeout(() => {
                    resolve({ timeout: true });
                }, COOKIE_REMOVAL_TIMEOUT_MS);
            });

            Promise.race([
                Promise.all(removePromises).then((results) => ({ results })),
                timeoutPromise
            ]).then((outcome) => {
                if (responded) return;
                responded = true;

                if (outcome.timeout) {
                    console.warn('[iMacros SW] Cookie removal timed out');
                    sendResponse({ success: true, removed: -1, warning: 'timeout' });
                } else {
                    const removed = outcome.results.filter(Boolean).length;
                    sendResponse({ success: true, removed: removed });
                }
            }).catch((err) => {
                if (responded) return;
                responded = true;
                sendResponse({ error: err && err.message ? err.message : String(err) });
            });
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

        const CONTENT_SCRIPT_FILES = [
            'utils.js',
            'errorLogger.js',
            'content_scripts/connector.js',
            'content_scripts/recorder.js',
            'content_scripts/player.js'
        ];

        const RESTRICTED_SCHEMES = ['chrome://', 'edge://', 'about:', 'file://', 'chrome-extension://'];

        const checkHostPermissions = async () => {
            try {
                const granted = await chrome.permissions.contains({ origins: ['<all_urls>', 'file:///*'] });
                return granted;
            } catch (e) {
                // If the API is unavailable or throws, fail open so we still attempt injection
                console.warn('[iMacros SW] Unable to verify host permissions:', e);
                return true;
            }
        };

        const injectContentScripts = async () => {
            // Best-effort injection for cases where the content script was not injected (e.g., site access off)
            try {
                const tab = await chrome.tabs.get(tab_id).catch(() => null);
                if (!tab || !tab.url) {
                    return { injected: false };
                }

                if (RESTRICTED_SCHEMES.some((scheme) => tab.url.startsWith(scheme))) {
                    console.warn('[iMacros SW] Skipping content script injection due to restricted scheme:', tab.url);
                    return { injected: false, restricted: true };
                }

                const hasHostPermissions = await checkHostPermissions();
                if (!hasHostPermissions) {
                    console.warn('[iMacros SW] Host permissions not granted; cannot inject content scripts');
                    return { injected: false, missingHostPermissions: true };
                }

                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab_id, allFrames: true },
                        files: CONTENT_SCRIPT_FILES
                    });
                    return { injected: true };
                } catch (err) {
                    const msg = err && err.message ? err.message : err;
                    console.warn('[iMacros SW] Failed to inject content scripts:', msg);
                    return { injected: false, error: msg };
                }
            } catch (e) {
                console.warn('[iMacros SW] Exception during content script injection:', e);
                return { injected: false, error: e && e.message ? e.message : String(e) };
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
            const lastErrMsg = lastErr && lastErr.message ? lastErr.message : '';
            if (lastErrMsg && lastErrMsg.includes('Receiving end does not exist')) {
                console.warn('[iMacros SW] No receiver in tab. Attempting to inject content scripts...');
                const injectionResult = await injectContentScripts();
                if (injectionResult.injected) {
                    sendMessageToTab();
                } else if (injectionResult.missingHostPermissions) {
                    sendResponse({
                        error: 'Content scripts not injected: host permissions are not granted for this site. Enable access to all sites in the extension settings.',
                        injected: false,
                        missingHostPermissions: true
                    });
                } else {
                    const errorMsg = lastErrMsg || 'No receiver in tab';
                    sendResponse({ error: `${errorMsg}; content script injection failed or not allowed`, injected: false });
                }
            } else if (lastErrMsg) {
                console.warn('[iMacros SW] SEND_TO_TAB error:', lastErrMsg);
                sendResponse({ error: lastErrMsg });
            } else {
                sendResponse(response);
            }
        });
        return true;
    }

    // --- BROADCAST_TO_WINDOW: Broadcast message to all tabs in a window (or all tabs if win_id not specified) ---
    if (msg.command === 'BROADCAST_TO_WINDOW') {
        const { win_id, message } = msg;
        if (!message) {
            sendResponse({ error: 'Missing message' });
            return true;
        }

        const queryInfo = win_id ? { windowId: win_id } : {};

        chrome.tabs.query(queryInfo, (tabs) => {
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
                if (result && typeof result.success !== 'undefined') {
                    sendResponse(result);
                } else {
                    sendResponse({ success: true });
                }
            }).catch(err => {
                console.error("[iMacros SW] startRecording error:", err);
                sendResponse({ success: false, error: (err && err.message) || String(err) });
            });
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
                if (result && typeof result.success !== 'undefined') {
                    sendResponse(result);
                } else {
                    sendResponse({ success: true });
                }
            }).catch(err => {
                console.error("[iMacros SW] stop error:", err);
                sendResponse({ success: false, error: (err && err.message) || String(err) });
            });
        });

        return true;
    }

    // --- 一時停止 (pause) ---
    if (msg.command === "pause") {
        console.log("[iMacros SW] Route: pause -> Offscreen");

        resolveTargetWindowId(msg.win_id, sender).then(win_id => {
            if (!win_id) {
                console.error("[iMacros SW] Cannot determine win_id for pause");
                sendResponse({ error: "Cannot determine window ID" });
                return;
            }

            console.log("[iMacros SW] Resolved win_id for pause:", win_id);

            sendMessageToOffscreen({
                command: "CALL_CONTEXT_METHOD",
                method: "pause",
                win_id: win_id
            }).then(result => {
                console.log("[iMacros SW] pause result:", result);
                if (result && typeof result.success !== 'undefined') {
                    sendResponse(result);
                } else {
                    sendResponse({ success: true });
                }
            }).catch(err => {
                console.error("[iMacros SW] pause error:", err);
                sendResponse({ success: false, error: (err && err.message) || String(err) });
            });
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
            let sessionData = {};
            try {
                sessionData = await getFromSessionOrLocal(null);
            } catch (error) {
                console.warn('[iMacros SW] Failed to read panel mapping from storage:', error);
                return null;
            }

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
            }).then(result => {
                console.log("[iMacros SW] playFile result:", result);
                if (result && typeof result.success !== 'undefined') {
                    sendResponse(result);
                } else {
                    sendResponse({ success: true });
                }
            }).catch(err => {
                console.error("[iMacros SW] playFile error:", err);
                sendResponse({ success: false, error: (err && err.message) || String(err) });
            });
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
    forwardToOffscreen({
        command: 'notificationClicked',
        notificationId: n_id
    }).catch((error) => logForwardingError('notificationClicked', error));
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

// --- Offscreen へメッセージを安全に送る関数 ---
async function sendMessageToOffscreen(msg) {
    const payload = { target: 'offscreen', ...msg };

    await ensureOffscreenDocument();
    try {
        return await messagingBus.sendRuntime(payload, { expectAck: true });
    } catch (err) {
        const genericPatterns = ['No ack received on channel', 'Ack timeout'];
        const isGeneric = genericPatterns.some(pat => err && err.message && err.message.includes(pat));
        if (isGeneric) {
            const context = [];
            if (msg.type) context.push(`type=${msg.type}`);
            if (msg.command) context.push(`command=${msg.command}`);
            if (msg.windowId !== undefined) context.push(`windowId=${msg.windowId}`);
            if (msg.tabId !== undefined) context.push(`tabId=${msg.tabId}`);
            const contextStr = context.length ? ` [${context.join(', ')}]` : '';
            throw new Error(`${err.message}${contextStr}`, { cause: err });
        }
        throw err;
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
            try {
                await sendMessageToOffscreen({
                    command: 'runMacroByUrl',
                    macroPath: macroPath,
                    windowId: windowId,
                    tabId: details.tabId
                });
            } catch (error) {
                console.error('[iMacros SW] Failed to trigger macro from imacros:// URL:', error);
            }

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

    // NOTE: openPanel command is handled by the main handler above (lines 221-302)
    // Do NOT add duplicate handler here - it causes panel to open twice
});

// NOTE: MessagingBus class is defined in mv3_messaging_bus.js (imported via importScripts)