(function () {
    'use strict';

    const results = { passed: 0, failed: 0, skipped: 0 };
    const errors = [];

    function log(message) {
        if (typeof console !== 'undefined') {
            console.log(message);
        }
    }

    function resetResults() {
        results.passed = 0;
        results.failed = 0;
        results.skipped = 0;
        errors.length = 0;
    }

    function assert(condition, message) {
        if (!condition) {
            throw new Error(message || 'Assertion failed');
        }
    }

    function assertEqual(actual, expected, context) {
        if (actual !== expected) {
            throw new Error(`Expected "${expected}" but got "${actual}" (${context})`);
        }
    }

    const tests = [
        {
            name: 'MacroPlayer.saveTarget: offscreen proxies downloads via DOWNLOADS_DOWNLOAD',
            async run() {
                assert(typeof MacroPlayer === 'function', 'MacroPlayer must be available');

                const originalChrome = globalThis.chrome;
                const originalLocation = globalThis.location;
                const originalWindow = globalThis.window;

                try {
                    if (!globalThis.window) globalThis.window = {};
                    if (!globalThis.location) globalThis.location = { pathname: '/' };
                    globalThis.location.pathname = '/offscreen.html';
                    globalThis.window.location = globalThis.location;

                    const messages = [];
                    let directDownloadCalls = 0;

                    globalThis.chrome = {
                        downloads: {
                            download() {
                                directDownloadCalls += 1;
                            }
                        },
                        runtime: {
                            lastError: null,
                            sendMessage(message, cb) {
                                messages.push(message);
                                if (typeof cb === 'function') cb({ success: true, downloadId: 123 });
                            }
                        }
                    };

                    const fakePlayer = {
                        win_id: 10,
                        tab_id: 22,
                        handleError() {
                            throw new Error('handleError should not be called for proxy path');
                        }
                    };

                    MacroPlayer.prototype.saveTarget.call(fakePlayer, 'https://example.test/file.bin');

                    assertEqual(directDownloadCalls, 0, 'direct chrome.downloads.download should not be called in offscreen');
                    assertEqual(messages.length, 1, 'should send one proxy message');
                    assertEqual(messages[0].command, 'DOWNLOADS_DOWNLOAD', 'proxy command name');
                    assertEqual(messages[0].win_id, 10, 'win_id forwarded');
                    assertEqual(messages[0].tab_id, 22, 'tab_id forwarded');
                } finally {
                    globalThis.chrome = originalChrome;
                    globalThis.location = originalLocation;
                    globalThis.window = originalWindow;
                }
            }
        },
        {
            name: 'DownloadCorrelationTracker: consumes pending correlation for extension download (race-safe)',
            async run() {
                assert(typeof DownloadCorrelationTracker === 'function', 'DownloadCorrelationTracker must be available');

                let now = 1000;
                const tracker = new DownloadCorrelationTracker({ pendingTtlMs: 5000, now: () => now });

                const url = 'https://example.test/file.bin';
                const token = tracker.recordPending(url, { win_id: 10, tab_id: 22 }, 't1');
                assertEqual(token, 't1', 'token should be preserved');

                const corr = tracker.consumePendingForCreated({ id: 7, url, byExtensionId: 'ext-1' }, 'ext-1');
                assert(corr && typeof corr === 'object', 'correlation should be returned');
                assertEqual(corr.win_id, 10, 'win_id should match');
                assertEqual(corr.tab_id, 22, 'tab_id should match');

                const active = tracker.getActive(7);
                assert(active && active.win_id === 10 && active.tab_id === 22, 'active correlation should be set');
            }
        },
        {
            name: 'DownloadCorrelationTracker: matches pending using originalUrl when final url differs',
            async run() {
                assert(typeof DownloadCorrelationTracker === 'function', 'DownloadCorrelationTracker must be available');

                const tracker = new DownloadCorrelationTracker({ pendingTtlMs: 5000, now: () => 1000 });
                tracker.recordPending('https://example.test/original', { win_id: 5, tab_id: 6 }, 't1');

                const corr = tracker.consumePendingForCreated({
                    id: 42,
                    url: 'https://example.test/final',
                    originalUrl: 'https://example.test/original',
                    byExtensionId: 'ext'
                }, 'ext');

                assert(corr && corr.win_id === 5 && corr.tab_id === 6, 'should match correlation via originalUrl');
            }
        },
        {
            name: 'DownloadCorrelationTracker: does not consume pending when extensionId mismatches',
            async run() {
                assert(typeof DownloadCorrelationTracker === 'function', 'DownloadCorrelationTracker must be available');

                const tracker = new DownloadCorrelationTracker({ pendingTtlMs: 5000, now: () => 1000 });
                const url = 'https://example.test/a';
                tracker.recordPending(url, { win_id: 1, tab_id: 2 }, 't1');

                const corr = tracker.consumePendingForCreated({ id: 1, url, byExtensionId: 'ext-A' }, 'ext-B');
                assertEqual(corr, null, 'should not match');
            }
        },
        {
            name: 'DownloadCorrelationTracker: accepts pending when byExtensionId is missing',
            async run() {
                assert(typeof DownloadCorrelationTracker === 'function', 'DownloadCorrelationTracker must be available');

                const tracker = new DownloadCorrelationTracker({ pendingTtlMs: 5000, now: () => 1000 });
                const url = 'https://example.test/missing';
                tracker.recordPending(url, { win_id: 3, tab_id: 4 }, 't1');

                const corr = tracker.consumePendingForCreated({ id: 2, url }, 'ext-A');
                assert(corr && corr.win_id === 3 && corr.tab_id === 4, 'should match without byExtensionId');
            }
        },
        {
            name: 'DownloadCorrelationTracker: pending TTL expiration prunes stale entries',
            async run() {
                assert(typeof DownloadCorrelationTracker === 'function', 'DownloadCorrelationTracker must be available');

                let now = 1000;
                const tracker = new DownloadCorrelationTracker({ pendingTtlMs: 100, now: () => now });
                const url = 'https://example.test/stale';
                tracker.recordPending(url, { win_id: 1, tab_id: 2 }, 't1');

                now = 2000;
                const corr = tracker.consumePendingForCreated({ id: 99, url, byExtensionId: 'ext' }, 'ext');
                assertEqual(corr, null, 'stale pending entry should not be used');
            }
        },
        {
            name: 'DownloadCorrelationTracker: removePending removes by token (idempotent)',
            async run() {
                assert(typeof DownloadCorrelationTracker === 'function', 'DownloadCorrelationTracker must be available');

                const tracker = new DownloadCorrelationTracker({ pendingTtlMs: 5000, now: () => 1000 });
                const url = 'https://example.test/remove';
                tracker.recordPending(url, { win_id: 1, tab_id: 2 }, 't1');

                assertEqual(tracker.removePending(url, 't1'), true, 'should remove existing token');
                assertEqual(tracker.removePending(url, 't1'), false, 'second removal should be no-op');
            }
        },
        {
            name: 'DownloadCorrelationTracker: FIFO ordering for same URL',
            async run() {
                assert(typeof DownloadCorrelationTracker === 'function', 'DownloadCorrelationTracker must be available');

                const tracker = new DownloadCorrelationTracker({ pendingTtlMs: 5000, now: () => 1000 });
                const url = 'https://example.test/fifo';
                tracker.recordPending(url, { win_id: 1, tab_id: 11 }, 'a');
                tracker.recordPending(url, { win_id: 2, tab_id: 22 }, 'b');

                const first = tracker.consumePendingForCreated({ id: 1, url, byExtensionId: 'ext' }, 'ext');
                const second = tracker.consumePendingForCreated({ id: 2, url, byExtensionId: 'ext' }, 'ext');

                assertEqual(first.win_id, 1, 'first win_id');
                assertEqual(first.tab_id, 11, 'first tab_id');
                assertEqual(second.win_id, 2, 'second win_id');
                assertEqual(second.tab_id, 22, 'second tab_id');
            }
        }
    ];

    const DownloadCorrelationTestSuite = {
        async run() {
            resetResults();
            log('='.repeat(80));
            log('Download Correlation Test Suite');
            log('='.repeat(80));

            for (const test of tests) {
                try {
                    await test.run();
                    log(`[PASS] ${test.name}`);
                    results.passed++;
                } catch (err) {
                    log(`[FAIL] ${test.name}: ${err.message}`);
                    if (err && err.stack) {
                        log(err.stack);
                    } else {
                        log(String(err));
                    }
                    results.failed++;
                    errors.push({ name: test.name, error: err.message, stack: err.stack });
                }
            }

            return { results, errors };
        }
    };

    if (typeof window !== 'undefined') {
        window.DownloadCorrelationTestSuite = DownloadCorrelationTestSuite;
    } else if (typeof global !== 'undefined') {
        global.DownloadCorrelationTestSuite = DownloadCorrelationTestSuite;
    }
})();
