/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

//
// Config
/* global FileSyncBridge, afio, communicator, registerSharedBackgroundHandlers */
"use strict";

//
// Common logic moved to bg_common.js
// Ensure handler registration only runs when the helper is available.
//

// Global handler for panel updates (called from bg_common.js)
self.updatePanels = function () {
    // In Service Worker, we cannot access DOM directly.
    // Ideally we should send a message to offscreen or panel to reload the tree.
    // For now, we log a warning as this functionality requires further refactoring for SW.
    console.log("[bg.js] updatePanels called, skipping DOM access in Service Worker");
};



// If bg_common has not been loaded (e.g., due to a previous load error), try to import it
// so the shared handlers are available just like in MV2.
if (typeof registerSharedBackgroundHandlers !== 'function') {
    try {
        importScripts('bg_common.js');
    } catch (e) {
        console.error("Failed to import bg_common.js for shared handlers", e);
    }
}

if (typeof registerSharedBackgroundHandlers === 'function') {
    registerSharedBackgroundHandlers(self);
} else {
    console.error("registerSharedBackgroundHandlers is not available; shared background handlers not registered");
}

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


// browser action button onclick handler
// Note: chrome.action is only available in Service Worker, not in Offscreen Document
if (typeof chrome !== 'undefined' && chrome.action && chrome.action.onClicked) {
    chrome.action.onClicked.addListener(function (tab) {
        var win_id = tab.windowId;
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
                var panel = ctx.panelWindow;
                if (!panel || panel.closed) {
                    openPanel(win_id);
                } else {
                    panel.close();
                    delete ctx.panelId;
                    delete ctx.panelWindow;
                }
            } else if (ctx.state === "paused") {
                if (mplayer.paused) {
                    // Switch to the tab where macro was paused before unpausing
                    if (ctx.pausedTabId) {
                        chrome.tabs.update(ctx.pausedTabId, { active: true }, function () {
                            if (chrome.runtime.lastError) {
                                logError("Failed to switch to paused tab: " + chrome.runtime.lastError.message, { pausedTabId: ctx.pausedTabId });
                                // Still try to unpause even if tab switch failed
                            }
                            // After switching tabs, unpause the macro
                            mplayer.unpause();
                        });
                    } else {
                        // If no tab_id was saved, just unpause
                        mplayer.unpause();
                    }
                }
            } else {
                if (mplayer.playing) {
                    mplayer.stop();
                } else if (recorder.recording) {
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

                                    // Save the file first, then open editor
                                    afio.writeTextFile(node, recorded_macro).then(function () {
                                        console.log('[iMacros MV3] #Current.iim saved successfully');
                                        edit(macro, /* overwrite */ true);
                                    }).catch(function (err) {
                                        logError('Failed to write #Current.iim: ' + err.message, {
                                            context: 'recording_stop',
                                            path: node.path,
                                            error: err
                                        });
                                        // Still open editor even if save failed
                                        edit(macro, true);
                                    });
                                }).catch(function (err) {
                                    logError('Failed to get save path for #Current.iim: ' + err.message, {
                                        context: 'recording_stop',
                                        tree_type: 'files',
                                        error: err
                                    });
                                    // Fallback to bookmark save
                                    console.warn('[iMacros MV3] Falling back to bookmark save for #Current.iim');
                                    delete macro.file_id;
                                    save(macro, true, function () {
                                        edit(macro, true);
                                    });
                                });
                            } else {            // no file access
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
                            // Fallback to bookmark save
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
    });
} // End of chrome.action.onClicked guard


function addSampleBookmarkletMacro(name, parentId, content) {
    return new Promise(function (resolve, reject) {
        // chrome.bookmarks is not available in Offscreen Document
        if (typeof chrome === 'undefined' || !chrome.bookmarks || !chrome.bookmarks.getChildren) {
            return resolve();
        }
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






function installProfilerXsl() {
    return afio.getDefaultDir("downpath").then(function (node) {
        return getSample("Profiler.xsl").then(function (file) {
            node.append("Profiler.xsl");
            return afio.writeTextFile(node, file.content);
        });
    });
}

function installAddressCsv() {
    return afio.getDefaultDir("datapath").then(function (node) {
        return getSample("Address.csv").then(function (file) {
            node.append("Address.csv");
            return afio.writeTextFile(node, file.content);
        });
    });
}

function installSampleBookmarkletMacros() {
    var names = [
        "ArchivePage.iim",
        "Eval.iim",
        "Extract.iim",
        "ExtractAndFill.iim",
        "ExtractRelative.iim",
        "ExtractTable.iim",
        "ExtractURL.iim",
        "FillForm-XPath.iim",
        "FillForm-Events.iim",
        "FillForm-CssSelectors.iim",
        "FillForm.iim",
        "Frame.iim",
        "Open6Tabs.iim",
        "SaveAs.iim",
        "SlideShow.iim",
        "Stopwatch.iim",
        "TagPosition.iim",
        "Upload.iim"
    ];

    return new Promise(function (resolve, reject) {
        // chrome.bookmarks is not available in Offscreen Document
        if (typeof chrome === 'undefined' || !chrome.bookmarks || !chrome.bookmarks.getTree) {
            console.log('[bg.js] chrome.bookmarks not available, skipping sample macro installation');
            return resolve();
        }
        chrome.bookmarks.getTree(function (tree) {
            if (chrome.runtime.lastError) {
                logError("Failed to get bookmark tree in installSampleBookmarkletMacros: " + chrome.runtime.lastError.message);
                return reject(chrome.runtime.lastError);
            }
            if (!tree || !tree[0] || !tree[0].children || !tree[0].children[0]) {
                logError("Invalid bookmark tree structure in installSampleBookmarkletMacros");
                return reject(new Error("Invalid bookmark tree structure"));
            }
            var panelId = tree[0].children[0].id
            ensureBookmarkFolderCreated(
                panelId, "iMacros"
            ).then(function (im) {
                return ensureBookmarkFolderCreated(im.id, "Demo-Chrome")
            }).then(function (node) {
                return names.map(getSample).reduce(function (seq, p) {
                    return seq.then(function () {
                        return p
                    }).then(macro => addSampleBookmarkletMacro(
                        macro.name, node.id, macro.content
                    ))
                }, Promise.resolve())
            }).then(resolve, reject);
        })
    })
}



// regexp to update bookmarked macros to newer version (e_m64)


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
        // get version number
        var manifestVersion = (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function')
            ? chrome.runtime.getManifest().version
            : '10.1.1';
        Storage.setChar("version", manifestVersion);
        installSampleBookmarkletMacros().catch(console.error.bind(console));
        // open welcome page
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
            chrome.tabs.create({
                url: getRedirFromString("welcome")
            }, function (tab) {
                if (chrome.runtime && chrome.runtime.lastError) {
                    console.error("Error creating welcome tab:", chrome.runtime.lastError);
                }
            });
        }
    } else {
        // Not first run - check if extension was updated
        var currentVersion = (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function')
            ? chrome.runtime.getManifest().version
            : '10.1.1';
        // check if macro was updated
        if (currentVersion != Storage.getChar("version")) {
            Storage.setChar("version", currentVersion);
            onUpdate();
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


function showNotification(win_id, args) {
    var opt = {
        type: "basic",
        title: (args.errorCode == 1 ? "iMacros" : "iMacros Error"),
        message: args.message,
        iconUrl: "skin/logo48.png",
        isClickable: true
    };
    chrome.notifications.create(win_id.toString(), opt, function (n_id) {
        if (chrome.runtime.lastError) {
            logError("Failed to create notification: " + chrome.runtime.lastError.message, { win_id: win_id });
        }
    });
}

// Global notification click listener
// Note: chrome.notifications is not available in Offscreen Document
if (typeof chrome !== 'undefined' && chrome.notifications && chrome.notifications.onClicked) {
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


// MV3 Note: Service workers don't have "unload" events.
// nm_connector.stopServer() doesn't need explicit calling in service workers.
// However, resource cleanup (dockInterval, panelWindow) is handled via
// chrome.windows.onRemoved listener below and in context.js.

// remove panel when its parent window is closed
// Note: chrome.windows is not available in Offscreen Document
if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.onRemoved) {
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
}

// Inject content scripts into existing tabs on installation/update
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

    // --- Offscreen Document Proxy Commands ---
    if (request.command === 'SEND_TO_TAB') {
        console.log(`[iMacros SW] SEND_TO_TAB tab:${request.tab_id}`, request.message);
        chrome.tabs.sendMessage(request.tab_id, request.message, (response) => {
            if (chrome.runtime.lastError) {
                console.warn(`[iMacros SW] SEND_TO_TAB failed tab:${request.tab_id}`, chrome.runtime.lastError.message);
                sendResponse({ error: chrome.runtime.lastError.message, found: false });
            } else {
                sendResponse(response);
            }
        });
        return true;
    }

    if (request.command === 'get_active_tab') {
        chrome.tabs.query({ active: true, windowId: request.win_id }, (tabs) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else if (tabs && tabs.length > 0) {
                sendResponse({ tab: tabs[0] });
            } else {
                sendResponse({ error: 'No active tab found' });
            }
        });
        return true;
    }

    // TAB Commands Proxy
    if (request.command === 'TAB_QUERY') {
        chrome.tabs.query(request.queryInfo, (tabs) => {
            if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message });
            else sendResponse({ tabs: tabs });
        });
        return true;
    }
    if (request.command === 'TAB_GET') {
        chrome.tabs.get(request.tab_id, (tab) => {
            if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message });
            else sendResponse({ tab: tab });
        });
        return true;
    }
    if (request.command === 'TAB_UPDATE') {
        chrome.tabs.update(request.tab_id, request.updateProperties, (tab) => {
            if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message });
            else sendResponse({ tab: tab });
        });
        return true;
    }
    if (request.command === 'TAB_REMOVE') {
        chrome.tabs.remove(request.tab_ids, () => {
            if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message });
            else sendResponse({ success: true });
        });
        return true;
    }
    if (request.command === 'TAB_CREATE') {
        chrome.tabs.create(request.createProperties, (tab) => {
            if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message });
            else sendResponse({ tab: tab });
        });
        return true;
    }
    if (request.type === 'UPDATE_BADGE') {
        const { method, winId, arg } = request;
        if (typeof badge !== 'undefined' && badge[method]) {
            badge[method](winId, arg);
        }
        if (sendResponse) sendResponse({ success: true });
        return true;
    }
});
// Service Worker Startup: Restore context for all open windows
// This is crucial because Service Worker memory is cleared on idle.
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

// Forward recorder messages to Offscreen Document
// NOTE: Only register these handlers in Service Worker context (where chrome.tabs is available)
// In Offscreen Document, these handlers would fail and cause race conditions
if (typeof chrome.tabs !== 'undefined' && chrome.tabs.get) {
    ['query-state', 'record-action', 'password-element-focused'].forEach(topic => {
        communicator.registerHandler(topic, function (data, tab_id, sendResponse) {
            chrome.tabs.get(tab_id, function (tab) {
                if (chrome.runtime.lastError || !tab) {
                    if (sendResponse) sendResponse({ state: 'idle', error: 'tab not found' });
                    return;
                }

                const baseMessage = {
                    target: 'offscreen',
                    tab_id: tab_id,
                    win_id: tab.windowId
                };

                const offscreenMessage = (topic === 'query-state')
                    ? Object.assign(baseMessage, { type: 'QUERY_STATE' })
                    : Object.assign(baseMessage, { command: 'FORWARD_MESSAGE', topic: topic, data: data });

                // Forward to Offscreen using reliable helper
                sendMessageToOffscreen(offscreenMessage).then(response => {
                    if (sendResponse) sendResponse(response);
                }).catch(e => {
                    // If offscreen doesn't respond or fails, we can't do much but log it
                    // console.warn("Forwarding message to offscreen failed:", e);
                    if (sendResponse) sendResponse({ success: false, error: e.message });
                });
            });
        });
    });
}

// Forward tab events to Offscreen Document
if (chrome.tabs) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        sendMessageToOffscreen({
            target: 'offscreen',
            type: 'TAB_UPDATED',
            tabId: tabId,
            changeInfo: changeInfo,
            tab: tab
        }).catch(e => { /* ignore */ });
    });

    chrome.tabs.onActivated.addListener((activeInfo) => {
        sendMessageToOffscreen({
            target: 'offscreen',
            type: 'TAB_ACTIVATED',
            activeInfo: activeInfo
        }).catch(e => { /* ignore */ });
    });

    chrome.tabs.onCreated.addListener((tab) => {
        sendMessageToOffscreen({
            target: 'offscreen',
            type: 'TAB_CREATED',
            tab: tab
        }).catch(e => { /* ignore */ });
    });

    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
        sendMessageToOffscreen({
            target: 'offscreen',
            type: 'TAB_REMOVED',
            tabId: tabId,
            removeInfo: removeInfo
        }).catch(e => { /* ignore */ });
    });

    chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
        sendMessageToOffscreen({
            target: 'offscreen',
            type: 'TAB_MOVED',
            tabId: tabId,
            moveInfo: moveInfo
        }).catch(e => { /* ignore */ });
    });

    chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
        sendMessageToOffscreen({
            target: 'offscreen',
            type: 'TAB_ATTACHED',
            tabId: tabId,
            attachInfo: attachInfo
        }).catch(e => { /* ignore */ });
    });

    chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
        sendMessageToOffscreen({
            target: 'offscreen',
            type: 'TAB_DETACHED',
            tabId: tabId,
            detachInfo: detachInfo
        }).catch(e => { /* ignore */ });
    });

    if (chrome.webNavigation) {
        chrome.webNavigation.onCommitted.addListener((details) => {
            sendMessageToOffscreen({
                target: 'offscreen',
                type: 'WEB_NAVIGATION_COMMITTED',
                details: details
            }).catch(e => { /* ignore */ });
        });

        chrome.webNavigation.onErrorOccurred.addListener((details) => {
            sendMessageToOffscreen({
                target: 'offscreen',
                type: 'WEB_NAVIGATION_ERROR',
                details: details
            }).catch(e => { /* ignore */ });
        });
    }
}
