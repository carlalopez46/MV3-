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
    const payload = event && event.data;
    if (!payload || payload.type !== 'eval_in_sandbox_result') {
        return;
    }

    // Only accept results from our own sandbox iframe.
    const sandboxFrame = document.getElementById('sandbox');
    const sandboxWindow = sandboxFrame && sandboxFrame.contentWindow;
    if (!sandboxWindow || event.source !== sandboxWindow) {
        return;
    }

    const id = payload.id;
        const sendResponse = pendingEvals.get(id);
        if (sendResponse) {
            sendResponse(payload);
            pendingEvals.delete(id);
        }
});

function safeSendResponse(sendResponse, payload) {
    try {
        if (typeof sendResponse === "function") {
            sendResponse(payload);
        }
    } catch (e) {
        console.warn('[iMacros MV3 Offscreen] Failed to send response:', e);
    }
}

// Handle messages from service worker via chrome.runtime.sendMessage
if (chrome && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
        try {
            // Only handle messages that are specifically for offscreen.js (eval, clipboard)
            // Messages with target === 'offscreen' are for offscreen_bg.js
            // Let other handlers process them by not responding
            if (message.target === 'offscreen') {
                // This message is for offscreen_bg.js, not for us
                return false;
            }

            // SECURITY: Only allow sensitive operations from privileged extension contexts.
            const msgType = message && typeof message === 'object' ? message.type : null;
            if (msgType === "eval_in_sandbox" || msgType === "clipboard_write" || msgType === "clipboard_read") {
                const extensionOrigin = (chrome && chrome.runtime && typeof chrome.runtime.getURL === 'function')
                    ? chrome.runtime.getURL('')
                    : '';
                const senderIsPrivileged = (typeof isPrivilegedSender === 'function')
                    ? isPrivilegedSender(sender, chrome.runtime.id, extensionOrigin)
                    : false;

                if (!senderIsPrivileged) {
                    console.warn('[iMacros Offscreen] Blocked unprivileged request:', msgType, sender);
                    if (msgType === "eval_in_sandbox") {
                        safeSendResponse(sendResponse, {
                            type: "eval_in_sandbox_result",
                            id: message && message.id,
                            error: { message: "Access denied" }
                        });
                    } else {
                        safeSendResponse(sendResponse, { success: false, error: "Access denied" });
                    }
                    return true;
                }
            }

            // Handle eval requests
            if (message.type === "eval_in_sandbox") {
                // Store callback
                pendingEvals.set(message.id, sendResponse);

                // Set timeout to prevent memory leak
                setTimeout(() => {
                    if (pendingEvals.has(message.id)) {
                        pendingEvals.delete(message.id);
                        safeSendResponse(sendResponse, {
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
                    safeSendResponse(sendResponse, {
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
                            safeSendResponse(sendResponse, { success: true });
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
                                safeSendResponse(sendResponse, { success: success });
                            } catch (domErr) {
                                console.error('[iMacros MV3 Offscreen] DOM clipboard write failed:', domErr);
                                safeSendResponse(sendResponse, {
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
                        safeSendResponse(sendResponse, { success: success });
                    } catch (err) {
                        console.error('[iMacros MV3 Offscreen] DOM clipboard write failed:', err);
                        safeSendResponse(sendResponse, {
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
                            safeSendResponse(sendResponse, { success: true, text: text });
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
                                    safeSendResponse(sendResponse, { success: true, text: text });
                                } else {
                                    console.error('[iMacros MV3 Offscreen] DOM clipboard read failed: execCommand returned false');
                                    safeSendResponse(sendResponse, { success: false, error: "Clipboard read failed (DOM fallback failed)" });
                                }
                            } catch (domErr) {
                                console.error('[iMacros MV3 Offscreen] DOM clipboard read exception:', domErr);
                                safeSendResponse(sendResponse, { success: false, error: "Clipboard read failed: " + (domErr.message || String(domErr)) });
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
                            safeSendResponse(sendResponse, { success: true, text: text });
                        } else {
                            console.error('[iMacros MV3 Offscreen] DOM clipboard read failed: execCommand returned false');
                            safeSendResponse(sendResponse, { success: false, error: "Clipboard read failed (DOM fallback failed)" });
                        }
                    } catch (err) {
                        console.error('[iMacros MV3 Offscreen] DOM clipboard read failed:', err);
                        safeSendResponse(sendResponse, { success: false, error: err.message || String(err) });
                    }
                    return false;  // Sync response
                }
            }

            // Ensure callers always receive a response to avoid runtime.lastError noise.
            const backgroundHandledTypes = new Set(['UPDATE_PANEL_VIEWS', 'SET_DIALOG_RESULT', 'GET_DIALOG_ARGS', 'CALL_CONTEXT_METHOD']);
            if (message && backgroundHandledTypes.has(message.type)) {
                // These message types are processed by the Service Worker; avoid responding here so the
                // background listener can supply the authoritative result.
                return false;
            }

            safeSendResponse(sendResponse, {
                success: false,
                error: 'Unhandled offscreen message type: ' + (message && message.type ? message.type : 'unknown')
            });
            return false;
        } catch (err) {
            console.error('[iMacros MV3 Offscreen] Unhandled exception while processing message:', err);
            safeSendResponse(sendResponse, { success: false, error: err.message || String(err) });
            return false;
        }
    });

    console.log('[iMacros MV3] Offscreen document initialized');
}

window.addEventListener('pagehide', () => {
    pendingEvals.clear();
});
