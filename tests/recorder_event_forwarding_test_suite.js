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
            name: 'Recorder.addListeners: offscreen skips native tab/download/webNavigation listeners',
            async run() {
                assert(typeof Recorder === 'function', 'Recorder must be available');

                const originalChrome = globalThis.chrome;
                const originalPathname = globalThis.location && globalThis.location.pathname;

                let tabListenerAdds = 0;
                let downloadListenerAdds = 0;
                let webNavListenerAdds = 0;

                try {
                    if (!globalThis.location) {
                        globalThis.location = { pathname: '/' };
                    }
                    globalThis.location.pathname = '/offscreen.html';

                    const makeEvent = (counter) => ({
                        addListener() { counter.count++; },
                        removeListener() { }
                    });

                    const tabCounter = { count: 0 };
                    const dlCounter = { count: 0 };
                    const navCounter = { count: 0 };

                    globalThis.chrome = {
                        tabs: {
                            onActivated: makeEvent(tabCounter),
                            onCreated: makeEvent(tabCounter),
                            onUpdated: makeEvent(tabCounter),
                            onRemoved: makeEvent(tabCounter),
                            onMoved: makeEvent(tabCounter),
                            onAttached: makeEvent(tabCounter),
                            onDetached: makeEvent(tabCounter)
                        },
                        downloads: {
                            onCreated: makeEvent(dlCounter)
                        },
                        webNavigation: {
                            onCommitted: makeEvent(navCounter)
                        },
                        runtime: {
                            lastError: null
                        }
                    };

                    const fakeRecorder = {
                        win_id: 1,
                        onActivated() { },
                        onCreated() { },
                        onUpdated() { },
                        onRemoved() { },
                        onMoved() { },
                        onAttached() { },
                        onDetached() { },
                        _onDownloadCreated() { },
                        onCommitted() { }
                    };

                    Recorder.prototype.addListeners.call(fakeRecorder);

                    tabListenerAdds = tabCounter.count;
                    downloadListenerAdds = dlCounter.count;
                    webNavListenerAdds = navCounter.count;

                    assertEqual(tabListenerAdds, 0, 'native tab listeners should be skipped in offscreen');
                    assertEqual(downloadListenerAdds, 0, 'native download listener should be skipped in offscreen');
                    assertEqual(webNavListenerAdds, 0, 'native webNavigation listener should be skipped in offscreen');
                } finally {
                    globalThis.chrome = originalChrome;
                    if (globalThis.location) {
                        globalThis.location.pathname = originalPathname || '/';
                    }
                }
            }
	        },
	        {
	            name: 'Recorder.onNavigation: forward_back suppresses URL GOTO and records BACK',
	            async run() {
	                assert(typeof Recorder === 'function', 'Recorder must be available');

	                const originalChrome = globalThis.chrome;

	                try {
	                    globalThis.chrome = {
	                        tabs: {
	                            get(tabId, cb) {
	                                cb({ id: tabId, windowId: 100, url: 'https://example.test/page' });
	                            }
	                        },
	                        runtime: {
	                            lastError: null,
	                            sendMessage(_msg, cb) { cb({}); }
	                        }
	                    };

	                    const recorder = {
	                        recording: true,
	                        win_id: 100,
	                        actions: ['URL GOTO=https://example.test/page'],
	                        lastTabUrls: new Map(),
	                        peekLastAction() {
	                            return this.actions.length ? this.actions[this.actions.length - 1] : '';
	                        },
	                        popLastAction() {
	                            return this.actions.pop();
	                        },
	                        recordAction(cmd) {
	                            this.actions.push(cmd);
	                            return true;
	                        }
	                    };

	                    Recorder.prototype.onNavigation.call(recorder, {
	                        tabId: 1,
	                        url: 'https://example.test/page',
	                        transitionType: 'link',
	                        transitionQualifiers: ['forward_back']
	                    });

	                    await new Promise(resolve => setTimeout(resolve, 0));

	                    assertEqual(recorder.actions.length, 1, 'should replace URL GOTO with BACK');
	                    assertEqual(recorder.actions[0], 'BACK', 'should record BACK');
	                    assertEqual(recorder.lastTabUrls.get(1), 'https://example.test/page', 'should prime lastTabUrls for tab');

	                    // Ensure onTabUpdated does not add URL GOTO for the same navigation after BACK.
	                    Recorder.prototype.onTabUpdated.call(
	                        recorder,
	                        1,
	                        { url: 'https://example.test/page', status: 'loading' },
	                        { id: 1, windowId: 100, url: 'https://example.test/page' }
	                    );

	                    await new Promise(resolve => setTimeout(resolve, 0));

	                    assertEqual(recorder.actions.length, 1, 'onTabUpdated should be deduped after BACK');
	                } finally {
	                    globalThis.chrome = originalChrome;
	                }
	            }
	        },
	        {
	            name: 'Recorder.onDownloadCreated: inserts ONDOWNLOAD before last action when tab matches window',
	            async run() {
	                assert(typeof Recorder === 'function', 'Recorder must be available');

                const originalChrome = globalThis.chrome;
                try {
                    globalThis.chrome = {
                        tabs: {
                            get(tabId, cb) {
                                cb({ id: tabId, windowId: 100, url: 'https://example.test/' });
                            }
                        },
                        runtime: {
                            lastError: null,
                            sendMessage(_msg, cb) { cb({}); }
                        }
                    };

                    const recorder = {
                        recording: true,
                        actions: ['TAG POS=1 TYPE=A ATTR=HREF:*'],
                        win_id: 100,
                        popLastAction() { return this.actions.pop(); },
                        recordAction(cmd) { this.actions.push(cmd); return true; }
                    };

                    Recorder.prototype.onDownloadCreated.call(recorder, { id: 1, tabId: 1 }, { tab_id: 1 });

                    await new Promise(resolve => setTimeout(resolve, 0));

                    assertEqual(recorder.actions.length, 2, 'should have ONDOWNLOAD + original action');
                    assert(typeof recorder.actions[0] === 'string' && recorder.actions[0].startsWith('ONDOWNLOAD'), 'first action should be ONDOWNLOAD');
                    assertEqual(recorder.actions[1], 'TAG POS=1 TYPE=A ATTR=HREF:*', 'original action should be restored after ONDOWNLOAD');
                } finally {
                    globalThis.chrome = originalChrome;
                }
            }
        },
        {
            name: 'Recorder.onDownloadCreated: ignores download when tab belongs to different window',
            async run() {
                assert(typeof Recorder === 'function', 'Recorder must be available');

                const originalChrome = globalThis.chrome;
                try {
                    globalThis.chrome = {
                        tabs: {
                            get(tabId, cb) {
                                cb({ id: tabId, windowId: 999, url: 'https://other.test/' });
                            }
                        },
                        runtime: {
                            lastError: null,
                            sendMessage(_msg, cb) { cb({}); }
                        }
                    };

                    const recorder = {
                        recording: true,
                        actions: ['TAG POS=1 TYPE=A ATTR=HREF:*'],
                        win_id: 100,
                        popLastAction() { return this.actions.pop(); },
                        recordAction(cmd) { this.actions.push(cmd); return true; }
                    };

                    Recorder.prototype.onDownloadCreated.call(recorder, { id: 1, tabId: 1 }, { tab_id: 1 });

                    await new Promise(resolve => setTimeout(resolve, 0));

                    assertEqual(recorder.actions.length, 1, 'should not modify actions for different window');
                    assertEqual(recorder.actions[0], 'TAG POS=1 TYPE=A ATTR=HREF:*', 'original action should remain unchanged');
                } finally {
                    globalThis.chrome = originalChrome;
                }
            }
        },
        {
            name: 'Recorder.onDownloadCreated: no-op when not recording',
            async run() {
                assert(typeof Recorder === 'function', 'Recorder must be available');

                const originalChrome = globalThis.chrome;
                try {
                    globalThis.chrome = {
                        tabs: {
                            get(tabId, cb) {
                                cb({ id: tabId, windowId: 100, url: 'https://example.test/' });
                            }
                        },
                        runtime: {
                            lastError: null,
                            sendMessage(_msg, cb) { cb({}); }
                        }
                    };

                    const recorder = {
                        recording: false,
                        actions: ['TAG POS=1 TYPE=A ATTR=HREF:*'],
                        win_id: 100,
                        popLastAction() { return this.actions.pop(); },
                        recordAction(cmd) { this.actions.push(cmd); return true; }
                    };

                    Recorder.prototype.onDownloadCreated.call(recorder, { id: 1, tabId: 1 }, { tab_id: 1 });

                    await new Promise(resolve => setTimeout(resolve, 0));

                    assertEqual(recorder.actions.length, 1, 'should not modify actions when not recording');
                    assertEqual(recorder.actions[0], 'TAG POS=1 TYPE=A ATTR=HREF:*', 'original action should remain unchanged');
                } finally {
                    globalThis.chrome = originalChrome;
                }
            }
        }
    ];

    const RecorderEventForwardingTestSuite = {
        async run() {
            resetResults();
            log('='.repeat(80));
            log('Recorder Event Forwarding Test Suite');
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
        window.RecorderEventForwardingTestSuite = RecorderEventForwardingTestSuite;
    } else if (typeof global !== 'undefined') {
        global.RecorderEventForwardingTestSuite = RecorderEventForwardingTestSuite;
    }
})();
