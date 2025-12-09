/*
 * iMacros MV3 Offscreen Document Handler
 * This runs with chrome.* API access (unlike sandbox.html which is sandboxed)
 */

// Define the same exception types as sandbox.js for consistency
function EvalException(msg, num) {
    this.message = msg;
    if (typeof num != "undefined")
        this.errnum = num;
    this.name = "MacroError";
}

function MacroError(txt) {
    throw new EvalException(txt, -1340);
}

// Map to store pending eval requests
const pendingEvals = new Map();

// Listen for messages from sandbox iframe
window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'eval_in_sandbox_result') {
        const id = event.data.id;
        const sendResponse = pendingEvals.get(id);
        if (sendResponse) {
            sendResponse(event.data);
            pendingEvals.delete(id);
        }
    }
});

// Handle messages from service worker via chrome.runtime.sendMessage
if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
        // Handle eval requests
        if (message.type === "eval_in_sandbox") {
            // Store callback
            pendingEvals.set(message.id, sendResponse);

            // Set timeout to prevent memory leak
            setTimeout(() => {
                if (pendingEvals.has(message.id)) {
                    pendingEvals.delete(message.id);
                    sendResponse({
                        type: "eval_in_sandbox_result",
                        id: message.id,
                        error: { message: "Eval request timed out" }
                    });
                }
            }, 5000);

            // Forward to sandbox iframe
            const sandbox = document.getElementById('sandbox');
            if (sandbox && sandbox.contentWindow) {
                sandbox.contentWindow.postMessage(message, '*');
            } else {
                console.error('[iMacros MV3 Offscreen] Sandbox iframe not found');
                sendResponse({
                    type: "eval_in_sandbox_result",
                    id: message.id,
                    error: { message: "Sandbox iframe not found in offscreen document" }
                });
                pendingEvals.delete(message.id);
            }
            return true;  // Keep message channel open for async response
        }

        // Handle clipboard write requests
        if (message.type === "clipboard_write") {
            console.log('[iMacros MV3 Offscreen] Clipboard write requested');

            // Ensure window has focus for Clipboard API
            try {
                window.focus();
            } catch (e) {
                console.warn('[iMacros MV3 Offscreen] Failed to focus window:', e);
            }

            // Try to write to clipboard using the Clipboard API
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(message.text)
                    .then(function () {
                        console.log('[iMacros MV3 Offscreen] Clipboard write successful');
                        sendResponse({ success: true });
                    })
                    .catch(function (err) {
                        console.warn('[iMacros MV3 Offscreen] Clipboard write via API failed, trying DOM fallback:', err);
                        // Fallback to DOM method
                        try {
                            var textarea = document.createElement('textarea');
                            textarea.value = message.text;
                            textarea.style.position = 'fixed';
                            textarea.style.opacity = '0';
                            document.body.appendChild(textarea);
                            textarea.focus();
                            textarea.select();

                            var success = document.execCommand('copy');
                            document.body.removeChild(textarea);

                            console.log('[iMacros MV3 Offscreen] DOM clipboard write:', success ? 'success' : 'failed');
                            sendResponse({ success: success });
                        } catch (domErr) {
                            console.error('[iMacros MV3 Offscreen] DOM clipboard write failed:', domErr);
                            sendResponse({
                                success: false,
                                error: err.message + " | Fallback: " + domErr.message
                            });
                        }
                    });
                return true;  // Async response
            } else {
                // Fallback: Try DOM-based clipboard method immediately if API not available
                try {
                    var textarea = document.createElement('textarea');
                    textarea.value = message.text;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.focus();
                    textarea.select();

                    var success = document.execCommand('copy');
                    document.body.removeChild(textarea);

                    console.log('[iMacros MV3 Offscreen] DOM clipboard write:', success ? 'success' : 'failed');
                    sendResponse({ success: success });
                } catch (err) {
                    console.error('[iMacros MV3 Offscreen] DOM clipboard write failed:', err);
                    sendResponse({
                        success: false,
                        error: err.message || String(err)
                    });
                }
                return false;  // Sync response
            }
        }

        // Handle clipboard read requests
        if (message.type === "clipboard_read") {
            console.log('[iMacros MV3 Offscreen] Clipboard read requested');

            // Ensure window has focus for Clipboard API
            try {
                window.focus();
            } catch (e) {
                console.warn('[iMacros MV3 Offscreen] Failed to focus window:', e);
            }

            // Try to read from clipboard using the Clipboard API
            if (navigator.clipboard && navigator.clipboard.readText) {
                navigator.clipboard.readText()
                    .then(function (text) {
                        console.log('[iMacros MV3 Offscreen] Clipboard read successful');
                        sendResponse({ success: true, text: text });
                    })
                    .catch(function (err) {
                        console.warn('[iMacros MV3 Offscreen] Clipboard read via API failed, trying DOM fallback:', err);

                        // Fallback to DOM method (execCommand 'paste')
                        try {
                            var textarea = document.createElement('textarea');
                            textarea.style.position = 'fixed';
                            textarea.style.left = '-9999px';
                            textarea.style.top = '0';
                            document.body.appendChild(textarea);
                            textarea.focus();

                            var success = document.execCommand('paste');
                            var text = textarea.value;
                            document.body.removeChild(textarea);

                            if (success) {
                                console.log('[iMacros MV3 Offscreen] DOM clipboard read successful');
                                sendResponse({ success: true, text: text });
                            } else {
                                console.error('[iMacros MV3 Offscreen] DOM clipboard read failed: execCommand returned false');
                                sendResponse({ success: false, error: "Clipboard read failed (DOM fallback failed)" });
                            }
                        } catch (domErr) {
                            console.error('[iMacros MV3 Offscreen] DOM clipboard read exception:', domErr);
                            sendResponse({ success: false, error: "Clipboard read failed: " + (domErr.message || String(domErr)) });
                        }
                    });
                return true;  // Async response
            } else {
                // Fallback: Try DOM-based clipboard method immediately if API not available
                try {
                    var textarea = document.createElement('textarea');
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.focus();

                    var success = document.execCommand('paste');
                    var text = textarea.value;
                    document.body.removeChild(textarea);

                    if (success) {
                        console.log('[iMacros MV3 Offscreen] DOM clipboard read successful');
                        sendResponse({ success: true, text: text });
                    } else {
                        throw new Error("execCommand('paste') failed");
                    }
                } catch (err) {
                    console.error('[iMacros MV3 Offscreen] Clipboard API not available and DOM fallback failed:', err);
                    sendResponse({
                        success: false,
                        error: "Clipboard API not available and DOM fallback failed: " + err.message
                    });
                }
                return false;
            }
        }

        return false;  // Not our message
    });

    console.log('[iMacros MV3] Offscreen document initialized');
}
