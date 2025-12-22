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

    function assertSome(items, predicate, message) {
        const ok = Array.isArray(items) && items.some(predicate);
        if (!ok) {
            throw new Error(message || 'Expected at least one matching item');
        }
    }

    async function dispatchRuntimeMessage(message, sender) {
        assert(globalThis.chrome && chrome.runtime && chrome.runtime.onMessage, 'chrome.runtime.onMessage must exist');
        assert(typeof chrome.runtime.onMessage.dispatch === 'function', 'chrome.runtime.onMessage.dispatch must exist');

        const responses = [];
        function sendResponse(payload) {
            responses.push(payload);
        }

        chrome.runtime.onMessage.dispatch(message, sender, sendResponse);
        await new Promise((resolve) => setTimeout(resolve, 0));
        return responses;
    }

    function privilegedSender(urlPath = 'panel.html') {
        return {
            id: chrome.runtime.id,
            url: chrome.runtime.getURL(urlPath)
        };
    }

    function unprivilegedSender() {
        return {
            id: chrome.runtime.id,
            url: 'https://example.test/',
            tab: { id: 1, url: 'https://example.test/' }
        };
    }

    const tests = [
        {
            name: 'offscreen.js blocks eval_in_sandbox from unprivileged senders',
            async run() {
                const id = 't_eval_denied';
                const responses = await dispatchRuntimeMessage(
                    { type: 'eval_in_sandbox', id, code: '1+1' },
                    unprivilegedSender()
                );

                assertSome(
                    responses,
                    (r) => r && r.type === 'eval_in_sandbox_result' && r.id === id && r.error && r.error.message === 'Access denied',
                    'Expected Access denied eval_in_sandbox_result response'
                );
            }
        },
        {
            name: 'offscreen.js blocks clipboard_write from unprivileged senders',
            async run() {
                const responses = await dispatchRuntimeMessage(
                    { type: 'clipboard_write', text: 'hello' },
                    unprivilegedSender()
                );

                assertSome(
                    responses,
                    (r) => r && r.success === false && r.error === 'Access denied',
                    'Expected Access denied clipboard_write response'
                );
            }
        },
        {
            name: 'offscreen.js allows eval_in_sandbox from privileged senders (not Access denied)',
            async run() {
                const id = 't_eval_allowed';
                const responses = await dispatchRuntimeMessage(
                    { type: 'eval_in_sandbox', id, code: '1+1' },
                    privilegedSender('offscreen.html')
                );

                assertSome(
                    responses,
                    (r) =>
                        r &&
                        r.type === 'eval_in_sandbox_result' &&
                        r.id === id &&
                        r.error &&
                        typeof r.error.message === 'string' &&
                        r.error.message !== 'Access denied',
                    'Expected non-Access-denied eval_in_sandbox_result response for privileged sender'
                );
            }
        }
    ];

    const OffscreenSecurityTestSuite = {
        async run() {
            resetResults();
            log('='.repeat(80));
            log('Offscreen Security Test Suite');
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
                    }
                    results.failed++;
                    errors.push({ name: test.name, error: err.message, stack: err.stack });
                }
            }

            return { results, errors };
        }
    };

    if (typeof window !== 'undefined') {
        window.OffscreenSecurityTestSuite = OffscreenSecurityTestSuite;
    } else if (typeof global !== 'undefined') {
        global.OffscreenSecurityTestSuite = OffscreenSecurityTestSuite;
    }
})();

