/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/


// a pattern to match a double quoted string or a non-whitespace char sequence
var im_strre = "(?:\"(?:[^\"\\\\]+|\\\\[0btnvfr\"\'\\\\])*\"|\\S*)";



var ClickHandler = {
    // check if the point is inside the element
    visibleElement: function (element) {
        return element.offsetWidth && element.offsetHeight;
    },


    withinElement: function (element, x, y) {
        var pos = this.getElementLUCorner(element);
        return (x >= pos.x && x <= pos.x + element.offsetWidth &&
            y >= pos.y && y <= pos.y + element.offsetHeight);

    },


    // find an innermost element which containts the point
    getInnermostElement: function (element, x, y) {
        var children = element.childNodes, tmp;

        for (var i = 0; i < children.length; i++) {
            if (children[i].nodeType != Node.ELEMENT_NODE)
                continue;
            if (this.visibleElement(children[i])) {
                if (this.withinElement(children[i], x, y)) {
                    return this.getInnermostElement(children[i], x, y);
                }
            } else {
                if (children[i].childNodes.length) {
                    tmp = this.getInnermostElement(children[i], x, y);
                    if (tmp != children[i])
                        return tmp;
                }
            }
        }

        return element;
    },


    // find an element specified by the coordinates
    getElementByXY: function (wnd, x, y) {
        throw new RuntimeError("getElementByXY is not supported in Chrome", 712);
    },


    // find element offset relative to its window
    calculateOffset: function (element) {
        var x = 0, y = 0;
        while (element) {
            x += element.offsetLeft;
            y += element.offsetTop;
            element = element.offsetParent;
        }
        return { x: x, y: y };
    },


    // find element position in the current content window
    getElementLUCorner: function (element) {
        var rect = element.getBoundingClientRect();
        // window in cr is already referring to element's frame
        // var win = element.ownerDocument.defaultView;
        var win = window;

        var doc = win.document;
        var doc_el = doc.documentElement;
        var body = doc.body;

        var clientTop = doc_el.clientTop ||
            (body && body.clientTop) || 0;

        var clientLeft = doc_el.clientLeft ||
            (body && body.clientLeft) || 0;

        var scrollX = win.scrollX || doc_el.scrollLeft ||
            (body && body.scrollLeft);

        var scrollY = win.scrollY || doc_el.scrollTop ||
            (body && body.scrollTop);

        var x = rect.left + scrollX - clientLeft;
        var y = rect.top + scrollY - clientTop;

        return { x: Math.round(x), y: Math.round(y) };
    },

    // find center of an element
    findElementPosition: function (element) {
        var pos = this.getElementLUCorner(element);
        pos.x += Math.round(element.offsetWidth / 2);
        pos.y += Math.round(element.offsetHeight / 2);
        return pos;
    }

};


// Note: This function is duplicated from recorder.js for content script isolation.
// Content scripts run in isolated contexts and cannot share utility functions
// directly without message passing overhead. Keep in sync with recorder.js version.
var escapeIdForSelector = id => {
    // HTML5 lessen restrictions on possible id values,
    // Based on the article http://mathiasbynens.be/notes/css-escapes

    // The following characters have a special meaning in CSS:
    id = id.replace(/([!"#$%&'()*+\.\/:;<=>?@\[\\\]^`{|}~])/g, '\\$1');
    // Escape leading digit character by its unicode value
    id = id.replace(/^(\d)/, '\\3$1 ');
    // The hyphen-minus character (-) only needs to be escaped if
    // it’s at the start of the identifier, and if it’s followed by
    // another hyphen-minus character or a digit from 0 to 9
    id = id.replace(/^-([0-9-])/, '\\-$1');
    // 3. Any characters matching [\t\n\v\f\r] need to be escaped based
    // on their Unicode code points.
    id = id.replace(/[\t\n\v\f\r]/g, function (s) {
        // Note: CSS selector escape syntax: backslash + character code + space.
        // This follows CSS spec for escaping control characters in selectors.
        // Example: tab (char code 9) becomes "\9 "
        return "\\" + s.charCodeAt(0).toString() + ' ';
    });

    return id;
}

var getSelectorForElement = (el, favorIds) => {
    // just walk up the tree until we find element with id or reach
    // HTML element
    var selector = "", temp = el;
    while (temp.parentNode) {
        if (temp.id && favorIds) {
            selector = "#" +
                imns.escapeLine(escapeIdForSelector(temp.id)) +
                (selector.length ? ">" + selector : "");
            return selector;
        }

        var siblings = temp.parentNode.childNodes, count = 0;
        for (var i = 0; i < siblings.length; i++) {
            if (siblings[i].nodeType != window.Node.ELEMENT_NODE)
                continue;
            if (siblings[i] == temp)
                break;
            if (siblings[i].tagName == temp.tagName)
                count++;
        }

        if (count) {
            selector = temp.tagName +
                ":nth-of-type(" + (count + 1) + ")" +
                (selector.length ? ">" + selector : "");
        } else {
            selector = temp.tagName +
                (selector.length ? ">" + selector : "");
        }

        temp = temp.parentNode;
    }

    return selector;
}

if (typeof FileInputElement === 'undefined') {
    window.FileInputElement = class FileInputElement {
        // Note: Multiple file selection is not currently supported in CONTENT parameter.
        // The current implementation assumes CONTENT defines a single file path.
        // For multiple file uploads, use multiple TAG commands with different files.
        constructor(element, txt, favorIds = false) {
            this.selector = getSelectorForElement(element, favorIds)
            this.files = [txt]
        }
    }
}

if (typeof ShouldDecryptPassword === 'undefined') {
    window.ShouldDecryptPassword = class ShouldDecryptPassword {
        constructor() {

        }
    }
}

// An object to find and process elements specified by TAG command
var TagHandler = {

    // Internal clipboard buffer for Ctrl+X/C/V operations during playback
    _clipboardBuffer: '',

    // Undo/Redo stacks for Ctrl+Z and Ctrl+Y operations
    _undoStack: [],
    _redoStack: [],

    // checks if the given node matches the atts
    match: function (node, atts) {
        var match = true;

        for (var at in atts) {
            if (at == "txt") {
                var txt = imns.escapeTextContent(node.textContent);
                if (!atts[at].exec(txt)) {
                    match = false; break;
                }
            } else {
                var atval = "", propval = "";
                // first check if the element has the <at> property 
                if (at in node) {
                    propval = node[at];
                } else if (at == "href" && "src" in node) {
                    // special case for old macros
                    // treat 'href' as 'src' 
                    propval = node.src;
                }
                // then check if the element has the <at> attribute
                if (node.hasAttribute(at)) {
                    atval = node.getAttribute(at);
                }
                // applay regexp to the values
                if (!(!!atts[at].exec(propval) || !!atts[at].exec(atval))) {
                    match = false; break;
                }
            }
        }
        return match;
    },

    // find element (relatively) starting from root/lastNode
    // with tagName and atts
    find: function (doc, root, pos, relative, tagName, atts, form_atts) {
        var xpath = "descendant-or-self", ctx = root, nodes = new Array();
        // construct xpath expression to get a set of nodes
        if (relative) {         // is positioning relative?
            xpath = pos > 0 ? "following" : "preceding";
            if (!(ctx = this.lastNode) || ctx.ownerDocument != doc)
                return (this.lastNode = null);
        }
        xpath += "::" + tagName;
        // evaluate XPath
        var result = doc.evaluate(xpath, ctx, null,
            XPathResult.ORDERED_NODE_ITERATOR_TYPE,
            null);
        var node = null;
        while (node = result.iterateNext()) {
            nodes.push(node);
        }

        // Set parameters for the search loop
        var count = 0, i, start, end, increment;
        if (pos > 0) {
            start = 0; end = nodes.length; increment = 1;
        } else if (pos < 0) {
            start = nodes.length - 1; end = -1; increment = -1;
        } else {
            throw new BadParameter("POS=<number> or POS=R<number>" +
                " where <number> is a non-zero integer", 1);
        }

        // check for NoFormName
        if (form_atts && form_atts["name"] &&
            form_atts["name"].exec("NoFormName"))
            form_atts = null;

        // loop over nodes
        for (i = start; i != end; i += increment) {
            // First check that all atts matches
            // if !atts then match elements with any attributes
            var match = atts ? this.match(nodes[i], atts) : true;
            // then check that the element's form matches form_atts
            if (match && form_atts && nodes[i].form)
                match = this.match(nodes[i].form, form_atts);
            if (match && ++count == Math.abs(pos)) {
                // success! return the node found
                return (this.lastNode = nodes[i]);
            }
        }

        return (this.lastNode = null);
    },



    // find element by XPath starting from root
    // Supports Shadow DOM with ">>" delimiter: host-xpath >> shadow-content-xpath
    findByXPath: function (doc, root, xpath) {
        // Check if this is a Shadow DOM XPath (contains >> outside string literals)
        var hasShadowDelimiter = false;
        for (var i = 0, inSingle = false, inDouble = false; i < xpath.length; i++) {
            var ch = xpath[i];
            if (ch === "'" && !inDouble) {
                inSingle = !inSingle;
            } else if (ch === '"' && !inSingle) {
                inDouble = !inDouble;
            } else if (!inSingle && !inDouble && xpath.substr(i, 4) === ' >> ') {
                hasShadowDelimiter = true;
                break;
            }
        }
        if (hasShadowDelimiter) {
            return this.findByXPathInShadowDOM(doc, xpath);
        }

        var nodes = new Array();
        // evaluate XPath
        try {
            var result = doc.evaluate(xpath, root, null,
                XPathResult.ORDERED_NODE_ITERATOR_TYPE,
                null);
            var node = null;
            while (node = result.iterateNext()) {
                nodes.push(node);
            }
        } catch (e) {
            throw new RuntimeError("incorrect XPath expression: " + xpath, 781);
        }
        if (nodes.length > 1)
            throw new RuntimeError("ambiguous XPath expression: " + xpath, 782);
        if (nodes.length == 1)
            return nodes[0];

        return null;
    },

    // find element by XPath within Shadow DOM
    // Format: host-xpath >> shadow-content-xpath [ >> nested-shadow-xpath ]
    findByXPathInShadowDOM: function (doc, shadowXPath) {
        // Parse >> delimiter while respecting quoted strings
        var parts = [];
        var buffer = "";
        for (var i = 0, inSingle = false, inDouble = false; i < shadowXPath.length; i++) {
            var ch = shadowXPath[i];
            if (ch === "'" && !inDouble) {
                inSingle = !inSingle;
            } else if (ch === '"' && !inSingle) {
                inDouble = !inDouble;
            }
            if (!inSingle && !inDouble && shadowXPath.substr(i, 4) === ' >> ') {
                parts.push(buffer.trim());
                buffer = "";
                i += 3; // Skip the ' >> ' delimiter
                continue;
            }
            buffer += ch;
        }
        parts.push(buffer.trim());

        var currentContext = doc;
        var currentElement = null;

        for (var i = 0; i < parts.length; i++) {
            var xpathPart = parts[i].trim();

            try {
                // Use document.evaluate for ShadowRoot/DocumentFragment compatibility
                var contextNode = currentContext.documentElement || currentContext;
                var evaluator = currentContext.evaluate ?
                    currentContext :
                    (currentContext.ownerDocument || doc);

                // Use iterator to detect ambiguous matches
                var result = evaluator.evaluate(
                    xpathPart,
                    contextNode,
                    null,
                    XPathResult.ORDERED_NODE_ITERATOR_TYPE,
                    null
                );

                var firstMatch = result.iterateNext();
                if (!firstMatch) {
                    // Return null instead of throwing to allow TAG/EXTRACT commands
                    // to properly return #EANF for missing elements
                    return null;
                }

                // Check for ambiguous matches
                if (result.iterateNext()) {
                    throw new RuntimeError(
                        "Ambiguous XPath expression in Shadow DOM: " + xpathPart,
                        782
                    );
                }

                currentElement = firstMatch;

                // If not the last part, navigate into shadow root
                if (i < parts.length - 1) {
                    if (!currentElement.shadowRoot) {
                        throw new RuntimeError(
                            "Element has no shadow root: " + xpathPart,
                            781
                        );
                    }
                    currentContext = currentElement.shadowRoot;
                }
            } catch (e) {
                if (e instanceof RuntimeError) {
                    throw e;
                }
                throw new RuntimeError(
                    "Incorrect Shadow DOM XPath expression: " + shadowXPath,
                    781
                );
            }
        }

        return currentElement;
    },

    // find element by CSS selector
    findByCSS: function (doc, selector) {
        try {
            var el = doc.querySelector(selector);

            if (el) {
                return el;
            }
        } catch (e) {
            throw new RuntimeError("incorrect CSS selector: " + selector, 783);
        }

        return null;
    },


    // Find element's position (for TAG recording)
    findPosition: function (element, atts, form_atts) {
        var xpath = "descendant-or-self::" + element.tagName;
        var doc = element.ownerDocument;
        var ctx = doc.documentElement;
        var nodes = new Array(), count = 0;
        // evaluate XPath
        try {
            var res = doc.evaluate(xpath, ctx, null,
                XPathResult.ORDERED_NODE_ITERATOR_TYPE,
                null);
            var node = null;
            while (node = res.iterateNext()) {
                nodes.push(node);
            }
        } catch (e) {
            console.error(e);
        }

        // check for NoFormName
        if (form_atts && form_atts["name"] &&
            form_atts["name"].exec("NoFormName"))
            form_atts = null;

        // loop over nodes
        for (var i = 0; i < nodes.length; i++) {
            // First check that all atts matches
            // if !atts then match elements with any attributes
            var match = atts ? this.match(nodes[i], atts) : true;
            // then check that the element's form matches form_atts
            if (match && form_atts && nodes[i].form)
                match = this.match(nodes[i].form, form_atts);
            if (match)
                count++;
            if (nodes[i] == element)
                break;
        }

        return count;
    },



    // handles EXTRACT=TXT|TXTALL|HTM|ALT|HREF|TITLE|CHECKED
    onExtractParam: function (tagName, element, extract_type) {
        var tmp = "", i;
        if (/^(txt|txtall)$/i.test(extract_type)) {
            tmp = RegExp.$1.toLowerCase();
            switch (tagName) {
                case "input": case "textarea":
                    return element.value;
                case "select":
                    if (tmp == "txtall") {
                        var s = new Array(), options = element.options;
                        for (i = 0; i < options.length; i++) {
                            s.push(options[i].text);
                        }
                        return s.join("[OPTION]");
                    } else {
                        // Note: For multi-select elements, only the first selected value is returned.
                        // This behavior follows iMacros convention. Use TXTALL for all selected values.
                        return element.value;
                    }
                case "table":
                    tmp = "";
                    for (i = 0; i < element.rows.length; i++) {
                        var row = element.rows[i], ar = new Array();
                        for (var j = 0; j < row.cells.length; j++)
                            ar.push(row.cells[j].textContent);
                        tmp += '"' + ar.join('","') + '"\n';
                    }
                    return tmp;
                default:
                    return element.textContent;
            }
        } else if (/^htm$/i.test(extract_type)) {
            tmp = element.outerHTML;
            tmp = tmp.replace(/[\t\n\r]/g, " ");
            return tmp;
        } else if (/^href$/i.test(extract_type)) {
            if ("href" in element)
                return element["href"];
            else if (element.hasAttribute("href"))
                return element.getAttribute("href");
            else if ("src" in element)
                return element["src"];
            else if (element.hasAttribute("src"))
                return element.getAttribute("src");
            else
                return "#EANF#";
        } else if (/^(title|alt)$/i.test(extract_type)) {
            tmp = RegExp.$1.toLowerCase();
            if (tmp in element)
                return element[tmp];
            else if (element.hasAttribute(tmp))
                return element.getAttribute(tmp);
            else
                return "#EANF#";
        } else if (/^checked$/i.test(extract_type)) {
            if (!/^(?:checkbox|radio)$/i.test(element.type))
                throw new BadParameter("EXTRACT=CHECKED makes sense" +
                    " only for check or radio boxes");
            return element.checked ? "YES" : "NO";
        } else {
            throw new BadParameter("EXTRACT=TXT|TXTALL|HTM|" +
                "TITLE|ALT|HREF|CHECKED", 5);
        }
    },


    // Dispatch special keys (like ${KEY_ENTER}) to the element
    dispatchSpecialKeys: function (element, text) {
        // Parse the text for special keys
        var parsedKeys = imns.SpecialKeys.parse(text);
        console.log("[DEBUG-PLAY] dispatchSpecialKeys parsed:", parsedKeys);

        for (var i = 0; i < parsedKeys.length; i++) {
            var item = parsedKeys[i];

            if (item.type === 'text') {
                // Regular text - insert at cursor position or append
                if (element.selectionStart !== undefined) {
                    var start = element.selectionStart;
                    var end = element.selectionEnd;
                    var val = element.value;
                    element.value = val.substring(0, start) + item.value + val.substring(end);
                    element.selectionStart = element.selectionEnd = start + item.value.length;
                } else {
                    element.value = element.value + item.value;
                }
                var inputEvent = new Event("input", { bubbles: true, cancelable: true });
                element.dispatchEvent(inputEvent);
            } else if (item.type === 'key') {
                // Handle special keys with actual DOM manipulation
                this.handleSpecialKeyAction(element, item.key, item.keyCode, item.modifiers);
            } else if (item.type === 'combo') {
                // Key combination with modifiers
                this.dispatchKeyCombo(element, item.keyCode, item.char, item.modifiers);
            }
        }
    },

    // Handle special key actions (actual DOM manipulation for navigation keys)
    handleSpecialKeyAction: function (element, keyName, keyCode, modifiers) {
        // Some input types (number, date, range, etc.) don't support selectionStart/End
        // and throw when accessing these properties
        var start, end, val;
        try {
            start = element.selectionStart;
            end = element.selectionEnd;
            val = element.value;
        } catch (e) {
            // For input types that don't support selection, just dispatch the event
            this.dispatchKeyEvent(element, keyCode, modifiers);
            return;
        }

        switch (keyName) {
            case 'KEY_ENTER':
                // Insert newline only for textarea (single-line inputs don't accept newlines)
                var isTextarea = element.tagName && element.tagName.toLowerCase() === 'textarea';
                if (isTextarea && start !== undefined && end !== undefined) {
                    element.value = val.substring(0, start) + '\n' + val.substring(end);
                    element.selectionStart = element.selectionEnd = start + 1;
                }
                break;

            case 'KEY_BACKSPACE':
                // Delete character before cursor
                if (start !== undefined && end !== undefined) {
                    if (start === end && start > 0) {
                        // No selection, delete one char before cursor
                        element.value = val.substring(0, start - 1) + val.substring(end);
                        element.selectionStart = element.selectionEnd = start - 1;
                    } else if (start !== end) {
                        // Delete selection
                        element.value = val.substring(0, start) + val.substring(end);
                        element.selectionStart = element.selectionEnd = start;
                    }
                }
                break;

            case 'KEY_DELETE':
                // Delete character after cursor
                if (start !== undefined && end !== undefined) {
                    if (start === end && start < val.length) {
                        // No selection, delete one char after cursor
                        element.value = val.substring(0, start) + val.substring(start + 1);
                        element.selectionStart = element.selectionEnd = start;
                    } else if (start !== end) {
                        // Delete selection
                        element.value = val.substring(0, start) + val.substring(end);
                        element.selectionStart = element.selectionEnd = start;
                    }
                }
                break;

            case 'KEY_LEFT':
                // Move cursor left (collapse selection first if present)
                if (start !== undefined && end !== undefined) {
                    if (start !== end) {
                        // Has selection - collapse to start
                        element.selectionStart = element.selectionEnd = start;
                    } else if (start > 0) {
                        // No selection - move left
                        element.selectionStart = element.selectionEnd = start - 1;
                    }
                }
                break;

            case 'KEY_RIGHT':
                // Move cursor right (collapse selection first if present)
                if (start !== undefined && end !== undefined) {
                    if (start !== end) {
                        // Has selection - collapse to end
                        element.selectionStart = element.selectionEnd = end;
                    } else if (end < val.length) {
                        // No selection - move right
                        element.selectionStart = element.selectionEnd = end + 1;
                    }
                }
                break;

            case 'KEY_UP':
            case 'KEY_DOWN':
                // For multi-line text (textarea), calculate line-based movement
                // For simplicity, just dispatch the event and let browser handle it
                this.dispatchKeyEvent(element, keyCode, modifiers);
                return;

            case 'KEY_HOME':
                // Move cursor to start
                if (start !== undefined) {
                    element.selectionStart = element.selectionEnd = 0;
                }
                break;

            case 'KEY_END':
                // Move cursor to end
                if (val !== undefined) {
                    element.selectionStart = element.selectionEnd = val.length;
                }
                break;
        }

        // Dispatch the keyboard event as well
        this.dispatchKeyEvent(element, keyCode, modifiers);

        // Trigger input/change events for value changes
        if (keyName === 'KEY_BACKSPACE' || keyName === 'KEY_DELETE' || keyName === 'KEY_ENTER') {
            var inputEvent = new Event("input", { bubbles: true, cancelable: true });
            element.dispatchEvent(inputEvent);
        }
    },

    // Dispatch a single key event
    dispatchKeyEvent: function (element, keyCode, modifiers) {
        var doc = element.ownerDocument;
        var defaultModifiers = modifiers || { ctrl: false, shift: false, alt: false, meta: false };

        // Dispatch keydown using modern KeyboardEvent constructor
        var keydownEvent = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            view: doc.defaultView,
            keyCode: keyCode,
            which: keyCode,
            ctrlKey: defaultModifiers.ctrl,
            altKey: defaultModifiers.alt,
            shiftKey: defaultModifiers.shift,
            metaKey: defaultModifiers.meta
        });
        element.dispatchEvent(keydownEvent);

        // Dispatch keyup using modern KeyboardEvent constructor
        var keyupEvent = new KeyboardEvent("keyup", {
            bubbles: true,
            cancelable: true,
            view: doc.defaultView,
            keyCode: keyCode,
            which: keyCode,
            ctrlKey: defaultModifiers.ctrl,
            altKey: defaultModifiers.alt,
            shiftKey: defaultModifiers.shift,
            metaKey: defaultModifiers.meta
        });
        element.dispatchEvent(keyupEvent);
    },

    // Dispatch a key combination (e.g., Ctrl+A)
    dispatchKeyCombo: function (element, keyCode, char, modifiers) {
        console.log("[DEBUG-PLAY] dispatchKeyCombo:", { keyCode, char, modifiers });
        var doc = element.ownerDocument;

        // Handle common keyboard shortcuts manually since browser won't execute them
        // when dispatched from JavaScript (security restriction)
        var charUpper = (char || '').toUpperCase();
        var isTextInput = element.tagName &&
            (/^(input|textarea)$/i.test(element.tagName)) &&
            (element.tagName.toLowerCase() === 'textarea' ||
                /^(text|password|email|search|url|tel)$/i.test(element.type));

        var isTextarea = element.tagName && element.tagName.toLowerCase() === 'textarea';
        var handled = false;

        // Helper function to get selection safely
        var getSelection = function () {
            try {
                return {
                    start: element.selectionStart,
                    end: element.selectionEnd,
                    value: element.value || ''
                };
            } catch (e) {
                return null;
            }
        };

        // Helper function to set selection safely
        var setSelection = function (start, end) {
            try {
                element.selectionStart = start;
                element.selectionEnd = end !== undefined ? end : start;
            } catch (e) {
                // Ignore errors for input types that don't support selection
            }
        };

        // Helper function to find word boundaries
        var findWordBoundary = function (text, pos, direction) {
            if (direction === 'left') {
                if (pos <= 0) return 0;
                var i = pos - 1;
                // Skip whitespace
                while (i > 0 && /\s/.test(text[i])) i--;
                // Skip word characters
                while (i > 0 && !/\s/.test(text[i - 1])) i--;
                return i;
            } else { // right
                if (pos >= text.length) return text.length;
                var i = pos;
                // Skip word characters
                while (i < text.length && !/\s/.test(text[i])) i++;
                // Skip whitespace
                while (i < text.length && /\s/.test(text[i])) i++;
                return i;
            }
        };

        // Helper function to find line boundaries (for textarea)
        var findLineBoundary = function (text, pos, direction) {
            if (direction === 'start') {
                var i = pos;
                while (i > 0 && text[i - 1] !== '\n') i--;
                return i;
            } else { // end
                var i = pos;
                while (i < text.length && text[i] !== '\n') i++;
                return i;
            }
        };

        if (isTextInput) {
            var sel = getSelection();
            if (sel) {
                var val = sel.value;
                var start = sel.start;
                var end = sel.end;

                // ============================================================
                // Ctrl + Key combinations (no Shift, no Alt)
                // ============================================================
                if (modifiers.ctrl && !modifiers.shift && !modifiers.alt) {
                    switch (charUpper) {
                        case 'A': // Select All
                            if (typeof element.select === 'function') {
                                element.select();
                                console.log("[DEBUG-PLAY] Ctrl+A - Selected all text");
                                handled = true;
                            }
                            break;

                        case 'X': // Cut
                            if (start !== end) {
                                // Save to undo stack before modifying
                                this._undoStack.push({ value: val, start: start, end: end });
                                this._redoStack = []; // Clear redo on new action
                                var selectedText = val.substring(start, end);
                                this._clipboardBuffer = selectedText;
                                element.value = val.substring(0, start) + val.substring(end);
                                setSelection(start);
                                element.dispatchEvent(new Event("input", { bubbles: true }));
                                console.log("[DEBUG-PLAY] Ctrl+X - Cut text:", selectedText);
                                handled = true;
                            }
                            break;

                        case 'C': // Copy
                            if (start !== end) {
                                var selectedText = val.substring(start, end);
                                this._clipboardBuffer = selectedText;
                                console.log("[DEBUG-PLAY] Ctrl+C - Copied text:", selectedText);
                                handled = true;
                            }
                            break;

                        case 'V': // Paste
                            if (this._clipboardBuffer) {
                                // Save to undo stack before modifying
                                this._undoStack.push({ value: val, start: start, end: end });
                                this._redoStack = []; // Clear redo on new action
                                element.value = val.substring(0, start) + this._clipboardBuffer + val.substring(end);
                                setSelection(start + this._clipboardBuffer.length);
                                element.dispatchEvent(new Event("input", { bubbles: true }));
                                console.log("[DEBUG-PLAY] Ctrl+V - Pasted text:", this._clipboardBuffer);
                                handled = true;
                            }
                            break;

                        case 'Z': // Undo
                            if (this._undoStack && this._undoStack.length > 0) {
                                this._redoStack = this._redoStack || [];
                                this._redoStack.push({ value: val, start: start, end: end });
                                var undoState = this._undoStack.pop();
                                element.value = undoState.value;
                                setSelection(undoState.start, undoState.end);
                                element.dispatchEvent(new Event("input", { bubbles: true }));
                                console.log("[DEBUG-PLAY] Ctrl+Z - Undo");
                                handled = true;
                            }
                            break;

                        case 'Y': // Redo
                            if (this._redoStack && this._redoStack.length > 0) {
                                this._undoStack = this._undoStack || [];
                                this._undoStack.push({ value: val, start: start, end: end });
                                var redoState = this._redoStack.pop();
                                element.value = redoState.value;
                                setSelection(redoState.start, redoState.end);
                                element.dispatchEvent(new Event("input", { bubbles: true }));
                                console.log("[DEBUG-PLAY] Ctrl+Y - Redo");
                                handled = true;
                            }
                            break;
                    }

                    // Ctrl + Navigation keys
                    if (keyCode === 36) { // Ctrl+Home - Go to beginning
                        setSelection(0);
                        console.log("[DEBUG-PLAY] Ctrl+Home - Moved to beginning");
                        handled = true;
                    } else if (keyCode === 35) { // Ctrl+End - Go to end
                        setSelection(val.length);
                        console.log("[DEBUG-PLAY] Ctrl+End - Moved to end");
                        handled = true;
                    } else if (keyCode === 37) { // Ctrl+Left - Move word left
                        var newPos = findWordBoundary(val, start, 'left');
                        setSelection(newPos);
                        console.log("[DEBUG-PLAY] Ctrl+Left - Moved word left");
                        handled = true;
                    } else if (keyCode === 39) { // Ctrl+Right - Move word right
                        var newPos = findWordBoundary(val, end, 'right');
                        setSelection(newPos);
                        console.log("[DEBUG-PLAY] Ctrl+Right - Moved word right");
                        handled = true;
                    } else if (keyCode === 8) { // Ctrl+Backspace - Delete word before cursor
                        if (start === end && start > 0) {
                            // Save to undo stack before modifying
                            this._undoStack.push({ value: val, start: start, end: end });
                            this._redoStack = [];
                            var wordStart = findWordBoundary(val, start, 'left');
                            element.value = val.substring(0, wordStart) + val.substring(start);
                            setSelection(wordStart);
                            element.dispatchEvent(new Event("input", { bubbles: true }));
                            console.log("[DEBUG-PLAY] Ctrl+Backspace - Deleted word before cursor");
                            handled = true;
                        }
                    } else if (keyCode === 46) { // Ctrl+Delete - Delete word after cursor
                        if (start === end && start < val.length) {
                            // Save to undo stack before modifying
                            this._undoStack.push({ value: val, start: start, end: end });
                            this._redoStack = [];
                            var wordEnd = findWordBoundary(val, start, 'right');
                            element.value = val.substring(0, start) + val.substring(wordEnd);
                            setSelection(start);
                            element.dispatchEvent(new Event("input", { bubbles: true }));
                            console.log("[DEBUG-PLAY] Ctrl+Delete - Deleted word after cursor");
                            handled = true;
                        }
                    }
                }

                // ============================================================
                // Shift + Key combinations (no Ctrl, no Alt) - Selection
                // ============================================================
                if (modifiers.shift && !modifiers.ctrl && !modifiers.alt) {
                    if (keyCode === 36) { // Shift+Home - Select to beginning of line
                        var lineStart = isTextarea ? findLineBoundary(val, start, 'start') : 0;
                        setSelection(lineStart, end);
                        console.log("[DEBUG-PLAY] Shift+Home - Selected to line start");
                        handled = true;
                    } else if (keyCode === 35) { // Shift+End - Select to end of line
                        var lineEnd = isTextarea ? findLineBoundary(val, end, 'end') : val.length;
                        setSelection(start, lineEnd);
                        console.log("[DEBUG-PLAY] Shift+End - Selected to line end");
                        handled = true;
                    } else if (keyCode === 37) { // Shift+Left - Extend selection left
                        if (start > 0) {
                            setSelection(start - 1, end);
                            console.log("[DEBUG-PLAY] Shift+Left - Extended selection left");
                            handled = true;
                        }
                    } else if (keyCode === 39) { // Shift+Right - Extend selection right
                        if (end < val.length) {
                            setSelection(start, end + 1);
                            console.log("[DEBUG-PLAY] Shift+Right - Extended selection right");
                            handled = true;
                        }
                    } else if (keyCode === 38 && isTextarea) { // Shift+Up - Extend selection up (textarea)
                        // Simplified: just dispatch event for complex line logic
                        handled = false;
                    } else if (keyCode === 40 && isTextarea) { // Shift+Down - Extend selection down (textarea)
                        handled = false;
                    }
                }

                // ============================================================
                // Ctrl + Shift + Key combinations - Select word/all
                // ============================================================
                if (modifiers.ctrl && modifiers.shift && !modifiers.alt) {
                    if (keyCode === 36) { // Ctrl+Shift+Home - Select to beginning of document
                        setSelection(0, end);
                        console.log("[DEBUG-PLAY] Ctrl+Shift+Home - Selected to document start");
                        handled = true;
                    } else if (keyCode === 35) { // Ctrl+Shift+End - Select to end of document
                        setSelection(start, val.length);
                        console.log("[DEBUG-PLAY] Ctrl+Shift+End - Selected to document end");
                        handled = true;
                    } else if (keyCode === 37) { // Ctrl+Shift+Left - Select word left
                        var newStart = findWordBoundary(val, start, 'left');
                        setSelection(newStart, end);
                        console.log("[DEBUG-PLAY] Ctrl+Shift+Left - Selected word left");
                        handled = true;
                    } else if (keyCode === 39) { // Ctrl+Shift+Right - Select word right
                        var newEnd = findWordBoundary(val, end, 'right');
                        setSelection(start, newEnd);
                        console.log("[DEBUG-PLAY] Ctrl+Shift+Right - Selected word right");
                        handled = true;
                    } else if (charUpper === 'Z') { // Ctrl+Shift+Z - Redo (alternative)
                        if (this._redoStack && this._redoStack.length > 0) {
                            this._undoStack = this._undoStack || [];
                            this._undoStack.push({ value: val, start: start, end: end });
                            var redoState = this._redoStack.pop();
                            element.value = redoState.value;
                            setSelection(redoState.start, redoState.end);
                            element.dispatchEvent(new Event("input", { bubbles: true }));
                            console.log("[DEBUG-PLAY] Ctrl+Shift+Z - Redo");
                            handled = true;
                        }
                    }
                }

                // ============================================================
                // Home/End without modifiers - Line navigation
                // ============================================================
                if (!modifiers.ctrl && !modifiers.shift && !modifiers.alt) {
                    if (keyCode === 36) { // Home - Go to beginning of line
                        var lineStart = isTextarea ? findLineBoundary(val, start, 'start') : 0;
                        setSelection(lineStart);
                        console.log("[DEBUG-PLAY] Home - Moved to line start");
                        handled = true;
                    } else if (keyCode === 35) { // End - Go to end of line
                        var lineEnd = isTextarea ? findLineBoundary(val, end, 'end') : val.length;
                        setSelection(lineEnd);
                        console.log("[DEBUG-PLAY] End - Moved to line end");
                        handled = true;
                    }
                }

                // ============================================================
                // Alt + Key combinations (for some special operations)
                // ============================================================
                if (modifiers.alt && !modifiers.ctrl && !modifiers.shift) {
                    // Alt combinations are typically browser-specific, dispatch as-is
                    handled = false;
                }
            }
        }

        // Also dispatch the keyboard events for any JavaScript handlers listening
        // Dispatch keydown using modern KeyboardEvent constructor
        var keydownEvent = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            view: doc.defaultView,
            key: char || "",
            keyCode: keyCode,
            which: keyCode,
            ctrlKey: modifiers.ctrl,
            altKey: modifiers.alt,
            shiftKey: modifiers.shift,
            metaKey: modifiers.meta
        });
        var dispatched = element.dispatchEvent(keydownEvent);
        console.log("[DEBUG-PLAY] keydown dispatched. Result:", dispatched, "handled:", handled);

        // Note: keypress event is deprecated and removed

        // Dispatch keyup using modern KeyboardEvent constructor
        var keyupEvent = new KeyboardEvent("keyup", {
            bubbles: true,
            cancelable: true,
            view: doc.defaultView,
            key: char || "",
            keyCode: keyCode,
            which: keyCode,
            ctrlKey: modifiers.ctrl,
            altKey: modifiers.alt,
            shiftKey: modifiers.shift,
            metaKey: modifiers.meta
        });
        element.dispatchEvent(keyupEvent);
    },

    // handles CONTENT=...
    onContentParam: function (tagName, element, args) {
        console.log("[DEBUG-PLAY] onContentParam called for:", tagName, "Content:", args.txt);
        var tmp;
        // fire "focus" event
        this.htmlFocusEvent(element);

        // Check if text contains special keys
        var hasSpecialKeys = args.txt && /\$\{KEY_[^}]+\}/i.test(args.txt);
        console.log("[DEBUG-PLAY] hasSpecialKeys:", hasSpecialKeys);

        switch (tagName) {
            case "select":
                // <select> element has special content semantic
                // so let the function handle it
                this.handleSelectElement(element, args);
                this.htmlChangeEvent(element);
                break;
            case "input":
                switch (element.type) {
                    case "file":
                        throw new FileInputElement(element, args.txt)
                        break;
                    case "text": case "hidden":
                    // HTML5 types
                    case "color": case "date": case "datetime":
                    case "datetime-local": case "email": case "month":
                    case "number": case "range": case "search":
                    case "tel": case "time": case "url": case "week":
                        if (hasSpecialKeys) {
                            // Clear the field first
                            element.value = '';
                            this.dispatchSpecialKeys(element, args.txt);
                        } else {
                            element.value = args.txt;
                        }
                        this.htmlChangeEvent(element);
                        break;
                    case "password":
                        if (!args.passwordDecrypted)
                            throw new ShouldDecryptPassword()
                        if (hasSpecialKeys) {
                            // Clear the field first
                            element.value = '';
                            this.dispatchSpecialKeys(element, args.txt);
                        } else {
                            this.handlePasswordElement(element, args.txt);
                        }
                        this.htmlChangeEvent(element);
                        break;
                    case "checkbox":
                        if (/^(?:true|yes|on)$/i.test(args.txt)) {
                            if (!element.checked)
                                element.click();
                        } else {
                            if (element.checked)
                                element.click();
                        }
                        break;
                    default:
                        // click on button-like elements
                        this.simulateClick(element);
                }
                break;
            case "button":
                this.simulateClick(element);
                break;
            case "textarea":
                if (hasSpecialKeys) {
                    // Clear the field first
                    element.value = '';
                    this.dispatchSpecialKeys(element, args.txt);
                } else {
                    element.value = args.txt;
                }
                this.htmlChangeEvent(element);
                break;
            default:
                // there is not much to do with other elements
                // let's try to click it
                this.simulateClick(element);
        }
        // fire "blur" event
        this.htmlBlurEvent(element);
    },


    // process <select> element
    handleSelectElement: function (element, args) {
        var options = element.options;

        // remove selection if any
        if (element.multiple)
            element.options.selectedIndex = -1;

        if (args.cdata.type != "select")
            throw new RuntimeError(
                "Unable to select entry(ies) specified by: " +
                args.rawdata, 725);

        if (args.cdata.seltype == "all") {
            // select all tags
            for (var j = 0; j < options.length; j++)
                options[j].selected = true;
            return;
        }

        if (args.cdata.seltype == "multiple") // multiple selection
            element.multiple = true;

        for (var i = 0; i < args.cdata.opts.length; i++) {
            switch (args.cdata.opts[i].typ) {
                case "$": case "%":
                    var re = new RegExp(args.cdata.opts[i].re_str, "i");
                    var found = false;
                    for (var j = 0; j < options.length; j++) {
                        var o = options[j];
                        var s = (args.cdata.opts[i].typ == "$") ?
                            imns.escapeTextContent(o.text) : o.value;
                        if (re.exec(s)) {
                            found = true;
                            options[j].selected = true;
                            break;
                        }
                    }
                    if (!found) {
                        throw new RuntimeError(
                            "Entry [" + args.cdata.opts[i].str + "] not available" +
                            " [Box has " + options.length + " entries]", 725);
                    }
                    break;
                case "#": // index
                    if (args.cdata.opts[i].idx > element.length)
                        throw new RuntimeError(
                            "Entry with index " + args.cdata.opts[i].idx +
                            " not available [Box has " + element.length +
                            " entries]", 724);
                    options[args.cdata.opts[i].idx - 1].selected = true;
                    break;
            }
        }
    },

    // process <input type="password"/> element
    handlePasswordElement: function (element, content) {
        element.value = content;
    },

    // simulate mouse click on the element
    simulateClick: function (element) {
        if (typeof (element.click) == "function") {
            element.click();
        } else {
            var initEvent = function (e, d, typ) {
                e.initMouseEvent(typ, true, true, d.defaultView, 1, 0, 0, 0, 0,
                    false, false, false, false, 0, null);
            };
            var stop = function (e) { e.stopPropagation(); };

            var doc = element.ownerDocument, x;
            var events = {
                "mouseover": null,
                "mousedown": null,
                "mouseup": null,
                "click": null
            };

            element.addEventListener("mouseover", stop, false);
            element.addEventListener("mouseout", stop, false);

            for (x in events) {
                events[x] = doc.createEvent("MouseEvent");
                initEvent(events[x], doc, x);
                element.dispatchEvent(events[x]);
            }
        }
    },

    // dispatch HTML "change" event to the element
    htmlChangeEvent: function (element) {
        if (!/^(?:input|select|textarea)$/i.test(element.tagName))
            return;
        var evt = element.ownerDocument.createEvent("Event");
        evt.initEvent("change", true, false);
        element.dispatchEvent(evt);
    },

    // dispatch HTML focus event
    htmlFocusEvent: function (element) {
        if (!/^(?:a|area|label|input|select|textarea|button)$/i.
            test(element.tagName))
            return;
        var evt = element.ownerDocument.createEvent("Event");
        evt.initEvent("focus", false, false);
        element.dispatchEvent(evt);
    },

    // dispatch HTML blur event
    htmlBlurEvent: function (element) {
        if (!/^(?:a|area|label|input|select|textarea|button)$/i.
            test(element.tagName))
            return;
        var evt = element.ownerDocument.createEvent("Event");
        evt.initEvent("blur", false, false);
        element.dispatchEvent(evt);
    }

};



function CSPlayer() {
    this.registerHandlers();
}


CSPlayer.prototype.registerHandlers = function () {
    console.log("[iMacros MV3] Registering CSPlayer handlers");
    connector.registerHandler("tag-command",
        this.handleTagCommand.bind(this));
    connector.registerHandler("refresh-command",
        this.handleRefreshCommand.bind(this));
    connector.registerHandler("back-command",
        this.handleBackCommand.bind(this));
    connector.registerHandler("prompt-command",
        this.handlePromptCommand.bind(this));
    connector.registerHandler("saveas-command",
        this.handleSaveAsCommand.bind(this));
    connector.registerHandler("search-command",
        this.handleSearchCommand.bind(this));
    connector.registerHandler("image-search-command",
        this.handleImageSearchCommand.bind(this));
    connector.registerHandler("frame-command",
        this.handleFrameCommand.bind(this));
    connector.registerHandler("tab-command",
        this.handleTabCommand.bind(this));
    connector.registerHandler("stop-replaying",
        this.onStopReplaying.bind(this));
    connector.registerHandler("query-page-dimensions",
        this.onQueryPageDimensions.bind(this));
    connector.registerHandler("webpage-scroll-to",
        this.onWebPageScrollTo.bind(this));
    connector.registerHandler("webpage-hide-scrollbars",
        this.onHideScrollbars.bind(this));
    connector.addHandler("activate-element",
        this.onActivateElement.bind(this));
    connector.addHandler("query-css-selector",
        this.onQueryCssSelector.bind(this));
    window.addEventListener("error", function (err) {
        var obj = {
            name: "ScriptError",
            message: err.message + " on " + err.filename + ":" + err.lineno
        }
        connector.postMessage("error-occurred", obj);
    });
    console.log("[iMacros MV3] CSPlayer handlers registered successfully");
};


CSPlayer.prototype.handleRefreshCommand = function (args, callback) {
    if (callback)
        callback();
    window.location.reload();
};

CSPlayer.prototype.handleBackCommand = function (args, callback) {
    if (callback)
        callback();
    history.back();
};


CSPlayer.prototype.handlePromptCommand = function (args, callback) {
    var retobj = { varnum: args.varnum, varname: args.varname };
    if (typeof (args.varnum) != "undefined" ||
        typeof (args.varname) != "undefined") {
        // Note: JavaScript's prompt() returns null when cancelled, but iMacros
        // treats this as an empty string. There's no standard way to distinguish
        // between cancel and empty input without a custom dialog.
        retobj.value = prompt(args.text, args.defval);
    } else {
        alert(args.text);
    }
    callback(retobj);
};

CSPlayer.prototype.handleFrameCommand = function (args, callback) {
    // find frame by number
    var findFrame = function (win, obj) {
        var frames = win.frames, i, f;
        for (i = 0; i < frames.length; i++) {
            var dv = frames[i];
            if (--obj.num == 0) {
                return frames[i];
            } else if (f = findFrame(dv, obj))
                return f;
        }
        return null;
    };

    // find frame by name
    var findFrameByName = function (win, name) {
        var frames = win.frames, i, f;
        for (var i = 0; i < frames.length; i++) {
            var dv = frames[i];
            if (name.test(frames[i].name))
                return frames[i];
            else if (f = findFrameByName(dv, name))
                return f;
        }
        return null;
    };

    var f = null;
    if (typeof (args.number) == "number") {
        f = findFrame(window, { num: args.number });
    } else if (args.name) {
        var name_re = new RegExp("^" + args.name.replace(/\*/g, ".*") + "$");
        f = findFrameByName(window, name_re);
    }
    // console.log("handleFrame: args=%O, frame %s", args,
    //            (f? "found" : "not found"));
    callback(f ? { frame: args } : {});
};

// currently the main purpouse of the handler is remove
// highlight div if present
CSPlayer.prototype.handleTabCommand = function (args, callback) {
    if (callback)
        callback();
    var hl_div = document.getElementById("imacros-highlight-div");
    if (hl_div) {
        (hl_div.parentNode || hl_div.ownerDocument).
            removeChild(hl_div);
    }
};

// currently the main purpouse of the handler is remove
// highlight div if present
CSPlayer.prototype.onStopReplaying = function (args, callback) {
    if (callback)
        callback();
    var hl_div = document.getElementById("imacros-highlight-div");
    if (hl_div) {
        (hl_div.parentNode || hl_div.ownerDocument).
            removeChild(hl_div);
    }
};


CSPlayer.prototype.highlightElement = function (element) {
    var doc = element.ownerDocument;
    var hl_div = doc.getElementById("imacros-highlight-div");
    var hl_img = null;
    if (!hl_div) {
        // Note: Inline styles are used instead of external CSS to avoid CSP issues
        // and ensure the highlight works on all pages without additional file injection.
        hl_div = doc.createElement("div");
        hl_div.id = "imacros-highlight-div";
        hl_div.style.position = "absolute";
        hl_div.style.zIndex = 1000;
        hl_div.style.border = "1px solid blue";
        hl_div.style.borderRadius = "2px";
        hl_img = doc.createElement("div");
        hl_img.style.display = "block";
        hl_img.style.width = "24px";
        hl_img.style.height = "24px";
        hl_img.style.backgroundImage =
            "url('" + chrome.runtime.getURL("skin/logo24.png") + "')";
        hl_img.style.pointerEvents = "none"
        hl_div.appendChild(hl_img);
        doc.body.appendChild(hl_div);
    } else {
        hl_img = hl_div.firstChild;
    }
    var rect = element.getBoundingClientRect();
    var scrollX = doc.defaultView.scrollX;
    var scrollY = doc.defaultView.scrollY;
    hl_div.style.left = Math.round(rect.left - 1 + scrollX) + "px";
    hl_div.style.top = Math.round(rect.top - 1 + scrollY) + "px";
    hl_div.style.width = Math.round(rect.width) + "px";
    hl_div.style.height = Math.round(rect.height) + "px";
    // position image 
    if (rect.top > 26) {
        hl_img.style.marginLeft = "4px";
        hl_img.style.marginTop = "-26px";
    } else if (rect.bottom + 26 < doc.body.clientHeight) {
        hl_img.style.marginLeft = "4px";
        hl_img.style.marginBottom = "-26px";
    } else if (rect.left > 26) {
        hl_img.style.marginLeft = "-26px";
        hl_img.style.marginTop = "4px";
    } else if (rect.right + 26 < doc.body.clientWidth) {
        hl_img.style.marginRight = "-26px";
        hl_img.style.marginTop = "4px";
    } else {
        hl_img.style.marginLeft = "0px";
        hl_img.style.marginTop = "0px";
    }

    return hl_div;
};


CSPlayer.prototype.handleTagCommand = function (args, callback) {
    var doc = window.document;
    var root = doc.documentElement;
    var element;

    var retobj = {
        found: false,       // element found
        extract: "",        // extract string if any
        error: null         // error message or code
    };
    // console.info("playing tag comand args=%O on page=%s", args,
    //              window.location.toString());
    try {
        // compile regexps for atts and form
        if (args.atts)
            for (var x in args.atts)
                args.atts[x] = new RegExp(args.atts[x], "i");
        if (args.form)
            for (var x in args.form)
                args.form[x] = new RegExp(args.form[x], "i");

        if (args.xpath)
            element = TagHandler.findByXPath(doc, root, args.xpath);
        else if (args.selector)
            element = TagHandler.findByCSS(doc, args.selector);
        else
            element = TagHandler.find(doc, root, args.pos, args.relative,
                args.tagName, args.atts, args.form);
        let is_fail_if_found = (args.type == "content" && args.cdata.type == "event" && args.cdata.etype == "fail_if_found");
        if (!element) {
            if (!is_fail_if_found) {
                var descriptor;

                if (args.atts_str)
                    descriptor = args.atts_str;
                else if (args.xpath)
                    descriptor = args.xpath;
                else
                    descriptor = args.selector;

                var msg = "element " + args.tagName.toUpperCase() +
                    " specified by " + descriptor +
                    " was not found";
                if (args.type == "extract") {
                    retobj.extract = "#EANF#";
                }
                else {
                    retobj.error = normalize_error(new RuntimeError(msg, 721));
                }
            } else {
                retobj.found = true;
            }
            callback(retobj);
            return;
        }
        retobj.found = true;
        // scroll to the element
        if (args.scroll) {
            var pos = ClickHandler.findElementPosition(element);
            window.scrollTo(pos.x - 100, pos.y - 100);
        }

        // make it blue
        if (args.highlight) {
            this.highlightElement(element);
        }

        if (args.tagName == "*" || args.tagName == "")
            args.tagName = element.tagName.toLowerCase();
        // extract
        if (args.type == "extract") {
            retobj.extract =
                TagHandler.onExtractParam(args.tagName, element, args.txt);
        } else if (args.type == "content") {
            if (args.cdata.type == "event") {
                switch (args.cdata.etype) {
                    case "saveitem": case "savepictureas":
                    case "savetargetas": case "savetarget":
                        var e = element;
                        while (e && e.nodeType == e.ELEMENT_NODE &&
                            !(e.hasAttribute("href") || e.hasAttribute("src"))
                        )
                            e = e.parentNode;
                        if (!e || e.nodeType != e.ELEMENT_NODE) {
                            retobj.error = normalize_error(new RuntimeError(
                                "Can not find link to save target", 723
                            ));
                            break;
                        }
                        retobj.targetURI = e.href || e.src;
                        break;
                    case "mouseover":
                        var evt = doc.createEvent("MouseEvent");
                        evt.initMouseEvent("mouseover", true, true,
                            doc.defaultView, 0, 0, 0, 0, 0,
                            false, false, false, false, 0, null);
                        element.dispatchEvent(evt);
                        break;
                    case "fail_if_found":
                        retobj.error = normalize_error(
                            new RuntimeError("FAIL_IF_FOUND event", 790)
                        );
                        break;
                    default:
                        retobj.error = normalize_error(
                            new Error("Unknown event type " +
                                args.cdata.etype.toUpperCase())
                        );
                }
            } else {
                TagHandler.onContentParam(args.tagName, element, args);
            }
        } else {
            if (args.download_pdf &&
                element.tagName == "A"
                && /\.pdf$/i.test(element.href)) {
                retobj.targetURI = element.href;
            } else {
                TagHandler.onContentParam(args.tagName, element, args);
            }
        }
    } catch (e) {
        if (e instanceof FileInputElement) {
            retobj.found = true
            retobj.selector = e.selector
            retobj.files = e.files
        } else if (e instanceof ShouldDecryptPassword) {
            retobj.found = true
            retobj.decryptPassword = true
        } else {
            retobj.error = normalize_error(e);
            console.error(e);
        }
    } finally {
        // console.log("handleTagCommand, retobj=%O", retobj);
        callback(retobj);
    }
};



CSPlayer.prototype.handleSaveAsCommand = function (args, callback) {
    if (args.type == "htm") {
        callback(document.documentElement.outerHTML);
    } else if (args.type == "txt") {
        callback(document.documentElement.innerText);
    }
};



CSPlayer.prototype.handleSearchCommand = function (args, callback) {
    var search_re, retobj = { found: false }, query = args.query;
    try {
        switch (args.type) {
            case "txt":
                // escape all chars which are of special meaning in regexp
                query = imns.escapeREChars(query);
                // replace * by 'match everything' regexp
                query = query.replace(/\*/g, '(?:[\r\n]|.)*');
                // treat all <SP> as a one or more whitespaces
                query = query.replace(/ /g, "\\s+");
                search_re = new RegExp(query, args.ignore_case);
                break;
            case "regexp":
                try {
                    search_re = new RegExp(query, args.ignore_case);
                } catch (e) {
                    console.error(e);
                    throw new RuntimeError("Can not compile regular expression: "
                        + query, 711);
                }
                break;
        }

        var root = window.document.documentElement;
        var found = search_re.exec(root.innerHTML);
        if (!found) {
            throw new RuntimeError(
                "Source does not match to " + args.type.toUpperCase() + "='" +
                args.query + "'", 726
            );
        }
        retobj.found = true;
        if (args.extract) {
            retobj.extract = args.extract.
                replace(/\$(\d{1,2})/g, function (match_str, x) {
                    return found[x];
                });
        }
    } catch (e) {
        retobj.error = normalize_error(e);
        console.error(e);
    } finally {
        callback(retobj);
    }
};



CSPlayer.prototype.handleImageSearchCommand = function (args, callback) {
    var div = document.createElement("div");
    div.style.width = args.width + "px";
    div.style.height = args.height + "px";
    div.style.border = "1px solid #9bff9b";
    div.style.zIndex = "100";
    div.style.position = "absolute";
    div.style.pointerEvents = "none"
    div.style.left = Math.floor(args.x - args.width / 2) + "px";
    div.style.top = Math.floor(args.y - args.height / 2) + "px";
    document.body.appendChild(div);
    window.scrollTo(args.x - 100, args.y - 100);
    callback();
};

var originalOverflowStyle = document.documentElement.style.overflow;

CSPlayer.prototype.onQueryPageDimensions = function (args, callback) {
    var width = document.documentElement.scrollWidth;
    var height = document.documentElement.scrollHeight;

    if (document.body) {
        width = Math.max(width, document.body.scrollWidth);
        height = Math.max(height, document.body.scrollHeight);
    }

    var retobj = {
        doc_w: width,
        doc_h: height,
        win_w: window.innerWidth,
        win_h: window.innerHeight
    };
    callback(retobj);
};

CSPlayer.prototype.onWebPageScrollTo = function (args, callback) {
    window.scrollTo(args.x, args.y);
    // console.log("scrollX=%d, scrollY=%d", window.scrollX, window.scrollY);
    // NOTE: it seems there is no deterministic way to do it,
    // so I put 500ms delay here;
    // onscroll is fired too early and not after scroll completion
    setTimeout(callback, 500);
};

CSPlayer.prototype.onHideScrollbars = function (args, callback) {
    if (args.hide) {
        document.documentElement.style.overflow = 'hidden';
    } else {
        document.documentElement.style.overflow = originalOverflowStyle;
    }
    setTimeout(callback, 500);
}

// get offset of the current window relative to topmost frame
function getXYOffset(w) {
    if (w === window.top) {
        try {
            let style = w.getComputedStyle(w.document.body);
            return {
                x_offset: parseInt(style.marginLeft) || 0,
                y_offset: parseInt(style.marginTop) || 0
            };
        } catch (e) {
            console.warn("[iMacros] Error getting body style in top frame:", e);
            return { x_offset: 0, y_offset: 0 };
        }
    }

    try {
        // Check for cross-origin access before attempting to access w.frameElement or w.parent
        // Accessing w.frameElement property throws SecurityError if cross-origin
        const frameElement = w.frameElement;

        if (!frameElement) {
            // Cannot access frameElement or it's null
            return { x_offset: 0, y_offset: 0 };
        }

        let { x_offset, y_offset } = getXYOffset(w.parent);

        let style = w.parent.getComputedStyle(frameElement);
        let rect = frameElement.getBoundingClientRect();

        return {
            x_offset: rect.left + x_offset + (parseInt(style.borderLeftWidth) || 0),
            y_offset: rect.top + y_offset + (parseInt(style.borderTopWidth) || 0)
        };
    } catch (e) {
        // Suppress errors for cross-origin frames
        // This is expected when running in iframes on different domains
        // console.warn("[iMacros] Cross-origin access blocked in getXYOffset:", e);
        return { x_offset: 0, y_offset: 0 };
    }
}

CSPlayer.prototype.onActivateElement = function (args, sendResponse) {
    try {
        var el, sel;
        if (args.selector === 'window') {
            let { x_offset, y_offset } = getXYOffset(window)
            sendResponse({
                targetRect:
                {
                    left: 0,
                    top: 0,
                    bottom: window.innerHeight,
                    right: window.innerWidth,
                    width: window.innerWidth,
                    height: window.innerHeight,
                    xOffset: x_offset,
                    yOffset: y_offset,
                    pageXOffset: window.pageXOffset,
                    pageYOffset: window.pageYOffset
                },
                isPasswordElement: false
            });
            return;
        }

        if (args.selector) {
            sel = args.selector;
            el = document.querySelector(sel);
        } else if (args.xpath) {
            sel = args.xpath;
            el = TagHandler.findByXPath(window.document, window.document.documentElement, sel);
        }

        if (!el) {
            sendResponse({
                error: normalize_error(
                    new RuntimeError(
                        "element specified by " +
                        sel + " not found", 721
                    )
                )
            })
        } else {
            // hack for handling select boxes in event mode
            if (el.tagName.toLowerCase() == "option") {
                el.selected = true
            }
            if (args.scroll) {
                var pos = ClickHandler.findElementPosition(el);
                window.scrollTo(pos.x - 100, pos.y - 100);
            }

            // Handle value setting for EVENT TYPE=INPUT
            if (typeof args.value !== 'undefined') {
                el.value = args.value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }

            var rect = el.getBoundingClientRect();
            let { x_offset, y_offset } = getXYOffset(window)
            sendResponse({
                targetRect:
                {
                    left: rect.left,
                    top: rect.top,
                    bottom: rect.bottom,
                    right: rect.right,
                    width: rect.width,
                    height: rect.height,
                    xOffset: x_offset,
                    yOffset: y_offset,
                    pageXOffset: window.pageXOffset,
                    pageYOffset: window.pageYOffset
                },
                isPasswordElement: el.type == "password"
            });
        }
    } catch (e) {
        console.error("[iMacros CSPlayer] onActivateElement error:", e);
        sendResponse({
            error: normalize_error(
                new RuntimeError(e.message || "Unknown error in onActivateElement", 1001)
            )
        });
    }
};

CSPlayer.prototype.onQueryCssSelector = function (args, sendresponse) {
    // Handle requests to locate elements by CSS selector for visual feedback or validation.
    // Returns a lightweight summary of the first few matches to avoid large payloads.
    const response = { matches: [], count: 0 };

    try {
        if (!args || typeof args.selector !== "string" || !args.selector.trim()) {
            sendresponse({
                error: "Invalid selector: selector must be a non-empty string",
            });
            return;
        }

        const nodeList = window.document.querySelectorAll(args.selector);
        const maxResults = Math.min(nodeList.length, 10);

        for (let i = 0; i < maxResults; i++) {
            const el = nodeList[i];
            const rect = el.getBoundingClientRect();
            response.matches.push({
                tagName: el.tagName,
                id: el.id || null,
                className: el.className || null,
                text: imns.escapeTextContent(el.textContent || ""),
                rect: {
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                },
            });
        }

        response.count = nodeList.length;
        sendresponse(response);
    } catch (err) {
        sendresponse({
            error: "Invalid selector: " + err.message,
        });
    }
};


// Initialize player when DOM is ready to ensure connector and DOM are accessible.
// MV3: content scripts may be injected multiple times; keep initialization idempotent.
try {
    var __imacrosGlobal = (typeof globalThis !== 'undefined') ? globalThis : window;
    var __imacrosPlayerBootstrapKey = '__imacros_mv3_csplayer_bootstrap__';
    var __imacrosPlayerBootstrap = (__imacrosGlobal && __imacrosGlobal[__imacrosPlayerBootstrapKey]) || null;

    if (!__imacrosPlayerBootstrap) {
        __imacrosPlayerBootstrap = { instance: null, scheduled: false };
        try {
            if (__imacrosGlobal) {
                __imacrosGlobal[__imacrosPlayerBootstrapKey] = __imacrosPlayerBootstrap;
            }
        } catch (e) {
            // ignore
        }
    }

    if (__imacrosPlayerBootstrap.instance) {
        window.player = __imacrosPlayerBootstrap.instance;
    } else if (!__imacrosPlayerBootstrap.scheduled) {
        __imacrosPlayerBootstrap.scheduled = true;

        var initPlayer = function () {
            if (__imacrosPlayerBootstrap.instance) {
                window.player = __imacrosPlayerBootstrap.instance;
                return;
            }
            try {
                console.log("[iMacros MV3] Initializing CSPlayer");
                __imacrosPlayerBootstrap.instance = new CSPlayer();
                window.player = __imacrosPlayerBootstrap.instance;
            } catch (err) {
                __imacrosPlayerBootstrap.scheduled = false;
                console.error("[iMacros MV3] CSPlayer initialization failed:", err);
            }
        };

        if (document.readyState === "complete" || document.readyState === "interactive") {
            setTimeout(initPlayer, 0);
        } else {
            window.addEventListener("DOMContentLoaded", initPlayer, { once: true });
            window.addEventListener("load", initPlayer, { once: true });
        }
    }
} catch (e) {
    console.error("[iMacros MV3] Failed to initialize CSPlayer:", e);
}
