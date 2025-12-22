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

    switch(type) {
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

function onSecurityChage(e) {
    let type = e.target.id.substring(5)
    switch(type) {
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
    let bg = chrome.extension.getBackgroundPage()
    for (let x in bg.context) { // update all panels
        var panel = bg.context[x].panelWindow;
        if (panel && !panel.closed) {
            let doc = panel.frames["tree-iframe"].contentDocument;
            doc.defaultView.location.reload();
        }
    }
}

function onPathChange(which) {
    Storage.setChar(which, $("#"+which).val());
    if (which == "defsavepath")
        updatePanelViews()

}


function choosePath(which) {
    var features = "titlebar=no,menubar=no,location=no,"+
        "resizable=yes,scrollbars=no,status=no,"+
        "width=200,height=300";
    var win = window.open("browse.html", "iMacros_browse_dialog", features);

    win.args = {path: Storage.getChar(which), which: which};
}

function savePath(which, path) {
    Storage.setChar(which, path);
    $("#"+which).val(path);
    if (which == "defsavepath")
        updatePanelViews()
}


window.addEventListener("load", function () {
    $("#show-before-play-dialog").prop(
        "checked", Storage.getBool("before-play-dialog")
    ).change(function(event) {
        let checked = event.target.checked
        Storage.setBool("before-play-dialog", checked)
    })

    $("#dock-panel").prop(
        "checked", Storage.getBool("dock-panel")
    ).change(function (event) {
        let checked = event.target.checked
        Storage.setBool("dock-panel", checked);
    })

    if (!Storage.getBool("afio-installed")) {
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
        $("#defsavepath-browse").hide();
        $("#defdatapath-browse").hide();
        $("#defdownpath-browse").hide();
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

    // encryption
    setSecurityLevel()
    $("#type_no").change(onSecurityChage);
    $("#type_stored").change(onSecurityChage);
    $("#type_tmpkey").change(onSecurityChage);
    $("#stored-password-box").on("input", function() {
        let pwd = $("#stored-password-box").val();
        pwd = btoa(encodeURIComponent(pwd));
        Storage.setChar("stored-password", pwd);
    })
    $("#temp-password-box").on("input", function() {
        let bg = chrome.extension.getBackgroundPage()
        bg.Rijndael.tempPassword = $("#temp-password-box").val()
    })

    // links
    $("#more-info-bp").click(function() {
        link(getRedirFromString('bookmarklets'));
    });
    $("#more-info-profiler").click(function() {
        link(getRedirectURL('Performance_Profiler'));
    });
    $("#password-tool-page").click(function() {
        link(getRedirectURL(160));
    });
    $("#more-info-encryption").click(function() {
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
    var record_radio = $("#record-mode-"+Storage.getChar("record-mode"));
    if (!record_radio) {
        alert("Unknown record mode type: "+Storage.getChar("record-mode"))
    } else {
        record_radio.prop("checked", true)
        for (let r of record_modes) {
            $("#record-mode-"+r).change(function(e) {
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
        $("#replay-speed-"+n).prop("checked", p(delay))
        $("#replay-speed-"+n).change(
            e => Storage.setNumber("replaying-delay", x)
        )
    }

    $("#more-info-event").click(function() {
        link(getRedirectURL("EVENT"))
    })
    $("#license-link").click(function() {
        link(getRedirFromString("EULA_Freeware"))
    })
    $("#favorid-panel").prop(
        "checked", Storage.getBool("recording-prefer-id")
    ).change(function(e) {
        Storage.setBool("recording-prefer-id", e.target.checked)
    })

    $("#css-selectors").prop(
        "checked", Storage.getBool("recording-prefer-css-selectors")
    ).change(function(e) {
        Storage.setBool("recording-prefer-css-selectors", e.target.checked)
    })
});
