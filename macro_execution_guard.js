/**
 * Small in-memory deduplication helper for MV3 contexts.
 *
 * Usage:
 *   const guard = createRecentKeyGuard({ ttlMs: 1000, maxKeys: 200 });
 *   const { allowed } = guard('some-key');
 */
(function (global) {
    'use strict';

    function toPositiveInt(value, fallback) {
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        return Math.max(1, Math.floor(num));
    }

    function toNonNegativeInt(value, fallback) {
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        return Math.max(0, Math.floor(num));
    }

    /**
     * Creates a guard that suppresses duplicate keys seen within a time window.
     *
     * @param {Object} [options]
     * @param {number} [options.ttlMs=1000] Time window in ms to treat as duplicate.
     * @param {number} [options.maxKeys=500] Bound on tracked keys to avoid leaks.
     * @param {() => number} [options.clock] Optional clock for testing.
     * @returns {(key: string, now?: number) => ({allowed: boolean, reason?: string, ageMs?: number, ttlMs: number})}
     */
    function createRecentKeyGuard(options) {
        const opts = options && typeof options === 'object' ? options : {};
        const ttlMs = toNonNegativeInt(opts.ttlMs, 1000);
        const maxKeys = toPositiveInt(opts.maxKeys, 500);
        const clock = typeof opts.clock === 'function' ? opts.clock : () => Date.now();
        const seen = new Map(); // key -> lastSeenTs

        function prune(now) {
            if (ttlMs > 0) {
                for (const [key, ts] of seen) {
                    if (now - ts >= ttlMs) {
                        seen.delete(key);
                    }
                }
            }

            while (seen.size > maxKeys) {
                const firstKey = seen.keys().next().value;
                if (typeof firstKey === 'undefined') break;
                seen.delete(firstKey);
            }
        }

        function check(key, now) {
            const ts = typeof now === 'number' && Number.isFinite(now) ? now : clock();
            prune(ts);

            if (typeof key !== 'string' || key.length === 0) {
                return { allowed: true, reason: 'no-key', ttlMs };
            }

            if (seen.has(key)) {
                const last = seen.get(key);
                const ageMs = ts - last;
                if (ageMs < ttlMs) {
                    return { allowed: false, reason: 'duplicate', ageMs, ttlMs };
                }
            }

            // Refresh insertion order for this key.
            if (seen.has(key)) {
                seen.delete(key);
            }
            seen.set(key, ts);

            // Enforce size bound after insertion.
            prune(ts);

            return { allowed: true, ttlMs };
        }

        check.clear = () => seen.clear();
        check._seen = seen;
        check.ttlMs = ttlMs;
        check.maxKeys = maxKeys;

        return check;
    }

    global.createRecentKeyGuard = createRecentKeyGuard;
})(typeof globalThis !== 'undefined' ? globalThis : this);
