/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

"use strict";


function setSecurityLevel() {
    if (!Storage.isSet("encryption-type"))
        Storage.setChar("encryption-type", "no");
    let type = Storage.getChar("encryption-type");
    if (!/^(?:no|stored|tmpkey)$/.test(type))
        type = "no";
    let stored = Storage.getChar("stored-password");
    if (stored) {
        $("#stored-password-box").val(decodeURIComponent(atob(stored)));
    }

    switch (type) {
        case "no":
            $("#type_no").prop("checked", true);
            $("#stored-password-field").hide()
            $("#temp-password-field").hide()
            break;
        case "stored":
            $("#type_stored").prop("checked", true);
            $("#stored-password-field").show()
            $("#temp-password-field").hide()
            break;
        case "tmpkey":
            $("#type_tmpkey").prop("checked", true);
            $("#stored-password-field").hide()
            $("#temp-password-field").show()
            break;
    }
}

function onSecurityChange(e) {
    // Guard against unexpected element IDs that don't start with "type_"
    if (!e.target.id || !e.target.id.startsWith("type_")) {
        console.error("onSecurityChange: unexpected element id:", e.target.id);
        return;
    }
    let type = e.target.id.substring(5)
    switch (type) {
        case "no":
            $("#stored-password-field").hide()
            $("#temp-password-field").hide()
            break;
        case "stored":
            $("#stored-password-field").show()
            $("#temp-password-field").hide()
            $("#stored-password-box").focus()
            $("#stored-password-box").select()
            break;
        case "tmpkey":
            $("#stored-password-field").hide()
            $("#temp-password-field").show()
            $("#temp-password-box").focus()
            $("#temp-password-box").select()
            break;
    }
    Storage.setChar("encryption-type", type)
}

function updatePanelViews() {
    // MV3: Send message to background to update all panel views
    chrome.runtime.sendMessage({
        type: 'UPDATE_PANEL_VIEWS'
    }, function (response) {
        if (chrome.runtime.lastError) {
            console.warn("Could not update panel views:", chrome.runtime.lastError);
            return;
        }
        if (!response || !response.success) {
            console.warn("Failed to update panel views:", response ? response.error : 'Unknown error');
        }
    });
}

function onPathChange(which) {
    Storage.setChar(which, $("#" + which).val());
    if (which == "defsavepath")
        updatePanelViews()

}


async function choosePath(which) {
    if (typeof FileSystemAccessService !== 'undefined' && FileSystemAccessService.isSupported()) {
        try {
            const fsService = new FileSystemAccessService({
                autoPrompt: false,
                persistPermissions: true
            });

            // Show directory picker
            const success = await fsService.promptForDirectory();

            if (success && fsService.rootHandle) {
                // Save directory name as path
                // Note: File System Access API does not provide absolute path, only directory name
                // If macro path is set, ensure tree-type is set to files
                if (which === "defsavepath") {
                    Storage.setChar("tree-type", "files");

                    // Automatically set paths relative to the selected root directory
                    // User selects the PARENT folder (e.g. iMacrosData), and we set subfolders
                    const rootName = fsService.rootHandle.name;

                    // Automatically create default subdirectories if they don't exist
                    try {
                        // Note: makeDirectory uses {create: true}, so it will create if missing or return existing handle
                        await fsService.makeDirectory("Macros");
                        await fsService.makeDirectory("Datasources");
                        await fsService.makeDirectory("Downloads");
                        await fsService.makeDirectory("Logs");
                    } catch (err) {
                        console.error("Failed to create default directories:", err);
                        alert("Warning: Failed to create/verify default subdirectories (Macros, Datasources, Downloads, Logs).\nPlease check your permissions.");
                    }

                    const macrosPath = rootName + "/Macros";
                    const dsPath = rootName + "/Datasources";
                    const dlPath = rootName + "/Downloads";
                    const logPath = rootName + "/Logs";

                    savePath("defsavepath", macrosPath);
                    savePath("defdatapath", dsPath);
                    savePath("defdownpath", dlPath);
                    savePath("deflogpath", logPath);

                    // Save backend type so bg.js knows to use File System Access API
                    Storage.setChar("afio-backend", "filesystem-access");
                    Storage.setBool("afio-installed", true);

                    // Notify Service Worker to reload localStorage cache
                    chrome.runtime.sendMessage({
                        type: 'RELOAD_LOCALSTORAGE_CACHE'
                    }, function (response) {
                        if (chrome.runtime.lastError) {
                            console.warn("Could not notify Service Worker:", chrome.runtime.lastError);
                        }

                        // Reload extension to ensure Service Worker picks up new settings
                        setTimeout(() => {
                            alert(`Root directory set to: ${rootName}\n\nStandard subdirectories (Macros, Datasources, Downloads) have been verified/created and configured automatically.\n\nThe extension will now reload to apply changes.`);
                            chrome.runtime.reload();
                        }, 500);
                    });
                } else {
                    // For other paths, just save the root name if selected individually (though typically we use the bulk update above)
                    savePath(which, fsService.rootHandle.name);
                }
            }
        } catch (e) {
            console.error("Error selecting directory:", e);
            alert("Failed to select directory: " + e.message);
        }
        return;
    }

    // Fallback for environments without File System Access API
    // Disabled to prevent infinite loading issues in browse.html
    /*
    var features = "titlebar=no,menubar=no,location=no,"+
        "resizable=yes,scrollbars=no,status=no,"+
        "width=200,height=300";
    var win = window.open("browse.html", "iMacros_browse_dialog", features);

    win.args = {path: Storage.getChar(which), which: which};
    */

    alert("File System Access API is not available or supported in this context.\nPlease ensure you are using a modern browser and the extension is correctly installed.\n(errorLogger.js might be missing)");
}

function savePath(which, path) {
    Storage.setChar(which, path);
    $("#" + which).val(path);
    if (which == "defsavepath")
        updatePanelViews()
}

async function ensureStorageReady() {
    const prefix = 'localStorage_';

    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        console.error('[iMacros Options] chrome.storage.local is unavailable; storage hydration aborted');
        showInitializationWarning("Persistent settings could not be loaded. Please reload the options page after re-installing the extension.");
        return;
    }

    try {
        console.log('[iMacros Options] Loading settings from chrome.storage.local...');
        const items = await chrome.storage.local.get(null);
        let loadedCount = 0;

        for (const key in items) {
            if (!key.startsWith(prefix)) {
                continue;
            }

            const localKey = key.substring(prefix.length);
            const existingValue = localStorage.getItem(localKey);

            // Only set if not already in localStorage (avoid overwriting recent changes)
            if (existingValue === null || typeof existingValue === 'undefined') {
                localStorage.setItem(localKey, items[key]);
                loadedCount++;
            }
        }

        console.log(`[iMacros Options] Loaded ${loadedCount} settings from persistent storage`);
    } catch (e) {
        console.error('[iMacros Options] Failed to load settings from chrome.storage.local:', e);
        showInitializationWarning("Persistent settings could not be loaded. Please reload the options page after re-installing the extension.");
    }
}


function showInitializationWarning(message) {
    if (document.getElementById("storage-hydration-warning")) {
        return;
    }

    const banner = document.createElement("div");
    banner.id = "storage-hydration-warning";
    banner.className = "storage-hydration-warning";
    banner.setAttribute("role", "alert");
    banner.setAttribute("aria-live", "polite");
    banner.textContent = message || "Options initialization is partially disabled. Please reload the options page after re-installing the extension.";

    document.body.prepend(banner);
}


window.addEventListener("load", async function () {
    // CRITICAL: Wait for storage to be ready before reading any settings
    await ensureStorageReady();

    if (typeof $ !== "function") {
        console.error("[iMacros Options] jQuery is unavailable; options UI cannot initialize");
        showInitializationWarning("The options UI could not load because jQuery failed to initialize. Please reload the options page after re-installing the extension.");
        return;
    }

    $("#show-before-play-dialog").prop(
        "checked", Storage.getBool("before-play-dialog")
    ).change(function (event) {
        let checked = event.target.checked
        Storage.setBool("before-play-dialog", checked)
    })

    $("#dock-panel").prop(
        "checked", Storage.getBool("dock-panel")
    ).change(function (event) {
        let checked = event.target.checked
        Storage.setBool("dock-panel", checked);
    })

    // Check if AFIO is installed OR File System Access API is supported
    const isAfioInstalled = Storage.getBool("afio-installed");
    const isFsAccessSupported = typeof FileSystemAccessService !== 'undefined' && FileSystemAccessService.isSupported();

    // Auto-repair paths if File System Access is active but paths are incorrect (e.g. /VirtualMacros)
    // OR if paths are not set at all - automatically use standard Macros/Datasources/Downloads structure
    if (isFsAccessSupported) {
        (async () => {
            try {
                const fsService = new FileSystemAccessService({ autoPrompt: false });
                // Initialize to load saved handle from IndexedDB
                await fsService.init();

                if (fsService.rootHandle) {
                    const rootName = fsService.rootHandle.name;
                    const currentSavePath = Storage.getChar("defsavepath");
                    const currentDataPath = Storage.getChar("defdatapath");
                    const currentDownPath = Storage.getChar("defdownpath");
                    const currentLogPath = Storage.getChar("deflogpath");

                    // Auto-configure if paths are missing, virtual, or don't match the standard structure
                    const needsAutoConfig = !currentSavePath ||
                                          currentSavePath === "/VirtualMacros" ||
                                          currentSavePath.startsWith("/Virtual") ||
                                          !currentSavePath.includes("/Macros") ||
                                          !currentDataPath ||
                                          !currentDataPath.includes("/Datasources") ||
                                          !currentDownPath ||
                                          !currentDownPath.includes("/Downloads") ||
                                          !currentLogPath ||
                                          !currentLogPath.includes("/Logs");

                    if (needsAutoConfig) {
                        console.log("Auto-configuring standard directory paths (Macros, Datasources, Downloads)");

                        // Ensure standard subdirectories exist
                        try {
                            await fsService.makeDirectory("Macros");
                            await fsService.makeDirectory("Datasources");
                            await fsService.makeDirectory("Downloads");
                            await fsService.makeDirectory("Logs");
                        } catch (e) {
                            console.warn("Auto-config mkdir failed (directories may already exist)", e);
                        }

                        const macrosPath = rootName + "/Macros";
                        const dsPath = rootName + "/Datasources";
                        const dlPath = rootName + "/Downloads";
                        const logPath = rootName + "/Logs";

                        // Update storage and UI
                        savePath("defsavepath", macrosPath);
                        savePath("defdatapath", dsPath);
                        savePath("defdownpath", dlPath);
                        savePath("deflogpath", logPath);

                        // Force UI update if elements exist
                        if ($("#defsavepath").length) $("#defsavepath").val(macrosPath);
                        if ($("#defdatapath").length) $("#defdatapath").val(dsPath);
                        if ($("#defdownpath").length) $("#defdownpath").val(dlPath);
                        if ($("#deflogpath").length) $("#deflogpath").val(logPath);

                        console.log("Paths auto-repaired to:", macrosPath);

                        // Notify user and refresh panels
                        alert(`Paths have been automatically corrected (root: ${rootName}):\\n\\nMacros: ${macrosPath}\\nDatasources: ${dsPath}\\nDownloads: ${dlPath}\\n\\nPlease reload the iMacros panel (close and reopen) to see the changes.`);
                        updatePanelViews();
                    }
                }
            } catch (err) {
                console.warn("Path auto-repair failed:", err);
            }
        })();
    }

    // Check File System Access permissions and warn if expired
    if (isFsAccessSupported) {
        (async () => {
            try {
                const fsService = new FileSystemAccessService({ autoPrompt: false });
                await fsService.init();

                // If we have a saved handle but no permission, warn the user
                if (fsService.rootHandle && !fsService.ready) {
                    showPermissionWarning(fsService.rootHandle.name);
                }
            } catch (err) {
                console.warn("Permission check failed:", err);
            }
        })();
    }

    function showPermissionWarning(directoryName) {
        // Remove existing warning if present
        const existingWarning = document.getElementById('permission-warning');
        if (existingWarning) {
            existingWarning.remove();
        }

        const warningDiv = document.createElement('div');
        warningDiv.id = 'permission-warning';
        warningDiv.style.cssText = `
            background-color: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 4px;
            padding: 12px 16px;
            margin-bottom: 16px;
            color: #856404;
        `;
        warningDiv.innerHTML = `
            <strong>⚠️ ディレクトリへのアクセス権限が失効しています</strong>
            <p style="margin: 8px 0 0 0;">
                保存されたディレクトリ「<strong></strong>」へのアクセス権限が失効しています。<br>
                パスを再設定するには、下の「参照」ボタンをクリックしてディレクトリを再選択してください。
            </p>
        `;

        // Safely insert directory name to prevent XSS
        const strongTag = warningDiv.querySelector('p strong');
        if (strongTag) {
            strongTag.textContent = directoryName;
        }

        const pathSettings = document.getElementById('path-settings');
        if (pathSettings && pathSettings.firstChild) {
            // Insert after the header
            const header = pathSettings.querySelector('.header');
            if (header && header.nextSibling) {
                pathSettings.insertBefore(warningDiv, header.nextSibling);
            } else {
                pathSettings.insertBefore(warningDiv, pathSettings.firstChild.nextSibling);
            }
        }
    }

    if (!isAfioInstalled && !isFsAccessSupported) {
        $("#file-access-note").addClass("settings-container");
        $("<span class='header'>File Access Not Installed</span>").prependTo("#file-access-note");
        $("<span>The File Access for iMacros Extensions module is currently " +
            "not installed. It is not available in the freeware version. " +
            "The following functionality is not available unless you have an iMacros license and " +
            "<span id='customer' class='a-link no-bold-link'>install the File Access</span> module:</span > ").appendTo("#note-header");
        $("<li>Save or play macro (.iim) files (only macros stored as bookmarks can be saved/played) </li>" +
            "<li>Read input from CSV files (!DATASOURCE command)</li> " +
            "<li>Access the file system via the !FOLDER_XXX variables, e.g. !FOLDER_DATASOURCE, !FOLDER_DOWNLOAD etc.</li>" +
            "<li>Save extracted data (SAVEAS and SAVEITEM commands)</li> " +
            "<li>Save screenshots (using the SAVEAS or SCREENSHOT commands)</li> " +
            "<li>Save stopwatch data to a log file via the STOPWATCH command " +
            "(data can be referenced in macro via the !STOPWATCHTIME variable)</li>" +
            "<li>Profile macro performance</li>").appendTo("#note-list");
        $("<span>See </span><span id='features-comparison' class='a-link no-bold-link'>" +
            "the feature comparison chart</span ><span>.</span> ").appendTo("#file-access-note");
        $("#profiler-enabled-box").addClass("disabled");
        $("#enable-profiler").attr("disabled", "disabled");
        $("#path-settings").addClass("disabled");
        $("#defsavepath").prop('disabled', true)
        $("#defdatapath").prop('disabled', true);
        $("#defdownpath").prop('disabled', true);
        $("#deflogpath").prop('disabled', true);
        $("#defsavepath-browse").hide();
        $("#defdatapath-browse").hide();
        $("#defdownpath-browse").hide();
        $("#deflogpath-browse").hide();
    }

    $("#enable-profiler").prop(
        "checked", Storage.getBool("profiler-enabled")
    ).change(function (event) {
        let checked = event.target.checked
        Storage.setBool("profiler-enabled", checked);
    })

    // paths
    $("#defsavepath").val(Storage.getChar("defsavepath"))
        .on("input", onPathChange.bind(null, "defsavepath"))
    $("#defsavepath-browse").click(choosePath.bind(null, "defsavepath"))
    $("#defdatapath").val(Storage.getChar("defdatapath"))
        .on("input", onPathChange.bind(null, "defdatapath"))
    $("#defdatapath-browse").click(choosePath.bind(null, 'defdatapath'))
    $("#defdownpath").val(Storage.getChar("defdownpath"))
        .on("input", onPathChange.bind(null, 'defdownpath'))
    $("#defdownpath-browse").click(choosePath.bind(null, 'defdownpath'))
    $("#deflogpath").val(Storage.getChar("deflogpath"))
        .on("input", onPathChange.bind(null, 'deflogpath'))
    $("#deflogpath-browse").click(choosePath.bind(null, 'deflogpath'))

    // encryption
    setSecurityLevel()
    $("#type_no").change(onSecurityChange);
    $("#type_stored").change(onSecurityChange);
    $("#type_tmpkey").change(onSecurityChange);
    $("#stored-password-box").on("input", function () {
        let pwd = $("#stored-password-box").val();
        pwd = btoa(encodeURIComponent(pwd));
        Storage.setChar("stored-password", pwd);
    })
    $("#temp-password-box").on("input", function () {
        // MV3: Send message to background to set temp password
        var tempPassword = $("#temp-password-box").val();
        chrome.runtime.sendMessage({
            type: 'SET_TEMP_PASSWORD',
            password: tempPassword
        }, function (response) {
            if (chrome.runtime.lastError) {
                console.warn("Could not set temp password:", chrome.runtime.lastError);
            }
        });
    })

    // links
    $("#more-info-bp").click(function () {
        link(getRedirFromString('bookmarklets'));
    });
    $("#more-info-profiler").click(function () {
        link(getRedirectURL('Performance_Profiler'));
    });
    $("#password-tool-page").click(function () {
        link(getRedirectURL(160));
    });
    $("#more-info-encryption").click(function () {
        link(getRedirectURL('!ENCRYPTION'));
    });
    if (!Storage.getBool("afio-installed")) {
        $("#customer").click(function () {
            link(getRedirFromString('install-afio'));
        });
        $("#features-comparison").click(function () {
            link(getRedirFromString('compare-versions'))
        });
    };

    // record modes
    var record_modes = ["conventional", "event"];
    var record_radio = $("#record-mode-" + Storage.getChar("record-mode"));
    if (!record_radio) {
        alert("Unknown record mode type: " + Storage.getChar("record-mode"))
    } else {
        record_radio.prop("checked", true)
        for (let r of record_modes) {
            $("#record-mode-" + r).change(function (e) {
                Storage.setChar("record-mode", e.target.id.substring(12))
            });
        }
    }

    // replay speed
    let delay = Storage.getNumber("replaying-delay")
    let delay_types = [
        ["fast", x => x <= 100 || isNaN(x), 0],
        ["medium", x => x <= 1000 && x > 100, 800],
        ["slow", x => x > 1000, 2000]
    ]
    for (let [n, p, x] of delay_types) {
        $("#replay-speed-" + n).prop("checked", p(delay))
        $("#replay-speed-" + n).change(
            e => Storage.setNumber("replaying-delay", x)
        )
    }

    $("#more-info-event").click(function () {
        link(getRedirectURL("EVENT"))
    })
    $("#license-link").click(function () {
        link(getRedirFromString("EULA_Freeware"))
    })
    $("#favorid-panel").prop(
        "checked", Storage.getBool("recording-prefer-id")
    ).change(function (e) {
        Storage.setBool("recording-prefer-id", e.target.checked)
    })

    $("#css-selectors").prop(
        "checked", Storage.getBool("recording-prefer-css-selectors")
    ).change(function (e) {
        Storage.setBool("recording-prefer-css-selectors", e.target.checked)
    })
});
