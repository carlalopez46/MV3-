/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/


var SIListener = {
    restartSIServer: function(pipe) {
        console.info("sending restart-server request, pipe="+pipe);

        this.restartTimeout =
            setTimeout(function() {SIListener.restartSIServer(pipe)}, 200);
        chrome.runtime.sendMessage(
            {command: "restart-server", pipe: pipe},
            function(response) {
                // ensure that bg has received the request
                if(response && response.status === "OK")
                    clearTimeout(SIListener.restartTimeout);

            }
        );
    }
};


window.addEventListener("load", function () {
    if (window.top !== self)
        return;

    if (window.location.protocol === "file:") {
        if (/^\?pipe=(.+)$/.test(window.location.search)) { 
	    SIListener.restartSIServer(RegExp.$1);
        }
        // var meta = document.getElementById("pipe");
        // if (meta && meta.name == "pipe") {
        //     SIListener.restartSIServer(meta.content);
        // }
    }

}, true);


