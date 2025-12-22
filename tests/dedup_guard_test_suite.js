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
            name: 'createRecentKeyGuard: blocks duplicate within ttl',
            async run() {
                assert(typeof createRecentKeyGuard === 'function', 'createRecentKeyGuard must be available');
                const guard = createRecentKeyGuard({ ttlMs: 100, maxKeys: 50 });

                const first = guard('k', 1000);
                assertEqual(first.allowed, true, 'first seen should be allowed');

                const second = guard('k', 1050);
                assertEqual(second.allowed, false, 'second seen within ttl should be blocked');
                assertEqual(second.reason, 'duplicate', 'reason should be duplicate');
                assert(typeof second.ageMs === 'number' && second.ageMs === 50, 'ageMs should be reported');
            }
        },
        {
            name: 'createRecentKeyGuard: allows after ttl boundary',
            async run() {
                const guard = createRecentKeyGuard({ ttlMs: 100, maxKeys: 50 });
                assertEqual(guard('k', 0).allowed, true, 'initial should be allowed');
                assertEqual(guard('k', 99).allowed, false, 'within ttl should be blocked');
                assertEqual(guard('k', 100).allowed, true, 'at ttl boundary should be allowed');
            }
        },
        {
            name: 'createRecentKeyGuard: empty keys do not crash',
            async run() {
                const guard = createRecentKeyGuard({ ttlMs: 100, maxKeys: 50 });
                assertEqual(guard('', 0).allowed, true, 'empty key should be allowed');
                assertEqual(guard(null, 0).allowed, true, 'null key should be allowed');
            }
        },
        {
            name: 'createRecentKeyGuard: enforces maxKeys bound',
            async run() {
                const guard = createRecentKeyGuard({ ttlMs: 10000, maxKeys: 2 });

                assertEqual(guard('a', 0).allowed, true, 'a allowed');
                assertEqual(guard('b', 0).allowed, true, 'b allowed');
                assertEqual(guard('c', 0).allowed, true, 'c allowed');

                assert(guard._seen && typeof guard._seen.size === 'number', 'guard should expose _seen Map');
                assertEqual(guard._seen.size, 2, 'should keep only maxKeys entries');
                assert(guard._seen.has('b'), 'should keep newest keys (b)');
                assert(guard._seen.has('c'), 'should keep newest keys (c)');
                assert(!guard._seen.has('a'), 'should evict oldest key (a)');
            }
        }
    ];

    const DedupGuardTestSuite = {
        async run() {
            resetResults();
            log('='.repeat(80));
            log('Dedup Guard Test Suite');
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
        window.DedupGuardTestSuite = DedupGuardTestSuite;
    } else if (typeof global !== 'undefined') {
        global.DedupGuardTestSuite = DedupGuardTestSuite;
    }
})();

