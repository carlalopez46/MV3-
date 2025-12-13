/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

function Connector() {
    this.handlers = new Object();
    this.message_handlers = new Map();

    // Single unified message listener to handle both legacy and new message patterns
    chrome.runtime.onMessage.addListener(
        function (msg, sender, callback) {
            // Filter out vfs-change messages in content scripts - they're only for UI pages
            if (msg.topic === 'vfs-change') {
                return false;
            }

            let handledByLegacy = connector.handleMessage(msg, callback);
            let handledByNew = connector.onMessage(msg, callback);

            // Log warning only if neither system handled the message and it has a topic
            // AND the message was not targeting a different frame (if _frame is specified)
            let isTargetingOtherFrame = msg._frame && !connector.thisFrame(msg._frame);

            if (!handledByLegacy && !handledByNew && msg.topic && !isTargetingOtherFrame) {
                console.warn("[iMacros MV3] Unknown topic:", msg.topic, "Current handlers:", Object.keys(connector.handlers));
                logWarning(`Connector: Unknown topic '${msg.topic}' - not handled by any system`, {
                    topic: msg.topic,
                    url: window.location.href,
                    hasFrame: !!msg._frame
                });
            }

            // Return true only if at least one handler system processed it
            return handledByLegacy || handledByNew;
        }
    );
}

Connector.prototype.findFrameNumber = function (win, f, obj) {
    if (win.top == f)         // it is a topmost window
        return 0;
    for (var i = 0; i < win.frames.length; i++) {
        obj.num++;
        if (win.frames[i] == f) {
            return obj.num;
        }
        var n = this.findFrameNumber(win.frames[i], f, obj);
        if (n != -1)
            return n;
    }
    return -1;
};

Connector.prototype.getFrameData = function () {
    var obj = {
        number: this.findFrameNumber(window.top, window, { num: 0 }),
        name: ""
    };
    try {
        // query 'name' field
        obj.name = (window.frameElement && window.frameElement.name) ?
            window.frameElement.name : "";
    } catch (e) {
        // in case of domain/protocol mismatch SecurityException is thrown
        // console.error(e);
    }

    return obj;
};


Connector.prototype.thisFrame = function (f) {
    var tf = this.getFrameData();
    return tf.number == f.number || (tf.name.length && tf.name == f.name);
};


// handle incoming messages
Connector.prototype.handleMessage = function (msg, callback) {
    if (msg._frame && !this.thisFrame(msg._frame))
        return false;

    // If message has no topic, it's not meant for this handler system
    if (!msg.topic) {
        return false;
    }

    if (msg.topic in this.handlers) {
        this.handlers[msg.topic].forEach(function (handler) {
            handler(msg.data, callback);
        });
        return true;
    } else {
        // Check if it's handled by the new message handler system before warning
        if (this.message_handlers.has(msg.topic)) {
            return false; // Let onMessage handle it
        }
        // Only warn if we're sure neither system will handle it
        return false;
    }
};

Connector.prototype.onMessage = function (msg, sendResponse) {
    if (msg._frame && !this.thisFrame(msg._frame))
        return false;
    if (!msg.topic)
        return false;
    if (this.message_handlers.has(msg.topic)) {
        this.message_handlers.get(msg.topic)(msg.data, sendResponse);
        return true;
    }
    return false;
}


// register handlers for specific messages
// callback's prototype is function(msg)
Connector.prototype.registerHandler = function (topic, handler) {
    if (!(topic in this.handlers))
        this.handlers[topic] = new Array();
    this.handlers[topic].push(handler);
};

Connector.prototype.addHandler = function (topic, handler) {
    console.assert(!this.message_handlers.has(topic), "addHandler, topic " +
        topic + " already has handler");
    this.message_handlers.set(topic, handler);
}

// remove specified handler
Connector.prototype.unregisterHandler = function (topic, callback) {
    // Guard against unregistering from non-existent topics
    if (!(topic in this.handlers)) {
        console.warn("unregisterHandler: topic", topic, "does not exist");
        return;
    }
    var i = this.handlers[topic].indexOf(callback);
    if (i != -1)
        this.handlers[topic].splice(i, 1);
};

Connector.prototype.removeHandler = function (topic) {
    if (!this.message_handlers.has(topic))
        return;
    this.message_handlers.delete(topic);
};


// post message to extension script
Connector.prototype.postMessage = function (topic, data, callback) {
    if (data) {
        data._frame = this.getFrameData();
    } else {
        data = { _frame: this.getFrameData() };
    }

    if (callback) {
        chrome.runtime.sendMessage({ topic: topic, data: data }, function (response) {
            if (chrome.runtime.lastError) {
                // Only log if it's not the expected "message channel closed" error for query-state
                var errorMsg = chrome.runtime.lastError.message;
                var isIgnorableError = topic === 'query-state' &&
                    (errorMsg.indexOf('message channel closed') !== -1 ||
                        errorMsg.indexOf('The message port closed') !== -1);

                if (!isIgnorableError) {
                    console.error("Error sending message from connector:", errorMsg, { topic: topic });
                    logError("Connector.postMessage: Failed to send message: " + errorMsg, {
                        topic: topic,
                        url: window.location.href,
                        errorMessage: errorMsg
                    });
                }
            }
            callback(response);
        });
    } else {
        chrome.runtime.sendMessage({ topic: topic, data: data }, function (response) {
            if (chrome.runtime.lastError) {
                // Only log if it's not the expected "message channel closed" error for query-state
                var errorMsg = chrome.runtime.lastError.message;
                var isIgnorableError = topic === 'query-state' &&
                    (errorMsg.indexOf('message channel closed') !== -1 ||
                        errorMsg.indexOf('The message port closed') !== -1);

                if (!isIgnorableError) {
                    console.error("Error sending message from connector:", errorMsg, { topic: topic });
                    logError("Connector.postMessage: Failed to send message: " + errorMsg, {
                        topic: topic,
                        url: window.location.href,
                        errorMessage: errorMsg
                    });
                }
            }
        });
    }
};

Connector.prototype.sendMessage = function (topic, data) {
    if (data) {
        data._frame = this.getFrameData();
    } else {
        data = { _frame: this.getFrameData() };
    }

    return new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage(
            { topic: topic, data: data },
            function (data) {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve(data);
            });
    });
};

var connector = new Connector();
