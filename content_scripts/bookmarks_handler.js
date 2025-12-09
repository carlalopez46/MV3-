/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/


// Ensure backwards compatibility for old iMacros bookmarklets
// embedded on web-pages. This requires utilities (imns) and the
// connector bridge to be available, but those scripts load later at
// document_idle. We therefore wait for the dependencies instead of
// failing immediately at document_start.

function waitForDependenciesAndInit() {
    const MAX_ATTEMPTS = 50;
    const RETRY_DELAY_MS = 100;
    let attempts = 0;
    let initialized = false;

    function hasDeps() {
        return typeof connector !== 'undefined' && typeof imns !== 'undefined';
    }

    function initHandlers() {
        if (initialized) return;
        initialized = true;

        // Handle macro execution requests posted by bookmarklets.
        window.addEventListener("iMacrosRunMacro", function (evt) {
            // console.log("iMacrosRunMacro event %O", evt);
            connector.postMessage("run-macro", evt.detail, null);
        }, true);

        // translate old m=... or m64=... bookmarklets to e_m64 type
        const processBookmarklets = function() {
            try {
                // evaluate XPath to find all anchor elements
                // with attribute href="javascript:..."
                var xpath = "//a[starts-with(@href, 'javascript:')]";
                var result = document.evaluate(xpath, document, null,
                                               XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
                var node = null, nodes = new Array();
                while (node = result.iterateNext()) {
                    nodes.push(node);
                }

                var im_strre = "(?:[^\"\\\\]|\\\\[0btnvfr\"\'\\\\])+";
                var re = new RegExp('^javascript\\:\\(function\\(\\) '+
                                    '\\{(?:try\\{)?var (m(?:64)?) = "('+im_strre+')"'+
                                    ', n = "('+im_strre+')";');
                nodes.forEach(function(x) {
                    var match = re.exec(x.href);
                    if (match) {
                        var source  = match[1] == "m" ?
                            decodeURIComponent(unwrap(match[2])) :
                            decodeURIComponent(atob(match[2]));
                        var name = match[3];

                        x.href = makeBookmarklet(name, source);
                    }
                });
            } catch (e) {
                console.error("[iMacros] bookmarklet handler failed:", e);
            }
        };

        // catches bookmarklet get/post requests (form submit or image source)
        // background script/iframe should place data into the temporary storage
        const processRequestAttributes = function() {
            try {
                var dst = document.documentElement;
                if (!dst) {
                    return;
                }

                var getVal = dst.getAttribute("data-e_m64") || dst.getAttribute("data-empzmnbuitleadcesegaustcm_64") || "";
                var postVal = dst.getAttribute("data-e_m") || dst.getAttribute("data-mgboikewtsucunot_64") || "";

                var macro = null;
                if (getVal !== "") {
                    macro = {
                        source: decodeURIComponent(atob(getVal)),
                        name: "Get request"
                    };
                } else if (postVal !== "") {
                    macro = {
                        source: decodeURIComponent(atob(postVal)),
                        name: "Post request"
                    };
                }

                if (!macro) {
                    return;
                }

                var evt = document.createEvent("CustomEvent");
                evt.initCustomEvent("iMacrosRunMacro", true, true, macro);
                window.dispatchEvent(evt);
            } catch (e) {
                console.error('[iMacros] Failed to process bookmarklet request attributes:', e);
            }
        };

        const runDeferredWork = function() {
            processBookmarklets();
            processRequestAttributes();
        };

        if (document.readyState === 'complete') {
            runDeferredWork();
        } else {
            window.addEventListener("load", runDeferredWork, true);
        }
    }

    if (hasDeps()) {
        initHandlers();
        return;
    }

    const timer = setInterval(() => {
        if (hasDeps()) {
            clearInterval(timer);
            initHandlers();
            return;
        }

        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
            clearInterval(timer);
            console.warn('[iMacros] bookmarks_handler could not find required globals (connector/imns); bookmarklet support is disabled for this page.');
        }
    }, RETRY_DELAY_MS);
}

waitForDependenciesAndInit();



// creates bookmarklet of new type 
function makeBookmarklet(name, content) {
    var pattern = "(function() {"+
        "try{"+
        "var e_m64 = \"{{macro}}\", n64 = \"{{name}}\";"+
        "if(!/^(?:chrome|https?|file)/.test(location)){"+
        "alert('iMacros: Open webpage to run a macro.');"+
        "return;"+
        "}"+
        "var macro = {};"+
        "macro.source = decodeURIComponent(atob(e_m64));"+
        "macro.name = decodeURIComponent(atob(n64));"+
        "var evt = document.createEvent(\"CustomEvent\");"+
        "evt.initCustomEvent(\"iMacrosRunMacro\", true, true, macro);"+
        "window.dispatchEvent(evt);"+
        "}catch(e){alert('iMacros Bookmarklet error: '+e.toString());}"+
        "}) ();";
    
    var macro_name = name || "Unnamed Macro", source = content;
    macro_name = btoa(encodeURIComponent(name));
    macro_name = imns.escapeLine(macro_name);
    pattern = pattern.replace("{{name}}", macro_name);
    source = btoa(encodeURIComponent(source));
    source = imns.escapeLine(source);
    pattern = pattern.replace("{{macro}}", source);
    
    var url = "javascript:" + pattern;

    return url;
}

// this is a stripped version of imns.unwrap() from utils.js
function unwrap(line) {
    var handleSequence = function(s) {
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
            return "\u0027"
        } else {
            // function to replace \x|u sequence
            var replaceChar = function (match_str, char_code) {
                return String.fromCharCode(parseInt("0x"+char_code));
            };
            if (/^\\x/.test(s))// replace \xXX by its value
                return s.replace(/\\x([\da-fA-F]{2})/g, replaceChar);
            else if (/^\\u/.test(s)) // replace \uXXXX by its value
                return s.replace(/\\u([\da-fA-F]{4})/g, replaceChar);
        }
    };

    var esc_re = new RegExp("\\\\(?:[0btnvfr\"\'\\\\]|x[\da-fA-F]{2}|u[\da-fA-F]{4})", "g");
    
    // replace escape sequences by their value
    line = line.replace(esc_re, handleSequence);
    
    return line;
}


