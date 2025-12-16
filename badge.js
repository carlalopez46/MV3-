/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

// Handy wrapper for browser action functions
// (badge is not really good naming for the object)
var badge = {
    // execute callback for all tabs in window
    // callback is function(tab) {...}
    forAllTabs: function (win_id, callback) {
        // In Offscreen Document, chrome.windows is not available
        if (!chrome.windows || !chrome.windows.getAll) {
            return;
        }

        try {
            chrome.windows.getAll({ populate: true }, function (ws) {
                if (chrome.runtime.lastError) {
                    console.warn('[badge] Error getting windows:', chrome.runtime.lastError.message);
                    return;
                }
                for (const win of ws) {
                    if (win.id == win_id && Array.isArray(win.tabs)) {
                        for (const tab of win.tabs) {
                            callback(tab);
                        }
                    }
                }
            });
        } catch (err) {
            console.error('[badge] forAllTabs error:', err);
        }
    },

    _sendToSW: function (method, win_id, arg) {
        try {
            chrome.runtime.sendMessage({
                type: 'UPDATE_BADGE',
                method: method,
                winId: win_id,
                arg: arg
            });
        } catch (e) { /* ignore */ }
    },

    _getActionApi: function () {
        if (typeof chrome === 'undefined') return null;
        if (chrome.action && typeof chrome.action.setBadgeText === 'function') {
            return chrome.action;
        }
        if (chrome.browserAction && typeof chrome.browserAction.setBadgeText === 'function') {
            return chrome.browserAction;
        }
        return null;
    },

    _normalizeText: function (text) {
        if (text === undefined || text === null) {
            return '';
        }
        try {
            return text.toString();
        } catch (e) {
            return '';
        }
    },

    setBackgroundColor: function (win_id, color) {
        if (!chrome.windows) {
            this._sendToSW('setBackgroundColor', win_id, color);
            return;
        }

        const actionApi = this._getActionApi();
        if (!actionApi) return;

        this.forAllTabs(win_id, function (tab) {
            try {
                actionApi.setBadgeBackgroundColor({ tabId: tab.id, color: color });
            } catch (e) {
                console.warn('[badge] Failed to set background color:', e.message);
            }
        });
    },

    setText: function (win_id, text) {
        if (!chrome.windows) {
            this._sendToSW('setText', win_id, text);
            return;
        }

        const actionApi = this._getActionApi();
        if (!actionApi) return;
        const safeText = this._normalizeText(text);

        this.forAllTabs(win_id, function (tab) {
            try {
                actionApi.setBadgeText({ tabId: tab.id, text: safeText });
            } catch (e) {
                console.warn('[badge] Failed to set text:', e.message);
            }
        });
    },

    setIcon: function (win_id, icon) {
        if (!chrome.windows) {
            this._sendToSW('setIcon', win_id, icon);
            return;
        }

        const actionApi = this._getActionApi();
        if (!actionApi) return;

        this.forAllTabs(win_id, function (tab) {
            try {
                actionApi.setIcon({ tabId: tab.id, path: icon });
            } catch (e) {
                console.warn('[badge] Failed to set icon:', e.message);
            }
        });
    },

    set: function (win_id, details) {
        if (!details || typeof details !== 'object') {
            this.clearText(win_id);
            return;
        }

        switch (details.status) {
            case "tag_wait":
                this.setBackgroundColor(win_id, [209, 211, 212, 255]); // light gray
                break;

            case "loading":
                this.setBackgroundColor(win_id, [250, 187, 24, 255]); // yellow
                break;

            case "waiting":
                this.setBackgroundColor(win_id, [162, 208, 116, 255]); // green
                break;

            case "playing":
                this.setBackgroundColor(win_id, [76, 196, 209, 255]); // blue
                break;

            case "recording":
                this.setBackgroundColor(win_id, [241, 86, 76, 255]); // red
                break;
        }

        this.setText(win_id, this._normalizeText(details.text));
    },

    clearText: function (win_id) {
        this.setText(win_id, "");
    }
};
