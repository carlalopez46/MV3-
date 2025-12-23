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

// Handle eval requests for MV2 (via postMessage from iframe)
window.addEventListener("message", function (event) {
    if (!event.data.type || event.data.type != "eval_in_sandbox")
        return;
    var response = {
        type: "eval_in_sandbox_result",
        id: event.data.id
    };
    try {
        var variables = event.data.variables || {};

        // Build arrays of variable names and values
        var paramNames = [];
        var paramValues = [];
        for (var key in variables) {
            if (variables.hasOwnProperty(key)) {
                paramNames.push(key);
                paramValues.push(variables[key]);
            }
        }

        // Create a function with variables as parameters and evaluate the expression
        // We use eval() inside the function to support both simple expressions and multi-statement scripts
        // and to automatically return the result of the last expression, mimicking standard eval() behavior.
        // The expression is stringified to safely pass it into the generated function's source.
        var functionBody = 'return eval(' + JSON.stringify(event.data.expression) + ');';
        var evalFunc = Function.apply(null, paramNames.concat(functionBody));
        response.result = evalFunc.apply(null, paramValues);
    } catch (e) {
        console.error("[iMacros Sandbox Error]", e.message || e);
        response.error = {
            name: e.name,
            message: e.message,
            errnum: e.errnum
        };
    }

    event.source.postMessage(response, event.origin);
});
