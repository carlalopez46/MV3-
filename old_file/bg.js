/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

"use strict";
// old bookmarklet pattern

// function makeBookmarklet(name, content) {
//     var pattern = "(function() {"+
//         "try{"+
//         "var m64 = \"{{macro}}\", n = \"{{name}}\";"+
//         "if(!/Chrome\\/\\d+\\.\\d+\\.\\d+\\.\\d+/.test(navigator.userAgent)){"+
//         "alert('iMacros: The embedded macros work with iMacros for Chrome. Support for IE/Firefox is planned.');"+
//         "return;"+
//         "}"+
//         "if(!/^(?:chrome|https?|file)/.test(location)){"+
//         "alert('iMacros: To run a macro, you need to open a website first.');"+
//         "return;"+
//         "}"+
//         "var div = document.getElementById(\"imacros-bookmark-div\");"+
//         "if (!div){"+
//         "alert(\"Can not run macro, no iMacros div found\");"+
//         "return;"+
//         "}"+
//         "var ta = document.getElementById(\"imacros-macro-container\");"+
//         "ta.value = decodeURIComponent(atob(m64));"+
//         "div.setAttribute(\"name\", n);"+
//         "var evt = document.createEvent(\"Event\");"+
//         "evt.initEvent(\"iMacrosRunMacro\", true, true);"+
//         "div.dispatchEvent(evt);"+
//         "}catch(e){alert('Bookmarklet error: '+e.toString());}"+
//         "}) ();";

//     var macro_name = name || "Unnamed Macro", source = content;
//     macro_name = imns.escapeLine(macro_name);
//     pattern = pattern.replace("{{name}}", macro_name);
//     source = btoa(encodeURIComponent(source));
//     source = imns.escapeLine(source);
//     pattern = pattern.replace("{{macro}}", source);

//     var url = "javascript:" + pattern;

//     return url;
// }


// create bookmarklet of new type
function makeBookmarklet(name, code) {
    var pattern = "(function() {"+
        "try{"+
        "var e_m64 = \"{{macro}}\", n64 = \"{{name}}\";"+
        "if(!/^(?:chrome|https?|file)/.test(location)){"+
        "alert('iMacros: Open webpage to run a macro.');"+
        "return;"+
        "}"+
        "var macro = {};"+
        "macro.source = decodeURIComponent(atob(e_m64));"+
        "macro.name = decodeURIComponent(atob(n64));"+
        "var evt = document.createEvent(\"CustomEvent\");"+
        "evt.initCustomEvent(\"iMacrosRunMacro\", true, true, macro);"+
        "window.dispatchEvent(evt);"+
        "}catch(e){alert('iMacros Bookmarklet error: '+e.toString());}"+
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
}


function ensureBookmarkFolderCreated(parent_id, name) {
    return new Promise(function(resolve, reject) {
        chrome.bookmarks.getChildren( parent_id, function (result) {
            // find a bookmark with matching name
            for(var r of result) {
                if (r.title == name)
                    return resolve(r);
            }
            // otherwise create one
            chrome.bookmarks.create(
                {parentId: parent_id, title: name}, resolve
            );
        });
    });
}

function createBookmark(folder_id, title, url, bookmark_id, overwrite) {
    return new Promise(function(resolve, reject) {
        if (bookmark_id) {
            chrome.bookmarks.update(
                bookmark_id,
                {url: url, title: title},
                resolve
            );
            return;
        }

        if (overwrite) {
            reject(new Error("bg.save() - trying to overwrite "+title+
                             " while bokmark_id is not set"));
            return;
        }

        // TODO: ask if user wants to overwrite the macro
        // if (confirm())...

        // look for a macro with the same name
        // append (\d) to title if macro with the title already exists
        chrome.bookmarks.getChildren(folder_id, function (children) {
            var found = false, count = 0, name = title;
            for(;;) {
                for(var x of children) {
                    if (x.title == name && x.url) {
                        found = true; count++; break;
                    }
                }
                if (found) {
                    found = false;
                    if (/\.iim$/.test(title)) {
                        name = title.replace(/\.iim$/, "$'("+count+").iim");
                    } else {
                        name = title+"("+count+")";
                    }
                    continue;
                } else {
                    break;
                }
            }
            chrome.bookmarks.create(
                {
                    parentId: folder_id,
                    title: name,
                    url: url
                }, resolve);
        });
    });
}


function save_file(save_data, overwrite, callback) {
    var node = afio.openNode(save_data.file_id);
    var update_tree = true;

    if (!isMacroFile(save_data.name))
        save_data.name += ".iim";

    if (node.leafName != save_data.name) {
        node = node.parent;
        node.append(save_data.name);
    }

    node.exists().then(function(exists) {
        if (exists && !overwrite) {
            var yes = confirm("Are you sure you want to overwrite "+
                              node.path+"?");
            if (!yes)
                return;
        }

        update_tree = !exists;

        return afio.writeTextFile(node, save_data.source).then(function() {
            typeof (callback) == "function" && callback(save_data);
            if (!update_tree)
                return;
            for (var x in context) { // update all panels
                var panel = context[x].panelWindow;
                if (panel && !panel.closed) {
                    var doc = panel.frames["tree-iframe"].contentDocument;
                    doc.defaultView.location.reload();
                }
            }
        });
    }).catch(console.error.bind(console));
}



function save(save_data, overwrite, callback) {
    // TODO: for file version when file_id is not set "saveAs"
    // saves into file or bookmark
    if (save_data.file_id) {
        save_file(save_data, overwrite, callback);
        return;
    }

    chrome.bookmarks.getTree( function (tree) {
        var p_id = tree[0].children[0].id;
        ensureBookmarkFolderCreated(p_id, "iMacros").then(function(node) {
            var url = makeBookmarklet(save_data.name, save_data.source);
            var iMacrosDirId = node.id;
            if (overwrite && !save_data.bookmark_id) {
                // we should check if "name" exists and if it does then
                // find its bookmark_id
                chrome.bookmarks.getChildren(iMacrosDirId, function(ar) {
                    for (var x of ar) {
                        if (x.title == save_data.name) {
                            save_data.bookmark_id = x.id;
                            createBookmark(
                                iMacrosDirId, save_data.name, url,
                                save_data.bookmark_id,
                                overwrite
                            ).then(function() {
                                typeof(callback) == "function" && callback(save_data);
                            });
                            return;
                        }
                    };
                    // no macro was found so create a new one
                    createBookmark(
                        iMacrosDirId, save_data.name, url,
                        save_data.bookmark_id,
                        false
                    ).then(function() {
                        typeof(callback) == "function" &&
                            callback(save_data);
                    });
                });
            } else {
                createBookmark(
                    iMacrosDirId, save_data.name, url,
                    save_data.bookmark_id,
                    overwrite
                ).then(function() {
                    typeof(callback) == "function" &&
                        callback(save_data);
                });
            }
        });
    });
}


function edit(macro, overwrite) {
    var features = "titlebar=no,menubar=no,location=no,"+
        "resizable=yes,scrollbars=yes,status=no,"+
        "width=640,height=480";
    // var win = window.open("editor/simple_editor.html",
    //     null, features);
    // console.info("Edit macro: %O", macro);
    var win = window.open("editor/editor.html",
        null, features);

    win.args = {macro: macro, overwrite: overwrite};
}


function playMacro(macro, win_id) {
    if (context[win_id]) {
        getLimits().then(
            limits => context[win_id].mplayer.play(macro, limits)
        )
    } else {
        console.error("No context for windowId="+win_id);
    }
}

function dockPanel(win_id) {
    var panel = context[win_id].panelWindow;
    if (!panel || panel.closed) {
        clearInterval(context[win_id].dockInterval);
        return;
    }
    if (!Storage.getBool("dock-panel"))
        return;

    chrome.windows.get(win_id, function(w) {
	var new_x = w.left - panel.outerWidth;
	if (new_x < 0)
            new_x = 0;

	var updateInfo = {
            height: w.height,
	         width: Math.round(panel.outerWidth),
            left: new_x,
            top: w.top
	};

	chrome.windows.update(context[win_id].panelId, updateInfo);
    });
}

function openPanel(win_id) {
	// Exit if panel is already open
	var panel = context[win_id].panelWindow;
	if (panel && !panel.closed) {
		return;
	}

    chrome.windows.get(win_id, function(win) {
        var panelBox = Storage.getObject("panel-box");
        if (!panelBox) {
            panelBox = new Object();
            panelBox.width = 210;
            if (Storage.getBool("dock-panel"))
                panelBox.height = win.height;
            else
                panelBox.height = 600;
            panelBox.top = win.top;
            panelBox.left = win.left-panelBox.width;
            if (panelBox.left < 0)
                panelBox.left = 0;
        }

        var createData = {
            url: "panel.html", type: "popup",
            top: panelBox.top, left: panelBox.left,
            width: panelBox.width, height: panelBox.height
        };

        chrome.windows.create(createData, function(w) {
            context[win_id].panelId = w.id;
            context[win_id].dockInterval = setInterval(function() {
                dockPanel(win.id);
            }, 500);
        });
    });
}

// called from panel
// we use it to find and set win_id for that panel
// NOTE: unfortnunately, it seems there is no more straightforward way
// because on Windows chrome.windows.onCreated is fired too early for
// panel's DOM window be fully constructed
function onPanelLoaded(panel) {
    for (var win_id in context) {
        win_id = parseInt(win_id);
        if (!isNaN(win_id)) {
            var v = chrome.extension.getViews(
                {windowId: context[win_id].panelId}
            )[0];
            if (v == panel) {
                context[win_id].panelWindow = panel;
                return win_id;
            }
        }
    }

    console.error("Can not find windowId for panel %O", panel);
    throw new Error("Can not find windowId for panel!");
}


// browser action button onclick handler
chrome.browserAction.onClicked.addListener(function(tab) {
    var win_id = tab.windowId;
    if (Storage.getBool("show-updated-badge")) {
        doAfterUpdateAction();
        return;
    }

    if (!context[win_id]) {
        console.warn("No context for window, rebuilding: "+win_id);
        context.init(win_id);
    }

    var mplayer = context[win_id].mplayer;
    var recorder = context[win_id].recorder;

    if (context[win_id].state == "idle") {
        var panel = context[win_id].panelWindow;
        if (!panel || panel.closed) {
            openPanel(win_id);
        } else {
            panel.close();
            delete context[win_id].panelId;
            delete context[win_id].panelWindow;
        }
    } else if (context[win_id].state == "paused") {
        if (mplayer.paused) {
            mplayer.unpause();
        }
    } else {
        if (mplayer.playing) {
            mplayer.stop();
        } else if (recorder.recording) {
            recorder.stop();
            var recorded_macro = recorder.actions.join("\n");
            var macro = {source: recorded_macro, win_id: win_id,
                         name: "#Current.iim"};

            if (Storage.getChar("tree-type") == "files") {
                afio.isInstalled().then(function(installed) {
                    if (installed) {
                        afio.getDefaultDir("savepath").then(function(node) {
                            node.append("#Current.iim");
                            macro.file_id = node.path;
                            edit(macro, /* overwrite */ true);
                        }).catch(console.error.bind(console));
                    } else {            // no file access
                        edit(macro, true);
                    }
                }).catch(console.error.bind(console));
            } else {
                edit(macro, true);
            }
        }
    }
});


function addSampleBookmarkletMacro(name, parentId, content) {
    return new Promise(function(resolve, reject) {
        chrome.bookmarks.getChildren(parentId, function(a) {
            // we should check if "name" exists
            var id = null;
            for (var x of a) {
                if (x.title == name) {
                    // TODO: maybe we should ask user if he or she
                    // wants to override that sample macro?
                    // Now just overwrite it silently
                    id = x.id;
                    break;
                }
            }
            // no macro was found, create a new one
            createBookmark(
                parentId, name,
                makeBookmarklet(name, content),
                id || null,
                !!id
            ).then(resolve, reject);
        });
    });
}

function xhr(path, mimeType) {
    return new Promise((resolve, reject) => {
        let url = chrome.extension.getURL(path)
        let req = new XMLHttpRequest()
        req.overrideMimeType(mimeType)
        req.onreadystatechange = function() {
            if (req.readyState == 4) {
                resolve(req.response)
            }
        }
        req.onerror = reject
        req.open("GET", url, true)
        req.send(null)
    })
}

function getSample(name) {
    return xhr("samples/"+name, "text/plain;charset=utf-8")
        .then(response => ({
            name: name,
            content: response
        }))
}

function ensureDirectoryExists(node) {
    // a workaround for afio.exe bug on Windows - paths which end with "\"
    // are erroneously reported as non-existsent
    if (__is_windows() && node._path.endsWith("\\"))
        node._path = node._path.slice(0, -1);
    return node.exists().then(function(exists) {
        return exists ? Promise.resolve() :
            node.parent.exists().then(function(parent_exists) {
                return  parent_exists ? afio.makeDirectory(node) :
                    ensureDirectoryExists(node.parent);
            });
    });
}


function installSampleMacroFiles() {
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
    ]

    return afio.isInstalled().then(function(installed) {
        if (!installed) {
            return Promise.reject("afio is not installed!")
        } else {
            return afio.getDefaultDir("savepath")
        }
    }).then(function(node) {
        node.append("Demo-Chrome")
        return ensureDirectoryExists(node).then(function() {
            return names.map(getSample).reduce(function(seq, p) {
                return seq.then(function() {
                    return p
                }).then(m => {
                    let file = node.clone()
                    file.append(m.name)
                    return afio.writeTextFile(file, m.content)
                })
            }, Promise.resolve())
        });
    });
}

function installProfilerXsl() {
    return afio.getDefaultDir("downpath").then(function(node) {
        return getSample("Profiler.xsl").then(function(file) {
            node.append("Profiler.xsl");
            return afio.writeTextFile(node, file.content);
        });
    });
}

function installAddressCsv() {
    return afio.getDefaultDir("datapath").then(function(node) {
        return getSample("Address.csv").then(function(file) {
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

    return new Promise(function(resolve, reject) {
        chrome.bookmarks.getTree(function(tree) {
            var panelId = tree[0].children[0].id
            ensureBookmarkFolderCreated(
                panelId, "iMacros"
            ).then(function(im) {
                return ensureBookmarkFolderCreated(im.id, "Demo-Chrome")
            }).then(function(node) {
                return names.map(getSample).reduce(function(seq, p) {
                    return seq.then(function() {
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
var strre = "(?:[^\"\\\\]|\\\\[0btnvfr\"\'\\\\])+";
var bm_update_re = new RegExp('^javascript\\:\\(function\\(\\) '+
                              '\\{try\\{var ((?:e_)?m(?:64)?) = "('+strre+')"'+
                              ', (n(?:64)?) = "('+strre+')";'+
                             '.+;evt\.initEvent');
// recursive function which walks through bookmarks tree
function updateBookmarksTree(tree) {
    if (!tree)
        return;

    tree.forEach(function(x) {
        if (x.url) {
            var match = bm_update_re.exec(x.url);
            if (match) {
                var source, name;
                switch(match[1]) {
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
                    x.id, {url: makeBookmarklet(name, source)}
                );
            }
        } else {
            updateBookmarksTree(x.children);
        }
    });
}


function doAfterUpdateAction() {
    Storage.setBool("show-updated-badge", false);
    chrome.windows.getAll({populate: false}, function(ws) {
        ws.forEach(function(win) {
            badge.clearText(win.id);
        });
    });
    // open update page
    link(getRedirFromString("updated"));
    var yes = confirm("Do you want to install the latest versions of the demo macros (Old sample macros will be overwritten)?");
    if (!yes)
        return;
    // update bookmarked macros for newer version if any
    chrome.bookmarks.getTree( function (tree) {
        updateBookmarksTree(tree);
    });
    installSampleBookmarkletMacros().then(function() {
        return afio.isInstalled().then(function(installed) {
            return installed ?
                installSampleMacroFiles()
                .then(installAddressCsv)
                .then(installProfilerXsl)
                : Promise.resolve();
        });
    }).catch(console.error.bind(console));
}

function onUpdate() {
    setDefaults();
    Storage.setBool("show-updated-badge", true);
    chrome.windows.getAll({populate: false}, function(ws) {
        ws.forEach(function(win) {
            badge.setText(win.id, "New");
        });
    });
}

function setDefaults() {
    // set some default parameters
    let default_settings = {
        "record-mode": "conventional",
        "recording-prefer-id": true,
        "recording-prefer-css-selectors": false,
        "before-play-dialog": true,
        "dock-panel": false,
        "default-dirs-set": false,
        "profiler-enabled": false,
        "replaying-delay": 0
    };
    for (let pref in default_settings) {
        if (!Storage.isSet(pref))
            switch(typeof default_settings[pref]) {
            case "string":
                Storage.setChar(pref, default_settings[pref]);
                break;
            case "boolean":
                Storage.setBool(pref, default_settings[pref]);
                break;
            case "number":
                Storage.setNumber(pref, default_settings[pref]);
                break;
            }
    }
}

window.addEventListener("load", function (event) {
    // initialize context
    // chrome.windows.getLastFocused(function (w) {
    chrome.windows.getCurrent(function (w) {
        context.init(w.id);
    });

    // listen to run-macro command from content script
    communicator.registerHandler("run-macro", function (data, tab_id) {
        chrome.tabs.get(tab_id, function(t) {
            var w_id = t.windowId;
            if (!context[w_id]) {
                console.error("No context for window "+w_id);
                return;
            }
            if (Storage.getBool("before-play-dialog")) {
                var features = "titlebar=no,menubar=no,location=no,"+
                    "resizable=yes,scrollbars=yes,status=no,"+
                    "width=400, height=140";
                var win = window.open("beforePlay.html", null, features);
                win.args = data;
                win.args.win_id = w_id;
            } else {
                getLimits().then(
                    limits => asyncRun(function () {
                        context[w_id].mplayer.play(data, limits);
                    })
                )
            }
        });
    });

    // check if it is the first run
    if (!Storage.getBool("already-installed")) {
        Storage.setBool("already-installed", true);
        setDefaults();
        // get version number
        Storage.setChar("version", chrome.runtime.getManifest().version);
        installSampleBookmarkletMacros().catch(console.error.bind(console));
        this.setDefaults();
        // open welcome page
        chrome.tabs.create({
            url: getRedirFromString("welcome")
        }, function() {});
    } else {
        var version = chrome.runtime.getManifest().version;
        // check if macro was updated
        if (version != Storage.getChar("version")) {
            Storage.setChar("version", version);
            onUpdate();
        }
    }

    // set default directories
    if (!Storage.getBool("default-dirs-set")) {
        afio.isInstalled().then(function(installed) {
            if (!installed)
                return;
            var dirs = ["datapath", "savepath", "downpath"];
            return dirs.reduce(function(seq, d) {
                return seq.then(function() {
                    return afio.getDefaultDir(d).then(function(node) {
                        Storage.setChar("def"+d, node.path);
                        return ensureDirectoryExists(node);
                    });
                });
            }, Promise.resolve()).then(installSampleMacroFiles)
                .then(installAddressCsv)
                .then(installProfilerXsl)
                .then(function() {
                    Storage.setBool("default-dirs-set", true);
                });
        }).catch(console.error.bind(console));
    }

    // TODO: check somehow if we need to start SI server
    // if (start_SI_server)
    nm_connector.startServer();

    // Set afio-installed
    afio.isInstalled().then(function(installed) {
        Storage.setBool("afio-installed", installed);
    });

    // listen to restart-server command from content script
    // (fires after t.html?pipe=<pipe> page is loaded)
    chrome.extension.onRequest.addListener(
        function (req, sender, sendResponse) {
            // clean up request
            if (req.command == "restart-server") {
                // TODO: avoid possible double-restart somehow
                sendResponse({status: "OK"});
                if (nm_connector.currentPipe != req.pipe) {
                    nm_connector.stopServer();
                    if (Storage.getBool("debug"))
                        console.info("Restarting server, pipe="+req.pipe);
                    nm_connector.startServer(req.pipe);
                    nm_connector.currentPipe = req.pipe;
                }
            }
        }
    );

}, true);


function addTab(url, win_id) {
    var args = {url: url};
    if (win_id)
        args.windowId = parseInt(win_id);

    chrome.tabs.create(args, function (tab) {});
}


function showInfo(args) {
    var win_id = args.win_id;
    context[win_id].info_args = args;
    var panel = context[win_id].panelWindow;
    if (panel && !panel.closed) {
        panel.showInfo(args);
    } else {
        var opt = {
            type: "basic",
            title: (args.errorCode == 1 ? "iMacros" : "iMacros Error"),
            message: args.message,
            iconUrl: "skin/logo48.png",
            isClickable: true

            // NOTE: buttons looks really weird so they commented out
            // , buttons: [
            //     {title: "Edit", iconUrl: "skin/edit.png"},
            //     {title: "Help", iconUrl: "skin/help.png"}
            // ]
        };
        chrome.notifications.create(win_id.toString(), opt, function(n_id) {
            // not much to do here
        });

        chrome.notifications.onClicked.addListener(function(n_id) {
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

    return afio.isInstalled().then(
        installed => {
            if (installed) {
                return afio.queryLimits().catch(() => defaultLimits)
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


window.addEventListener("unload", function(event) {
    nm_connector.stopServer();
});

// remove panel when its parent window is closed
chrome.windows.onRemoved.addListener(function(win_id) {
    if (!context[win_id])
        return;
    var panel = context[win_id].panelWindow;
    if (panel && !panel.closed) {
        panel.close();
    }
});
