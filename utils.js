/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

// Some utility functions
// MV3 Service Worker Polyfill for localStorage
// _localStorageData is exposed globally so it can be hydrated from chrome.storage.local
// Use Object.create(null) to avoid prototype pollution issues
var _localStorageData = Object.create(null);
// Namespace prefix to avoid conflicts with other chrome.storage.local data
var _LOCALSTORAGE_PREFIX = '__imacros_ls__:';

// Check if localStorage needs polyfill - use try-catch to safely handle ReferenceError in Service Workers
var _needsLocalStoragePolyfill = false;
try {
    _needsLocalStoragePolyfill = (typeof localStorage === "undefined" || localStorage === null || localStorage.__isMinimalLocalStorageShim || localStorage.__isInMemoryShim);
} catch (e) {
    // ReferenceError in strict Service Worker environment
    _needsLocalStoragePolyfill = true;
}

if (_needsLocalStoragePolyfill) {
    // Define properly on global scope
    var _global = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : {});

    _global.localStorage = {
        getItem: function (key) {
            return Object.prototype.hasOwnProperty.call(_localStorageData, key) ? _localStorageData[key] : null;
        },
        setItem: function (key, value) {
            _localStorageData[key] = String(value);
            // Persist to chrome.storage.local for MV3 Service Worker persistence
            // Use namespaced key to avoid conflicts with other extension data
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                var item = {};
                item[_LOCALSTORAGE_PREFIX + key] = String(value);
                chrome.storage.local.set(item, function () {
                    if (chrome.runtime && chrome.runtime.lastError) {
                        console.warn('[localStorage polyfill] Failed to persist:', key, chrome.runtime.lastError);
                    }
                });
            }
        },
        removeItem: function (key) {
            delete _localStorageData[key];
            // Remove from chrome.storage.local as well (with namespace prefix)
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.remove(_LOCALSTORAGE_PREFIX + key, function () {
                    if (chrome.runtime && chrome.runtime.lastError) {
                        console.warn('[localStorage polyfill] Failed to remove:', key, chrome.runtime.lastError);
                    }
                });
            }
        },
        clear: function () {
            // Clear in-memory data without breaking object reference
            Object.keys(_localStorageData).forEach(function (key) {
                delete _localStorageData[key];
            });
            // Remove only namespaced keys from chrome.storage.local (not ALL extension data)
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(null, function (items) {
                    if (chrome.runtime && chrome.runtime.lastError) {
                        console.warn('[localStorage polyfill] Failed to list keys for clear:', chrome.runtime.lastError);
                        return;
                    }
                    var keysToRemove = Object.keys(items || {}).filter(function (k) {
                        return k.indexOf(_LOCALSTORAGE_PREFIX) === 0;
                    });
                    if (keysToRemove.length === 0) return;
                    chrome.storage.local.remove(keysToRemove, function () {
                        if (chrome.runtime && chrome.runtime.lastError) {
                            console.warn('[localStorage polyfill] Failed to clear:', chrome.runtime.lastError);
                        }
                    });
                });
            }
        },
        key: function (i) {
            var keys = Object.keys(_localStorageData);
            return keys[i] || null;
        },
        get length() {
            return Object.keys(_localStorageData).length;
        }
    };

    // Also expose as property access for direct localStorage['key'] usage
    if (typeof Proxy !== 'undefined') {
        _global.localStorage = new Proxy(_global.localStorage, {
            get: function (target, prop) {
                if (prop in target) return target[prop];
                return target.getItem(prop);
            },
            set: function (target, prop, value) {
                if (prop in target) { target[prop] = value; return true; }
                target.setItem(prop, value);
                return true;
            },
            deleteProperty: function (target, prop) {
                if (prop in target) { delete target[prop]; return true; }
                target.removeItem(prop);
                return true;
            }
        });
    }
}

(function () {
    const globalScope = typeof self !== 'undefined' ? self : window;

    if (typeof window !== 'undefined' && window.postMessage) {
        const timers = [];
        const onMessage = function (event) {
            if (event.source != window ||
                !event.data.type ||
                event.data.type != "asyncRun")
                return;

            const f = timers.shift();
            if (f) f();
        };

        window.asyncRun = function (f) {
            timers.push(f);
            window.postMessage({ type: "asyncRun" }, "*");
        };

        window.addEventListener("message", onMessage);
    } else {
        // Fallback for Service Worker or environments without window/postMessage
        globalScope.asyncRun = function (f) {
            setTimeout(f, 0);
        };
    }
})();


// Open URL in a new window
function link(url) {
    if (typeof window !== 'undefined') {
        window.open(url);
    } else {
        // In Service Worker, use chrome.tabs or chrome.windows
        if (typeof chrome !== 'undefined' && chrome.tabs) {
            chrome.tabs.create({ url: url });
        }
    }
}


function __is_windows() {
    return /^win(32)?/i.test(navigator.platform);
}

function __psep() {
    return __is_windows() ? "\\" : "/";
}

function __is_full_path(path) {
    if (__is_windows()) {
        return /^[a-z]:/i.test(path);
    } else {
        return /^\//.test(path);
    }
}

var imns = {

    // Returns number if and only if num is an integer or
    // a string representation of an integer,
    // otherwise returns NaN
    s2i: function (num) {
        let s = num.toString();
        s = this.trim(s);
        if (!s.length)
            return Number.NaN;
        const n = parseInt(s);
        if (n.toString().length != s.length)
            return Number.NaN;
        return n;
    },

    // escape \n, \t, etc. chars in line
    escapeLine: function (line) {
        const values_to_escape = {
            "\\u005C": "\\\\",
            "\\u0000": "\\0",
            "\\u0008": "\\b",
            "\\u0009": "\\t",
            "\\u000A": "\\n",
            "\\u000B": "\\v",
            "\\u000C": "\\f",
            "\\u000D": "\\r",
            "\\u0022": "\\\"",
            "\\u0027": "\\'"
        };

        // var values_to_escape = {
        //          "\\": "\\\\",
        //          "\0": "\\0",
        //          "\b": "\\b",
        //          "\t": "\\t",
        //          "\n": "\\n",
        //          "\v": "\\v",
        //          "\f": "\\f",
        //          "\r": "\\r",
        //          "\"": "\\\"",
        //          "'": "\\'"};

        for (const x in values_to_escape) {
            line = line.replace(new RegExp(x, "g"), values_to_escape[x]);
        }

        return line;
    },

    // replace all white-space symbols by <..>
    wrap: function (line) {
        const line_re = new RegExp("^\"((?:\n|.)*)\"$");

        let m = null;
        if (m = line.match(line_re)) { // it is a quoted string
            line = this.escapeLine(m[1]);

            // add quotes
            line = "\"" + line + "\"";
        } else {
            line = line.replace(/\t/g, "<SP>");
            line = line.replace(/\n/g, "<BR>");
            line = line.replace(/\r/g, "<LF>");
            line = line.replace(/\s/g, "<SP>");
        }

        return line;
    },

    // Unwraps a line 
    // If the line is a quoted string then the following escape sequences
    // are translated:
    // \0 The NUL character (\u0000).
    // \b Backspace (\u0008).
    // \t Horizontal tab (\u0009).
    // \n Newline (\u000A).
    // \v Vertical tab (\u000B).
    // \f Form feed (\u000C).
    // \r Carriage return (\u000D).
    // \" Double quote (\u0022).
    // \' Apostrophe or single quote (\u0027).
    // \\ Backslash (\u005C).
    // \xXX The Latin-1 character specified by the two hexadecimal digits XX.
    // \uXXXX The Unicode character specified by four hexadecimal digits XXXX.
    // Otherwise <BR>, <LF>, <SP> are replaced by \n, \r, \x31 resp.

    unwrap: function (line) {
        const line_re = new RegExp("^\"((?:\n|.)*)\"$");
        let m = null;

        const handleSequence = function (s) {
            if (s == "\\\\") {
                return "\u005C";
            } else if (s == "\\0") {
                return "\u0000";
            } else if (s == "\\b") {
                return "\u0008";
            } else if (s == "\\t") {
                return "\u0009";
            } else if (s == "\\n") {
                return "\u000A";
            } else if (s == "\\v") {
                return "\u000B";
            } else if (s == "\\f") {
                return "\u000C";
            } else if (s == "\\r") {
                return "\u000D";
            } else if (s == "\\\"") {
                return "\u0022";
            } else if (s == "\\\'") {
                return "\u0027";
            } else {
                // function to replace \x|u sequence
                const replaceChar = function (match_str, char_code) {
                    return String.fromCharCode(parseInt("0x" + char_code));
                };
                if (/^\\x/.test(s))// replace \xXX by its value
                    return s.replace(/\\x([\da-fA-F]{2})/g, replaceChar);
                else if (/^\\u/.test(s)) // replace \uXXXX by its value
                    return s.replace(/\\u([\da-fA-F]{4})/g, replaceChar);
            }
        };

        const esc_re = /\\(?:[0btnvfr"'\\]|x[\da-fA-F]{2}|u[\da-fA-F]{4})/g;

        if (m = line.match(line_re)) {
            line = m[1];        // 'unquote' the line
            // replace escape sequences by their value
            line = line.replace(esc_re, handleSequence);
        } else {
            line = line.replace(/<br>/gi, '\n');
            line = line.replace(/<lf>/gi, '\r');
            line = line.replace(/<sp>/gi, ' ');
        }

        return line;
    },

    formatDate: function (str, date) {
        const prependDate = function (dateStr, num) {
            let s = dateStr.toString();
            const x = imns.s2i(s), y = imns.s2i(num);
            if (isNaN(x) || isNaN(y))
                return s;
            while (s.length < num)
                s = '0' + s;
            return s;
        };
        const now = date ? date : new Date();
        str = str.replace(/yyyy/g, prependDate(now.getFullYear(), 4));
        str = str.replace(/yy/g, now.getFullYear().toString().substr(-2));
        str = str.replace(/mm/g, prependDate(now.getMonth() + 1, 2));
        str = str.replace(/dd/g, prependDate(now.getDate(), 2));
        str = str.replace(/hh/g, prependDate(now.getHours(), 2));
        str = str.replace(/nn/g, prependDate(now.getMinutes(), 2));
        str = str.replace(/ss/g, prependDate(now.getSeconds(), 2));

        return str;
    },

    // escape chars which are of special meaning in regexp
    escapeREChars: function (str) {
        const chars = "^$.+?=!:|\\/()[]{}";
        let res = "";

        for (let i = 0; i < str.length; i++) {
            for (let j = 0; j < chars.length; j++) {
                if (str[i] == chars[j]) {
                    res += "\\";
                    break;
                }
            }
            res += str[i];
        }

        return res;
    },

    escapeTextContent: function (str) {
        // 1. remove all leading/trailing white spaces
        str = this.trim(str);
        // 2. remove all linebreaks
        str = str.replace(/[\r\n]+/g, "");
        // 3. all consequent white spaces inside text are replaced by one
        str = str.replace(/\s+/g, " ");

        return str;
    },


    trim: function (s) {
        return s.replace(/^\s+/, "").replace(/\s+$/, "");
    },

    // Special key mappings for XType-like functionality
    // Maps ${KEY_*} notation to keyboard key codes and names
    SpecialKeys: {
        // Key code mappings for Chrome DevTools Protocol
        keyCodes: {
            'KEY_ENTER': 13,
            'KEY_BACKSPACE': 8,
            'KEY_DELETE': 46,
            'KEY_UP': 38,
            'KEY_DOWN': 40,
            'KEY_LEFT': 37,
            'KEY_RIGHT': 39,
            'KEY_TAB': 9,
            'KEY_ESC': 27,
            'KEY_ESCAPE': 27,
            'KEY_HOME': 36,
            'KEY_END': 35,
            'KEY_PAGEUP': 33,
            'KEY_PAGEDOWN': 34,
            'KEY_INSERT': 45,
            'KEY_SPACE': 32,
            // Modifier keys
            'KEY_CTRL': 17,
            'KEY_SHIFT': 16,
            'KEY_ALT': 18,
            'KEY_META': 91,
            'KEY_WIN': 91,
            'KEY_CMD': 91,
            // Function keys
            'KEY_F1': 112,
            'KEY_F2': 113,
            'KEY_F3': 114,
            'KEY_F4': 115,
            'KEY_F5': 116,
            'KEY_F6': 117,
            'KEY_F7': 118,
            'KEY_F8': 119,
            'KEY_F9': 120,
            'KEY_F10': 121,
            'KEY_F11': 122,
            'KEY_F12': 123
        },

        // Parse special key notation like ${KEY_ENTER} or ${KEY_CTRL+KEY_A}
        // Returns array of {type: 'text'|'key'|'combo', value: string|keyCode, modifiers: object}
        parse: function (text) {
            if (!text) return [{ type: 'text', value: '' }];

            var result = [];
            var regex = /\$\{([^}]+)\}/g;
            var lastIndex = 0;
            var match;

            while ((match = regex.exec(text)) !== null) {
                // Add text before the special key
                if (match.index > lastIndex) {
                    result.push({
                        type: 'text',
                        value: text.substring(lastIndex, match.index)
                    });
                }

                // Parse the special key or key combination
                var keySpec = match[1].trim();
                var parsed = this.parseKeySpec(keySpec);
                if (parsed) {
                    result.push(parsed);
                } else {
                    // If not a valid special key, treat as literal text
                    result.push({
                        type: 'text',
                        value: match[0]
                    });
                }

                lastIndex = regex.lastIndex;
            }

            // Add remaining text
            if (lastIndex < text.length) {
                result.push({
                    type: 'text',
                    value: text.substring(lastIndex)
                });
            }

            return result;
        },

        // Parse a key specification like "KEY_ENTER" or "KEY_CTRL+KEY_A"
        parseKeySpec: function (spec) {
            var parts = spec.split('+');
            var modifiers = {
                ctrl: false,
                shift: false,
                alt: false,
                meta: false
            };
            var mainKey = null;

            for (var i = 0; i < parts.length; i++) {
                var part = parts[i].trim().toUpperCase();

                if (part === 'KEY_CTRL' || part === 'CTRL') {
                    modifiers.ctrl = true;
                } else if (part === 'KEY_SHIFT' || part === 'SHIFT') {
                    modifiers.shift = true;
                } else if (part === 'KEY_ALT' || part === 'ALT') {
                    modifiers.alt = true;
                } else if (part === 'KEY_META' || part === 'META' || part === 'KEY_CMD' || part === 'CMD' || part === 'KEY_WIN' || part === 'WIN') {
                    modifiers.meta = true;
                } else if (this.keyCodes[part]) {
                    mainKey = part;
                } else if (/^KEY_[A-Z0-9]$/.test(part)) {
                    // Support KEY_A, KEY_B, KEY_C, etc. notation
                    mainKey = part.slice(4);
                } else if (part.length === 1) {
                    // Single character like 'A', 'C', 'V'
                    mainKey = part;
                } else {
                    // Unknown key
                    return null;
                }
            }

            if (!mainKey) {
                // Only modifiers, no main key
                return null;
            }

            // Check if it's a combination or a single key
            var hasModifiers = modifiers.ctrl || modifiers.shift || modifiers.alt || modifiers.meta;

            if (hasModifiers) {
                return {
                    type: 'combo',
                    key: mainKey,
                    keyCode: this.keyCodes[mainKey] || mainKey.charCodeAt(0),
                    modifiers: modifiers,
                    char: mainKey.length === 1 ? mainKey : null
                };
            } else {
                return {
                    type: 'key',
                    key: mainKey,
                    // Fallback to charCode for single characters (e.g., ${A})
                    keyCode: this.keyCodes[mainKey] || (mainKey.length === 1 ? mainKey.charCodeAt(0) : undefined),
                    modifiers: modifiers
                };
            }
        },

        // Get modifier string for EVENT command (e.g., "ctrl|shift")
        getModifierString: function (modifiers) {
            var mods = [];
            if (modifiers.ctrl) mods.push('ctrl');
            if (modifiers.shift) mods.push('shift');
            if (modifiers.alt) mods.push('alt');
            if (modifiers.meta) mods.push('meta');
            return mods.join('|');
        }
    },

    Clipboard: {
        _offscreenInitPromise: null,
        _offscreenUnavailableError: null,
        /**
         * Check if we're in a Service Worker environment
         */
        _isServiceWorker: function () {
            // Check for ServiceWorkerGlobalScope
            if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
                return true;
            }
            // Check if chrome.offscreen is available (indicates Service Worker with MV3 offscreen support)
            if (typeof chrome !== 'undefined' && chrome.offscreen) {
                return true;
            }
            return false;
        },

        /**
         * Helper to ensure offscreen document exists (for Service Worker context)
         */
        _ensureOffscreenDocument: function () {
            if (this._offscreenUnavailableError) {
                return Promise.reject(this._offscreenUnavailableError);
            }

            if (typeof chrome === 'undefined' || !chrome.offscreen || !chrome.runtime || !chrome.runtime.getContexts) {
                const error = new Error("Offscreen API not available");
                error.code = 'OFFSCREEN_UNAVAILABLE';
                this._offscreenUnavailableError = error;
                return Promise.reject(error);
            }

            if (this._offscreenInitPromise) {
                return this._offscreenInitPromise;
            }

            // Use chrome.runtime.getContexts to check if offscreen document exists
            // hasDocument() was removed from the API
            this._offscreenInitPromise = chrome.runtime.getContexts({
                contextTypes: ['OFFSCREEN_DOCUMENT'],
                documentUrls: [chrome.runtime.getURL('offscreen.html')]
            }).then(function (contexts) {
                if (contexts.length > 0) {
                    // Offscreen document already exists
                    return Promise.resolve();
                }

                // Create offscreen document using Promise-based API
                return chrome.offscreen.createDocument({
                    url: 'offscreen.html',
                    reasons: [
                        chrome.offscreen.Reason?.DOM_SCRAPING || 'DOM_SCRAPING',
                        'SANDBOXING'
                    ],
                    justification: 'Clipboard operations and EVAL command execution'
                });
            }).catch((err) => {
                // If error is "Only a single offscreen document may be created", ignore it
                if (err.message && err.message.includes('Only a single offscreen')) {
                    return Promise.resolve();
                }
                if (!err.code && (err.message === 'Offscreen API not available' || err.name === 'TypeError')) {
                    err.code = 'OFFSCREEN_UNAVAILABLE';
                }
                if (err.code === 'OFFSCREEN_UNAVAILABLE') {
                    this._offscreenUnavailableError = err;
                }
                throw err;
            }).finally(() => {
                this._offscreenInitPromise = null;
            });

            return this._offscreenInitPromise;
        },

        _writeClipboardFallback: function (str) {
            var self = this;

            // Check if we're in an Offscreen Document context (no focus, clipboard fails)
            var isOffscreenContext = (typeof document !== 'undefined' &&
                document.location &&
                document.location.pathname.includes('offscreen'));

            // If in Offscreen Document, proxy through Service Worker -> Content Script
            if (isOffscreenContext) {
                console.log("[iMacros] Clipboard write: proxying through content script");
                return new Promise(function (resolve, reject) {
                    chrome.runtime.sendMessage({
                        command: 'CLIPBOARD_WRITE',
                        text: str
                    }, function (response) {
                        if (chrome.runtime.lastError) {
                            console.warn("[iMacros] Clipboard write proxy failed:", chrome.runtime.lastError.message);
                            // Don't fail the macro - clipboard is non-critical
                            resolve();
                            return;
                        }
                        if (response && response.success) {
                            resolve();
                        } else {
                            console.warn("[iMacros] Clipboard write failed:", response && response.error);
                            // Don't fail the macro - clipboard is non-critical
                            resolve();
                        }
                    });
                });
            }

            // Try Clipboard API first if available (modern browsers)
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                return navigator.clipboard.writeText(str).catch(function (err) {
                    console.error("[iMacros] Clipboard write failed:", err);
                    // Don't throw - return resolved promise (clipboard is non-critical)
                    return Promise.resolve();
                });
            }

            // Fallback to DOM method if available (content scripts, popups)
            if (typeof document !== 'undefined' && document.body) {
                try {
                    var x = self._check_area();
                    x.value = str;
                    x.focus();
                    x.select();
                    document.execCommand("Copy");
                    return Promise.resolve();
                } catch (e) {
                    console.error("[iMacros] Legacy clipboard write failed:", e);
                    return Promise.resolve(); // Don't fail the macro
                }
            }

            // No clipboard access available - return resolved (non-critical)
            console.warn("[iMacros] Clipboard API not available in this context");
            return Promise.resolve();
        },

        _readClipboardFallback: function () {
            // Try Clipboard API first if available (modern browsers)
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
                return navigator.clipboard.readText().catch(function (err) {
                    console.error("[iMacros] Clipboard read failed:", err);
                    // Don't throw - return rejected promise for caller to handle
                    return Promise.reject(new Error("Clipboard read failed: " + err.message));
                });
            }

            // Fallback to DOM method if available (content scripts, popups)
            if (typeof document !== 'undefined' && document.body) {
                try {
                    var x = this._check_area();
                    x.value = '';
                    x.select();
                    x.focus();
                    document.execCommand("Paste");
                    return Promise.resolve(x.value);
                } catch (e) {
                    console.warn("[iMacros] Clipboard paste failed (background mode):", e);
                    return Promise.resolve(""); // Return empty string on error
                }
            }

            // No clipboard access available - return rejected promise
            console.warn("[iMacros] Clipboard API not available in this context");
            return Promise.resolve("");
        },

        /**
         * Legacy DOM-based clipboard area (for content scripts and popups)
         */
        _check_area: function (str) {
            // Only works in contexts with document (content scripts, popups)
            if (typeof document === 'undefined') {
                throw new Error("DOM not available in this context. Use Clipboard API instead.");
            }

            var x;
            if (!(x = document.getElementById("clipboard-area"))) {
                x = document.createElement("textarea");
                x.id = "clipboard-area";
                x.setAttribute("contentEditable", "true");
                document.body.appendChild(x);
            }
            return x;
        },

        /**
         * Put string to clipboard
         * Uses offscreen document in Service Worker, Clipboard API or DOM in other contexts
         */
        putString: function (str) {
            var self = this;

            // Service Worker context: use offscreen document
            if (self._isServiceWorker()) {
                return self._ensureOffscreenDocument().then(function () {
                    return new Promise(function (resolve, reject) {
                        chrome.runtime.sendMessage({
                            type: 'clipboard_write',
                            text: str
                        }, function (response) {
                            if (chrome.runtime.lastError) {
                                console.error("[iMacros] Offscreen clipboard write error:", chrome.runtime.lastError);
                                reject(new Error(chrome.runtime.lastError.message));
                            } else if (response && response.success) {
                                console.log("[iMacros] Clipboard write successful via offscreen");
                                resolve();
                            } else {
                                var errorMsg = response && response.error ? response.error : "Unknown error";
                                console.error("[iMacros] Offscreen clipboard write failed:", errorMsg);
                                reject(new Error("Clipboard write failed: " + errorMsg));
                            }
                        });
                    });
                }).catch(function (err) {
                    if (err && err.code === 'OFFSCREEN_UNAVAILABLE') {
                        console.warn("[iMacros] Offscreen API unavailable, falling back to direct clipboard access");
                        return self._writeClipboardFallback(str);
                    }
                    console.error("[iMacros] Failed to setup offscreen document:", err);
                    return Promise.reject(err);
                });
            }

            return self._writeClipboardFallback(str);
        },

        /**
         * Get string from clipboard
         * Uses offscreen document in Service Worker, Clipboard API or DOM in other contexts
         */
        getString: function () {
            var self = this;

            // Service Worker context: use offscreen document
            if (self._isServiceWorker()) {
                return self._ensureOffscreenDocument().then(function () {
                    return new Promise(function (resolve, reject) {
                        chrome.runtime.sendMessage({
                            type: 'clipboard_read'
                        }, function (response) {
                            if (chrome.runtime.lastError) {
                                console.error("[iMacros] Offscreen clipboard read error:", chrome.runtime.lastError);
                                reject(new Error(chrome.runtime.lastError.message));
                            } else if (response && response.success) {
                                console.log("[iMacros] Clipboard read successful via offscreen");
                                resolve(response.text || "");
                            } else {
                                var errorMsg = response && response.error ? response.error : "Unknown error";
                                console.error("[iMacros] Offscreen clipboard read failed:", errorMsg);
                                reject(new Error("Clipboard read failed: " + errorMsg));
                            }
                        });
                    });
                }).catch(function (err) {
                    if (err && err.code === 'OFFSCREEN_UNAVAILABLE') {
                        console.warn("[iMacros] Offscreen API unavailable, falling back to direct clipboard access");
                        return self._readClipboardFallback();
                    }
                    console.error("[iMacros] Failed to setup offscreen document:", err);
                    return Promise.reject(err);
                });
            }

            return self._readClipboardFallback();
        }
    }
};




// App exceptions

// Classes for reporting syntax and runtime errors

// Returns error with message=msg and optional position of
// bad parameter set by num
function BadParameter(msg, num) {
    this.message = typeof (num) != "undefined" ? "expected " + msg +
        " as parameter " + num : msg;
    this.name = "BadParameter";
    this.errnum = 711;
}

BadParameter.prototype = Error.prototype;


function UnsupportedCommand(msg) {
    this.message = "command " + msg + " is not supported in the current version";
    this.name = "UnsupportedCommand";
    this.errnum = 712;
}

UnsupportedCommand.prototype = Error.prototype;

// Returns error with message=msg, optional error number num
// sets mplayer.errorCode
function RuntimeError(msg, num) {
    this.message = msg;
    if (typeof num != "undefined")
        this.errnum = num;
    this.name = "RuntimeError";
}

RuntimeError.prototype = Error.prototype;

function FreewareLimit(msg) {
    this.message = "Freeware version limit exceeded: " + msg;
    this.errnum = 800;
    this.name = "FreewareLimit";
}

FreewareLimit.prototype = Error.prototype;

SyntaxError.prototype.
    __defineGetter__("errnum", function () { return 710; });


function normalize_error(e) {
    return { name: e.name, message: e.message, errnum: e.errnum };
}



// preference storage
var Storage = {
    _syncToChromeStorage: function (key, value) {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            var storageKey = 'localStorage_' + key;
            try {
                if (value === null) {
                    const result = chrome.storage.local.remove(storageKey, function () {
                        if (chrome.runtime && chrome.runtime.lastError) {
                            console.warn("Failed to remove from chrome.storage.local:", chrome.runtime.lastError);
                        }
                    });

                    // Support both Promise-based and callback-based chrome.storage implementations
                    if (result && typeof result.catch === 'function') {
                        result.catch(function (e) {
                            console.warn("Failed to remove from chrome.storage.local:", e);
                        });
                    }
                } else {
                    var obj = {};
                    obj[storageKey] = String(value);
                    const result = chrome.storage.local.set(obj, function () {
                        if (chrome.runtime && chrome.runtime.lastError) {
                            console.warn("Failed to save to chrome.storage.local:", chrome.runtime.lastError);
                        }
                    });

                    // Support both Promise-based and callback-based chrome.storage implementations
                    if (result && typeof result.catch === 'function') {
                        result.catch(function (e) {
                            console.warn("Failed to save to chrome.storage.local:", e);
                        });
                    }
                }
            } catch (e) {
                console.warn("Failed to sync to chrome.storage.local:", e);
            }
        }
    },

    isSet: function (key) {
        if (typeof localStorage === "undefined") return false;
        return typeof (localStorage[key]) != "undefined";
    },

    setBool: function (key, value) {
        if (typeof localStorage !== "undefined") {
            localStorage[key] = Boolean(value);
        }
        this._syncToChromeStorage(key, Boolean(value));
    },

    getBool: function (key, defaultValue) {
        if (typeof localStorage === "undefined") {
            return typeof defaultValue !== "undefined" ? defaultValue : false;
        }
        var value = localStorage[key];
        if (typeof value === "undefined" || value === null) {
            return typeof defaultValue !== "undefined" ? defaultValue : false;
        }
        return value.toString() != "false";
    },

    setChar: function (key, value) {
        if (typeof localStorage !== "undefined") {
            localStorage[key] = String(value);
        }
        this._syncToChromeStorage(key, String(value));
    },

    getChar: function (key, defaultValue) {
        if (typeof localStorage === "undefined") {
            return typeof defaultValue !== "undefined" ? defaultValue : "";
        }
        var value = localStorage[key];
        if (typeof value === "undefined" || value === null) {
            return typeof defaultValue !== "undefined" ? defaultValue : "";
        }
        return value.toString();
    },

    setNumber: function (key, value) {
        var val = Number(value);
        if (!isNaN(val)) {
            if (typeof localStorage !== "undefined") {
                localStorage[key] = val;
            }
            this._syncToChromeStorage(key, val);
        }
    },

    getNumber: function (key, defaultValue) {
        if (typeof localStorage === "undefined") {
            return typeof defaultValue !== "undefined" ? defaultValue : 0;
        }
        var value = localStorage[key];
        if (typeof value === "undefined" || value === null) {
            return typeof defaultValue !== "undefined" ? defaultValue : 0;
        }
        var num = Number(value);
        return isNaN(num) ? (typeof defaultValue !== "undefined" ? defaultValue : 0) : num;
    },

    setObject: function (key, value) {
        var s = JSON.stringify(value);
        if (typeof localStorage !== "undefined") {
            localStorage[key] = s;
        }
        this._syncToChromeStorage(key, s);
    },

    getObject: function (key, defaultValue) {
        if (typeof localStorage === "undefined") {
            return typeof defaultValue !== "undefined" ? defaultValue : null;
        }
        var s = localStorage[key];
        if (typeof s != "string" || s === null || s === "undefined") {
            return typeof defaultValue !== "undefined" ? defaultValue : null;
        }
        try {
            return JSON.parse(s);
        } catch (e) {
            logError("Failed to parse JSON for key '" + key + "': " + e.message, { key: key, value: s });
            return typeof defaultValue !== "undefined" ? defaultValue : null;
        }
    }
};


// resize window to fit its content
function resizeToContent(win, container) {
    var rect = container.getBoundingClientRect();
    var width = (win.outerWidth - win.innerWidth) + rect.width;
    var height = (win.outerHeight - win.innerHeight) + rect.height;
    // that +30 is for window's titlebar which seems missing when
    // outerWidth-innerWidth is calculated
    win.resizeTo(width, height + 30);
}


// open a dialog and return promise which resolves on a message from the
// known popup window
var dialogUtils = (function () {
    "use strict";



    let dialogResolvers = new Map();
    let dialogArgs = new Map();
    let dialogTimeouts = new Map();
    let windowCloseListenerRegistered = false;

    // Default dialog timeout (0 = no timeout)
    const DEFAULT_DIALOG_TIMEOUT_MS = 0;

    /**
     * Handle window close event - cleanup and resolve pending dialogs
     */
    function handleWindowClose(windowId) {
        // Check if this window has a pending dialog resolver
        if (dialogResolvers.has(windowId)) {
            console.log('[iMacros] Dialog window closed without response, windowId:', windowId);

            // Get the resolver before cleanup
            const resolver = dialogResolvers.get(windowId);

            // Clear timeout if set
            if (dialogTimeouts.has(windowId)) {
                clearTimeout(dialogTimeouts.get(windowId));
                dialogTimeouts.delete(windowId);
            }

            // Cleanup maps
            dialogResolvers.delete(windowId);
            dialogArgs.delete(windowId);

            // Resolve with cancelled flag (allows caller to handle gracefully)
            resolver({ cancelled: true, reason: 'window_closed' });
        }
    }

    /**
     * Register the window close listener (once)
     */
    function ensureWindowCloseListener() {
        if (windowCloseListenerRegistered) return;

        if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.onRemoved) {
            chrome.windows.onRemoved.addListener(handleWindowClose);
            windowCloseListenerRegistered = true;
            console.log('[iMacros] dialogUtils: Window close listener registered');
        }
    }

    /**
     * Set a timeout for dialog response
     */
    function setDialogTimeout(windowId, timeoutMs, resolve) {
        if (!timeoutMs || timeoutMs <= 0) return;

        const timeoutId = setTimeout(() => {
            if (dialogResolvers.has(windowId)) {
                console.warn('[iMacros] Dialog timeout after ' + timeoutMs + 'ms, windowId:', windowId);

                // Cleanup
                dialogResolvers.delete(windowId);
                dialogArgs.delete(windowId);
                dialogTimeouts.delete(windowId);

                // Try to close the window
                try {
                    chrome.windows.remove(windowId, () => {
                        if (chrome.runtime.lastError) {
                            // Window might already be closed, ignore
                        }
                    });
                } catch (e) {
                    // Ignore errors during window close
                }

                // Resolve with timeout flag
                resolve({ cancelled: true, reason: 'timeout' });
            }
        }, timeoutMs);

        dialogTimeouts.set(windowId, timeoutId);
    }

    return {
        setArgs(win, args) {
            // Store by window object for MV2 compatibility (always)
            dialogArgs.set(win, args);

            // MV3 compatibility: if win has an id property (mock window from window.open shim),
            // also store by window ID when it becomes available
            if (win && typeof win.id !== 'undefined') {
                // Check if ID is already available (synchronous case)
                if (win.id !== null && win.id > 0) {
                    // Valid window ID, store it
                    dialogArgs.set(win.id, args);
                } else if (win.id === -1) {
                    // Window creation failed (id = -1 signals error from window.open shim)
                    console.error('[iMacros] Window creation failed, args stored by window object only');
                } else {
                    // ID not yet set (null) - poll for it (window.open shim sets it asynchronously)
                    let pollCount = 0;
                    const maxPolls = 500; // 5 seconds with 10ms interval
                    const pollInterval = setInterval(() => {
                        pollCount++;
                        if (win.id !== null && win.id > 0) {
                            // Valid window ID received, store it
                            dialogArgs.set(win.id, args);
                            clearInterval(pollInterval);
                        } else if (win.id === -1) {
                            // Window creation failed, stop polling
                            console.error('[iMacros] Window creation failed during polling, args stored by window object only');
                            clearInterval(pollInterval);
                        } else if (pollCount >= maxPolls) {
                            // Timeout - window ID never arrived
                            console.warn('[iMacros] Dialog args timeout: window.id not set after 5s');
                            clearInterval(pollInterval);
                        }
                    }, 10);
                }
            }
        },

        getArgs(win) {
            // MV3 compatibility: support both window objects and numeric IDs
            // If win is a number, treat it as a window ID directly
            if (typeof win === 'number') {
                if (dialogArgs.has(win)) {
                    return dialogArgs.get(win);
                }
                throw new Error("dialogUtils error: bad dialog id " + win);
            }

            // If win is an object, check by window ID first (only for valid IDs > 0)
            if (win && typeof win.id === 'number' && win.id > 0 && dialogArgs.has(win.id)) {
                return dialogArgs.get(win.id);
            }
            // Fallback: try window object as key (works for MV2 and MV3 error cases)
            if (!dialogArgs.has(win))
                throw new Error("dialogUtils error: bad dialog win reference")
            return dialogArgs.get(win);
        },

        setDialogResult(win_id, response) {
            if (!dialogResolvers.has(win_id)) {
                // Log warning instead of throwing - window might have been closed
                console.warn('[iMacros] setDialogResult: no resolver for windowId ' + win_id + ' (window may have been closed)');
                return;
            }

            // Clear timeout if set
            if (dialogTimeouts.has(win_id)) {
                clearTimeout(dialogTimeouts.get(win_id));
                dialogTimeouts.delete(win_id);
            }

            dialogResolvers.get(win_id)(response);
            dialogResolvers.delete(win_id);
            dialogArgs.delete(win_id);
        },

        getDialogArgs(win_id) {
            if (!dialogArgs.has(win_id))
                throw new Error("dialogUtils error: bad dialog id")
            return dialogArgs.get(win_id)
        },

        /**
         * Check if a dialog is still pending
         */
        isDialogPending(win_id) {
            return dialogResolvers.has(win_id);
        },

        /**
         * Get the count of pending dialogs (for debugging)
         */
        getPendingDialogCount() {
            return dialogResolvers.size;
        },

        /**
         * Cancel a pending dialog by window ID
         */
        cancelDialog(win_id, reason = 'cancelled') {
            if (!dialogResolvers.has(win_id)) {
                return false;
            }

            const resolver = dialogResolvers.get(win_id);

            // Clear timeout if set
            if (dialogTimeouts.has(win_id)) {
                clearTimeout(dialogTimeouts.get(win_id));
                dialogTimeouts.delete(win_id);
            }

            // Cleanup
            dialogResolvers.delete(win_id);
            dialogArgs.delete(win_id);

            // Try to close the window
            try {
                chrome.windows.remove(win_id, () => {
                    if (chrome.runtime.lastError) {
                        // Window might already be closed, ignore
                    }
                });
            } catch (e) {
                // Ignore errors
            }

            // Resolve with cancelled flag
            resolver({ cancelled: true, reason: reason });
            return true;
        },

        openDialog(url, name, args = {}, pos) {
            // Proxy for Offscreen Document where chrome.windows is unavailable
            if (typeof chrome.windows === 'undefined') {
                console.log("[iMacros Utils] openDialog proxying to Service Worker");
                return new Promise(function (resolve, reject) {
                    // Set default dimensions/timeout the same way as the chrome.windows path
                    const width = pos && pos.width ? pos.width : 400;
                    const height = pos && pos.height ? pos.height : 250;
                    const timeout = (pos && pos.timeout) || args.timeout || DEFAULT_DIALOG_TIMEOUT_MS;

                    chrome.runtime.sendMessage({
                        command: "openDialog",
                        url: url,
                        name: name,
                        args: args,
                        pos: Object.assign({}, pos, { width, height })
                    }, function (response) {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }
                        if (!response || response.error) {
                            reject(new Error((response && response.error) || "Failed to open dialog"));
                            return;
                        }

                        const win = response.result;
                        if (!win || typeof win.id !== 'number') {
                            reject(new Error('Invalid dialog window returned'));
                            return;
                        }

                        // Mirror the normal path by registering args/resolver locally so GET_DIALOG_ARGS works
                        console.log('[iMacros Utils] Setting dialog args for window:', win.id);
                        dialogArgs.set(win.id, args);
                        dialogResolvers.set(win.id, resolve);

                        if (timeout > 0) {
                            setDialogTimeout(win.id, timeout, resolve);
                        }
                    });
                });
            }

            // Ensure window close listener is registered
            ensureWindowCloseListener();

            return new Promise(function (resolve, reject) {
                // Set default dimensions if not provided
                const width = pos && pos.width ? pos.width : 400;
                const height = pos && pos.height ? pos.height : 250;
                const timeout = (pos && pos.timeout) || args.timeout || DEFAULT_DIALOG_TIMEOUT_MS;

                // Ensure URL is absolute
                const fullUrl = url.indexOf('://') === -1 ? chrome.runtime.getURL(url) : url;

                chrome.windows.create({
                    url: fullUrl,
                    type: "popup",
                    width: width,
                    height: height,
                    left: pos && pos.left || undefined,
                    top: pos && pos.top || undefined
                }, function (w) {
                    if (chrome.runtime.lastError) {
                        console.error('[iMacros] Failed to create dialog window:', chrome.runtime.lastError);
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (!w || !w.id) {
                        console.error('[iMacros] Dialog window creation returned invalid window');
                        reject(new Error('Invalid window returned'));
                        return;
                    }

                    console.log('[iMacros] Dialog window created with ID:', w.id);
                    dialogArgs.set(w.id, args);
                    dialogResolvers.set(w.id, resolve);

                    // Set timeout if specified
                    if (timeout > 0) {
                        setDialogTimeout(w.id, timeout, resolve);
                    }
                });
            });
        }
    };
})();

let cachedManifestVersion = null;

function getSafeManifestVersion() {
    if (cachedManifestVersion) return cachedManifestVersion;
    try {
        if (chrome && chrome.runtime && typeof chrome.runtime.getManifest === "function") {
            cachedManifestVersion = chrome.runtime.getManifest().version || "unknown";
        } else {
            // Some contexts (e.g., sandboxed iframes) do not expose chrome.runtime.
            console.warn("[iMacros] chrome.runtime.getManifest not available; using 'unknown' version");
            cachedManifestVersion = "unknown";
        }
    } catch (e) {
        console.error("[iMacros] Failed to read manifest version for redirect", e);
        cachedManifestVersion = "unknown";
    }
    return cachedManifestVersion;
}

function getRedirectURL(id_or_kw) {
    const version = getSafeManifestVersion();
    const prefix = `http://rd.imacros.net/redirect.aspx?type=CR&version=${version}`;
    if (typeof id_or_kw === "number") {
        return `${prefix}&helpid=${id_or_kw}`;
    }
    if (typeof id_or_kw === "string") {
        return `${prefix}&helpid=102&kw=${id_or_kw}`;
    }
    return prefix;
}

function getRedirFromString(idString) {
    // Custom redirect URL for welcome page
    if (idString === "welcome") {
        return "https://yokohamaticket.co.jp";
    }
    const version = getSafeManifestVersion();
    const prefix = `http://rd.imacros.net/redirect.aspx?type=CR&version=${version}`;
    return `${prefix}&helpid=${idString}`;
}

// returns true if fileName's extension is of a macro file (e.g. .iim or .IIM)
function isMacroFile(fileName) {
    return /\.iim$/i.test(fileName);
}

/**
 * XPath Selector Generation Utilities
 * Based on ROBULA+ algorithm and industry best practices
 * References:
 * - https://www.researchgate.net/publication/299336358_Robula_An_algorithm_for_generating_robust_XPath_locators_for_web_testing
 * - https://medium.com/@solanki.govinda/best-practices-for-selecting-xpath-locators-in-ui-automation-9d0cc80e626b
 */
imns.XPathUtils = {

    /**
     * Escape special characters in XPath string literals
     */
    escapeXPathString: function (str) {
        if (!str) return "''";

        // If string contains both single and double quotes, use concat()
        if (str.indexOf("'") !== -1 && str.indexOf('"') !== -1) {
            var parts = str.split("'").map(function (part) {
                return "'" + part + "'";
            });
            return 'concat(' + parts.join(',"\'",') + ')';
        }

        // If string contains single quotes, use double quotes
        if (str.indexOf("'") !== -1) {
            return '"' + str + '"';
        }

        // Default: use single quotes
        return "'" + str + "'";
    },

    /**
     * Check if an element has a unique attribute value among its siblings
     */
    isUniqueAmongSiblings: function (element, attrName, attrValue) {
        if (!element.parentNode) return false;

        var siblings = element.parentNode.children;
        var count = 0;

        for (var i = 0; i < siblings.length; i++) {
            if (siblings[i].tagName === element.tagName &&
                siblings[i].getAttribute(attrName) === attrValue) {
                count++;
                if (count > 1) return false;
            }
        }

        return count === 1;
    },

    /**
     * Generate XPath using ID (highest priority)
     */
    getXPathByID: function (element) {
        var id = element.getAttribute('id');
        if (!id) return null;

        // Verify ID is unique in document
        try {
            var found = document.getElementById(id);
            if (found === element) {
                return '//*[@id=' + this.escapeXPathString(id) + ']';
            }
        } catch (e) {
            // Invalid ID format
        }

        return null;
    },

    /**
     * Generate XPath using data-* attributes (test hooks)
     */
    getXPathByDataAttribute: function (element) {
        // Priority order for data attributes
        var dataAttrs = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-automation-id'];

        for (var i = 0; i < dataAttrs.length; i++) {
            var attrName = dataAttrs[i];
            var attrValue = element.getAttribute(attrName);

            if (attrValue) {
                // Check if unique in document
                var xpath = '//*[@' + attrName + '=' + this.escapeXPathString(attrValue) + ']';
                try {
                    var result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                    if (result.snapshotLength === 1 && result.snapshotItem(0) === element) {
                        return xpath;
                    }
                } catch (e) {
                    continue;
                }
            }
        }

        return null;
    },

    /**
     * Generate XPath using name attribute (for form elements)
     */
    getXPathByName: function (element) {
        var name = element.getAttribute('name');
        if (!name) return null;

        var tagName = element.tagName.toLowerCase();
        var xpath = '//' + tagName + '[@name=' + this.escapeXPathString(name) + ']';

        // Check if unique
        try {
            var result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            if (result.snapshotLength === 1 && result.snapshotItem(0) === element) {
                return xpath;
            }

            // If not unique, add type attribute for input elements
            if (tagName === 'input' && element.type) {
                xpath = '//' + tagName + '[@name=' + this.escapeXPathString(name) +
                    ' and @type=' + this.escapeXPathString(element.type) + ']';
                result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                if (result.snapshotLength === 1 && result.snapshotItem(0) === element) {
                    return xpath;
                }
            }
        } catch (e) {
            // XPath evaluation error
        }

        return null;
    },

    /**
     * Generate XPath using ARIA attributes
     */
    getXPathByARIA: function (element) {
        var ariaAttrs = ['aria-label', 'aria-labelledby', 'role'];

        for (var i = 0; i < ariaAttrs.length; i++) {
            var attrName = ariaAttrs[i];
            var attrValue = element.getAttribute(attrName);

            if (attrValue) {
                var tagName = element.tagName.toLowerCase();
                var xpath = '//' + tagName + '[@' + attrName + '=' + this.escapeXPathString(attrValue) + ']';

                try {
                    var result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                    if (result.snapshotLength === 1 && result.snapshotItem(0) === element) {
                        return xpath;
                    }
                } catch (e) {
                    continue;
                }
            }
        }

        return null;
    },

    /**
     * Generate XPath using text content (for buttons, links, etc.)
     */
    getXPathByText: function (element) {
        var tagName = element.tagName.toLowerCase();

        // Only use text for certain elements
        if (!['a', 'button', 'span', 'div', 'li', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
            return null;
        }

        // Get all text content including nested elements (matches XPath text() behavior)
        var text = element.textContent;

        // Normalize whitespace to match normalize-space() XPath function
        text = text.trim().replace(/\s+/g, ' ');

        // Text should be reasonably short and non-empty
        if (!text || text.length > 60) return null;

        // Try exact text match first (use . to include nested text nodes)
        var xpath = '//' + tagName + '[normalize-space(.)=' + this.escapeXPathString(text) + ']';
        try {
            var result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            if (result.snapshotLength === 1 && result.snapshotItem(0) === element) {
                return xpath;
            }

            // Try contains() for partial match (use . to include nested text nodes)
            if (text.length >= 4) {
                xpath = '//' + tagName + '[contains(normalize-space(.),' + this.escapeXPathString(text) + ')]';
                result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                if (result.snapshotLength === 1 && result.snapshotItem(0) === element) {
                    return xpath;
                }
            }
        } catch (e) {
            // XPath evaluation error
        }

        return null;
    },

    /**
     * Generate XPath using position (last resort)
     */
    getXPathByPosition: function (element) {
        var path = '';
        var current = element;

        while (current && current.nodeType === Node.ELEMENT_NODE) {
            var tagName = current.tagName.toLowerCase();

            if (current.parentNode) {
                var siblings = current.parentNode.children;
                var sameTagSiblings = [];

                for (var i = 0; i < siblings.length; i++) {
                    if (siblings[i].tagName === current.tagName) {
                        sameTagSiblings.push(siblings[i]);
                    }
                }

                if (sameTagSiblings.length > 1) {
                    var index = sameTagSiblings.indexOf(current) + 1;
                    path = '/' + tagName + '[' + index + ']' + path;
                } else {
                    path = '/' + tagName + path;
                }
            } else {
                path = '/' + tagName + path;
            }

            current = current.parentNode;
        }

        return path || null;
    },

    /**
     * Generate the most robust XPath for an element
     * Following priority order based on best practices
     */
    generateXPath: function (element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return null;
        }

        // Priority 1: ID attribute
        var xpath = this.getXPathByID(element);
        if (xpath) return xpath;

        // Priority 2: data-* test attributes
        xpath = this.getXPathByDataAttribute(element);
        if (xpath) return xpath;

        // Priority 3: name attribute (for form elements)
        xpath = this.getXPathByName(element);
        if (xpath) return xpath;

        // Priority 4: ARIA attributes
        xpath = this.getXPathByARIA(element);
        if (xpath) return xpath;

        // Priority 5: Text content
        xpath = this.getXPathByText(element);
        if (xpath) return xpath;

        // Priority 6: Position-based (last resort)
        xpath = this.getXPathByPosition(element);
        if (xpath) return xpath;

        // Fallback
        return '//' + element.tagName.toLowerCase();
    },

    /**
     * Verify that an XPath uniquely identifies an element
     */
    verifyXPath: function (xpath, expectedElement) {
        try {
            var result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            return result.singleNodeValue === expectedElement;
        } catch (e) {
            return false;
        }
    },

    /**
     * Check if an element is inside a Shadow DOM
     */
    isInShadowDOM: function (element) {
        var root = element.getRootNode();
        return root !== document && root instanceof ShadowRoot;
    },

    /**
     * Get the Shadow DOM path to an element
     * Returns array of shadow hosts from document to element
     */
    getShadowPath: function (element) {
        var path = [];
        var current = element;

        while (current) {
            var root = current.getRootNode();
            if (root instanceof ShadowRoot) {
                path.unshift(root.host);
                current = root.host;
            } else {
                break;
            }
        }

        return path;
    },

    /**
     * Generate XPath for an element within a specific context (not document)
     */
    generateXPathInContext: function (element, context) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return null;
        }

        // Try ID within shadow root
        var id = element.getAttribute('id');
        if (id) {
            return '//*[@id=' + this.escapeXPathString(id) + ']';
        }

        // Build relative path from shadow root
        var path = '';
        var current = element;

        while (current && current !== context) {
            var tagName = current.tagName.toLowerCase();
            var parent = current.parentNode;

            if (parent) {
                var siblings = parent.children;
                var sameTagSiblings = [];

                for (var i = 0; i < siblings.length; i++) {
                    if (siblings[i].tagName === current.tagName) {
                        sameTagSiblings.push(siblings[i]);
                    }
                }

                if (sameTagSiblings.length > 1) {
                    var index = sameTagSiblings.indexOf(current) + 1;
                    path = '/' + tagName + '[' + index + ']' + path;
                } else {
                    path = '/' + tagName + path;
                }
            }

            current = parent;
        }

        return path || '//' + element.tagName.toLowerCase();
    },

    /**
     * Generate XPath that works with Shadow DOM
     * Format: shadow-root:host-selector >> shadow-content-xpath
     */
    generateShadowDOMXPath: function (element) {
        if (!this.isInShadowDOM(element)) {
            return this.generateXPath(element);
        }

        var shadowPath = this.getShadowPath(element);
        var parts = [];

        // Add shadow host selectors
        // Use context-relative XPath for nested shadow hosts
        for (var i = 0; i < shadowPath.length; i++) {
            var host = shadowPath[i];
            var hostRoot = host.getRootNode();
            // If host is itself in a shadow root, use context-relative XPath
            var hostXPath = hostRoot instanceof ShadowRoot
                ? this.generateXPathInContext(host, hostRoot)
                : this.generateXPath(host);
            parts.push(hostXPath);
        }

        // Add the final element XPath within the shadow root
        var shadowRoot = element.getRootNode();
        var localXPath = this.generateXPathInContext(element, shadowRoot);
        parts.push(localXPath);

        // Combine with shadow-root delimiter
        return parts.join(' >> ');
    }
};