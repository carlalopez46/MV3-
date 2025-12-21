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

    function assertThrows(fn, context) {
        let threw = false;
        try {
            fn();
        } catch (err) {
            threw = true;
        }
        if (!threw) {
            throw new Error(`Expected function to throw (${context})`);
        }
    }

    const tests = [
        {
            name: 'hasPathTraversalSegments: detects ".." path segments',
            async run() {
                assert(typeof hasPathTraversalSegments === 'function', 'hasPathTraversalSegments must be available');
                assertEqual(hasPathTraversalSegments('Macros/test.iim'), false, 'no traversal in normal macro path');
                assertEqual(hasPathTraversalSegments('../Macros/test.iim'), true, 'detects leading traversal');
                assertEqual(hasPathTraversalSegments('Macros/../test.iim'), true, 'detects middle traversal');
                assertEqual(hasPathTraversalSegments('Macros\\\\..\\\\test.iim'), true, 'detects windows traversal');
                assertEqual(hasPathTraversalSegments('Macros/..foo/test.iim'), false, 'does not match ".." substring');
                assertEqual(hasPathTraversalSegments(''), false, 'empty string');
                assertEqual(hasPathTraversalSegments(null), false, 'null treated as empty');
            }
        },
        {
            name: 'sanitizeMacroFilePath: strips null bytes and trims',
            async run() {
                assert(typeof sanitizeMacroFilePath === 'function', 'sanitizeMacroFilePath must be available');
                assertEqual(sanitizeMacroFilePath('  Macros/test.iim  '), 'Macros/test.iim', 'trim behavior');
                assertEqual(sanitizeMacroFilePath('Macros/test.iim\0'), 'Macros/test.iim', 'null byte stripping');
                assertEqual(sanitizeMacroFilePath(''), '', 'empty path stays empty');
            }
        },
        {
            name: 'sanitizeMacroFilePath: throws on traversal segments',
            async run() {
                assertThrows(() => sanitizeMacroFilePath('../Macros/test.iim'), 'throws on leading traversal');
                assertThrows(() => sanitizeMacroFilePath('Macros/../test.iim'), 'throws on middle traversal');
                assertThrows(() => sanitizeMacroFilePath('Macros\\\\..\\\\test.iim'), 'throws on windows traversal');
            }
        },
        {
            name: 'isPrivilegedSender: accepts extension pages, rejects content-script senders',
            async run() {
                assert(typeof isPrivilegedSender === 'function', 'isPrivilegedSender must be available');
                const extensionId = 'ppafadkifjondfcbgnkenajflgimplbb';
                const origin = `chrome-extension://${extensionId}/`;

                assertEqual(
                    isPrivilegedSender({ id: extensionId, url: `${origin}panel.html` }, extensionId, origin),
                    true,
                    'panel sender should be privileged'
                );

                assertEqual(
                    isPrivilegedSender({ id: extensionId, url: 'https://example.com/', tab: { id: 123 } }, extensionId, origin),
                    false,
                    'content script sender should not be privileged'
                );

                assertEqual(
                    isPrivilegedSender({ id: extensionId, url: '', tab: { id: 123 } }, extensionId, origin),
                    false,
                    'tab sender with empty url should not be privileged'
                );

                assertEqual(
                    isPrivilegedSender({ id: extensionId }, extensionId, origin),
                    true,
                    'sender without url and without tab treated as privileged'
                );

                assertEqual(
                    isPrivilegedSender({ id: 'other', url: `${origin}panel.html` }, extensionId, origin),
                    false,
                    'wrong extension id not privileged'
                );
            }
        }
    ];

    const SecurityUtilsTestSuite = {
        async run() {
            resetResults();
            log('='.repeat(80));
            log('Security Utils Test Suite');
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
        window.SecurityUtilsTestSuite = SecurityUtilsTestSuite;
    } else if (typeof global !== 'undefined') {
        global.SecurityUtilsTestSuite = SecurityUtilsTestSuite;
    }
})();
