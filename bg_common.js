/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

// Common background logic shared between Service Worker (bg.js) and Offscreen Document (offscreen_bg.js)
// Depends on: utils.js, afio (AsyncFileIO.js), communicator.js
/* global chrome, logError, logWarning, context, getLimits, afioCache, dialogUtils, Storage, makeBookmarklet,
   ensureBookmarkFolderCreated, createBookmark, saveToBookmark, afio, window, FileSyncBridge, communicator */

"use strict";

// Define global scope for both Service Worker and Window contexts
var globalScope = typeof self !== 'undefined' ? self : window;

// Centralized helper to wrap callback-based chrome.* APIs with consistent
// error handling.
function chromeAsync(executor, contextMessage, metadata) {
    return new Promise(function (resolve, reject) {
        executor(function (result) {
            if (chrome.runtime.lastError) {
                var wrappedError = new Error(contextMessage + ": " + chrome.runtime.lastError.message);
                if (typeof logError === 'function') {
                    logError(wrappedError.message, metadata);
                }
                return reject(wrappedError);
            }
            resolve(result);
        });
    });
}

// ============================================================================
// AFIO Cache & Validation
// ============================================================================

const AFIO_NEGATIVE_CACHE_TTL_MS = 60 * 1000; // Cache negative results for 1 minute

globalScope.afioCache = {
    _installed: null,
    _negativeExpiresAt: null,
    _promise: null,

    isInstalled: function () {
        // Return cached result if available
        if (this._installed !== null) {
            if (this._installed === false && this._negativeExpiresAt !== null) {
                if (Date.now() > this._negativeExpiresAt) {
                    this.invalidate();
                }
            }
            if (this._installed !== null) {
                return Promise.resolve(this._installed);
            }
        }

        // Return ongoing check if in progress
        if (this._promise) {
            return this._promise;
        }

        // Perform the check
        this._promise = afio.isInstalled().then(installed => {
            this._installed = installed;
            if (installed) {
                this._negativeExpiresAt = null;
            } else {
                this._negativeExpiresAt = Date.now() + AFIO_NEGATIVE_CACHE_TTL_MS;
            }
            this._promise = null;
            return installed;
        }).catch(err => {
            this._installed = false;
            this._negativeExpiresAt = Date.now() + AFIO_NEGATIVE_CACHE_TTL_MS;
            this._promise = null;
            throw err;
        });

        return this._promise;
    },

    invalidate: function () {
        this._installed = null;
        this._negativeExpiresAt = null;
        this._promise = null;
    }
};

globalScope.backgroundFileSyncBridge = null;

globalScope.ensureBackgroundFileSyncBridge = function () {
    if (globalScope.backgroundFileSyncBridge || typeof FileSyncBridge === 'undefined' || typeof afio === 'undefined') {
        return globalScope.backgroundFileSyncBridge;
    }
    if (typeof communicator === 'undefined') {
        return null;
    }
    globalScope.backgroundFileSyncBridge = new FileSyncBridge({
        mode: 'background',
        vfs: afio._vfs,
        communicator: communicator
    });
    globalScope.backgroundFileSyncBridge.start();
    return globalScope.backgroundFileSyncBridge;
};

// Also verify bridge on load
globalScope.ensureBackgroundFileSyncBridge();


// ============================================================================
// Bookmarklet Generation
// ============================================================================

globalScope.makeBookmarklet = function (name, code) {
    var pattern = "(function() {" +
        "try{" +
        "var e_m64 = \"{{macro}}\", n64 = \"{{name}}\";" +
        "if(!/^(?:chrome|https?|file)/.test(location)){" +
        "alert('iMacros: Open webpage to run a macro.');" +
        "return;" +
        "}" +
        "var macro = {};" +
        "macro.source = decodeURIComponent(atob(e_m64));" +
        "macro.name = decodeURIComponent(atob(n64));" +
        "var evt = document.createEvent(\"CustomEvent\");" +
        "evt.initCustomEvent(\"iMacrosRunMacro\", true, true, macro);" +
        "window.dispatchEvent(evt);" +
        "}catch(e){alert('iMacros Bookmarklet error: '+e.toString());}" +
        "}) ();";

    var macro_name = name || "Unnamed Macro", source = code;
    macro_name = btoa(encodeURIComponent(name));
    macro_name = imns.escapeLine(macro_name);
    pattern = pattern.replace("{{name}}", macro_name);
    source = btoa(encodeURIComponent(source));
    source = imns.escapeLine(source);
    pattern = pattern.replace("{{macro}}", source);

    var url = "javascript:" + pattern;

    return url;
};


// ============================================================================
// Shared background helpers used by bg.js and offscreen_bg.js
// ============================================================================

function sharedSave(save_data, overwrite, callback) {
    // saves into file or bookmark
    if (save_data.file_id) {
        globalScope.save_file(save_data, overwrite, callback);
        return;
    }

    // If tree-type is "files" but file_id is not set, prompt user with saveAs dialog
    // to choose file location instead of falling back to bookmark storage
    if (Storage.getChar("tree-type") === "files" && !save_data.file_id) {
        globalScope.afioCache.isInstalled().then(function (installed) {
            if (installed && typeof window !== 'undefined' && window && typeof window.open === 'function') {
                // Open saveAs dialog to let user choose file location
                // Use storage + URL key strategy for robust MV3/Offscreen support
                var dialogKey = 'saveAs_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                var storage = chrome.storage.session || chrome.storage.local;

                var data = {};
                data[dialogKey] = { save_data: save_data };

                storage.set(data, function () {
                    if (chrome.runtime.lastError) {
                        console.error("[iMacros] Failed to store saveAs args:", chrome.runtime.lastError);
                    }
                    var features = "titlebar=no,menubar=no,location=no," +
                        "resizable=yes,scrollbars=no,status=no";
                    window.open("saveAsDialog.html?key=" + dialogKey, null, features);
                });

                // The saveAsDialog will call save() again with file_id set
                return;
            }
            // If afio is not installed or window.open is unavailable (e.g., MV3 Service Worker),
            // fall back to bookmark storage
            saveToBookmark(save_data, overwrite, callback);
        }).catch(function (err) {
            console.error("Error checking afio installation:", err);
            // Fall back to bookmark storage on error
            saveToBookmark(save_data, overwrite, callback);
        });
        return;
    }

    // Default: save to bookmark
    saveToBookmark(save_data, overwrite, callback);
}

function sharedPlayMacro(macro, win_id) {
    // Ensure context is initialized before playing
    var contextPromise = context[win_id] && context[win_id]._initialized
        ? Promise.resolve(context[win_id])
        : context.init(win_id);

    contextPromise.then(function (ctx) {
        return getLimits().then(
            limits => ctx.mplayer.play(macro, limits)
        );
    }).catch(err => {
        logError("Failed to initialize context, get limits, or play macro in playMacro: " + err.message, { win_id: win_id, macro_name: macro.name });
    });
}

async function sharedDockPanel(win_id) {
    // MV3: Docking panel is not supported in Service Worker due to lack of DOM access
    // and reliable timers. This feature is disabled.
    if (context[win_id] && context[win_id].dockInterval) {
        clearInterval(context[win_id].dockInterval);
        context[win_id].dockInterval = null;
    }
    if (!context[win_id] || !context[win_id]._initialized) {
        return;
    }

    var panel = context[win_id].panelWindow;
    if (!panel || panel.closed) {
        return;
    }
    if (!Storage.getBool("dock-panel"))
        return;

    if (typeof panel.outerWidth !== 'number') {
        logWarning("Panel window width unavailable; skipping docking", { win_id: win_id });
        return;
    }

    try {
        const w = await chromeAsync(cb => chrome.windows.get(win_id, cb), "Failed to get window in dockPanel", { win_id: win_id });
        if (!w) {
            logWarning("Window not found in dockPanel", { win_id: win_id });
            return;
        }

        var new_x = w.left - panel.outerWidth;
        if (new_x < 0)
            new_x = 0;

        var updateInfo = {
            height: w.height,
            width: Math.round(panel.outerWidth),
            left: new_x,
            top: w.top
        };

        await chromeAsync(cb => chrome.windows.update(context[win_id].panelId, updateInfo, cb), "Failed to update panel window", { panelId: context[win_id] ? context[win_id].panelId : 'unknown' });

        var ctx = context[win_id];
        if (!ctx) {
            return;
        }
        // Update cached dimensions
        ctx.panelWidth = updateInfo.width;
        ctx.panelHeight = updateInfo.height;
    } catch (err) {
        // chromeAsync already logs context-aware errors; fallback here for unexpected exceptions
        logError("Dock panel update failed: " + err.message, { win_id: win_id });
    }
}

function sharedOpenPanel(win_id) {
    // Safety check: ensure context exists and is initialized
    if (!context[win_id] || !context[win_id]._initialized) {
        console.warn("Cannot open panel: context not initialized for window " + win_id);
        return;
    }

    // MV3: Delegate panel creation to Service Worker via message
    // This avoids duplicate panel creation between bg.js and background.js
    console.log(`[iMacros MV3] Requesting panel open for window ${win_id}`);
    chrome.runtime.sendMessage({
        command: "openPanel",
        win_id: win_id
    });
}

async function sharedOpenPanelWindow(win_id) {
    try {
        const win = await chromeAsync(cb => chrome.windows.get(win_id, cb), "Failed to get window in openPanel", { win_id: win_id });
        if (!win) {
            logWarning("Window not found in openPanel", { win_id: win_id });
            return;
        }

        var panelBox = Storage.getObject("panel-box");
        if (!panelBox) {
            panelBox = new Object();
            panelBox.width = 210;
            if (Storage.getBool("dock-panel"))
                panelBox.height = win.height;
            else
                panelBox.height = 600;
            panelBox.top = win.top;
            panelBox.left = win.left - panelBox.width;
            if (panelBox.left < 0)
                panelBox.left = 0;
        }

        var createData = {
            url: "panel.html", type: "popup",
            top: panelBox.top, left: panelBox.left,
            width: panelBox.width, height: panelBox.height
        };

        await chromeAsync(cb => chrome.windows.create(createData, cb), "Failed to create panel window", { createData: createData });
    } catch (err) {
        logError("Failed to create panel window: " + err.message, { win_id: win_id });
    }
}

globalScope.registerSharedBackgroundHandlers = function (scope) {
    scope.save = sharedSave;
    scope.playMacro = sharedPlayMacro;
    scope.dockPanel = sharedDockPanel;
    scope.openPanel = sharedOpenPanel;
    scope._openPanelWindow = sharedOpenPanelWindow;
};


// ============================================================================
// Sample Macros Installation
// ============================================================================

globalScope.getSample = function (name) {
    const url = chrome.runtime.getURL("samples/" + name);
    return fetch(url)
        .then(response => {
            if (!response.ok) throw new Error("Failed to load sample: " + name);
            return response.text();
        })
        .then(text => ({
            name: name,
            content: text
        }));
};

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

globalScope.installSampleMacroFiles = function () {
    var names = [
        "ArchivePage.iim",
        "Eval.iim",
        "Extract.iim",
        "ExtractAndFill.iim",
        "ExtractRelative.iim",
        "ExtractTable.iim",
        "ExtractURL.iim",
        "FillForm-Events.iim",
        "FillForm-CssSelectors.iim",
        "FillForm-XPath.iim",
        "FillForm.iim",
        "Frame.iim",
        "Loop-Csv-2-Web.iim",
        "Open6Tabs.iim",
        "SaveAs.iim",
        "SlideShow.iim",
        "Stopwatch.iim",
        "TagPosition.iim",
        "Upload.iim"
    ];

    if (Storage.getBool("samples-installed")) {
        return Promise.resolve();
    }

    return globalScope.afioCache.isInstalled().then(function (installed) {
        if (!installed) {
            return Promise.resolve();
        }
        return afio.getDefaultDir("savepath").then(function (node) {
            return ensureDirectoryExists(node).then(function () {
                var p = names.map(getSample).reduce(function (seq, p) {
                    return seq.then(function () {
                        return p;
                    }).then(function (file) {
                        var file_node = node.clone();
                        file_node.append(file.name);
                        return afio.writeTextFile(file_node, file.content);
                    });
                }, Promise.resolve());

                return p.then(installProfilerXsl).then(installAddressCsv).then(function () {
                    Storage.setBool("samples-installed", true);
                });
            });
        });
    });
};

function addSampleBookmarkletMacro(name, parentId, content) {
    return new Promise(function (resolve, reject) {
        chrome.bookmarks.getChildren(parentId, function (children) {
            if (chrome.runtime.lastError) {
                // If folder doesn't exist or other error, try to create new
                // console.warn("Error getting children", chrome.runtime.lastError);
                // Proceed to create
            }

            var existing = null;
            if (children) {
                for (var i = 0; i < children.length; i++) {
                    if (children[i].title == name) {
                        existing = children[i];
                        break;
                    }
                }
            }

            if (existing) {
                // Update existing
                createBookmark(
                    parentId, name,
                    makeBookmarklet(name, content),
                    existing.id,
                    false // not an overwrite user action, but system update
                ).then(resolve, reject);
            } else {
                // Create new
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

globalScope.installSampleBookmarkletMacros = function () {
    var names = [
        "ArchivePage.iim",
        "Eval.iim",
        "Extract.iim",
        "ExtractAndFill.iim",
        "ExtractRelative.iim",
        "ExtractTable.iim",
        "ExtractURL.iim",
        "FillForm-Events.iim",
        "FillForm-CssSelectors.iim",
        "FillForm-XPath.iim",
        "FillForm.iim",
        "Frame.iim",
        "Open6Tabs.iim",
        "SaveAs.iim",
        "SlideShow.iim",
        "Stopwatch.iim",
        "TagPosition.iim",
        "Upload.iim"
    ];

    if (Storage.getBool("samples-installed-bookmarks")) {
        return Promise.resolve();
    }

    // Skip if bookmarks API is not available (e.g. not in manifest or restricted context)
    if (!chrome.bookmarks) {
        console.log("[iMacros] chrome.bookmarks API not available in this context (Offscreen), delegating installation to Service Worker");
        // Delegate to Service Worker where bookmarks API is available
        if (chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ command: 'INSTALL_SAMPLE_BOOKMARKLETS' });
        }
        return Promise.resolve();
    }

    return new Promise(function (resolve, reject) {
        chrome.bookmarks.getTree(function (tree) {
            if (chrome.runtime.lastError) {
                return reject(chrome.runtime.lastError);
            }
            if (!tree || !tree[0] || !tree[0].children || !tree[0].children[0]) {
                // Fallback or error
                return resolve();
            }
            var panelId = tree[0].children[0].id; // Usually "Bookmarks Bar"

            // Try to find or create iMacros folder in Bookmarks Bar
            ensureBookmarkFolderCreated(panelId, "iMacros").then(function (im) {
                return ensureBookmarkFolderCreated(im.id, "Demo-Chrome");
            }).then(function (node) {
                return names.map(getSample).reduce(function (seq, p) {
                    return seq.then(function () {
                        return p;
                    }).then(macro => addSampleBookmarkletMacro(
                        macro.name, node.id, macro.content
                    ));
                }, Promise.resolve());
            }).then(function () {
                Storage.setBool("samples-installed-bookmarks", true);
                resolve();
            }).catch(function (err) {
                console.warn("Failed to install sample bookmarklets:", err);
                resolve(); // Don't fail the whole startup
            });
        });
    });
};

// ============================================================================
// Bookmark Management Helpers
// ============================================================================

var handleOverwriteDialog = globalScope.handleOverwriteDialog = async function (existingMacro, url, title, folder_id, children) {
    try {
        const dialogResult = await dialogUtils.openDialog("overwriteDialog.html", "overwriteDialog", {
            macroName: title
        });

        if (dialogResult.action === "overwrite") {
            return chromeAsync(cb => chrome.bookmarks.update(existingMacro.id, { url: url, title: title }, cb),
                "Failed to update bookmark (overwrite)", { bookmark_id: existingMacro.id, title: title });
        }

        if (dialogResult.action === "save-new") {
            let found = false, count = 1, name = title;
            for (; ;) {
                found = false;
                for (var x of children) {
                    if (x.title === name && x.url) {
                        found = true;
                        if (/\.iim$/.test(title)) {
                            name = title.replace(/\.iim$/, "(" + count + ").iim");
                        } else {
                            name = title + "(" + count + ")";
                        }
                        count++;
                        break;
                    }
                }
                if (!found) break;
            }

            return chromeAsync(cb => chrome.bookmarks.create({ parentId: folder_id, title: name, url: url }, cb),
                "Failed to create bookmark (save-new)", { folder_id: folder_id, title: name });
        }

        throw new Error("User cancelled save operation");
    } catch (err) {
        logError("Dialog error: " + err.message);
        throw err;
    }
};

globalScope.ensureBookmarkFolderCreated = async function (parent_id, name) {
    const children = await chromeAsync(
        cb => chrome.bookmarks.getChildren(parent_id, cb),
        "Failed to get bookmark children",
        { parent_id: parent_id }
    );

    if (!children) {
        throw new Error("Bookmark getChildren returned null result");
    }

    for (var r of children) {
        if (r.title === name) {
            return r;
        }
    }

    return chromeAsync(
        cb => chrome.bookmarks.create({ parentId: parent_id, title: name }, cb),
        "Failed to create bookmark folder",
        { parent_id: parent_id, name: name }
    );
};

// ============================================================================
// File System Helpers
// ============================================================================

globalScope.ensureDirectoryExists = function (node) {
    return node.exists().then(async function (exists) {
        if (!exists) {
            // Check parent first
            if (node.parent) {
                await ensureDirectoryExists(node.parent);
            }
            return node.createDirectory();
        }
    });
};

// ============================================================================
// Bookmark Creation & Saving Logic
// ============================================================================

globalScope.createBookmark = async function (folder_id, title, url, bookmark_id, overwrite) {
    if (bookmark_id) {
        return chromeAsync(
            cb => chrome.bookmarks.update(bookmark_id, { url: url, title: title }, cb),
            "Failed to update bookmark",
            { bookmark_id: bookmark_id, title: title }
        );
    }

    if (overwrite) {
        throw new Error("bg.save() - trying to overwrite " + title + " while bookmark_id is not set");
    }

    const children = await chromeAsync(
        cb => chrome.bookmarks.getChildren(folder_id, cb),
        "Failed to get bookmark children",
        { folder_id: folder_id }
    );

    if (!children) {
        throw new Error("Bookmark getChildren returned null");
    }

    var existingMacro = null;
    for (var x of children) {
        if (x.title === title && x.url) {
            existingMacro = x;
            break;
        }
    }

    if (existingMacro) {
        if (typeof handleOverwriteDialog === 'function') {
            return handleOverwriteDialog(existingMacro, url, title, folder_id, children);
        }
        throw new Error("Overwrite dialog handler not implemented in this context");
    }

    return chromeAsync(
        cb => chrome.bookmarks.create({ parentId: folder_id, title: title, url: url }, cb),
        "Failed to create bookmark (new)",
        { folder_id: folder_id, title: title }
    );
};

var saveToBookmark = globalScope.saveToBookmark = async function (save_data, overwrite, callback) {
    try {
        if (typeof chrome.bookmarks === 'undefined' || !chrome.bookmarks.getTree) {
            throw new Error("Bookmark API not available in this context");
        }

        const tree = await chromeAsync(
            cb => chrome.bookmarks.getTree(cb),
            "Failed to get bookmark tree"
        );

        if (!tree || !tree[0] || !tree[0].children || !tree[0].children[0]) {
            throw new Error("Invalid bookmark tree structure");
        }

        var p_id = tree[0].children[0].id;
        const node = await ensureBookmarkFolderCreated(p_id, "iMacros");
        var url = makeBookmarklet(save_data.name, save_data.source);
        var iMacrosDirId = node.id;

        if (overwrite && !save_data.bookmark_id) {
            const children = await chromeAsync(
                cb => chrome.bookmarks.getChildren(iMacrosDirId, cb),
                "Failed to get bookmark children in saveToBookmark",
                { folder_id: iMacrosDirId }
            );

            for (var x of children) {
                if (x.url && x.title === save_data.name) {
                    save_data.bookmark_id = x.id;
                    break;
                }
            }
        }

        const bookmarkId = save_data.bookmark_id;
        if (overwrite && !bookmarkId) {
            throw new Error("bg.save() - trying to overwrite " + save_data.name + " while bookmark_id is not set");
        }

        await createBookmark(
            iMacrosDirId,
            save_data.name,
            url,
            bookmarkId,
            overwrite
        );

        typeof callback === "function" && callback(save_data);
    } catch (err) {
        logError("Failed to save bookmark: " + err.message, { name: save_data && save_data.name });
        save_data.error = err.message || String(err);
        typeof callback === "function" && callback(save_data);
    }
};


globalScope.save_file = function (save_data, overwrite, callback) {
    var node = afio.openNode(save_data.file_id);
    var update_tree = true;

    if (!isMacroFile(save_data.name))
        save_data.name += ".iim";

    if (node.leafName != save_data.name) {
        node = node.parent;
        node.append(save_data.name);
    }

    node.exists().then(function (exists) {
        if (exists && !overwrite) {
            console.warn("[iMacros] File already exists, skipping overwrite: " + node.path);
            save_data.skipped = true;  // Flag to indicate save was skipped
            typeof (callback) === "function" && callback(save_data);
            return;
        }

        update_tree = !exists;

        return afio.writeTextFile(node, save_data.source).then(function () {
            typeof (callback) === "function" && callback(save_data);
            if (!update_tree)
                return;

            // Delegate panel update to environment specific handler
            if (typeof updatePanels === 'function') {
                updatePanels();
            } else {
                // Fallback / legacy check
                try {
                    for (var x in context) { // update all panels
                        var panel = context[x].panelWindow;
                        if (panel && !panel.closed) {
                            var doc = panel.frames["tree-iframe"].contentDocument;
                            doc.defaultView.location.reload();
                        }
                    }
                } catch (e) { /* ignore in SW */ }
            }
        });
    }).catch(console.error.bind(console));
};


// Bookmark Update Logic & Defaults
// ============================================================================

var strre = "(?:[^\"\\\\]|\\\\[0btnvfr\"\'\\\\])+";
var bm_update_re = new RegExp('^javascript\\:\\(function\\(\\) ' +
    '\\{try\\{var ((?:e_)?m(?:64)?) = "(' + strre + ')"' +
    ', (n(?:64)?) = "(' + strre + ')";' +
    '.+;evt\.initEvent');

function updateBookmarksTree(tree) {
    if (!tree) return;

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

globalScope.doAfterUpdateAction = function () {
    Storage.setBool("show-updated-badge", false);

    // chrome.windows might not be available in Offscreen
    if (typeof chrome.windows !== 'undefined' && chrome.windows.getAll) {
        chrome.windows.getAll({ populate: false }, function (ws) {
            if (chrome.runtime.lastError) {
                logError("Failed to get all windows in doAfterUpdateAction: " + chrome.runtime.lastError.message);
                return;
            }
            if (ws) {
                ws.forEach(function (win) {
                    // Only update badge on normal browser windows, not panel popups
                    if (win.type === 'normal' && typeof badge !== 'undefined') {
                        badge.clearText(win.id);
                    }
                });
            }
        });
    }

    // Check if getRedirFromString exists (it should be in utils.js)
    if (typeof getRedirFromString === 'function') {
        link(getRedirFromString("updated"));
    }
    console.log("[iMacros] Installing latest versions of demo macros");

    // update bookmarked macros for newer version if any
    if (chrome.bookmarks) {
        chrome.bookmarks.getTree(function (tree) {
            if (chrome.runtime.lastError) {
                logError("Failed to get bookmark tree in doAfterUpdateAction: " + chrome.runtime.lastError.message);
                return;
            }
            updateBookmarksTree(tree);
        });
    }

    installSampleBookmarkletMacros().then(function () {
        return installSampleMacroFiles().then(function () {
            // These were separate calls in bg.js, but now part of generic install flow or explicit here?
            // In bg_common.js implementation of installSampleMacroFiles, we already call installProfilerXsl and installAddressCsv.
            // So just calling installSampleMacroFiles is enough.
        });
    }).catch(function (e) { console.error(e); });
};

globalScope.onUpdate = function () {
    setDefaults();
    Storage.setBool("show-updated-badge", true);
    if (typeof chrome.windows !== 'undefined' && chrome.windows.getAll) {
        chrome.windows.getAll({ populate: false }, function (ws) {
            if (chrome.runtime.lastError) return;
            if (ws) {
                ws.forEach(function (win) {
                    // Only update badge on normal browser windows, not panel popups
                    if (win.type === 'normal' && typeof badge !== 'undefined') {
                        badge.setText(win.id, "New");
                    }
                });
            }
        });
    }
};

globalScope.setDefaults = function () {
    let default_settings = {
        "record-mode": "conventional",
        "recording-prefer-id": true,
        "recording-prefer-css-selectors": false,
        "before-play-dialog": true,
        "dock-panel": false,
        "default-dirs-set": false,
        "profiler-enabled": false,
        "replaying-delay": 0,
        "default-timeout": 60
    };
    for (let pref in default_settings) {
        if (!Storage.isSet(pref)) {
            switch (typeof default_settings[pref]) {
                case "boolean":
                    Storage.setBool(pref, default_settings[pref]);
                    break;
                case "number":
                    Storage.setNumber(pref, default_settings[pref]);
                    break;
                case "string":
                    Storage.setChar(pref, default_settings[pref]);
                    break;
            }
        }
    }
};
