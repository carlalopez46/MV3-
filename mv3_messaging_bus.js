/*
 * MV3 Messaging Bus
 * Provides resilient runtime/tab messaging with retry/backoff semantics
 * to eliminate unchecked runtime.lastError propagation.
 */
(function (globalScope) {
    const DEFAULT_OPTIONS = {
        maxRetries: 3,
        backoffMs: 150,
        ackTimeoutMs: 500
    };

    class MessagingBus {
        constructor(runtime, tabs, options = {}) {
            this.runtime = runtime;
            this.tabs = tabs;
            this.options = Object.assign({}, DEFAULT_OPTIONS, options);
        }

        async sendRuntime(message, opts = {}) {
            if (!this.runtime || typeof this.runtime.sendMessage !== 'function') {
                throw new Error('chrome.runtime is not available');
            }
            return this._retry(async () => {
                return await this._send((resolve, reject) => {
                    this.runtime.sendMessage(message, (response) => {
                        this._resolveWithLastError(resolve, reject, response);
                    });
                });
            }, opts, 'runtime');
        }

        async sendToTab(tabId, message, opts = {}) {
            return this._retry(async () => {
                return await this._send((resolve, reject) => {
                    if (!this.tabs || !this.tabs.sendMessage) {
                        reject(new Error('chrome.tabs is not available'));
                        return;
                    }
                    this.tabs.sendMessage(tabId, message, (response) => {
                        this._resolveWithLastError(resolve, reject, response);
                    });
                });
            }, opts, `tab-${tabId}`);
        }

        async _send(executor) {
            return new Promise((resolve, reject) => {
                try {
                    executor(resolve, reject);
                } catch (err) {
                    reject(err);
                }
            });
        }

        async _retry(fn, opts, channelLabel) {
            const maxRetries = opts.maxRetries ?? this.options.maxRetries;
            const baseBackoff = opts.backoffMs ?? this.options.backoffMs;
            const ackTimeout = opts.ackTimeoutMs ?? this.options.ackTimeoutMs;
            const enforceAck = opts.expectAck === true;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                let timeoutId = null;
                try {
                    const fnPromise = fn();
                    const resultPromise = enforceAck && typeof ackTimeout === 'number'
                        ? Promise.race([
                            fnPromise,
                            new Promise((_, reject) => {
                                timeoutId = setTimeout(() => reject(new Error(`Ack timeout on ${channelLabel || 'channel'}`)), ackTimeout);
                            })
                        ])
                        : fnPromise;
                    const result = await resultPromise;
                    if (timeoutId) clearTimeout(timeoutId);
                    if (enforceAck && !this._hasAck(result)) {
                        throw new Error(`No ack received on ${channelLabel || 'channel'}`);
                    }
                    return result;
                } catch (error) {
                    // Clear any pending timeout if the primary promise rejected first.
                    if (timeoutId) clearTimeout(timeoutId);
                    if (attempt >= maxRetries || !this._isTransient(error)) {
                        throw error;
                    }
                    const delay = baseBackoff * Math.pow(2, attempt);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
        }

        _resolveWithLastError(resolve, reject, response) {
            if (this.runtime && this.runtime.lastError) {
                reject(this.runtime.lastError);
            } else {
                resolve(response);
            }
        }

        _isTransient(error) {
            if (!error || typeof error.message !== 'string') return false;
            return error.message.includes('Receiving end does not exist') ||
                error.message.includes('Could not establish connection') ||
                error.message.includes('The message port closed');
        }

        _hasAck(response) {
            if (!response) return false;
            // For compatibility across legacy callers, treat boolean true for any of these keys as an acknowledgment
            // (callers should prefer the explicit `ack: true` contract going forward).
            if (response.ack === true || response.success === true || response.ok === true) return true;
            // Explicit error responses still count as acknowledgments to avoid needless retries when a responder
            // returns success: false with an error payload.
            return typeof response.ack === 'boolean' || typeof response.success === 'boolean' || typeof response.ok === 'boolean';
        }
    }

    globalScope.MessagingBus = MessagingBus;
})(typeof self !== 'undefined' ? self : this);