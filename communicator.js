/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

// incapsulates all content scripts-extensions communications
function Communicator() {
    this.handlers = Object.create(null);
    this.addListeners();
}

// add listener for extension events
Communicator.prototype.addListeners = function () {
    // MV3対応: chrome.extension.onRequest -> chrome.runtime.onMessage
    chrome.runtime.onMessage.addListener(
        (msg, sender, sendResponse) => {
            // 内部メッセージや他からのメッセージをフィルタリング
            if (!msg || !msg.topic) return;

            // sender.tab がない場合はバックグラウンド/ポップアップからのメッセージの可能性がある
            // タブIDがない場合は -1 などを割り当てるか、ハンドラ側で対応
            const tabId = sender.tab ? sender.tab.id : -1;

            // 这里的 callback 是 sendResponse，但旧代码期望 callback() 形式
            // 需要适配
            return this.handleMessage(msg, tabId, sendResponse);
        }
    );

    // 安全性向上: chrome.windows が存在する場合のみリスナー登録
    if (typeof chrome.windows !== 'undefined' && chrome.windows.onRemoved) {
        chrome.windows.onRemoved.addListener((win_id) => {
            // remove all handlers bind to the window
            for (const topic in this.handlers) {
                const len = this.handlers[topic].length;
                const junk = [];
                for (let i = 0; i < len; i++) {
                    if (this.handlers[topic][i].win_id == win_id) {
                        junk.push(this.handlers[topic][i].handler);
                    }
                }
                for (let i = 0; i < junk.length; i++) {
                    this.unregisterHandler(topic, junk[i]);
                }
            }
        });
    }
};

// register handlers for specific content script messages
Communicator.prototype.registerHandler = function (topic, handler, win_id) {
    if (!(topic in this.handlers))
        this.handlers[topic] = [];
    this.handlers[topic].push({ handler: handler, win_id: win_id });
};

Communicator.prototype.unregisterHandler = function (topic, handler) {
    if (!(topic in this.handlers))
        return;
    for (let i = 0; i < this.handlers[topic].length; i++) {
        if (this.handlers[topic][i].handler == handler) {
            this.handlers[topic].splice(i, 1);
            break;
        }
    }
};

// handle message from script
// handle message from script
Communicator.prototype.handleMessage = function (msg, tab_id, sendResponse) {
    if (msg.topic in this.handlers) {
        // tab_id が有効な場合のみタブ情報を取得
        if (tab_id !== -1 && chrome.tabs) {
            chrome.tabs.get(tab_id, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    // タブが見つからない、またはコンテキストが違う場合は直接実行
                    this._execHandlers(msg, tab_id, null, sendResponse);
                    return;
                }
                this._execHandlers(msg, tab_id, tab.windowId, sendResponse);
            });
        } else {
            this._execHandlers(msg, tab_id, null, sendResponse);
        }
        return true; // Handled
    } else {
        // Only warn if running in a context where we expect to handle this (e.g. not Service Worker forwarding)
        // console.warn("Communicator: unknown topic " + msg.topic);
        return false; // Not handled
    }
};

Communicator.prototype._execHandlers = function (msg, tab_id, win_id, sendResponse) {
    if (!this.handlers[msg.topic]) {
        console.warn("Communicator: no handlers for topic " + msg.topic);
        if (sendResponse) sendResponse({ error: 'No handlers for topic' });
        return;
    }
    let handled = false;
    for (const x of this.handlers[msg.topic]) {
        if (x.win_id && win_id && x.win_id == win_id) {
            handled = true;
            x.handler(msg.data, tab_id, sendResponse);
            // Continue to allow multiple handlers to process the message
        } else if (!x.win_id) {
            // browser-wide message handler
            handled = true;
            x.handler(msg.data, tab_id, sendResponse);
            // Continue to allow multiple handlers to process the message
        }
    }
    // If no handler matched (e.g., win_id mismatch), still send a response to close the channel
    if (!handled && sendResponse) {
        // Collect debug info
        const debugInfo = this.handlers[msg.topic].map(h => ({
            handlerWinId: h.win_id,
            handlerWinIdType: typeof h.win_id,
            targetWinId: win_id,
            targetWinIdType: typeof win_id
        }));
        console.warn("[Communicator] No handler matched for topic:", msg.topic, "Debug:", debugInfo);

        sendResponse({
            state: 'idle',
            notHandled: true,
            debug: debugInfo
        });
    }
};

// send message to specific tab
// In Offscreen Document, chrome.tabs is not available, so we proxy through Service Worker
Communicator.prototype.postMessage = function (topic, data, tab_id, callback, frame) {
    console.log('[Communicator] postMessage called:', topic, 'tab_id:', tab_id, 'chrome.tabs available:', !!chrome.tabs);

    if (chrome.tabs && chrome.tabs.sendMessage) {
        // Direct access (Service Worker or extension page)
        console.log('[Communicator] Using direct chrome.tabs.sendMessage');
        chrome.tabs.sendMessage(
            tab_id,
            { topic: topic, data: data, _frame: frame },
            (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('[Communicator] Direct sendMessage error:', chrome.runtime.lastError.message);
                }
                if (callback) callback(response);
            }
        );
    } else {
        // Proxy through Service Worker (Offscreen Document)
        console.log('[Communicator] Proxying through Service Worker (SEND_TO_TAB)');
        chrome.runtime.sendMessage({
            command: 'SEND_TO_TAB',
            tab_id: tab_id,
            message: { topic: topic, data: data, _frame: frame }
        }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn('[Communicator] SEND_TO_TAB error:', chrome.runtime.lastError.message);
                if (callback) callback({ error: chrome.runtime.lastError.message, found: false });
            } else if (callback) {
                if (typeof response !== 'undefined') callback(response);
                else callback({ error: 'Empty response from Service Worker', found: false });
            }
        });
    }
};

Communicator.prototype.sendMessage = function (topic, data, tab_id, frame) {
    return new Promise((resolve, reject) => {
        if (chrome.tabs && chrome.tabs.sendMessage) {
            // Direct access (Service Worker or extension page)
            chrome.tabs.sendMessage(
                tab_id,
                { topic: topic, data: data, _frame: frame },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(response);
                    }
                }
            );
        } else {
            // Proxy through Service Worker (Offscreen Document)
            chrome.runtime.sendMessage({
                command: 'SEND_TO_TAB',
                tab_id: tab_id,
                message: { topic: topic, data: data, _frame: frame }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        }
    });
};

// broadcast message
Communicator.prototype.broadcastMessage = function (topic, data, win_id) {
    // MV3では特定のウィンドウのタブ全てに送る処理は重いので、
    // 必要に応じて実装するか、runtime.sendMessageで代用を検討
    if (chrome.tabs && chrome.tabs.query) {
        // Direct access (Service Worker or extension page)
        const queryInfo = win_id ? { windowId: win_id } : {};

        chrome.tabs.query(queryInfo, (tabs) => {
            if (chrome.runtime.lastError) {
                console.warn('[Communicator] broadcastMessage query error:', chrome.runtime.lastError.message);
                return;
            }
            if (!tabs) return;
            for (const tab of tabs) {
                chrome.tabs.sendMessage(tab.id, { topic: topic, data: data }, () => {
                    // Ignore errors for individual tabs
                    if (chrome.runtime.lastError) {
                        // Tab may not have content script
                    }
                });
            }
        });
    } else {
        // Proxy through Service Worker (Offscreen Document)
        chrome.runtime.sendMessage({
            command: 'BROADCAST_TO_WINDOW',
            win_id: win_id,
            message: { topic: topic, data: data }
        }, () => {
            if (chrome.runtime.lastError) {
                console.warn('[Communicator] BROADCAST_TO_WINDOW error:', chrome.runtime.lastError.message);
            }
        });
    }
};

var communicator = new Communicator();
