/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

// Context to store browser window-specific information

// Context to store browser window-specific information

// Define global listeners to ensure stable references
const _globalContextListeners = {
    onCreated: function (w) {
        if (typeof context !== 'undefined' && context.onCreated) {
            context.onCreated(w);
        }
    },
    onRemoved: function (id) {
        if (typeof context !== 'undefined' && context.onRemoved) {
            context.onRemoved(id);
        }
    },
    onTabUpdated: function (tab_id, changeInfo, tab) {
        if (typeof context !== 'undefined' && context.onTabUpdated) {
            context.onTabUpdated(tab_id, changeInfo, tab);
        }
    }
};

const context = {
    _initialized: false,
    _listenersAttached: false,
    _initPromises: {}, // Track ongoing initializations

    init: function (win_id) {
        // Return existing promise if initialization is already in progress
        if (this._initPromises[win_id]) {
            return this._initPromises[win_id];
        }

        // Return resolved promise if already initialized
        if (context[win_id] && context[win_id]._initialized) {
            return Promise.resolve(context[win_id]);
        }

        // Attach global listeners only once
        if (!this._listenersAttached) {
            this.attachListeners();
            this._listenersAttached = true;
        }

        // Create and store initialization promise
        this._initPromises[win_id] = new Promise((resolve) => {
            context[win_id] = new Object();
            context[win_id].mplayer = new MacroPlayer(win_id);
            context[win_id].recorder = new Recorder(win_id);
            context[win_id].vars = new VariableManager(); // Initialize VariableManager
            context[win_id].state = "idle";
            context[win_id]._initialized = true;

            // Clean up the promise tracker
            delete this._initPromises[win_id];

            resolve(context[win_id]);
        });

        return this._initPromises[win_id];
    },

    updateState: function (win_id, state) {
        const startFocusGuard = (tabId) => {
            if (!Number.isInteger(tabId) || typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
            try {
                chrome.runtime.sendMessage({
                    command: 'FOCUS_GUARD_START',
                    tabId: tabId,
                    winId: win_id
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.warn('[iMacros] Failed to start focus guard:', chrome.runtime.lastError.message);
                    }
                });
            } catch (err) {
                console.warn('[iMacros] Focus guard start threw synchronously:', err);
            }
        };

        const stopFocusGuard = () => {
            if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
            try {
                chrome.runtime.sendMessage({
                    command: 'FOCUS_GUARD_STOP',
                    winId: win_id
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.warn('[iMacros] Failed to stop focus guard:', chrome.runtime.lastError.message);
                    }
                });
            } catch (err) {
                console.warn('[iMacros] Focus guard stop threw synchronously:', err);
            }
        };

        // set browser action icon
        switch (state) {
            case "playing": case "recording":
                badge.setIcon(win_id, "skin/stop.png");
                // Store the current active tab_id when starting to play/record
                if (typeof chrome.tabs !== 'undefined' && chrome.tabs.query) {
                    chrome.tabs.query({ active: true, windowId: win_id }, function (tabs) {
                        if (chrome.runtime.lastError) {
                            logError("Failed to query tabs in updateState: " + chrome.runtime.lastError.message, { win_id: win_id, state: state });
                            return;
                        }
                        // Check context still exists (window may have closed during query)
                        if (context[win_id] && tabs && tabs.length > 0) {
                            context[win_id].pausedTabId = tabs[0].id;
                            startFocusGuard(tabs[0].id);
                        }
                    });
                }
                break;
            case "paused":
                badge.setIcon(win_id, "skin/play.png");
                // Store the tab_id where macro was paused
                if (typeof chrome.tabs !== 'undefined' && chrome.tabs.query) {
                    chrome.tabs.query({ active: true, windowId: win_id }, function (tabs) {
                        if (chrome.runtime.lastError) {
                            logError("Failed to query tabs in updateState (paused): " + chrome.runtime.lastError.message, { win_id: win_id, state: state });
                            return;
                        }
                        // Check context still exists (window may have closed during query)
                        if (context[win_id] && tabs && tabs.length > 0) {
                            context[win_id].pausedTabId = tabs[0].id;
                        }
                    });
                }
                stopFocusGuard();
                break;
            case "idle":
                badge.setIcon(win_id, "skin/logo19.png");
                if (Storage.getBool("show-updated-badge")) {
                    badge.setText(win_id, "New");
                } else {
                    badge.clearText(win_id);
                }
                // Clear the paused tab_id when returning to idle state
                if (context[win_id]) {
                    delete context[win_id].pausedTabId;
                }
                stopFocusGuard();
                break;
        }
        // update panel
        if (context[win_id]) {
            // MV3: Send message to panel instead of direct access
            try {
                chrome.runtime.sendMessage({
                    type: 'UPDATE_PANEL_STATE',
                    panelWindowId: context[win_id].panelId,
                    state: state
                }, function () {
                    if (chrome.runtime.lastError) {
                        // Ignore errors if panel is closed
                    }
                });
            } catch (e) {
                // Ignore errors
            }
            context[win_id].state = state;
        }
    },

    onCreated: function (w) {
        if (w.type != "normal")
            return;

        // Use init method for consistent initialization
        this.init(w.id).then(ctx => {
            this.updateState(w.id, "idle");
        }).catch(err => {
            logError("Failed to initialize context in onCreated: " + err.message, { win_id: w.id });
        });
    },

    onRemoved: function (id) {
        // Clean up initialization promise if window is removed during initialization
        if (this._initPromises[id]) {
            delete this._initPromises[id];
        }

        if (context[id]) {
            let t;
            if (t = context[id].mplayer) {
                t.terminate();
                delete context[id].mplayer;
            }
            if (t = context[id].recorder) {
                t.terminate();
                delete context[id].recorder;
            }
            if (context[id].dockInterval) {
                clearInterval(context[id].dockInterval);
                context[id].dockInterval = null;
            }
            delete context[id];
        }
    },

    onTabUpdated: function (tab_id, changeInfo, tab) {
        if (!context[tab.windowId])
            return;
        // set icon after tab is updated
        switch (context[tab.windowId].state) {
            case "playing": case "recording":
                badge.setIcon(tab.windowId, "skin/stop.png");
                break;
            case "paused":
                badge.setIcon(tab.windowId, "skin/play.png");
                break;
            case "idle":
                badge.setIcon(tab.windowId, "skin/logo19.png");
                if (Storage.getBool("show-updated-badge")) {
                    badge.setText(tab.windowId, "New");
                } else {
                    badge.clearText(tab.windowId);
                }
                break;
        }
    },

    attachListeners: function () {
        if (this._listenersAttached) return;

        // Skip attaching listeners in Offscreen Document
        // Listeners for windows/tabs should be handled by Service Worker
        if (typeof window !== 'undefined' && window.location.pathname.endsWith('offscreen.html')) {
            console.log("[iMacros] Skipping listener attachment in Offscreen Document");
            this._listenersAttached = true;
            return;
        }

        // 安全にチェックして登録
        // Use _globalContextListeners for stable references that can be removed later
        if (typeof chrome.windows !== 'undefined' && chrome.windows.onCreated) {
            chrome.windows.onCreated.addListener(_globalContextListeners.onCreated);
        }
        if (typeof chrome.windows !== 'undefined' && chrome.windows.onRemoved) {
            chrome.windows.onRemoved.addListener(_globalContextListeners.onRemoved);
        }
        if (typeof chrome.tabs !== 'undefined' && chrome.tabs.onUpdated) {
            chrome.tabs.onUpdated.addListener(_globalContextListeners.onTabUpdated);
        }

        // chrome.downloads API のチェック
        if (typeof chrome.downloads !== 'undefined' && chrome.downloads.onDeterminingFilename) {
            this._boundOnDf = this.on_df.bind(this);
            chrome.downloads.onDeterminingFilename.addListener(this._boundOnDf);
        } else {
            console.log("[iMacros] chrome.downloads API not available in this context.");
        }

        this._listenersAttached = true;
    },

    detachListeners: function () {
        if (typeof _globalContextListeners === 'undefined') return;

        if (chrome.windows.onCreated.hasListener(_globalContextListeners.onCreated))
            chrome.windows.onCreated.removeListener(_globalContextListeners.onCreated);

        if (chrome.windows.onRemoved.hasListener(_globalContextListeners.onRemoved))
            chrome.windows.onRemoved.removeListener(_globalContextListeners.onRemoved);

        if (chrome.tabs.onUpdated.hasListener(_globalContextListeners.onTabUpdated))
            chrome.tabs.onUpdated.removeListener(_globalContextListeners.onTabUpdated);

        // Remove downloads listener if attached
        if (this._boundOnDf && chrome.downloads && chrome.downloads.onDeterminingFilename) {
            chrome.downloads.onDeterminingFilename.removeListener(this._boundOnDf);
            delete this._boundOnDf;
        }

        this._listenersAttached = false;
    },

    registerDfHandler: function (win_id) {
        if (this.df_handlers.indexOf(win_id) !== -1)
            return;
        this.df_handlers.push(win_id);
    },

    unregisterDfHandler: function (win_id) {
        var idx = this.df_handlers.indexOf(win_id);
        if (idx != -1)
            this.df_handlers.splice(idx, 1);
    },

    on_df: function (dl, suggest) {
        for (let i = 0; i < this.df_handlers.length; i++) {
            const mplayer = context[this.df_handlers[i]].mplayer;
            if (mplayer && mplayer.onDeterminingFilename(dl, suggest))
                return;
        }
    }

};


// This event has a weird condition that an extension can register only
// one listener. It is registered in attachListeners() now.
context.df_handlers = [];

// Make context globally accessible for dependency verification
globalThis.context = context;
