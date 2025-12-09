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
        // for some stupid reason windows.get(win) does not
        // contain "tabs" property, so we have to get All windows
        chrome.windows.getAll({ populate: true }, function (ws) {
            if (chrome.runtime.lastError) {
                // console.error("Error getting windows:", chrome.runtime.lastError.message);
                return;
            }
            ws.forEach(function (win) {
                if (win.id == win_id) {
                    win.tabs.forEach(function (tab) {
                        callback(tab);
                    });
                    return;
                }
            });
        });
    },

    _sendToSW: function (method, win_id, arg) {
        try {
            chrome.runtime.sendMessage({
                type: 'UPDATE_BADGE',
                method: method,
                winId: win_id,
                arg: arg
            });
        } catch (e) { }
    },


    setBackgroundColor: function (win_id, color) {
        if (!chrome.windows) {
            this._sendToSW('setBackgroundColor', win_id, color);
            return;
        }
        this.forAllTabs(win_id, function (tab) {
            chrome.action.setBadgeBackgroundColor(
                { tabId: tab.id, color: color }
            );
        });
    },


    setText: function (win_id, text) {
        if (!chrome.windows) {
            this._sendToSW('setText', win_id, text);
            return;
        }
        this.forAllTabs(win_id, function (tab) {
            chrome.action.setBadgeText(
                { tabId: tab.id, text: text }
            );
        });
    },


    setIcon: function (win_id, icon) {
        if (!chrome.windows) {
            this._sendToSW('setIcon', win_id, icon);
            return;
        }
        this.forAllTabs(win_id, function (tab) {
            chrome.action.setIcon(
                { tabId: tab.id, path: icon }
            );
        });
    },


    set: function (win_id, details) {
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
        };

        this.setText(win_id, details.text.toString());
    },


    clearText: function (win_id) {
        this.setText(win_id, "");
    }
};
