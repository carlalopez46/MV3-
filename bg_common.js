/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

// Common background logic shared between Service Worker (bg.js) and Offscreen Document (offscreen_bg.js)
// Depends on: utils.js, afio (AsyncFileIO.js), communicator.js

"use strict";

// Define global scope for both Service Worker and Window contexts
var globalScope = typeof self !== 'undefined' ? self : window;

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
    if (backgroundFileSyncBridge || typeof FileSyncBridge === 'undefined' || typeof afio === 'undefined') {
        return backgroundFileSyncBridge;
    }
    if (typeof communicator === 'undefined') {
        return null;
    }
    backgroundFileSyncBridge = new FileSyncBridge({
        mode: 'background',
        vfs: afio._vfs,
        communicator: communicator
    });
    backgroundFileSyncBridge.start();
    return backgroundFileSyncBridge;
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

    return afioCache.isInstalled().then(function (installed) {
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
        console.warn("[iMacros] chrome.bookmarks API not available, skipping sample bookmarklets installation");
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

globalScope.ensureBookmarkFolderCreated = function (parent_id, name) {
    return new Promise(function (resolve, reject) {
        chrome.bookmarks.getChildren(parent_id, function (result) {
            if (chrome.runtime.lastError) {
                logError("Failed to get bookmark children: " + chrome.runtime.lastError.message, { parent_id: parent_id });
                return reject(chrome.runtime.lastError);
            }
            if (!result) {
                logError("Bookmark getChildren returned null result", { parent_id: parent_id });
                return reject(new Error("Bookmark getChildren returned null result"));
            }
            // find a bookmark with matching name
            for (var r of result) {
                if (r.title === name)
                    return resolve(r);
            }
            // otherwise create one
            chrome.bookmarks.create(
                { parentId: parent_id, title: name },
                function (createdFolder) {
                    if (chrome.runtime.lastError) {
                        logError("Failed to create bookmark folder: " + chrome.runtime.lastError.message, { parent_id: parent_id, name: name });
                        return reject(chrome.runtime.lastError);
                    }
                    resolve(createdFolder);
                }
            );
        });
    });
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

globalScope.createBookmark = function (folder_id, title, url, bookmark_id, overwrite) {
    return new Promise(function (resolve, reject) {
        if (bookmark_id) {
            chrome.bookmarks.update(
                bookmark_id,
                { url: url, title: title },
                function (result) {
                    if (chrome.runtime.lastError) {
                        logError("Failed to update bookmark: " + chrome.runtime.lastError.message, { bookmark_id: bookmark_id, title: title });
                        return reject(chrome.runtime.lastError);
                    }
                    resolve(result);
                }
            );
            return;
        }

        if (overwrite) {
            reject(new Error("bg.save() - trying to overwrite " + title +
                " while bookmark_id is not set"));
            return;
        }

        // Check if a macro with the same name already exists
        chrome.bookmarks.getChildren(folder_id, function (children) {
            if (chrome.runtime.lastError) {
                logError("Failed to get bookmark children: " + chrome.runtime.lastError.message, { folder_id: folder_id });
                return reject(chrome.runtime.lastError);
            }
            if (!children) {
                logError("Bookmark getChildren returned null", { folder_id: folder_id });
                return reject(new Error("Bookmark getChildren returned null"));
            }

            var existingMacro = null;
            for (var x of children) {
                if (x.title === title && x.url) {
                    existingMacro = x;
                    break;
                }
            }

            if (existingMacro) {
                // Determine environment and handle dialog
                // Delegate to a global handler that must be implemented by the specific bg script
                if (typeof handleOverwriteDialog === 'function') {
                    handleOverwriteDialog(existingMacro, url, title, folder_id, resolve, reject, children);
                } else {
                    reject(new Error("Overwrite dialog handler not implemented in this context"));
                }
            } else {
                // No existing macro, just create it
                chrome.bookmarks.create(
                    {
                        parentId: folder_id,
                        title: title,
                        url: url
                    }, function (result) {
                        if (chrome.runtime.lastError) {
                            logError("Failed to create bookmark (new): " + chrome.runtime.lastError.message, { folder_id: folder_id, title: title });
                            return reject(chrome.runtime.lastError);
                        }
                        resolve(result);
                    });
            }
        });
    });
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
