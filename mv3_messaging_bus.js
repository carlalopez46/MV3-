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

    /**
     * MessagingBus provides resilient runtime/tab messaging with retry, backoff, and acknowledgment
     * handling for MV3 service workers and offscreen documents.
     *
     * @param {chrome.runtime} runtime - chrome.runtime messaging API (required).
     * @param {chrome.tabs} tabs - chrome.tabs API for tab-targeted messaging (optional but recommended).
     * @param {Object} options - Optional configuration ({ maxRetries, backoffMs, ackTimeoutMs }).
     */
    class MessagingBus {
        constructor(runtime, tabs, options = {}) {
            if (!runtime || typeof runtime !== 'object') {
                throw new Error('MessagingBus: runtime parameter must be a valid object');
            }
            if (tabs && typeof tabs !== 'object') {
                throw new Error('MessagingBus: tabs parameter must be a valid object');
            }
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
            if (!this.tabs || typeof this.tabs.sendMessage !== 'function') {
                throw new Error('chrome.tabs is not available');
            }
            return this._retry(async () => {
                return await this._send((resolve, reject) => {
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
            // Any response containing an explicit ack/success/ok boolean (true or false) counts as an acknowledgment.
            // This avoids needless retries when a responder returns { success: false, error: ... } while preserving
            // compatibility with the preferred `ack: true` contract. Callers must still inspect the response fields to
            // determine success/failure semantics.
            return typeof response.ack === 'boolean' || typeof response.success === 'boolean' || typeof response.ok === 'boolean';
        }
    }

    globalScope.MessagingBus = MessagingBus;
})(typeof self !== 'undefined' ? self : this);