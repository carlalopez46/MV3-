/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

let args;
let dialogWindowId = null;

window.addEventListener("load", function () {
    // Primary MV3 path: request dialog args from background with retry
    // Check for key in URL first (MV3/Offscreen compatibility)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('key')) {
        fallbackToSessionStorage();
        return;
    }

    if (typeof chrome.windows !== 'undefined' && chrome.windows.getCurrent) {
        chrome.windows.getCurrent(function (currentWindow) {
            if (chrome.runtime.lastError || !currentWindow) {
                console.warn("[iMacros] Failed to get current window:", chrome.runtime.lastError);
                fallbackToSessionStorage();
                return;
            }
            dialogWindowId = currentWindow.id;
            requestArgs(5);
        });
    } else {
        console.warn("[iMacros] chrome.windows API not available. Falling back to storage strategy.");
        fallbackToSessionStorage();
    }

    function requestArgs(retries) {
        chrome.runtime.sendMessage({
            type: 'GET_DIALOG_ARGS',
            windowId: dialogWindowId
        }, function (result) {
            if (chrome.runtime.lastError) {
                console.error("[iMacros] Failed to get dialog args:", chrome.runtime.lastError.message);
                fallbackToSessionStorage();
                return;
            }
            if (!result || !result.success) {
                // If it's a "bad dialog id" error, it likely means the background hasn't registered the ID yet (race condition)
                // Retry a few times
                if (retries > 0 && result && result.error && result.error.includes('bad dialog id')) {
                    console.log("[iMacros] Args not ready yet (" + result.error + "), retrying... remaining: " + retries);
                    setTimeout(function () { requestArgs(retries - 1); }, 200);
                    return;
                }

                console.error("[iMacros] Background failed to get dialog args:", result && result.error);
                fallbackToSessionStorage();
                return;
            }

            args = result.args;
            initializeWithAfio();
        });
    }


    function fallbackToSessionStorage() {
        // MV3: Get dialog args from chrome.storage.session using URL parameter
        var urlParams = new URLSearchParams(window.location.search);
        var dialogKey = urlParams.get('key');

        if (!dialogKey) {
            console.error("[iMacros] Dialog args not available (missing key)");
            window.close();
            return;
        }

        var storage = chrome.storage.session || chrome.storage.local;

        if (!storage) {
            console.error("[iMacros] chrome.storage not available");
            window.close();
            return;
        }

        storage.get([dialogKey], function (result) {
            if (chrome.runtime.lastError) {
                console.error("[iMacros] Failed to retrieve dialog args:", chrome.runtime.lastError);
                window.close();
                return;
            }

            if (!result[dialogKey]) {
                console.error("[iMacros] Dialog args not found for key:", dialogKey);
                window.close();
                return;
            }

            args = result[dialogKey];

            // Clean up the session storage
            storage.remove([dialogKey], function() {
                if (chrome.runtime.lastError) {
                    console.warn("[iMacros] Failed to clean up dialog key:", chrome.runtime.lastError);
                }
            });

            initializeWithAfio();
        });
    }

    function initializeWithAfio() {
        if (afio._initPromise) {
            afio._initPromise.then(initDialog).catch(function (err) {
                console.error('[iMacros] afio initialization failed:', err);
                initDialog(); // Try to initialize anyway
            });
        } else {
            initDialog();
        }
    }

    function initDialog() {

        var mc = document.getElementById("main-container");
        var rc = mc.getBoundingClientRect();
        // Resize to fit content, a bit larger for the new button
        window.resizeTo(rc.width + 30, rc.height + 60);

        if (window.opener && !window.opener.closed) {
            try {
                window.moveTo(
                    window.opener.screenX + window.opener.outerWidth / 2 - 100,
                    window.opener.screenY + window.opener.outerHeight / 2 - 100
                );
            } catch (e) {
                // Ignore cross-origin blocking or other window access errors
            }
        }

        var macro_name = document.getElementById("macro-name");
        // Strip extension for display if it's a file path or name
        var name = args.save_data.name || "Unnamed Macro";
        // keep only basename (avoid paths in the filename field)
        name = String(name).split(/[\\/]/).pop();
        // strip .iim for display
        name = name.replace(/\.iim$/i, "");

        macro_name.value = name;
        macro_name.select();
        macro_name.focus();
        macro_name.addEventListener("keypress", function (e) {
            if (e.which == 13) ok();
        });

        var file_type = !!args.save_data.file_id;

        // Setup buttons
        var okBtn = document.getElementById("ok-button");
        var cancelBtn = document.getElementById("cancel-button");
        var buttonPack = document.getElementById("buttonpack");

        okBtn.addEventListener("click", ok);
        cancelBtn.addEventListener("click", cancel);

        // Add "Save" button if editing an existing file
        if (file_type) {
            var saveBtn = document.createElement("div");
            saveBtn.id = "save-button";
            saveBtn.className = "button icon-button";
            saveBtn.innerHTML = "<span>Save</span>";
            saveBtn.style.marginRight = "10px";
            saveBtn.addEventListener("click", saveDirectly);

            // Insert before OK button
            buttonPack.insertBefore(saveBtn, okBtn);

            // Update OK button text to "Save As" to be clearer
            okBtn.querySelector("span").innerText = "Save As";
        }

        if (file_type) {
            document.getElementById("radio-files-tree").checked = true;
        } else {
            // Default to Files if available, otherwise Bookmarks
            if (typeof afio !== 'undefined' && afio.getBackendType() !== 'none') {
                document.getElementById("radio-files-tree").checked = true;
            } else {
                document.getElementById("radio-bookmarks-tree").checked = true;
            }
        }

        // Add directory selection functionality
        var directoryBox = document.getElementById("directory-selector-box");
        var directoryPath = document.getElementById("directory-path");
        var browseButton = document.getElementById("browse-button");
        var filesRadio = document.getElementById("radio-files-tree");
        var bookmarksRadio = document.getElementById("radio-bookmarks-tree");

        // Show/hide directory selector based on storage type
        function updateDirectoryBoxVisibility() {
            if (filesRadio.checked) {
                directoryBox.style.display = "block";

                // If we are editing a file, try to extract the directory from the file_id
                if (file_type && args.save_data.file_id) {
                    // file_id is typically the full path
                    try {
                        var path = String(args.save_data.file_id);
                        var parts = path.split(/[\\/]/);
                        if (parts.length > 1) {
                            parts.pop(); // Remove filename
                            var dir = parts.join("/"); // Normalize to forward slashes for internal use

                            // Only update if currently empty or explicitly restoring from file_id
                            if (!directoryPath.value || directoryPath.value === "") {
                                directoryPath.value = dir;
                                directoryPath.dataset.path = dir;
                            }
                        }
                    } catch (e) {
                        console.error("Failed to parse directory from file_id:", e);
                    }
                }

                // Set default directory path if still not set
                if (!directoryPath.value) {
                    afio.getDefaultDir("savepath").then(function (node) {
                        var p = node.path;
                        // Default to Macros folder if root is returned (common in File System Access)
                        if (p === '/' || p === '' || p === '\\') {
                            p = 'Macros';
                        }
                        directoryPath.value = p;
                        directoryPath.dataset.path = p;
                    }).catch(function (err) {
                        console.error("Error getting default directory:", err);
                    });
                }
            } else {
                directoryBox.style.display = "none";
            }
        }

        // Listen for storage type changes
        filesRadio.addEventListener("change", updateDirectoryBoxVisibility);
        bookmarksRadio.addEventListener("change", updateDirectoryBoxVisibility);

        // Handle browse button click
        browseButton.addEventListener("click", async function () {
            if (afio.getBackendType() === 'filesystem-access') {
                try {
                    // Use File System Access API to pick a directory
                    const success = await afio.promptForFileSystemAccess();
                    if (success) {
                        const defaultDir = await afio.getDefaultDir("savepath");
                        directoryPath.value = defaultDir.path;
                        directoryPath.dataset.path = defaultDir.path;
                    }
                } catch (e) {
                    console.error("Browse failed:", e);
                }
                return;
            }

            // Note: In MV2, directory selection requires native messaging
            // We use a prompt as a simple solution for directory path input
            var currentPath = directoryPath.value || "";
            var newPath = prompt("Enter directory path:", currentPath);

            if (newPath) {
                // Validate the path exists
                var node = afio.openNode(newPath);
                node.exists().then(function (exists) {
                    if (exists) {
                        directoryPath.value = newPath;
                        directoryPath.dataset.path = newPath;
                    } else {
                        alert("Directory does not exist: " + newPath);
                    }
                }).catch(function (err) {
                    console.error("Error checking directory:", err);
                    alert("Error checking directory: " + err.message);
                });
            }
        });

        // Initialize directory box visibility
        updateDirectoryBoxVisibility();
    }
});



function saveDirectly() {
    // Direct save overrides the existing file without checking or asking
    // args.save_data.file_id holds the path to overwrite

    if (!args.save_data.file_id) {
        // Fallback to OK behavior if no file ID exists (should not happen if button is shown)
        ok();
        return;
    }

    // Ensure we are in file mode for consistency, though we use file_id directly
    args.save_data.bookmark_id = "";

    // If using File System Access API, write directly
    if (afio.getBackendType() === 'filesystem-access') {
        var node = afio.openNode(args.save_data.file_id);

        afio.writeTextFile(node, args.save_data.source).then(function () {
            // Notify background to refresh panels
            chrome.runtime.sendMessage({ type: 'REFRESH_PANEL_TREE' });
            window.close();
        }).catch(function (err) {
            console.error("Save failed:", err);
            alert("Save failed: " + (err && err.message ? err.message : String(err)));
        });
        return;
    }

    // Default save mechanism for other backends
    saveMacro(args.save_data, true).then(function () {
        chrome.runtime.sendMessage({ type: 'REFRESH_PANEL_TREE' });
        window.close();
    }).catch(function (err) {
        console.error("[iMacros] Failed to save macro:", err);
        alert("Save failed: " + (err && err.message ? err.message : String(err)));
    });
}

function ok() {
    var macro_name = document.getElementById("macro-name");

    try {
        var normalizedName = normalizeMacroName(macro_name.value);
        args.save_data.name = normalizedName;
    } catch (e) {
        alert(e.message || String(e));
        macro_name.focus();
        return;
    }

    console.log("[iMacros] Saving macro as:", args.save_data.name);

    var overwrite = false;

    if (!/\.iim$/.test(args.save_data.name)) // append .iim extension
        args.save_data.name += ".iim";

    if (!document.getElementById("radio-files-tree").checked) {
        // save macro as bookmark
        if (args.save_data.file_id)
            args.save_data.file_id = "";
        saveMacro(args.save_data, overwrite).then(function () {
            window.close();
        }).catch(function (err) {
            console.error("[iMacros] Failed to save macro:", err);
            alert("Save failed: " + err);
        });
        return;
    }

    // otherwise save macro as a file
    args.save_data.bookmark_id = "";
    afio.isInstalled().then(function (installed) {
        if (!installed) {
            alert("Please install file support for iMacros " +
                "to save macro as a file");
            return;
        }

        // Get the selected directory path
        var directoryPath = document.getElementById("directory-path");
        var selectedDir = directoryPath.dataset.path || directoryPath.value;

        // Use the selected directory or fall back to default
        var dirPromise = selectedDir ?
            Promise.resolve(afio.openNode(selectedDir)) :
            afio.getDefaultDir("savepath");

        dirPromise.then(function (node) {
            // Append the filename to the directory path
            node.append(args.save_data.name);
            args.save_data.file_id = node.path;

            node.exists().then(function (exists) {
                if (exists) {
                    overwrite = confirm("Macro " + node.leafName +
                        " already exists.\n" +
                        "Do you want to overwrite it?");
                    if (!overwrite)
                        return;
                }

                // If using File System Access API, write directly from this context
                // because the background service worker cannot access the handle
                if (afio.getBackendType() === 'filesystem-access') {
                    afio.writeTextFile(node, args.save_data.source).then(function () {
                        // Notify background to refresh panels
                        chrome.runtime.sendMessage({ type: 'REFRESH_PANEL_TREE' });
                        window.close();
                    }).catch(function (err) {
                        console.error("Save failed:", err);
                        alert("Save failed: " + err);
                    });
                    return;
                }

                saveMacro(args.save_data, overwrite).then(function () {
                    window.close();
                }).catch(function (err) {
                    console.error("[iMacros] Failed to save macro:", err);
                    alert("Save failed: " + err);
                });
            }).catch(function (err) {
                console.error("[iMacros] File existence check failed:", err);
                alert("Error checking file: " + (err.message || err));
            });
        });
    });
}

function normalizeMacroName(rawName) {
    var trimmed = String(rawName || "").trim();

    if (!trimmed) {
        throw new Error("Macro name cannot be empty");
    }

    // Replace only characters that are invalid on common filesystems
    var sanitized = trimmed.replace(/[\\/:*?"<>|]/g, "_");

    return sanitized;
}

// Helper: send save request to background service worker
function saveMacro(macro, overwrite) {
    return new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage({
            type: 'SAVE_MACRO',
            macro: macro,
            overwrite: overwrite
        }, function (result) {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError.message);
                return;
            }
            if (!result || !result.success) {
                reject(result && result.error ? result.error : 'Unknown error');
                return;
            }
            resolve(result.result);
        });
    });
}


function cancel() {
    window.close();
}
