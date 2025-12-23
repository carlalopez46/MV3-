/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

function EvalException(msg, num) {
    this.message = msg;
    if (typeof num != "undefined")
        this.errnum = num;
    this.name = "MacroError";
}

function MacroError(txt) {
    throw new EvalException(txt, -1340);
}

window.addEventListener("message", function(event) {
    if (!event.data.type || event.data.type != "eval_in_sandbox")
        return;
    var response = {
        type: "eval_in_sandbox_result",
        id: event.data.id
    };
    try {
        response.result = eval(event.data.expression);
    } catch(e) {
        console.error(e);
        response.error = {
            name: e.name,
            message: e.message,
            errnum: e.errnum
        };
    }
    
    event.source.postMessage(response, event.origin);
});
