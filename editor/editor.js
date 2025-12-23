/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/



//script for Integrated editor


var Editor = {
    bgPage: null,  // Cache for background page
    bgPageReady: false,  // Flag to track if bgPage is initialized

    init: function (file) {
        // In MV3, we don't need bgPage cache since all operations use message passing
        this.bgPageReady = true;  // Mark as ready immediately
        var doc = window.frames["editbox"].contentDocument;
        var bypass = doc.getElementById("bypass");
        if (!bypass || !bypass.hasAttribute("inited")) {
            setTimeout(function () { Editor.init(file); }, 100);
            return;
        }
        bypass.setAttribute("lang", "en");
        bypass.setAttribute("syntax", file.type || "imacro");
        var evt = doc.createEvent("Events");
        evt.initEvent("iMacrosEditorInitEvent", true, false);
        bypass.dispatchEvent(evt);

        if (file) {
            this.completeLoad(file);
        }

        this.attachListeners();
    },

    completeLoad: function (file) {
        var doc = window.frames["editbox"].contentDocument;
        // send notification to EditArea
        var bypass = doc.getElementById("bypass");
        console.log("[iMacros Editor] completeLoad - file_id:", file.file_id);
        bypass.setAttribute("filename", file.name || "");
        bypass.setAttribute("bookmark_id", file.bookmark_id || "");
        bypass.setAttribute("file_id", file.file_id || "");
        console.log("[iMacros Editor] bypass setAttribute file_id:", bypass.getAttribute("file_id"));
        console.log("[iMacros Editor] Setting content. Source length:", file.source ? file.source.length : "undefined");
        if (file.source && file.source.length > 0) {
            console.log("[iMacros Editor] Source preview:", file.source.substring(0, 100));
        } else {
            console.warn("[iMacros Editor] Source is empty or undefined!");
        }
        bypass.setAttribute("content", file.source);
        bypass.setAttribute("syntax", file.type || "imacro");
        var evt = doc.createEvent("Events");
        evt.initEvent("iMacrosEditorLoadCompleteEvent", true, false);
        bypass.dispatchEvent(evt);
        // set title
        document.title = file.name + " - iMacros Editor";
        // save original source
        this.originalSource = file.source;
        this.win_id = file.win_id;
    },

    attachListeners: function () {
        document.addEventListener("iMacrosEditorSaveEvent",
            function (e) { Editor.listen(e); },
            false);
        document.addEventListener("iMacrosEditorLoadEvent",
            function (e) { Editor.listen(e); },
            false);
    },


    saveFile: function () {
        var r = this.getEditAreaData();
        if (!r.name) {
            r.name = prompt("Enter macro name:", "Unnamed Macro");
        }

        if (!r.name)
            return Promise.resolve(false);

        var save_data = {
            name: r.name,
            source: r.source,
            bookmark_id: r.bookmark_id,
            file_id: r.file_id,
            type: r.syntax,
            win_id: this.win_id
        };

        return new Promise((resolve) => {
            // MV3: If we have a file_id, use afio directly to allow permission prompts
            if (save_data.file_id && typeof afio !== 'undefined') {
                var node = afio.openNode(save_data.file_id);
                afio.writeTextFile(node, save_data.source).then(() => {
                    // Notify background to refresh panels
                    chrome.runtime.sendMessage({ type: 'REFRESH_PANEL_TREE' });
                    Editor.originalSource = r.source;
                    resolve(true);
                }).catch(err => {
                    console.error("[iMacros] Save failed:", err);
                    alert("Failed to save macro: " + err);
                    resolve(false);
                });
            } else {
                // Fallback to message passing (Bookmarks or legacy)
                chrome.runtime.sendMessage({
                    command: "save",
                    data: save_data,
                    overwrite: true
                }, function (response) {
                    if (chrome.runtime.lastError) {
                        console.error("[iMacros] Save failed:", chrome.runtime.lastError.message);
                        alert("Failed to save macro. Please try again.");
                        resolve(false);
                        return;
                    }
                    if (!response || !response.success) {
                        console.error("[iMacros] Save failed:", response ? response.error : "No response");
                        alert("Failed to save macro: " + (response ? response.error : "Unknown error"));
                        resolve(false);
                        return;
                    }
                    Editor.originalSource = r.source;
                    resolve(true);
                });
            }
        });
    },

    saveFileAs: function () {
        var features = "titlebar=no,menubar=no,location=no," +
            "resizable=yes,scrollbars=no,status=no";

        var r = this.getEditAreaData();

        var save_data = {
            name: r.name,
            source: r.source,
            bookmark_id: "",
            file_id: r.file_id,
            type: r.syntax,
            win_id: this.win_id
        };

        // Prefer session storage for transient dialog args; fall back to local if session isn't available
        var dialogKey = 'saveAsDialog_' + Date.now();
        var store = (chrome.storage && chrome.storage.session) || (chrome.storage && chrome.storage.local);
        if (!store) {
            console.error("[iMacros] No storage backend available for dialog args");
            alert("Failed to open Save As dialog (no storage backend available).");
            return true;
        }

        store.set({
            [dialogKey]: { save_data: save_data }
        }, function () {
            if (chrome.runtime.lastError) {
                console.error("[iMacros] Failed to store dialog args:", chrome.runtime.lastError);
                return;
            }

            // Open dialog with the key as a URL parameter
            var win = window.open("saveAsDialog.html?key=" + dialogKey,
                null, features);
        });

        return true;
    },


    getEditAreaData: function () {
        var doc = window.frames["editbox"].contentDocument;
        // send notification to EditArea
        var bypass = doc.getElementById("bypass");
        var evt = doc.createEvent("Events");
        evt.initEvent("iMacrosEditorGetContentEvent", true, false);
        bypass.dispatchEvent(evt);
        var source = bypass.getAttribute("content");
        var name = bypass.getAttribute("filename");
        var bookmark_id = bypass.getAttribute("bookmark_id");
        var file_id = bypass.getAttribute("file_id");
        console.log("[iMacros Editor] getEditAreaData - retrieved file_id:", file_id);
        var syntax = bypass.getAttribute("syntax");

        return {
            source: source,
            name: name,
            bookmark_id: bookmark_id,
            file_id: file_id,
            syntax: syntax
        };
    },

    checkFileChanged: function () {
        var r = this.getEditAreaData();
        return this.originalSource != r.source;
    },


    checkPermissions: function (file) {
        // Note: Permission checking is not currently implemented in MV2.
        // File system permissions are handled by the native messaging host (afio).
        // This function is kept for potential future use but always returns true.
        return true;
    },


    loadFile: function (fileData) {
        // Load a macro file into the editor
        // fileData should contain: {name, source, file_id, bookmark_id, win_id}
        if (!fileData) {
            console.error("loadFile called without file data");
            return;
        }

        // Check if current file has unsaved changes
        if (this.checkFileChanged()) {
            var msg = "Current file has unsaved changes. Do you want to save before opening another file?";
            if (window.confirm(msg)) {
                this.saveFile().then(function (success) {
                    if (success) Editor.completeLoad(fileData);
                });
                return;
            }
        }

        // Load the new file
        this.completeLoad(fileData);
    },

    getSelection: function () {
        var doc = window.frames["editbox"].contentDocument;
        // send notification to EditArea
        var bypass = doc.getElementById("bypass");
        var evt = doc.createEvent("Events");
        evt.initEvent("iMacrosEditorGetSelection", true, false);
        bypass.dispatchEvent(evt);
        var selection = bypass.getAttribute("selection");
        return selection;
    },


    setSelection: function (text) {
        var doc = window.frames["editbox"].contentDocument;
        // send notification to EditArea
        var bypass = doc.getElementById("bypass");
        var evt = doc.createEvent("Events");
        evt.initEvent("iMacrosEditorSetSelection", true, false);
        bypass.setAttribute("selection", text);
        bypass.dispatchEvent(evt);
    },

    // context menu handler
    // Note: Context menu implementation is limited in MV2 due to iframe restrictions.
    // EditArea runs inside an iframe and has its own context menu.
    // For full context menu support, consider upgrading to MV3 or implementing
    // a custom menu overlay.

    onContextShowing: function (event) {
        // Basic context menu handler stub
        // In MV2, we rely on EditArea's built-in context menu
        // Custom menu items would require modifying EditArea or creating an overlay

        // For now, we can log context menu events for debugging
        if (Storage && Storage.getBool("debug")) {
            console.log("Context menu requested in editor");
        }

        // Future enhancement: Add custom menu items like:
        // - Run macro
        // - Encode/decode selection
        // - Insert iMacros command template
        // - Validate macro syntax
    },

    listen: function (evt) {
        if (evt.type == "iMacrosEditorSaveEvent") {
            var content = evt.target.getAttribute("content");
            var r = this.getEditAreaData();
            // If we have a file_id, overwrite directly. Otherwise open Save As dialog.
            if (r.file_id) {
                this.saveFile().catch(function (err) {
                    console.error("[iMacros] Save failed in event handler:", err);
                });
            } else {
                this.saveFileAs();
            }
        } else if (evt.type == "iMacrosEditorLoadEvent") {
            this.loadFile(evt);
        }
    }
};


function cancel() {
    window.close();
}

function saveAndQuit() {
    var result = Editor.saveFile();
    if (result && typeof result.then === 'function') {
        result.then(function (success) {
            if (success) window.close();
        });
    } else if (result) {
        window.close();
    }
}


function timedClose() {
    setTimeout(function () { window.close(); }, 100);
}

function saveAsAndQuit() {
    Editor.saveFileAs();
}

// Retrieve args from background page using window ID (MV3 compatible)
var args;
let editorInitialized = false;

// Helper function to try legacy fallback pattern
function tryLegacyFallback() {
    if (typeof window.args !== 'undefined') {
        args = window.args;
        initializeEditor();
        return true;
    }
    return false;
}

function initializeEditor() {
    if (!args) {
        console.error("[iMacros] Editor args not loaded yet");
        return;
    }
    // Prevent duplicate initialization
    if (editorInitialized) {
        console.warn("[iMacros] Editor already initialized, skipping duplicate initialization");
        return;
    }
    editorInitialized = true;

    if (!args.overwrite)
        document.getElementById("save-button").style.display = "none";
    Editor.init(args.macro);
    document.getElementById("save-button").addEventListener("click", saveAndQuit);
    document.getElementById("saveas-button").addEventListener("click", saveAsAndQuit);
    document.getElementById("cancel-button").addEventListener("click", cancel);
}

window.addEventListener("load", function () {
    const sessionStore = chrome.storage && chrome.storage.session;
    const localStore = chrome.storage && chrome.storage.local;
    const storages = [];

    if (sessionStore) {
        storages.push(sessionStore);
    }
    if (localStore && localStore !== sessionStore) {
        storages.push(localStore);
    }

    if (!storages.length) {
        console.error("[iMacros Editor] No storage backend available for macro data");
        alert("Error: Unable to access macro data");
        return;
    }

    console.log("[iMacros Editor] Loading macro data from storage...");

    function loadFromStorage(index) {
        if (index >= storages.length) {
            console.error("[iMacros Editor] No macro data found in available storage backends");
            if (!tryLegacyFallback()) {
                alert("Error: No macro data found to edit");
            }
            return;
        }

        const storage = storages[index];
        storage.get(["currentMacroToEdit", "editorOverwriteMode", "editorStartLine"], function (data) {
            if (chrome.runtime.lastError) {
                console.warn("[iMacros Editor] Failed to load data from storage index", index, chrome.runtime.lastError);
                loadFromStorage(index + 1);
                return;
            }

            if (!data.currentMacroToEdit) {
                console.warn("[iMacros Editor] No macro data found in storage index", index, "- trying next backend if available");
                loadFromStorage(index + 1);
                return;
            }

            if (Storage && Storage.getBool && Storage.getBool("debug")) {
                console.log("[iMacros Editor] Loaded macro:", data.currentMacroToEdit.name);
            }

            // Set up args object for compatibility with existing code
            args = {
                macro: data.currentMacroToEdit,
                overwrite: data.editorOverwriteMode || false,
                line: data.editorStartLine || 0
            };

            // Initialize editor
            initializeEditor();

            // Clear from all backends to prevent stale data
            storages.forEach((st) => {
                st.remove(["currentMacroToEdit", "editorOverwriteMode", "editorStartLine"], function () {
                    if (chrome.runtime.lastError) {
                        console.warn("[iMacros Editor] Failed to clear storage from backend:", chrome.runtime.lastError);
                    }
                });
            });
        });
    }

    loadFromStorage(0);
});


window.addEventListener("beforeunload", function () {
    if (Editor.checkFileChanged()) {
        var msg = "File content was changed. Would you like to save changes?";
        if (window.confirm(msg))
            Editor.saveFile();
    }
    return null;
});
