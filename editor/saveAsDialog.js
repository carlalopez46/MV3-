/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

var args;
var dialogWindowId = null;

window.addEventListener("load", function () {
    // Primary MV3 path: request dialog args from background
    chrome.windows.getCurrent(function (currentWindow) {
        dialogWindowId = currentWindow.id;

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
                console.error("[iMacros] Background failed to get dialog args:", result && result.error);
                fallbackToSessionStorage();
                return;
            }

            args = result.args;
            initializeWithAfio();
        });
    });


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
            storage.remove([dialogKey]);

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
        window.resizeTo(rc.width + 30, rc.height + 30);
        window.moveTo(window.opener.screenX + window.opener.outerWidth / 2 - 100,
            window.opener.screenY + window.opener.outerHeight / 2 - 100);
        var macro_name = document.getElementById("macro-name");
        macro_name.value = args.save_data.name || "Unnamed Macro";
        macro_name.select();
        macro_name.focus();
        macro_name.addEventListener("keypress", function (e) {
            if (e.which == 13) ok();
        });

        var file_type = !!args.save_data.file_id;
        if (file_type) {
            document.getElementById("radio-files-tree").checked = "yes";
        } else {
            document.getElementById("radio-bookmarks-tree").checked = "yes";
        }

        // Add event listeners for buttons
        document.getElementById("ok-button").addEventListener("click", ok);
        document.getElementById("cancel-button").addEventListener("click", cancel);

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
                // Set default directory path if not already set
                if (!directoryPath.value) {
                    afio.getDefaultDir("savepath").then(function (node) {
                        directoryPath.value = node.path;
                        directoryPath.dataset.path = node.path;
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



function ok() {
    var macro_name = document.getElementById("macro-name");
    args.save_data.name = macro_name.value;

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
            }).catch(console.error.bind(console));
        });
    });
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
