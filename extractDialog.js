/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

function ok() {
    window.close();
}

window.addEventListener("beforeunload", function() {
    args.mplayer.waitingForExtract = false;
    args.mplayer.next("extractDialog");
    return null;
});

window.addEventListener("load", function(evt) {
    var field = document.getElementById("data-field");
    field.focus();
    if (args) {
        field.value = args.data;
        //field.select();
    }

    //document.getElementById("ok-button").addEventListener("click", ok);
    let okButton = document.getElementById("ok-button");
    okButton.addEventListener("click", ok);
    okButton.focus();
    okButton.addEventListener("keydown", function(e) {
        var type = e.type;
        if (type === "keydown"){
            if((e.keyCode === 13) || (e.keyCode === 32)){
                ok();
                e.preventDefault();
            }
        }
    });
    resizeToContent(window, document.getElementById('container'));
});
