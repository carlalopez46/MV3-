/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/


function __play(callback) {
    var win_id = args.win_id;
    var bg = chrome.extension.getBackgroundPage();
    var mplayer = bg.context[win_id].mplayer;
    var doc = window.frames["tree-iframe"].contentDocument;
    var container = doc.getElementById("imacros-macro-container");
    var div = doc.getElementById("imacros-bookmark-div");
    var macro = {};
    if (mplayer.paused || mplayer.pauseIsPending) {
        mplayer.unpause();
        return;
    }

    if (div.hasAttribute("file_id")) {
        var node = afio.openNode(div.getAttribute("file_id"));
        macro.file_id = node.path;
        afio.readTextFile(node).then(function(source) {
            macro.source = source;
            macro.name = div.getAttribute("name");
            bg.getLimits().then(limits => mplayer.play(macro, limits, callback))
        }, function(err) {
            // TODO: it would be better to display the error
            // on the info area of the panel
            console.error(err);
            alert("Can not read macro file, error "+err);
        });
    } else if (div.hasAttribute("bookmark_id")) {
        macro.source = container.value;
        macro.bookmark_id = div.getAttribute("bookmark_id");
        macro.name = div.getAttribute("name");
        bg.getLimits().then(limits => mplayer.play(macro, limits, callback))
    }
}

// play-button click handler
function play() {
    if (document.getElementById("play-button").getAttribute("disabled") == "true")
        return;
    __play(false);
}

function playLoop() {
    if (document.getElementById("loop-button").getAttribute("disabled") == "true")
        return;
    var cur = parseInt(document.getElementById("current-loop").value);
    var max = parseInt(document.getElementById("max-loop").value);
    if (cur > max) {
        alert("Current loop value should be less or equivalent max loop value");
        return;
    }

    var win_id = args.win_id;
    var bg = chrome.extension.getBackgroundPage();
    var mplayer = bg.context[win_id].mplayer;
    var doc = window.frames["tree-iframe"].contentDocument;
    var container = doc.getElementById("imacros-macro-container");
    var div = doc.getElementById("imacros-bookmark-div");
    var macro = {
        name: div.getAttribute("name"),
        times: max,
        startLoop: cur
    };

    if (div.hasAttribute("file_id")) {
        var node = afio.openNode(div.getAttribute("file_id"));
        macro.file_id = div.getAttribute("file_id");
        afio.readTextFile(node).then(function(source, err) {
            macro.source = source;
            bg.getLimits().then(limits => mplayer.play(macro, limits))
        }, function(err) {
            console.error(err);
            alert("Can not open "+container.value+
                  ", reason: "+err);
        });
    } else if (div.hasAttribute("bookmark_id")) {
        macro.source = container.value;
        bg.getLimits().then(limits => mplayer.play(macro, limits))
    }
}

// Pause button handler
function pause() {
    if (document.getElementById("pause-button").getAttribute("disabled") == "true")
        return;
    try {
        var win_id = args.win_id;
        var bg = chrome.extension.getBackgroundPage();
        var mplayer = bg.context[win_id].mplayer;
        if (mplayer.playing) {
            mplayer.pause();
        }
    } catch (e) {
        console.error(e);
    }
}

// Edit button handler
function edit() {
    if (document.getElementById("edit-button").getAttribute("disabled") == "true")
        return;
    var bg = chrome.extension.getBackgroundPage();
    var doc = window.frames["tree-iframe"].contentDocument;
    var container = doc.getElementById("imacros-macro-container");
    var div = doc.getElementById("imacros-bookmark-div");
    var source = "", name = div.getAttribute("name");
    var macro = {name: name, win_id: args.win_id};

    if (div.hasAttribute("file_id")) {
        var file_id = div.getAttribute("file_id");
        var node = afio.openNode(file_id);
        afio.readTextFile(node).then(function(source) {
            macro.source = source;
            macro.file_id = file_id;
            bg.edit(macro, true);
        }, function(e) {
            console.error(e);
            alert("Can not open "+container.value+
                  ", reason: "+e);
        });
    } else if (div.hasAttribute("bookmark_id")) {
        source = container.value;
        var bookmark_id = div.getAttribute("bookmark_id");
        macro.source = source;
        macro.bookmark_id = bookmark_id;
        bg.edit(macro, true);
    }
}


// Record button handler
function record() {
    if (document.getElementById("record-button").getAttribute("disabled") == "true")
        return;
    var win_id = args.win_id;
    var bg = chrome.extension.getBackgroundPage();
    var recorder = bg.context[win_id].recorder;
    try {
        recorder.start();
    } catch (e) {
        console.error(e);
    }
}

// Stop button handler
function stop() {
    var win_id = args.win_id;
    var bg = chrome.extension.getBackgroundPage();

    var mplayer = bg.context[win_id].mplayer;
    var recorder = bg.context[win_id].recorder;

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
                    var node = afio.openNode(localStorage["defsavepath"]);
                    node.append("#Current.iim");
                    macro.file_id = node.path;
                    bg.edit(macro, /* overwrite */ true);
                } else {            // no file access
                    bg.edit(macro, true);
                }
            }).catch(console.error.bind(console));
        } else {
            bg.edit(macro, true);
        }
    }
}


// called when a macro is selected in tree-view
function onSelectionChanged(selected) {
    var disable = function (btns) {
        for (var x = 0; x < arguments.length; x++) {
            var b = document.getElementById(arguments[x]+"-button");
            b.setAttribute("disabled", "true");
        }
    };
    var enable = function (btns) {
        for (var x = 0; x < arguments.length; x++) {
            var b = document.getElementById(arguments[x]+"-button");
            b.setAttribute("disabled", "false");
        }
    };

    // change 'disabled' status of buttons
    if (selected) {
        enable("play", "loop", "edit");
    } else {
        disable("play", "loop", "edit");
    }
}


function updatePanel(state) {
    var show = function (btns) {
        for (var x = 0; x < arguments.length; x++) {
            document.getElementById(arguments[x]+"-button").setAttribute("collapsed", "false");
        }
    };
    var hide = function (btns) {
        for (var x = 0; x < arguments.length; x++) {
            document.getElementById(arguments[x]+"-button").setAttribute("collapsed", "true");
        }
    };
    var hideInfo = function() {
        document.getElementById("info-div").setAttribute("hidden", "true");
        document.getElementById("logo-and-links").removeAttribute("hidden");
    };
    var disable = function (btns) {
        for (var x = 0; x < arguments.length; x++) {
            var b = document.getElementById(arguments[x]+"-button");
            b.setAttribute("disabled", "true");
        }
    };
    var enable = function (btns) {
        for (var x = 0; x < arguments.length; x++) {
            var b = document.getElementById(arguments[x]+"-button");
            b.setAttribute("disabled", "false");
        }
    };
    switch(state) {
    case "playing":
        show("pause");
        hide("play");
        enable("stop-replaying");
        disable("loop", "record", "stop-recording", "saveas", "capture", "edit");
        hideInfo();
        break;
    case "paused":
        show("play");
        hide("pause");
        break;
    case "recording":
        enable("stop-recording", "saveas", "capture");
        disable("play", "loop", "record", "edit");
        hideInfo();
        break;
    case "idle":
        show("play");
        hide("pause");
        enable("play", "loop", "record", "edit");
        disable("stop-recording", "stop-replaying", "saveas", "capture");
        break;
    }

}


function onTreeSelect(type) {
    Storage.setChar("tree-type", type);
    var tree_iframe = document.getElementById("tree-iframe");
    if (type == "files") {
        document.getElementById("radio-files-tree").checked="yes";
        tree_iframe.src = "fileView.html";
    } else if (type == "bookmarks") {
        tree_iframe.src = "treeView.html";
        document.getElementById("radio-bookmarks-tree").checked="yes";
    }
}


window.addEventListener("load", function() {
    var bg = chrome.extension.getBackgroundPage();
    args = {win_id: bg.onPanelLoaded(window)};
    var tree_type = Storage.isSet("tree-type") ?
        Storage.getChar("tree-type") : "files";
    afio.isInstalled().then(function(installed) {
        if (!/^(?:files|bookmarks)$/.test(tree_type)) {
            tree_type = installed ? "files" : "bookmarks"
        }
        if (tree_type == "files" && installed) {
            onTreeSelect("files");
        } else {
            onTreeSelect("bookmarks");
        }
    }).catch(console.error.bind(console));
    // attach various event handlers
    document.getElementById("play-button").addEventListener("click", play);
    document.getElementById("pause-button").addEventListener("click", pause);
    document.getElementById("record-button").addEventListener("click", record);
    document.getElementById("stop-replaying-button").addEventListener("click", stop);
    document.getElementById("stop-recording-button").addEventListener("click", stop);
    document.getElementById("saveas-button").addEventListener("click", onSaveAs);
    document.getElementById("capture-button").addEventListener("click", onCapture);
    document.getElementById("loop-button").addEventListener("click", playLoop);
    document.getElementById("edit-button").addEventListener("click", edit);
    document.getElementById("settings-button").addEventListener("click", function() {
        link("options.html")
    });
    document.getElementById("help-button").addEventListener("click", function() {
        link(getRedirectURL('iMacros_for_Chrome'))
    });
    document.getElementById("info-edit-button").addEventListener("click", onInfoEdit);
    document.getElementById("info-help-button").addEventListener("click", onInfoHelp);
    document.getElementById("info-close-button").addEventListener("click", onInfoClose);

    document.getElementById("radio-files-tree").addEventListener("change", function() {
        onTreeSelect('files');
    });
    document.getElementById("radio-bookmarks-tree").addEventListener("change", function() {
        onTreeSelect('bookmarks');
    });

    document.body.oncontextmenu = function(e) {
        e.preventDefault();
        return false;
    };

    setAdDetails();
});


window.addEventListener("beforeunload", function() {
    var bg = chrome.extension.getBackgroundPage();
    chrome.windows.get(bg.context[args.win_id].panelId, function(p) {
        var panelBox = {
            left: p.left, top: p.top,
            width: p.width, height: p.height
        };
        Storage.setObject("panel-box", panelBox);
    });
});


function setLoopValue(val) {
    document.getElementById("current-loop").value = val;
}


// convert bookmarklet-type macro to file or vice versa
function convert() {
    var win_id = args.win_id;
    var bg = chrome.extension.getBackgroundPage();
    var doc = window.frames["tree-iframe"].contentDocument;
    var container = doc.getElementById("imacros-macro-container");
    var div = doc.getElementById("imacros-bookmark-div");
    var macro = {};
    var type;

    if (div.hasAttribute("file_id")) {
        // convert file to bookmarklet
        type = "bookmark";
        var node = afio.openNode(div.getAttribute("file_id"));
        afio.readTextFile(node).then(function(source) {
            macro.source = source;
            macro.name = div.getAttribute("name");
            bg.save(macro, false, function(macro) {
                alert("Macro copied in "+type+" storage");
            });
        }, function(e) {
            console.error(e);
            alert("Can not open "+container.value+
                  ", reason: "+e.message());
        });
    } else if (div.hasAttribute("bookmark_id")) {
        type = "file";
        // convert bookmarklet to file
        macro.source = container.value;
        macro.name = div.getAttribute("name");
        if (!/\.iim$/.test(macro.name))  // append .iim extension
            macro.name += ".iim";
        var node = afio.openNode(localStorage["defsavepath"]);
        node.append(macro.name);
        macro.file_id = node.path;
        bg.save(macro, false, function(macro) {
            alert("Macro copied in "+type+" storage");
        });
    }
}




function showLines(code) {
    document.getElementById("tree-view").setAttribute("hidden", "true");
    document.getElementById("macro-view").removeAttribute("hidden");
    if (code && code.length) {
        document.getElementById("macro-iframe").contentWindow.mv.showLines(code);
    } else {
        document.getElementById("macro-iframe").contentWindow.mv.clearAllLines();
    }
}

function showMacroTree() {
    document.getElementById("tree-view").removeAttribute("hidden");
    document.getElementById("macro-view").setAttribute("hidden", "true");
}

function addLine(txt) {
    document.getElementById("macro-iframe").contentWindow.mv.addLine(txt);
}

function highlightLine(line) {
    document.getElementById("macro-iframe").contentWindow.mv.highlightLine(line);
}

function setStatLine(txt, type) {
    document.getElementById("macro-iframe").contentWindow.mv.setStatLine(txt, type);
}

function removeLastLine() {
    document.getElementById("macro-iframe").contentWindow.mv.removeLastLine();
}


var info_args = null;

function showInfo(args) {
    info_args = args;
    var info_div = document.getElementById("info-div");
    info_div.removeAttribute("hidden");
    document.getElementById("logo-and-links").setAttribute("hidden", "true");

    if (args.errorCode != 1) {
        document.getElementById("info-area").setAttribute("type", "error");
        document.getElementById("info-edit-button").removeAttribute("collapsed");
        document.getElementById("info-help-button").removeAttribute("collapsed");
    } else {
        document.getElementById("info-area").setAttribute("type", "message");
        document.getElementById("info-edit-button").setAttribute("collapsed", "true");
        document.getElementById("info-help-button").setAttribute("collapsed", "true");
    }

    document.getElementById("info-area").textContent = args.message;
}

function onInfoClose() {
    document.getElementById("info-div").setAttribute("hidden", "true");
    document.getElementById("logo-and-links").removeAttribute("hidden");
}


function onInfoHelp() {
    var url = getRedirFromString("error");
	//info_args.errorCode;
    var bg = chrome.extension.getBackgroundPage();
    bg.addTab(url, info_args.win_id);
}

function onInfoEdit() {
    // TODO: pass line number to editor
    // var line = 0;
    // if (/, line:\s*(\d+)(?:\s+\(.*\))?$/.test(info_args.message))
    //     line = parseInt(RegExp.$1);
    var bg = chrome.extension.getBackgroundPage();
    bg.edit(info_args.macro, true);
}

function onSaveAs() {
    if (document.getElementById("saveas-button").getAttribute("disabled") == "true")
        return;
    var win_id = args.win_id;
    var bg = chrome.extension.getBackgroundPage();
    bg.context[win_id].recorder.saveAs();
}

function onCapture() {
    if (document.getElementById("capture-button").getAttribute("disabled") == "true")
        return;
    var win_id = args.win_id;
    var bg = chrome.extension.getBackgroundPage();
    bg.context[win_id].recorder.capture();
}


function setAdDetails() {
    var ad_link = document.getElementById("ad-link");
    var ad_image = document.getElementById("ad-image");
    var ad_image_link = document.getElementById("ad-image-link");
    var bg = chrome.extension.getBackgroundPage();

    bg.isPersonalVersion().then(function(personal) {
        bg.xhr("skin/ads.json", "plain/text")
            .then(function(response) {
                let ads = JSON.parse(response);
                let ad_index = personal ? 0 : Math.floor(Math.random() * ads.length)

                ad_link.innerText = ads[ad_index].ad_text;
                var href = ads[ad_index].ad_link;
                ad_link.addEventListener("click", function() {
                    link(href);
                });
                ad_image_link.addEventListener("click", function() {
                    link(href);
                });
                ad_image.src = "../skin/ads/" + ads[ad_index].ad_img;
            })
    })
}
