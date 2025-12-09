/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

(function(global) {
    'use strict';

    const CHANGE_TOPIC = 'vfs-change';
    const EXPORT_KEY = 'vfs_export_bundle';
    const LAST_EVENT_KEY = 'vfs_last_event';
    const DEFAULT_EXPORT_INTERVAL = 5 * 60 * 1000; // 5 minutes

    class FileSyncBridge {
        constructor(options = {}) {
            this.mode = options.mode || 'background';
            this.vfs = options.vfs || null;
            this.communicator = options.communicator || null;
            this.exportInterval = options.exportInterval || DEFAULT_EXPORT_INTERVAL;
            this.listeners = new Set();
            this.onChangeCallback = typeof options.onChange === 'function' ? options.onChange : null;
            this.timer = null;
            this.started = false;
            this._runtimeListener = null;
            this._vfsSubscription = null;
        }

        start() {
            if (this.started) {
                return;
            }
            this.started = true;

            if (this.mode === 'background' && this.vfs && typeof this.vfs.on === 'function') {
                this._vfsSubscription = this.vfs.on('change', (event) => {
                    this._handleVfsChange(event).catch((err) => {
                        console.error('FileSyncBridge VFS change handling failed', err);
                    });
                });
                this._scheduleExport();
            }

            this._runtimeListener = (message, sender, sendResponse) => {
                if (!message || !message.topic) {
                    return;
                }
                if (message.topic === CHANGE_TOPIC && this.mode === 'ui') {
                    this._notifyListeners(message.data);
                }
                if (message.topic === 'vfs-request-export' && this.mode === 'background') {
                    this._handleExportRequest(sendResponse);
                    return true;
                }
                return false;
            };
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
                chrome.runtime.onMessage.addListener(this._runtimeListener);
            }
        }

        stop() {
            if (!this.started) {
                return;
            }
            this.started = false;
            if (this._vfsSubscription) {
                this._vfsSubscription();
                this._vfsSubscription = null;
            }
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
            if (this._runtimeListener && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
                chrome.runtime.onMessage.removeListener(this._runtimeListener);
            }
        }

        onChange(handler) {
            if (typeof handler === 'function') {
                this.listeners.add(handler);
                return () => this.listeners.delete(handler);
            }
            return function noop() {};
        }

        async exportSnapshot() {
            if (!this.vfs || typeof this.vfs.exportTree !== 'function') {
                return null;
            }
            const bundle = await this.vfs.exportTree();
            await this._persistExport(bundle);
            return bundle;
        }

        async requestExportFromBackground() {
            return new Promise((resolve, reject) => {
                if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
                    return reject(new Error('Runtime messaging not available'));
                }
                chrome.runtime.sendMessage({ topic: 'vfs-request-export' }, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(response);
                    }
                });
            });
        }

        _scheduleExport() {
            if (!this.vfs) return;
            if (this.timer) {
                clearInterval(this.timer);
            }
            this.timer = setInterval(() => {
                this.exportSnapshot().catch((err) => {
                    console.warn('FileSyncBridge export failed', err);
                });
            }, this.exportInterval);
        }

        async _handleExportRequest(sendResponse) {
            try {
                const bundle = await this.exportSnapshot();
                if (sendResponse) {
                    sendResponse({ success: true, bundle });
                }
            } catch (err) {
                if (sendResponse) {
                    sendResponse({ success: false, error: err.message });
                }
            }
        }

        async _handleVfsChange(event) {
            const payload = Object.assign({ timestamp: Date.now() }, event || {});
            try {
                await this._persistEvent(payload);
            } catch (err) {
                console.warn('FileSyncBridge persistence failed', err);
            }
            this._notifyListeners(payload);
            const message = { topic: CHANGE_TOPIC, data: payload };
            if (this.communicator && typeof this.communicator.broadcastMessage === 'function') {
                // Pass undefined as win_id parameter to avoid payload being misinterpreted
                this.communicator.broadcastMessage(CHANGE_TOPIC, payload, undefined);
            }
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                // Properly handle chrome.runtime.lastError in callback
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('FileSyncBridge runtime message failed', chrome.runtime.lastError);
                    }
                });
            }
        }

        _notifyListeners(event) {
            if (this.onChangeCallback) {
                try {
                    this.onChangeCallback(event);
                } catch (err) {
                    console.error('FileSyncBridge onChange callback failed', err);
                }
            }
            this.listeners.forEach((handler) => {
                try {
                    handler(event);
                } catch (err) {
                    console.error('FileSyncBridge listener failed', err);
                }
            });
        }

        async _persistExport(bundle) {
            if (!bundle) return;
            await this._storageSet({ [EXPORT_KEY]: bundle });
        }

        async _persistEvent(event) {
            if (!event) return;
            await this._storageSet({ [LAST_EVENT_KEY]: event });
        }

        _storageSet(items) {
            return new Promise((resolve) => {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.set(items, () => {
                        if (chrome.runtime && chrome.runtime.lastError) {
                            console.warn('FileSyncBridge storage write failed', chrome.runtime.lastError);
                        }
                        resolve();
                    });
                } else {
                    Object.keys(items).forEach((key) => {
                        try {
                            localStorage.setItem(key, JSON.stringify(items[key]));
                        } catch (err) {
                            console.warn('FileSyncBridge storage write failed', err);
                        }
                    });
                    resolve();
                }
            });
        }
    }

    FileSyncBridge.CHANGE_TOPIC = CHANGE_TOPIC;
    FileSyncBridge.EXPORT_KEY = EXPORT_KEY;
    FileSyncBridge.LAST_EVENT_KEY = LAST_EVENT_KEY;

    global.FileSyncBridge = FileSyncBridge;
})(this);
