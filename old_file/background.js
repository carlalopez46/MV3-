/*
 * Background Service Worker for iMacros MV3
 * Replaces bg.html from MV2
 */

/* global chrome */

// MV3 Service Worker Polyfills for DOM-dependent code
// These provide compatibility shims for code expecting a DOM environment

// Create a minimal window/document shim for compatibility
// This allows legacy code to run without immediate crashes
const globalThis_shim = globalThis || self;

// Store message event listeners for manual dispatch
// Each entry is {handler, options} to support proper duplicate prevention and removal
const messageEventListeners = [];

if (typeof window === 'undefined') {
    globalThis_shim.window = globalThis_shim;
}

if (typeof document === 'undefined') {
    globalThis_shim.document = {
        getElementById: function (id) {
            // Sandbox iframe handling for MV3
            if (id === 'sandbox') {
                console.warn('[iMacros MV3] Sandbox iframe not available in service worker, using offscreen document pattern');
                // Return a proxy object that handles postMessage
                return {
                    contentWindow: {
                        postMessage: function (data, targetOrigin) {
                            // Forward to offscreen document or handle differently
                            handleSandboxMessage(data);
                        }
                    }
                };
            }
            return null;
        },
        createEvent: function (eventType) {
            console.warn('[iMacros MV3] document.createEvent called in service worker:', eventType);
            return {
                initEvent: function () { },
                initCustomEvent: function () { }
            };
        },
        createElement: function (tag) {
            console.warn('[iMacros MV3] document.createElement called in service worker:', tag);
            return {};
        },
        createElementNS: function (namespace, tag) {
            console.warn('[iMacros MV3] document.createElementNS called in service worker:', namespace, tag);
            // Return a more complete mock element to avoid TypeErrors
            // Used by SCREENSHOT/SAVEAS commands which need canvas support
            return {
                style: {},  // Prevent "cannot read property 'width' of undefined"
                width: 0,
                height: 0,
                getContext: function () {
                    console.error('[iMacros MV3] Canvas operations not supported in service worker. Use offscreen document instead.');
                    return null;
                },
                toDataURL: function () {
                    throw new Error('[iMacros MV3] Canvas.toDataURL not supported in service worker');
                }
            };
        },
        implementation: {
            createDocument: function (namespaceURI, qualifiedName, doctype) {
                console.warn('[iMacros MV3] document.implementation.createDocument called in service worker');
                // Return a more complete XML document mock
                // Used by profiler output features
                const mockElement = {
                    nodeName: qualifiedName,
                    appendChild: function (child) { return child; },
                    setAttribute: function () { },
                    textContent: ''
                };
                return {
                    documentElement: mockElement,  // Prevent "cannot read property 'appendChild' of undefined"
                    createElement: function (name) {
                        return {
                            nodeName: name,
                            appendChild: function (child) { return child; },
                            setAttribute: function () { },
                            setAttributeNode: function () { },
                            textContent: ''
                        };
                    },
                    createAttribute: function (name) {
                        return {
                            name: name,
                            nodeValue: '',
                            value: ''
                        };
                    },
                    createTextNode: function (text) {
                        return { nodeValue: text, textContent: text };
                    },
                    appendChild: function (child) {
                        mockElement.appendChild(child);
                        return child;
                    }
                };
            }
        },
        addEventListener: function (event, handler) {
            // No-op in service worker context
            console.warn('[iMacros MV3] document.addEventListener ignored in service worker:', event);
        }
    };
}

// Add window.addEventListener shim with message listener tracking
// CRITICAL: Always override addEventListener, even if native one exists from window=self
// This ensures message events are captured in messageEventListeners for postMessage shim
//
// WARNING: This file is ONLY for MV3 Service Worker environments!
// The always-override approach bypasses native message event propagation.
// DO NOT load this file in DOM window contexts or you will break native events.
const nativeAddEventListener = globalThis_shim.window.addEventListener;
const nativeRemoveEventListener = globalThis_shim.window.removeEventListener;
const nativePostMessage = globalThis_shim.window.postMessage;

// Helper function to normalize event listener options for comparison
// Per spec, two listeners are the same if they have the same handler AND capture value
function normalizeListenerOptions(options) {
    // Handle boolean useCapture (legacy API)
    if (typeof options === 'boolean') {
        return { capture: options, once: false };
    }
    // Handle options object
    if (options && typeof options === 'object') {
        return {
            capture: !!options.capture,
            once: !!options.once
        };
    }
    // Undefined or null defaults to capture: false, once: false
    return { capture: false, once: false };
}

// Helper function to check if two listener entries match
function listenersMatch(entry, handler, options) {
    if (entry.handler !== handler) {
        return false;
    }
    const normalized1 = normalizeListenerOptions(entry.options);
    const normalized2 = normalizeListenerOptions(options);
    return normalized1.capture === normalized2.capture;
}

// Helper function to invoke event listener (supports both function and object with handleEvent)
// Per DOM spec: handler can be a function OR an object with handleEvent method
function invokeEventListener(handler, event, thisArg) {
    if (typeof handler === 'function') {
        handler.call(thisArg, event);
    } else if (handler && typeof handler.handleEvent === 'function') {
        handler.handleEvent(event);
    } else {
        console.warn('[iMacros MV3] Invalid event listener:', handler);
    }
}

globalThis_shim.window.addEventListener = function (event, handler, options) {
    if (event === 'load') {
        // Service workers don't have a load event, execute immediately with event object
        // Per DOM spec: 'this' inside handler should be currentTarget (window)
        // Supports both function and object with handleEvent method
        setTimeout(() => {
            invokeEventListener(handler, {
                type: 'load',
                target: globalThis_shim.window,
                currentTarget: globalThis_shim.window
            }, globalThis_shim.window);
        }, 0);
    } else if (event === 'message') {
        // Store message listeners so we can manually dispatch to them
        // Prevent duplicate registration: same handler + same capture value (per spec)
        const existingIndex = messageEventListeners.findIndex(entry =>
            listenersMatch(entry, handler, options)
        );
        if (existingIndex === -1) {
            messageEventListeners.push({ handler, options });
        }
    } else if (nativeAddEventListener) {
        // Delegate other events to native implementation
        nativeAddEventListener.call(globalThis_shim.window, event, handler, options);
    } else {
        console.warn('[iMacros MV3] window.addEventListener ignored in service worker:', event);
    }
};

// Add window.removeEventListener shim to prevent memory leaks
globalThis_shim.window.removeEventListener = function (event, handler, options) {
    if (event === 'message') {
        // Remove handler from messageEventListeners array
        // Must match both handler AND capture value (per spec)
        const index = messageEventListeners.findIndex(entry =>
            listenersMatch(entry, handler, options)
        );
        if (index !== -1) {
            messageEventListeners.splice(index, 1);
        }
    } else if (nativeRemoveEventListener) {
        // Delegate other events to native implementation
        nativeRemoveEventListener.call(globalThis_shim.window, event, handler, options);
    } else {
        console.warn('[iMacros MV3] window.removeEventListener ignored in service worker:', event);
    }
};

// Add window.postMessage shim that dispatches to stored listeners
globalThis_shim.window.postMessage = function (message, targetOrigin) {
    // Manually dispatch to all registered message listeners
    const event = {
        data: message,
        origin: targetOrigin || '*',
        source: globalThis_shim.window,
        type: 'message',
        currentTarget: globalThis_shim.window,
        target: globalThis_shim.window
    };

    // Call all registered message listeners
    // Use for loop (not forEach) to support 'once' option removal during iteration
    for (let i = messageEventListeners.length - 1; i >= 0; i--) {
        const entry = messageEventListeners[i];
        try {
            // Per DOM spec: 'this' inside handler should be currentTarget (window)
            // Supports both function and object with handleEvent method
            invokeEventListener(entry.handler, event, globalThis_shim.window);

            // If 'once' option is true, remove listener after first call (per spec)
            const normalized = normalizeListenerOptions(entry.options);
            if (normalized.once) {
                messageEventListeners.splice(i, 1);
            }
        } catch (err) {
            console.error('[iMacros MV3] Error in message handler:', err);
        }
    }
};

// Add window.open shim - uses chrome.windows.create and returns mock window object
if (!globalThis_shim.window.open) {
    globalThis_shim.window.open = function (url, target, features) {
        console.debug('[iMacros MV3] window.open called, using chrome.windows.create instead');

        // Create a mock window object to prevent "cannot set property of null" errors
        // This allows code like `win.args = {...}` to work without crashing
        const mockWindow = {
            id: null,  // Will be set when window is created (or -1 on error)
            args: null,
            closed: false,
            error: null,  // Will be set if creation fails
            close: function () {
                this.closed = true;
                console.warn('[iMacros MV3] Mock window.close() called - no action taken');
            }
        };

        // Convert to chrome.windows.create for actual window creation
        chrome.windows.create({
            url: chrome.runtime.getURL(url),
            type: 'popup',
            focused: true
        }).then(w => {
            // Validate window ID (Chrome API spec says id is optional)
            if (!w || typeof w.id !== 'number' || w.id <= 0) {
                console.error('[iMacros MV3] Invalid or missing window ID:', w?.id);
                mockWindow.id = -1;
                mockWindow.error = new Error('Invalid window ID returned from chrome.windows.create');
                return;
            }
            // Store the actual window ID in the mock object
            // This allows dialogUtils.setArgs to use the window ID
            mockWindow.id = w.id;
            console.log('[iMacros MV3] Window created successfully with ID:', w.id);
        }).catch(err => {
            console.error('[iMacros MV3] Failed to create window:', err);
            // Set id to -1 to signal error and stop polling in dialogUtils
            mockWindow.id = -1;
            mockWindow.error = err;
        });

        // Return mock window object so callers can set properties without errors
        return mockWindow;
    };
}

// Add window.dispatchEvent shim
if (!globalThis_shim.window.dispatchEvent) {
    globalThis_shim.window.dispatchEvent = function (event) {
        console.warn('[iMacros MV3] window.dispatchEvent ignored in service worker');
        return true;
    };
}

// Add XMLSerializer shim for XML document serialization
if (typeof XMLSerializer === 'undefined') {
    globalThis_shim.XMLSerializer = function () { };
    globalThis_shim.XMLSerializer.prototype.serializeToString = function (doc) {
        console.warn('[iMacros MV3] XMLSerializer.serializeToString called in service worker');
        // Return a basic XML string representation
        if (doc && doc.documentElement) {
            return '<?xml version="1.0"?><' + doc.documentElement.nodeName + '/>';
        }
        return '<?xml version="1.0"?>';
    };
}

// Offscreen document for sandbox evaluation
// In MV3, service workers can't use eval or iframes, so we use an offscreen document
let offscreenDocumentCreating = null;

async function ensureOffscreenDocument() {
    // Check if offscreen document already exists
    if (await chrome.offscreen.hasDocument?.()) {
        return;
    }

    // If creation is in progress, wait for it
    if (offscreenDocumentCreating) {
        await offscreenDocumentCreating;
        return;
    }

    // Create offscreen document
    // Use offscreen.html (with chrome API access) instead of sandbox.html (sandboxed, no API access)
    // Use IFRAME_SCRIPTING for Chrome 109+ compatibility (WORKERS only available in 113+)
    offscreenDocumentCreating = chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [
            chrome.offscreen.Reason?.IFRAME_SCRIPTING || 'IFRAME_SCRIPTING',
            chrome.offscreen.Reason?.CLIPBOARD || 'CLIPBOARD'
        ],
        justification: 'Offscreen document for evaluating macro expressions and clipboard access'
    }).catch(err => {
        console.error('[iMacros MV3] Failed to create offscreen document:', err);
        offscreenDocumentCreating = null;
        throw err;
    });

    await offscreenDocumentCreating;
    offscreenDocumentCreating = null;
}

// Sandbox message handler for MV3
// In MV3, we use offscreen documents instead of eval (which violates CSP)
async function handleSandboxMessage(data) {
    if (data.type === 'eval_in_sandbox') {
        console.log('[iMacros MV3] Sandbox eval requested:', data);

        try {
            // Ensure offscreen document exists
            // Note: chrome.offscreen API requires Chrome 109+
            if (chrome.offscreen && chrome.offscreen.createDocument) {
                await ensureOffscreenDocument();

                // Forward the eval request to the offscreen document and wait for response
                // The offscreen document will evaluate and return the result
                chrome.runtime.sendMessage(data, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[iMacros MV3] Failed to send message to offscreen:', chrome.runtime.lastError);
                        const errorResponse = {
                            type: 'eval_in_sandbox_result',
                            id: data.id,
                            result: null,
                            error: chrome.runtime.lastError.message
                        };
                        window.postMessage(errorResponse, '*');
                        return;
                    }

                    // Forward the response from offscreen to MacroPlayer via window.postMessage
                    if (response && response.type === 'eval_in_sandbox_result') {
                        window.postMessage(response, '*');
                    }
                });
            } else {
                // Fallback: If offscreen API not available, return error
                console.error('[iMacros MV3] Offscreen API not available (requires Chrome 109+)');
                const response = {
                    type: 'eval_in_sandbox_result',
                    id: data.id,
                    result: null,
                    error: 'Sandbox evaluation requires Chrome 109+ (Offscreen API)'
                };

                if (typeof window !== 'undefined' && window.postMessage) {
                    window.postMessage(response, '*');
                }
            }
        } catch (error) {
            console.error('[iMacros MV3] Sandbox error:', error);
            const response = {
                type: 'eval_in_sandbox_result',
                id: data.id,
                result: null,
                error: error.toString()
            };

            if (typeof window !== 'undefined' && window.postMessage) {
                window.postMessage(response, '*');
            }
        }
    }
}

// Add localStorage polyfill for MV3 Service Worker
// Service workers don't have access to localStorage, so we create a shim using chrome.storage.local
// bg.js startup logic and any imported scripts must see a populated cache before running startup checks
let localStorageInitPromise = Promise.resolve(true);
if (typeof localStorage === 'undefined') {
    console.log('[iMacros MV3] Creating localStorage polyfill using chrome.storage.local');

    // In-memory cache for synchronous access
    // This allows existing synchronous code to work without modification
    const localStorageCache = {};
    const STORAGE_PREFIX = 'localStorage_';

    // Load cache using top-level await so importScripts() happens after data is ready
    localStorageInitPromise = (async () => {
        try {
            const startTime = Date.now();
            console.log('[iMacros MV3] Loading localStorage cache from chrome.storage.local');
            const result = await chrome.storage.local.get(null);

            // Populate cache with all localStorage items
            // IMPORTANT: Only set values that aren't already in cache to avoid overwriting
            // values written by setItem() during initialization (race condition protection)
            let count = 0;
            for (const key in result) {
                if (key.startsWith(STORAGE_PREFIX)) {
                    const actualKey = key.substring(STORAGE_PREFIX.length);
                    // Only populate if key doesn't already exist in cache
                    if (!(actualKey in localStorageCache)) {
                        localStorageCache[actualKey] = result[key];
                        count++;
                    }
                }
            }

            const duration = Date.now() - startTime;
            console.log(`[iMacros MV3] localStorage cache loaded: ${count} items in ${duration}ms`);
            console.log('[iMacros MV3] localStorage polyfill initialized successfully');
            return true;  // Signal successful initialization
        } catch (error) {
            console.error('[iMacros MV3] Failed to load localStorage cache:', error);
            // Continue with empty cache rather than blocking extension startup
            return false;
        }
    })();

    // Expose initialization promise for bg.js startup logic to await
    globalThis.localStorageInitPromise = localStorageInitPromise;

    // Persist a value to chrome.storage.local
    // This happens asynchronously in the background
    function persistToStorage(key, value) {
        const storageKey = STORAGE_PREFIX + key;
        if (value === undefined || value === null) {
            chrome.storage.local.remove(storageKey).catch(err => {
                console.error('[iMacros MV3] Failed to remove from chrome.storage.local:', err);
            });
        } else {
            chrome.storage.local.set({ [storageKey]: value }).catch(err => {
                console.error('[iMacros MV3] Failed to persist to chrome.storage.local:', err);
            });
        }
    }

    // Create localStorage polyfill object
    const localStoragePolyfill = {
        getItem: function (key) {
            if (key in localStorageCache) {
                return localStorageCache[key];
            }
            return null;
        },

        setItem: function (key, value) {
            const stringValue = String(value);
            localStorageCache[key] = stringValue;
            persistToStorage(key, stringValue);
        },

        removeItem: function (key) {
            delete localStorageCache[key];
            persistToStorage(key, null);
        },

        clear: function () {
            // Get all localStorage keys
            const keys = Object.keys(localStorageCache);

            // Clear cache
            for (const key of keys) {
                delete localStorageCache[key];
            }

            // Clear from chrome.storage.local
            const storageKeys = keys.map(k => STORAGE_PREFIX + k);
            if (storageKeys.length > 0) {
                chrome.storage.local.remove(storageKeys).catch(err => {
                    console.error('[iMacros MV3] Failed to clear chrome.storage.local:', err);
                });
            }
        },

        key: function (index) {
            const keys = Object.keys(localStorageCache);
            return keys[index] || null;
        },

        get length() {
            return Object.keys(localStorageCache).length;
        }
    };

    // Support bracket notation (localStorage[key])
    // This is a common pattern in legacy code
    const handler = {
        get: function (target, prop) {
            if (prop === 'length') {
                return Object.keys(localStorageCache).length;
            }
            if (typeof target[prop] !== 'undefined') {
                return target[prop];
            }
            return target.getItem(prop);
        },
        set: function (target, prop, value) {
            if (prop === 'getItem' || prop === 'setItem' || prop === 'removeItem' ||
                prop === 'clear' || prop === 'key' || prop === 'length') {
                return false; // Don't allow overwriting methods
            }
            target.setItem(prop, value);
            return true;
        },
        deleteProperty: function (target, prop) {
            target.removeItem(prop);
            return true;
        },
        has: function (target, prop) {
            return prop in localStorageCache || prop in target;
        },
        ownKeys: function (target) {
            return Object.keys(localStorageCache);
        },
        getOwnPropertyDescriptor: function (target, prop) {
            if (prop in localStorageCache) {
                return {
                    value: localStorageCache[prop],
                    writable: true,
                    enumerable: true,
                    configurable: true
                };
            }
            return Object.getOwnPropertyDescriptor(target, prop);
        }
    };

    globalThis_shim.localStorage = new Proxy(localStoragePolyfill, handler);

    console.log('[iMacros MV3] localStorage polyfill ready with pre-loaded cache');
} else {
    // Ensure downstream code can still await the init promise even if native localStorage exists
    globalThis.localStorageInitPromise = localStorageInitPromise;
}

// Wait for the localStorage cache to finish loading before importing dependent scripts
// NOTE: Top-level await is NOT allowed in classic Service Workers (without type: module)
// We must allow importScripts to run immediately. Dependent scripts should ideally
// wait for localStorageInitPromise if they need to access localStorage immediately on startup.
/*
try {
    await localStorageInitPromise;
    console.log('[iMacros MV3] localStorage cache ready before loading bg.js dependencies');
} catch (err) {
    console.error('[iMacros MV3] localStorage cache failed to load before importScripts:', err);
}
*/

// Import all dependencies using importScripts
// IMPORTANT: Load order matters - context.js must be loaded before nm_connector.js
// because nm_connector.js references the global 'context' object
// GlobalErrorLogger.js must be loaded before errorLogger.js for compatibility layer
importScripts(
    'utils.js',
    'GlobalErrorLogger.js', // New unified error logging system
    'errorLogger.js',       // Legacy error logger (now uses GlobalErrorLogger as backend)
    'context.js',          // Define context first
    'nm_connector.js',     // Uses context
    'communicator.js',
    'badge.js',
    'variable-manager.js', // Variable manager for macro chaining
    'mplayer.js',
    'mrecorder.js',
    'rijndael.js',
    'VirtualFileService.js',
    'WindowsPathMappingService.js',
    'FileSystemAccessService.js',
    'FileSyncBridge.js',
    'AsyncFileIO.js',
    'bg.js'
);

// Helper function to find context by panel ID
function findContextByPanelId(panelWindowId) {
    if (typeof context === 'undefined') return null;
    for (let win_id in context) {
        if (context[win_id] && context[win_id].panelId === panelWindowId) {
            return context[win_id];
        }
    }
    return null;
}

// Helper function to create a panel window proxy for MV3
// This replaces the direct window object reference used in MV2
function createPanelProxy(panelWindowId) {
    // Helper function to send messages to the panel
    function sendToPanel(type, data) {
        chrome.runtime.sendMessage({
            type: type,
            panelWindowId: panelWindowId,
            data: data
        }, function (response) {
            if (chrome.runtime.lastError) {
                console.debug('[iMacros MV3] Error sending to panel:', chrome.runtime.lastError);
            }
        });
    }

    return {
        // Check if window is closed
        get closed() {
            // Return cached state based on panelClosing flag
            const ctx = findContextByPanelId(panelWindowId);
            return !ctx || ctx.panelClosing === true;
        },

        // Close the panel window
        close: function () {
            chrome.windows.remove(panelWindowId, function () {
                if (chrome.runtime.lastError) {
                    console.debug('[iMacros MV3] Error closing panel:', chrome.runtime.lastError);
                }
            });
        },

        // Update panel UI state
        updatePanel: function (state) {
            // Broadcast message with panelWindowId so the specific panel can check if it's the target
            chrome.runtime.sendMessage({
                type: 'UPDATE_PANEL_STATE',
                panelWindowId: panelWindowId,
                state: state
            }, function (response) {
                if (chrome.runtime.lastError) {
                    console.debug('[iMacros MV3] Error updating panel state:', chrome.runtime.lastError);
                }
            });
        },

        // Show lines in the macro view
        showLines: function (code) {
            sendToPanel('PANEL_SHOW_LINES', { code: code });
        },

        // Set status line message
        setStatLine: function (txt, type) {
            sendToPanel('PANEL_SET_STAT_LINE', { txt: txt, type: type });
        },

        // Add a line to the macro view
        addLine: function (txt) {
            sendToPanel('PANEL_ADD_LINE', { txt: txt });
        },

        // Highlight a specific line
        highlightLine: function (line) {
            sendToPanel('PANEL_HIGHLIGHT_LINE', { line: line });
        },

        // Show macro tree view
        showMacroTree: function () {
            sendToPanel('PANEL_SHOW_MACRO_TREE', {});
        },

        // Set loop value
        setLoopValue: function (value) {
            sendToPanel('PANEL_SET_LOOP_VALUE', { value: value });
        },

        // Show info
        showInfo: function (args) {
            sendToPanel('PANEL_SHOW_INFO', { args: args });
        },

        // Remove last line from macro view
        removeLastLine: function () {
            sendToPanel('PANEL_REMOVE_LAST_LINE', {});
        },

        // Frames property for accessing iframes within panel
        // In MV3, we can't directly access frames, so we provide methods instead
        get frames() {
            return {
                // Provide a way to reload the tree-iframe
                'tree-iframe': {
                    get contentDocument() {
                        // Return a proxy that can reload the tree
                        return {
                            get defaultView() {
                                return {
                                    get location() {
                                        return {
                                            reload: function () {
                                                sendToPanel('PANEL_RELOAD_TREE', {});
                                            }
                                        };
                                    }
                                };
                            }
                        };
                    }
                }
            };
        },

        // Window dimensions - cached from actual window
        // These are updated when panel is created/resized
        get outerWidth() {
            const ctx = findContextByPanelId(panelWindowId);
            return ctx?.panelWidth || 210; // Default width
        },

        get outerHeight() {
            const ctx = findContextByPanelId(panelWindowId);
            return ctx?.panelHeight || 600; // Default height
        }
    };
}

// Security: Whitelist of allowed background functions and context methods
// This prevents arbitrary code execution via message passing
const ALLOWED_BG_FUNCTIONS = new Set([
    'getLimits',
    'edit',
    'save',
    'addTab',
    'isPersonalVersion',
    'xhr'
]);

const ALLOWED_CONTEXT_METHODS = {
    'mplayer': new Set(['play', 'pause', 'unpause', 'stop']),
    'recorder': new Set(['start', 'stop', 'saveAs', 'capture'])
};

// Add message listener for MV3 compatibility - replacement for getBackgroundPage()
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_BACKGROUND_CONTEXT') {
        // Return context information that UI pages might need
        // This replaces the need for getBackgroundPage()
        sendResponse({
            context: typeof context !== 'undefined' ? context : null,
            Storage: typeof Storage !== 'undefined' ? Storage : null,
            // Note: Functions can't be serialized, so this is limited
            // UI pages may need to send messages for specific operations
        });
        return true; // Keep the message channel open for async response
    }

    // Handle panel initialization
    if (message.type === 'PANEL_LOADED') {
        try {
            // MV3: Create a proxy object that simulates the panel window for MV3
            const panelWindowId = message.panelWindowId;
            const panelProxy = createPanelProxy(panelWindowId);
            const win_id = onPanelLoaded(panelProxy, panelWindowId);
            sendResponse({ success: true, win_id: win_id });
        } catch (error) {
            console.error('[iMacros MV3] Error in PANEL_LOADED:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    // Handle panel view updates from options page
    if (message.type === 'UPDATE_PANEL_VIEWS') {
        try {
            if (typeof context === 'undefined') {
                sendResponse({ success: false, error: 'Context not available' });
                return true;
            }
            // In MV3, broadcast message to all extension pages (panels)
            // Panel pages listen with chrome.runtime.onMessage, not tabs.sendMessage
            // This is a broadcast, so all open panels will receive and refresh
            chrome.runtime.sendMessage({
                type: 'REFRESH_PANEL_TREE'
            }, function (response) {
                if (chrome.runtime.lastError) {
                    // Expected if no panels are open
                    console.debug('[iMacros MV3] No panels to update:', chrome.runtime.lastError);
                }
            });

            sendResponse({ success: true });
        } catch (error) {
            console.error('[iMacros MV3] Error in UPDATE_PANEL_VIEWS:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    // Handle localStorage cache reload request from options page
    if (message.type === 'RELOAD_LOCALSTORAGE_CACHE') {
        try {
            console.log('[iMacros MV3] Reloading localStorage cache from chrome.storage.local');
            // Reload the cache by calling the initialization function again
            if (typeof globalThis.reloadLocalStorageCache === 'function') {
                globalThis.reloadLocalStorageCache().then(() => {
                    console.log('[iMacros MV3] localStorage cache reloaded successfully');
                    sendResponse({ success: true });
                }).catch(err => {
                    console.error('[iMacros MV3] Failed to reload localStorage cache:', err);
                    sendResponse({ success: false, error: err.message });
                });
            } else {
                // Fallback: manually reload from chrome.storage.local
                chrome.storage.local.get(null, (items) => {
                    if (chrome.runtime.lastError) {
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    // Update the localStorage polyfill cache
                    for (const key in items) {
                        if (key.startsWith('localStorage_')) {
                            const localKey = key.substring(13); // Remove 'localStorage_' prefix
                            localStorage.setItem(localKey, items[key]);
                        }
                    }
                    console.log('[iMacros MV3] localStorage cache reloaded successfully (fallback method)');
                    sendResponse({ success: true });
                });
            }
        } catch (error) {
            console.error('[iMacros MV3] Error in RELOAD_LOCALSTORAGE_CACHE:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    // Handle dialog result from popup dialogs (MV3 compatible)
    if (message.type === 'SET_DIALOG_RESULT') {
        try {
            const { windowId, response } = message;
            if (typeof dialogUtils !== 'undefined') {
                dialogUtils.setDialogResult(windowId, response);
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: 'dialogUtils not available' });
            }
        } catch (error) {
            console.error('[iMacros MV3] Error in SET_DIALOG_RESULT:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    // Handle dialog args request from popup dialogs (MV3 compatible)
    if (message.type === 'GET_DIALOG_ARGS') {
        try {
            const { windowId } = message;
            if (typeof dialogUtils !== 'undefined') {
                const args = dialogUtils.getDialogArgs(windowId);
                sendResponse({ success: true, args: args });
            } else {
                sendResponse({ success: false, error: 'dialogUtils not available' });
            }
        } catch (error) {
            console.error('[iMacros MV3] Error in GET_DIALOG_ARGS:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    // Handle get panel ID request
    if (message.type === 'GET_PANEL_ID') {
        const { win_id } = message;
        try {
            if (typeof context === 'undefined' || !context[win_id]) {
                sendResponse({ success: false, error: 'Context not found for win_id: ' + win_id });
                return true;
            }
            sendResponse({ success: true, panelId: context[win_id].panelId });
        } catch (error) {
            console.error('[iMacros MV3] Error in GET_PANEL_ID:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    // Handle temp password setting
    if (message.type === 'SET_TEMP_PASSWORD') {
        try {
            if (typeof Rijndael !== 'undefined') {
                Rijndael.tempPassword = message.password;
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: 'Rijndael not available' });
            }
        } catch (error) {
            console.error('[iMacros MV3] Error in SET_TEMP_PASSWORD:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    // Handle mplayer pause state check
    if (message.type === 'CHECK_MPLAYER_PAUSED') {
        const { win_id } = message;
        try {
            if (typeof context === 'undefined' || !context[win_id]) {
                sendResponse({ success: false, error: 'Context not found for win_id: ' + win_id });
                return true;
            }
            const mplayer = context[win_id].mplayer;
            const isPaused = !!(mplayer && (mplayer.paused || mplayer.pauseIsPending));
            sendResponse({ success: true, isPaused: isPaused });
        } catch (error) {
            console.error('[iMacros MV3] Error in CHECK_MPLAYER_PAUSED:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    // Handle recorder state check
    if (message.type === 'GET_RECORDER_STATE') {
        const { win_id } = message;
        try {
            if (typeof context === 'undefined' || !context[win_id]) {
                sendResponse({ success: false, error: 'Context not found for win_id: ' + win_id });
                return true;
            }
            const recorder = context[win_id].recorder;
            if (recorder) {
                sendResponse({
                    success: true,
                    recording: recorder.recording,
                    actions: recorder.actions || []
                });
            } else {
                sendResponse({ success: false, error: 'Recorder not available' });
            }
        } catch (error) {
            console.error('[iMacros MV3] Error in GET_RECORDER_STATE:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    // Handle macro save (callback-based save function)
    if (message.type === 'SAVE_MACRO') {
        const { macro, overwrite } = message;
        try {
            // save() is callback-based, need to wrap it
            if (typeof save !== 'function') {
                sendResponse({ success: false, error: 'save function not available' });
                return true;
            }

            save(macro, overwrite, function (result) {
                // result contains {error, skipped, name} or success indicator
                if (result && result.error) {
                    sendResponse({ success: false, error: result.error, result: result });
                } else {
                    sendResponse({ success: true, result: result });
                }
            });
            return true; // Keep message channel open for async callback
        } catch (error) {
            console.error('[iMacros MV3] Error in SAVE_MACRO:', error);
            sendResponse({ success: false, error: error.message });
            return true;
        }
    }

    // Handle generic function calls from UI pages
    if (message.type === 'CALL_BG_FUNCTION') {
        const { functionName, args: funcArgs } = message;

        try {
            // Security check: Only allow whitelisted functions
            if (!ALLOWED_BG_FUNCTIONS.has(functionName)) {
                console.error('[iMacros MV3] Function not allowed:', functionName);
                sendResponse({ success: false, error: 'Function not allowed: ' + functionName });
                return true;
            }

            // Get the function from global scope
            let func = globalThis[functionName];

            if (typeof func !== 'function') {
                console.error('[iMacros MV3] Function not found:', functionName);
                sendResponse({ success: false, error: 'Function not found: ' + functionName });
                return true;
            }

            // Call the function with provided arguments
            const result = func.apply(globalThis, funcArgs || []);

            // Handle Promise results
            if (result && typeof result.then === 'function') {
                result.then(value => {
                    sendResponse({ success: true, result: value });
                }).catch(error => {
                    console.error('[iMacros MV3] Promise error in', functionName, ':', error);
                    sendResponse({ success: false, error: error.message || String(error) });
                });
                return true; // Keep message channel open for async response
            } else {
                // Synchronous result
                sendResponse({ success: true, result: result });
            }
        } catch (error) {
            console.error('[iMacros MV3] Error calling', functionName, ':', error);
            sendResponse({ success: false, error: error.message || String(error) });
        }
        return true;
    }

    // Handle context property access
    if (message.type === 'GET_CONTEXT_PROPERTY') {
        const { win_id, property } = message;

        try {
            if (typeof context === 'undefined' || !context[win_id]) {
                sendResponse({ success: false, error: 'Context not found for win_id: ' + win_id });
                return true;
            }

            const value = context[win_id][property];

            // We can't serialize functions or complex objects, so return a reference
            if (typeof value === 'function') {
                sendResponse({ success: true, isFunction: true });
            } else if (typeof value === 'object' && value !== null) {
                sendResponse({ success: true, isObject: true, type: value.constructor.name });
            } else {
                sendResponse({ success: true, value: value });
            }
        } catch (error) {
            console.error('[iMacros MV3] Error getting context property:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    // Handle context method calls (like mplayer.play, recorder.start, etc.)
    if (message.type === 'CALL_CONTEXT_METHOD') {
        const { win_id, objectPath, methodName, args: methodArgs } = message;

        try {
            if (typeof context === 'undefined' || !context[win_id]) {
                sendResponse({ success: false, error: 'Context not found for win_id: ' + win_id });
                return true;
            }

            // Security check: Only allow whitelisted object paths and methods
            if (!objectPath || !ALLOWED_CONTEXT_METHODS[objectPath]) {
                console.error('[iMacros MV3] Object path not allowed:', objectPath);
                sendResponse({ success: false, error: 'Object path not allowed: ' + objectPath });
                return true;
            }
            if (!ALLOWED_CONTEXT_METHODS[objectPath].has(methodName)) {
                console.error('[iMacros MV3] Method not allowed:', objectPath + '.' + methodName);
                sendResponse({ success: false, error: 'Method not allowed: ' + objectPath + '.' + methodName });
                return true;
            }

            // Navigate to the object (e.g., context[win_id].mplayer)
            let obj = context[win_id];
            if (objectPath) {
                const parts = objectPath.split('.');
                for (let part of parts) {
                    obj = obj[part];
                    if (!obj) {
                        sendResponse({ success: false, error: 'Object path not found: ' + objectPath });
                        return true;
                    }
                }
            }

            // Call the method
            const method = obj[methodName];
            if (typeof method !== 'function') {
                sendResponse({ success: false, error: 'Method not found: ' + methodName });
                return true;
            }

            const result = method.apply(obj, methodArgs || []);

            // Handle Promise results
            if (result && typeof result.then === 'function') {
                result.then(value => {
                    sendResponse({ success: true, result: value });
                }).catch(error => {
                    console.error('[iMacros MV3] Promise error in', objectPath + '.' + methodName, ':', error);
                    sendResponse({ success: false, error: error.message || String(error) });
                });
                return true; // Keep message channel open for async response
            } else {
                sendResponse({ success: true, result: result });
            }
        } catch (error) {
            console.error('[iMacros MV3] Error calling context method:', error);
            sendResponse({ success: false, error: error.message || String(error) });
        }
        return true;
    }

    /* global context */
    // Handle login dialog processing (MV3 compatible replacement for getBackgroundPage)
    if (message.type === 'HANDLE_LOGIN_DIALOG') {
        try {
            const { username, password, args } = message;

            if (!args || !args.recorder || !args.cypherData) {
                sendResponse({ success: false, error: 'Missing required args' });
                return true;
            }

            // Encrypt password if needed
            let pwd = password;
            if (args.cypherData.encrypt) {
                if (typeof Rijndael !== 'undefined') {
                    pwd = Rijndael.encryptString(pwd, args.cypherData.key);
                } else {
                    console.error('[iMacros MV3] Rijndael not available for password encryption');
                    sendResponse({ success: false, error: 'Rijndael not available' });
                    return true;
                }
            }

            // Record the ONLOGIN command
            const rec = "ONLOGIN USER=" + username + " PASSWORD=" + pwd;

            // Remove previously recorded ONLOGIN command if exists
            const l = args.recorder.actions.length;
            const match_part = "ONLOGIN USER=";
            if (l && args.recorder.actions[l - 1].indexOf(match_part) === 0) {
                args.recorder.actions.pop();

                // Update panel to remove last line
                if (typeof context !== 'undefined' && context[args.recorder.win_id]) {
                    const panel = context[args.recorder.win_id].panelWindow;
                    if (panel && !panel.closed) {
                        panel.removeLastLine();
                    }
                }
            }

            // Record the new action
            args.recorder.recordAction(rec);

            // Prepare auth response (authCredentials needs plain password for HTTP authentication)
            const response = {
                authCredentials: {
                    username: username,
                    password: password  // Use plain password for HTTP authentication
                }
            };

            sendResponse({ success: true, response: response });
        } catch (error) {
            console.error('[iMacros MV3] Error in HANDLE_LOGIN_DIALOG:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    // Handle panel closing notification
    if (message.type === 'PANEL_CLOSING') {
        const { win_id, panelBox } = message;
        try {
            // Save panel dimensions if provided
            if (panelBox && panelBox.left !== undefined && panelBox.top !== undefined) {
                chrome.storage.local.set({ 'panel-box': panelBox }, function () {
                    if (chrome.runtime.lastError) {
                        console.error('[iMacros MV3] Failed to save panel position:', chrome.runtime.lastError);
                    } else {
                        console.debug('[iMacros MV3] Panel position saved:', panelBox);
                    }
                });
            }

            // Mark that the panel is closing and cache final dimensions
            if (typeof context !== 'undefined' && context[win_id]) {
                context[win_id].panelClosing = true;
                // Cache final panel dimensions before closing
                if (panelBox && panelBox.width !== undefined && panelBox.height !== undefined) {
                    context[win_id].panelWidth = panelBox.width;
                    context[win_id].panelHeight = panelBox.height;
                }
            }
            sendResponse({ success: true });
        } catch (error) {
            console.error('[iMacros MV3] Error in PANEL_CLOSING:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }

    // Note: eval_in_sandbox_result is now handled via sendResponse callback
    // in handleSandboxMessage, not as a separate incoming message
});

// MV3: Listen for window removals to clean up panel context
// Panel position is saved in PANEL_CLOSING handler before window closes
chrome.windows.onRemoved.addListener(function (windowId) {
    if (typeof context === 'undefined') {
        return;
    }

    // Find and clean up the context with matching panelId
    for (let win_id in context) {
        const ctx = context[win_id];
        if (ctx && ctx.panelId === windowId) {
            // Clean up panel references
            delete ctx.panelId;
            delete ctx.panelWindow;
            delete ctx.panelClosing;
            console.debug('[iMacros MV3] Panel context cleaned up for win_id:', win_id);
            break;
        }
    }
});

console.log('[iMacros MV3] Background service worker initialized');
