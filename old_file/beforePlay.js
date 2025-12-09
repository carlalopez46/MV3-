/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/


function play() {
    var m = {
        source: args.source,
        name: args.name,
        bookmark_id: args.bookmark_id
    };
    var win_id = args.win_id;
    var showAgain = document.getElementById("checkbox").checked;
    opener.Storage.setBool("before-play-dialog", showAgain);
    window.opener.playMacro(m, win_id);
    window.close();
}

function cancel() {
    opener.Storage.setBool("before-play-dialog", document.getElementById("checkbox").checked);
    window.close();
}

function edit() {
    var m = {
        source: args.source,
        name: args.name,
        bookmark_id: args.bookmark_id
    };
    setTimeout(function () {window.opener.edit(m);}, 0);
    opener.Storage.setBool("before-play-dialog", document.getElementById("checkbox").checked);
    window.close();
}

window.addEventListener("load", function(evt) {
    if (args) {
        var x = document.getElementById("message").textContent;
        x = x.replace(/{{macroname}}/, args.name);
        document.getElementById("message").textContent = x;
    }
    document.getElementById("play-button").focus();
    document.getElementById("checkbox").checked = opener.Storage.getBool("before-play-dialog");
    
    // add DOM event handlers
    document.getElementById("play-button").addEventListener("click", play);
    // document.getElementById("edit-button").addEventListener("click", edit);
    document.getElementById("cancel-button").addEventListener("click", cancel);

    resizeToContent(window, document.getElementById('container'));
    // prevent right-click
    document.body.oncontextmenu = function(e) {
        e.preventDefault();
        return false;
    };
}, true);
