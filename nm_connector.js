/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

/**
 * Global dependencies (loaded via importScripts in background.js):
 * @external context - Global context object from context.js
 * @external openPanel - Panel management function from bg.js
 * @external afio - Async File I/O module from AsyncFileIO.js
 * @external chrome - Chrome Extension API
 */

function canUseNativeMessaging() {
    return typeof chrome !== 'undefined' &&
        chrome.runtime &&
        typeof chrome.runtime.connectNative === 'function' &&
        typeof chrome.runtime.sendNativeMessage === 'function';
}

const nm_connector = {
    // Native module connection status
    isConnected: false,
    port: null,
    clients: null,

    onInit: function (clientId, args) {
        if (clientId in this.clients) {
            this.sendResponse(clientId,
                "Can not create new instance. Error: " +
                "already initialized (maybe two iimInit() calls?)",
                -20);
            return;
        }

        const self = this;

        function attach(win) {
            // MV3: Initialize context before opening panel or executing macros
            // This ensures context[win.id] exists when native host sends commands
            if (!context || typeof context.init !== 'function') {
                console.error('[nm_connector] Context object not available');
                self.sendResponse(clientId, "Failed to initialize: context not available", -1);
                return;
            }
            context.init(win.id).then(function () {
                cacheClient(win);
                // Open panel if necessary
                if (!args.options || !/-simpleui/i.test(args.options)) {
                    openPanel(win.id);
                }
            }).catch(function (err) {
                console.error('[nm_connector] Failed to initialize context:', err);
                self.sendResponse(clientId, "Failed to initialize: " + (err.message || err), -1);
            });
        }

        function cacheClient(win) {
            self.clients[clientId] = { win_id: win.id };
            self.sendResponse(clientId, "OK", 1);
        }

        function openNewBrowser() {
            chrome.windows.create({ url: "about:blank" }, attach);
        }

        if (args.launched) {
            // reuse the current window
            if (chrome.windows && chrome.windows.getCurrent) {
                chrome.windows.getCurrent(attach);
            } else {
                console.log('[nm_connector] chrome.windows not available in this context');
            }
        }
        else if (args.openNewBrowser) {
            openNewBrowser();
        } else {            // reuse any of the "free" existing window
            if (chrome.windows && chrome.windows.getAll) {
                chrome.windows.getAll({ windowTypes: ['normal'] }, function (windows) {
                    let saved = false;
                    for (let i = 0; i < windows.length; i++) {
                        const win = windows[i];
                        let found = false;
                        for (const j in self.clients) {
                            if (self.clients[j].win_id == win.id) {
                                found = true; break;
                            }
                        }
                        if (!found) { // if win.id is not among windows in use
                            attach(win);
                            saved = true; break;
                        }
                    }
                    if (!saved) {   // if all the windows are in use
                        // then create new window
                        openNewBrowser();
                    }
                });
            } else {
                console.log('[nm_connector] chrome.windows not available in this context');
            }
        }
    },


    onCapture: function (clientId, args) {
        const win_id = this.clients[clientId].win_id;
        let type;
        const extMatch = args.path.match(/^.*\.(\w+)$/);
        if (extMatch) {
            const ext = extMatch[1];
            if (ext == "jpg") {
                type = "jpeg";
            } else if (ext == "png") {
                type = "png";
            } else {
                this.sendResponse(clientId,
                    "Unsupported type " + ext, -1);
                return;
            }
        } else {
            // if no file extension is set than assume "png"
            type = "png";
            args.path += ".png";
        }

        afio.isInstalled().then(function (installed) {
            if (!installed) {
                nm_connector.sendResponse(
                    clientId,
                    "Can not instantiate file IO plugin", -1
                );
                return;
            }
            let f = null;
            let pathPromise;
            if (__is_full_path(args.path)) {
                f = afio.openNode(args.path);
                pathPromise = Promise.resolve(f);
            } else {
                // do not allow references to upper directories
                args.path = args.path.replace("..", "_");
                pathPromise = afio.getDefaultDir("downpath").then(function (node) {
                    f = afio.openNode(node.path);
                    f.append(args.path);
                    return f;
                });
            }
            pathPromise.then(function (fileNode) {
                chrome.tabs.captureVisibleTab(
                    win_id, { format: type },
                    function (data) {
                        if (chrome.runtime.lastError) {
                            nm_connector.sendResponse(
                                clientId,
                                "Could not capture tab: " + chrome.runtime.lastError.message, -2
                            );
                            return;
                        }
                        const re = /data\:([\w-]+\/[\w-]+)?(?:;(base64))?,(.+)/;
                        const m = re.exec(data);
                        if (!m) {
                            nm_connector.sendResponse(
                                clientId,
                                "Could not parse captured data", -2
                            );
                            return;
                        }
                        const imageData = {
                            image: m[3],
                            encoding: m[2],
                            mimeType: m[1]
                        };
                        afio.writeImageToFile(fileNode, imageData).then(function () {
                            nm_connector.sendResponse(clientId, "OK", 1);
                        }, function (err) {
                            nm_connector.sendResponse(
                                clientId,
                                "Could not write to " + fileNode.path, -2
                            );
                        });
                    }
                );
            }).catch(function (err) {
                nm_connector.sendResponse(
                    clientId,
                    "Could not get default directory: " + (err.message || err), -2
                );
            });
        });

    },


    onPlay: function (clientId, args) {
        const win_id = this.clients[clientId].win_id;

        // MV3: Ensure context is initialized before playing macro
        if (!context[win_id] || !context[win_id]._initialized) {
            console.error('[nm_connector] Context not initialized for window:', win_id);
            this.sendResponse(clientId, "Context not initialized. Please call iimInit() first.", -1);
            return;
        }

        for (const x in args.vars) { // save user vars if any
            context[win_id].mplayer.setUserVar(x, args.vars[x]);
        }

        if (args.use_profiler) {
            context[win_id].mplayer.profiler.si_enabled = true;
        }

        if (/^CODE:((?:\n|.)+)$/.test(args.source)) { // if macro is embedded
            let val = RegExp.$1;
            val = val.replace(/\[sp\]/ig, ' ');
            val = val.replace(/\[br\]/ig, '\n');
            val = val.replace(/\[lf\]/ig, '\r');
            //play macro
            getLimits().then(
                limits => context[win_id].mplayer.play(
                    {
                        name: "__noname__.iim",
                        file_id: "",
                        source: val,
                        client_id: clientId
                    },
                    limits
                )
            ).catch(function (err) {
                console.error("Error playing embedded macro:", err);
                nm_connector.sendResponse(
                    clientId,
                    "Failed to play macro: " + (err.message || err),
                    -1
                );
            });
            return;
        }

        // try to load macro from file otherwise
        let name = args.source;
        if (!isMacroFile(name))
            name += ".iim";

        let filePromise;
        if (__is_full_path(name)) {
            // full path is given
            filePromise = Promise.resolve(afio.openNode(name));
        } else {
            filePromise = afio.getDefaultDir("savepath").then(function (node) {
                const file = afio.openNode(node.path);
                const nodes = name.split(__psep()).reverse();
                while (nodes.length)
                    file.append(nodes.pop());
                return file;
            });
        }

        filePromise.then(function (file) {
            return file.exists().then(function (exists) {
                if (!exists) {
                    nm_connector.sendResponse(
                        clientId, "Can not open macro " + name, -931);
                    return;
                }
                afio.readTextFile(file).then(function (val) {
                    getLimits().then(
                        limits => context[win_id].mplayer.play(
                            {
                                name: file.leafName,
                                file_id: file.path,
                                source: val,
                                client_id: clientId
                            },
                            limits
                        )
                    ).catch(function (err) {
                        console.error("Error playing macro from file:", err);
                        nm_connector.sendResponse(
                            clientId,
                            "Failed to play macro: " + (err.message || err),
                            -1
                        );
                    });
                }, function (e) {
                    nm_connector.sendResponse(
                        clientId, "Can not read macro, error " + e.message, -931);
                    return;
                });
            }, function (err) {
                nm_connector.sendResponse(
                    clientId, "Can not open macro, error " + err.message, -931);
                return;
            });
        }).catch(function (err) {
            console.error("Error getting file path:", err);
            nm_connector.sendResponse(
                clientId,
                "Error accessing file system: " + (err.message || err),
                -931
            );
        });

    },


    handleCommand: function (clientId, cmd) {
        let request;
        try {
            request = JSON.parse(cmd);
        } catch (e) {
            console.error("Failed to parse command:", e);
            this.sendResponse(clientId,
                "Can not parse request \"" + cmd + "\"", -1);
            return;
        }

        switch (request.type) {
            case "init":
                this.onInit(clientId, request.args);
                break;

            case "play":
                this.onPlay(clientId, request.args);
                break;

            case "disconnect":
                delete this.clients[clientId];
                this.sendResponse(clientId, "OK", 1);
                break;

            case "exit": {
                const win_id = this.clients[clientId].win_id;
                if (chrome.windows && chrome.windows.getAll) {
                    chrome.windows.getAll(null, function (windows) {
                        if (windows.length == 1) {
                            // Note: Chrome Extensions API does not provide a way to get the browser's PID.
                            // The chrome.processes API mentioned in older documentation was never
                            // released for extensions. Using -1 as a placeholder, which is sufficient
                            // for the current use case (signaling the last window closure).
                            const pid = -1;
                            nm_connector.sendResponse(clientId, "OK", 1,
                                { waitForProcessId: pid });
                        } else {
                            nm_connector.sendResponse(clientId, "OK", 1);
                        }

                        chrome.windows.remove(win_id, function () {
                            if (chrome.runtime.lastError) {
                                console.warn('[nm_connector] Error removing window:', chrome.runtime.lastError.message);
                            }
                            delete nm_connector.clients[clientId];
                        });
                    });
                } else {
                    console.log('[nm_connector] chrome.windows not available for exit command');
                    nm_connector.sendResponse(clientId, "OK", 1);
                }
                break;
            }

            case "show": {
                const show_win_id = this.clients[clientId].win_id;
                const showArgs = {
                    message: request.args.message,
                    errorCode: 1,
                    win_id: show_win_id,
                    macro: null
                };

                showInfo(showArgs);
                this.sendResponse(clientId, "OK", 1);
                break;
            }

            case "capture":
                this.onCapture(clientId, request.args);
                break;
            case "error":
                console.error("Got error from iMacros host: " + request.message);
                break;

            case "info":
                console.info("Got message from iMacros host: " + request.message);
                break;
        }
    },


    startServer: function (args) {
        const si_host = "com.ipswitch.imacros.host";
        this.clients = Object.create(null);
        this.isConnected = false;

        try {
            // Check if connectNative is available (not available in Offscreen Document)
            if (!canUseNativeMessaging()) {
                console.info('[iMacros] Native Messaging is not available in this context (', typeof location !== 'undefined' ? location.pathname : 'unknown', '). nm_connector is disabled in this context.');
                this.port = null;
                return;
            }

            this.port = chrome.runtime.connectNative(si_host);

            this.port.onMessage.addListener(function (msg) {
                // Process messages asynchronously to avoid blocking
                setTimeout(function () {
                    nm_connector.handleCommand(msg.clientId, msg.request);
                }, 0);
            });

            this.port.onDisconnect.addListener(function () {
                nm_connector.isConnected = false;
                // Always check chrome.runtime.lastError to prevent "Unchecked runtime.lastError" warnings
                const error = chrome.runtime.lastError;
                if (error) {
                    // Consume the error to prevent unchecked error warnings
                    // Log at debug level since this is expected when native host is not installed/accessible
                    if (error.message && error.message.includes('forbidden')) {
                        console.debug('[nm_connector] Native messaging access forbidden (expected if host not configured):', error.message);
                    } else {
                        console.debug('[nm_connector] Native messaging host disconnected with error:', error.message);
                    }
                } else {
                    console.info("Native messaging host disconnected");
                }
            });

            const init_msg = { type: 'init' };
            if (args)
                init_msg.ac_pipe = args;

            // Attempt to send initial message
            try {
                this.port.postMessage(init_msg);
                this.isConnected = true;
                console.info("Native messaging host connected successfully");
            } catch (postError) {
                // If postMessage throws a synchronous error, clean up
                console.warn("Failed to send initial message to native messaging host:", postError);
                if (this.port) {
                    this.port.disconnect();
                    this.port = null;
                }
                this.isConnected = false;
            }
        } catch (e) {
            console.warn("Failed to connect to native messaging host:", e);
            console.warn("External iMacros integration unavailable. Extension features will continue to work.");
            this.port = null;
            this.isConnected = false;
        }
    },

    stopServer: function () {
        if (this.port)
            this.port.disconnect();
    },


    sendResponse: function (clientId, message, errorCode, extra) {
        // Guard against sending when port is not connected
        if (!this.port) {
            console.warn('Cannot send response: native messaging port is not connected');
            return;
        }

        if (errorCode < 0 && !/error/i.test(message)) {
            message = "Error: " + message;
        }
        message += " (" + errorCode + ")";

        const result = {
            status: message,
            errorCode: errorCode
        };

        if (extra) {
            if (extra.extractData)
                result.extractData = extra.extractData.split("[EXTRACT]");
            if (extra.lastPerformance)
                result.lastPerformance = extra.lastPerformance;
            if (extra.waitForProcessId)
                result.waitForProcessId = extra.waitForProcessId;
            if (extra.profilerData)
                result.profilerData = extra.profilerData;
        }

        // Check if native messaging host is connected before sending
        if (!this.port || !this.isConnected) {
            console.warn(
                "[nm_connector] Cannot send response to clientId " + clientId +
                ": Native messaging host not connected. " +
                "Message: " + message
            );
            return;
        }

        // console.debug("Sending response %s for clientId %d",
        //               JSON.stringify(result), clientId);
        try {
            this.port.postMessage({
                type: "command_result",
                clientId: clientId,
                result: JSON.stringify(result)
            });
        } catch (e) {
            console.error("[nm_connector] Failed to send response:", e);
        }
    }
};
