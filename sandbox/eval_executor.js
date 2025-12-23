// Execute code in a specific context (macro variables)
function executeInContext(code, context) {
    const keys = Object.keys(context);
    const values = Object.values(context);

    // Create a function with macro variables as arguments
    // Use eval to execute the code string
    const executor = new Function(...keys, `return eval(${JSON.stringify(code)});`);
    return executor(...values);
}

// Listen for messages from the Offscreen Document
window.addEventListener('message', (event) => {
    if (event.data.command === 'EVAL_REQUEST') {
        const { code, variables, requestId } = event.data;
        let response = { success: false, requestId: requestId };

        try {
            const result = executeInContext(code, variables);
            response.success = true;
            response.result = result;
        } catch (e) {
            response.error = { message: e.message, name: e.name };
        }

        // Send response back to parent (Offscreen Document)
        if (event.source) {
            event.source.postMessage(response, event.origin);
        }
    }
});
