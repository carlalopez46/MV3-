/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

// incapsulates all content scripts-extensions communications
function Communicator() {
    this.handlers = Object.create(null);
    this.addListeners();
}

function isOffscreenDocument() {
    if (typeof location === 'undefined' || !location || typeof location.href !== 'string') return false;
    return location.href.endsWith('/offscreen.html');
}

// add listener for extension events
Communicator.prototype.addListeners = function () {
    const inOffscreenDocument = isOffscreenDocument();
    // MV3対応: chrome.extension.onRequest -> chrome.runtime.onMessage
    chrome.runtime.onMessage.addListener(
        (msg, sender, sendResponse) => {
            // 内部メッセージや他からのメッセージをフィルタリング
            if (!msg || !msg.topic) return;
            // if (inOffscreenDocument && sender && sender.tab) {
            //    // Offscreen must only handle content-script topics via SW forwarding.
            //    return;
            // }

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
        if (sendResponse) sendResponse({ error: 'No handlers for topic', state: 'idle' });
        return;
    }
    // Normalize win_id to number for consistent comparison
    const normalizedWinId = (win_id !== null && win_id !== undefined) ? Number(win_id) : null;

    let handled = false;
    for (const x of this.handlers[msg.topic]) {
        // Normalize handler's win_id as well
        const handlerWinId = (x.win_id !== null && x.win_id !== undefined) ? Number(x.win_id) : null;

        if (handlerWinId && normalizedWinId && handlerWinId === normalizedWinId) {
            // Exact window match
            handled = true;
            x.handler(msg.data, tab_id, sendResponse);
            // Continue to allow multiple handlers to process the message
        } else if (!handlerWinId) {
            // browser-wide message handler (no specific window)
            handled = true;
            x.handler(msg.data, tab_id, sendResponse);
            // Continue to allow multiple handlers to process the message
        } else if (!normalizedWinId && handlerWinId && (msg.topic === 'record-action' || msg.topic === 'password-element-focused')) {
            // Special case for recording-related messages: if win_id is not provided,
            // try to route to any registered recorder. This can happen when
            // messages come from iframes or when tab info is unavailable.

            // Check if context and recorder exist and are recording
            // This prevents routing to an idle recorder which would reject the action
            let isActive = true;
            if (typeof context !== 'undefined' && context[handlerWinId] && context[handlerWinId].recorder) {
                if (!context[handlerWinId].recorder.recording) {
                    isActive = false;
                }
            }

            if (isActive) {
                handled = true;
                x.handler(msg.data, tab_id, sendResponse);
            }
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
        // query-state is frequently sent to check recorder state, don't warn for it
        // as it's expected that handlers from different windows won't match
        if (msg.topic !== 'query-state') {
            console.warn("[Communicator] No handler matched for topic:", msg.topic, "Debug:", JSON.stringify(debugInfo));
        }

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
                    if (callback) callback({ error: chrome.runtime.lastError.message, found: false });
                } else if (callback) {
                    callback(response);
                }
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

const communicator = new Communicator();

// Make communicator globally accessible for dependency verification
globalThis.communicator = communicator;
