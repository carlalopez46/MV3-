/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

function cancel() {
    window.close();
}


function choose() {
    var doc = window.frames["tree-iframe"].contentDocument;
    var path = doc.getElementById("path").value;
    if (!path)
        return;
    opener.savePath(args.which, path);
    window.close();
}

window.addEventListener("load", function() {
    document.getElementById("button-ok").addEventListener("click", choose);
    document.getElementById("button-cancel").addEventListener("click", cancel);
    // prevent right-click
    document.body.oncontextmenu = function(e) {
        e.preventDefault();
        return false;
    };
    asyncRun(function() {
        // resizeToContent(window, document.getElementById("container"));
        window.resizeTo(260, window.outerHeight+60);
        window.moveTo(200, 200);
    });
});
