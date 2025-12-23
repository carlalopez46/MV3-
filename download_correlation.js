// Lightweight correlation tracker for download events in MV3.
// Used to route chrome.downloads.onCreated/onChanged back to the originating window/tab,
// including the race where onCreated may fire before chrome.downloads.download callback.
(function (root) {
    'use strict';

    function isNonEmptyString(value) {
        return typeof value === 'string' && value.length > 0;
    }

    function toFiniteNumber(value) {
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    }

    function cloneCorrelation(correlation) {
        if (!correlation || typeof correlation !== 'object') return {};
        const win_id = toFiniteNumber(correlation.win_id);
        const tab_id = toFiniteNumber(correlation.tab_id);
        const out = {};
        if (win_id !== null) out.win_id = win_id;
        if (tab_id !== null) out.tab_id = tab_id;
        return out;
    }

    class DownloadCorrelationTracker {
        constructor(options) {
            const opts = options && typeof options === 'object' ? options : {};
            this._activeById = new Map();
            this._pendingByUrl = new Map();
            this._pendingTtlMs = Number.isFinite(opts.pendingTtlMs) ? opts.pendingTtlMs : 10000;
            this._maxPendingUrls = Number.isFinite(opts.maxPendingUrls) ? opts.maxPendingUrls : 200;
            this._maxPendingPerUrl = Number.isFinite(opts.maxPendingPerUrl) ? opts.maxPendingPerUrl : 5;
            this._now = typeof opts.now === 'function' ? opts.now : () => Date.now();
        }

        getActive(downloadId) {
            return this._activeById.get(downloadId);
        }

        setActive(downloadId, correlation) {
            if (!Number.isInteger(downloadId) || downloadId < 0) return;
            this._activeById.set(downloadId, cloneCorrelation(correlation));
        }

        clearActive(downloadId) {
            this._activeById.delete(downloadId);
        }

        recordPending(url, correlation, token) {
            if (!isNonEmptyString(url)) return null;
            const corr = cloneCorrelation(correlation);
            if (!('win_id' in corr) && !('tab_id' in corr)) return null;

            const now = this._now();
            this._prunePending(now);

            const queue = this._pendingByUrl.get(url) || [];
            if (!this._pendingByUrl.has(url)) this._pendingByUrl.set(url, queue);

            const entry = {
                token: isNonEmptyString(token) ? token : `${now}-${Math.random().toString(36).slice(2, 10)}`,
                win_id: corr.win_id,
                tab_id: corr.tab_id,
                requestedAt: now
            };

            queue.push(entry);
            if (queue.length > this._maxPendingPerUrl) {
                queue.splice(0, queue.length - this._maxPendingPerUrl);
            }

            this._enforceMaxUrls();
            return entry.token;
        }

        removePending(url, token) {
            if (!isNonEmptyString(url) || !isNonEmptyString(token)) return false;
            const queue = this._pendingByUrl.get(url);
            if (!queue || !queue.length) return false;
            const idx = queue.findIndex((entry) => entry && entry.token === token);
            if (idx === -1) return false;
            queue.splice(idx, 1);
            if (queue.length === 0) this._pendingByUrl.delete(url);
            return true;
        }

        consumePendingForCreated(downloadItem, extensionId) {
            if (!downloadItem || !Number.isInteger(downloadItem.id) || downloadItem.id < 0) return null;

            const existing = this._activeById.get(downloadItem.id);
            if (existing) return existing;

            if (isNonEmptyString(extensionId) && isNonEmptyString(downloadItem.byExtensionId) && downloadItem.byExtensionId !== extensionId) {
                return null;
            }

            const candidateUrls = [];
            if (isNonEmptyString(downloadItem.originalUrl)) {
                candidateUrls.push(downloadItem.originalUrl);
            }
            if (isNonEmptyString(downloadItem.url) && downloadItem.url !== downloadItem.originalUrl) {
                candidateUrls.push(downloadItem.url);
            }
            if (!candidateUrls.length) return null;

            const now = this._now();
            this._prunePending(now);

            let entry = null;
            for (const url of candidateUrls) {
                const queue = this._pendingByUrl.get(url);
                if (!queue || queue.length === 0) continue;

                while (queue.length) {
                    const candidate = queue.shift();
                    if (candidate && typeof candidate.requestedAt === 'number' && now - candidate.requestedAt <= this._pendingTtlMs) {
                        entry = candidate;
                        break;
                    }
                }

                if (queue.length === 0) this._pendingByUrl.delete(url);
                if (entry) break;
            }

            if (!entry) return null;

            const correlation = cloneCorrelation(entry);
            this._activeById.set(downloadItem.id, correlation);
            return correlation;
        }

        _prunePending(now) {
            const cutoff = now - this._pendingTtlMs;
            for (const [url, queue] of this._pendingByUrl.entries()) {
                if (!Array.isArray(queue) || queue.length === 0) {
                    this._pendingByUrl.delete(url);
                    continue;
                }
                const fresh = queue.filter((entry) => entry && typeof entry.requestedAt === 'number' && entry.requestedAt >= cutoff);
                if (fresh.length) {
                    this._pendingByUrl.set(url, fresh);
                } else {
                    this._pendingByUrl.delete(url);
                }
            }
        }

        _enforceMaxUrls() {
            const overflow = this._pendingByUrl.size - this._maxPendingUrls;
            if (overflow <= 0) return;

            const entries = Array.from(this._pendingByUrl.entries()).map(([url, queue]) => ({
                url,
                oldest: queue && queue.length ? queue[0].requestedAt : 0
            }));
            entries.sort((a, b) => a.oldest - b.oldest);
            for (let i = 0; i < overflow; i++) {
                this._pendingByUrl.delete(entries[i].url);
            }
        }
    }

    root.DownloadCorrelationTracker = DownloadCorrelationTracker;
})(typeof globalThis !== 'undefined' ? globalThis : this);
