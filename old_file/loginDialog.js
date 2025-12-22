/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

function ok() {
    var bg = chrome.extension.getBackgroundPage();

    var user = document.getElementById("username").value;
    var pwd = document.getElementById("password").value;

    var response = {
        authCredentials: {
            username: document.getElementById("username").value,
            password: document.getElementById("password").value
        }
    };
    if (args.cypherData.encrypt) {
        pwd = bg.Rijndael.encryptString(pwd, args.cypherData.key);
    }

    var rec = "ONLOGIN USER="+user+" PASSWORD="+pwd;
    // remove previously recorded ONLOGIN command
    var l = args.recorder.actions.length;
    var match_part = "ONLOGIN USER=";
    if (l && args.recorder.actions[l-1].indexOf(match_part) == 0) {
        args.recorder.actions.pop();
        var panel = bg.context[args.recorder.win_id].panelWindow; 
        if (panel && !panel.closed) {
            panel.removeLastLine();
        }
    }
    args.recorder.recordAction(rec);
    args.callback(response);
    window.close();
}


function cancel() {
    args.callback({cancel: true})
    window.close();
}

window.addEventListener("load", function(evt) {
    var message = args.details.challenger.host+":"+
        args.details.challenger.port+" requires authentication.";
    if (args.details.realm)
        message += " Server message: "+args.details.realm;
    document.getElementById("message").innerText = message;
    // window.moveTo(window.opener.screenX+window.opener.outerWidth/2-170,
    //               window.opener.screenY+window.opener.outerHeight/2-100);
    document.getElementById("username").addEventListener("keypress", function(e) {
        if (e.which == 13) ok();
    });
    document.getElementById("password").addEventListener("keypress", function(e) {
        if (e.which == 13) ok();
    });
    document.getElementById("ok-button").addEventListener("click", ok);
    document.getElementById("cancel-button").addEventListener("click", cancel);
    resizeToContent(window, document.getElementById('container'));
});
