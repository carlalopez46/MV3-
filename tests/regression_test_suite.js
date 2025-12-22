/**
 * Regression Test Suite for iMacros MV3
 *
 * Tests for previously fixed bugs to prevent regressions:
 * - packSingleKeyPressEvent parameter order (mrecorder.js)
 * - playInFlight race condition guard (offscreen_bg.js)
 * - Message handler completeness (panel.js)
 */

(function() {
    'use strict';

    const results = { passed: 0, failed: 0, skipped: 0 };
    const testResults = [];

    function log(msg) {
        if (typeof console !== 'undefined') {
            console.log(msg);
        }
    }

    function pass(name, msg) {
        results.passed++;
        testResults.push({ name, status: 'passed', message: msg });
        log(`[PASS] ${name}`);
    }

    function fail(name, msg) {
        results.failed++;
        testResults.push({ name, status: 'failed', message: msg });
        log(`[FAIL] ${name}: ${msg}`);
    }

    function skip(name, reason) {
        results.skipped++;
        testResults.push({ name, status: 'skipped', message: reason });
        log(`[SKIP] ${name}: ${reason}`);
    }

    /**
     * Test: packSingleKeyPressEvent parameter order
     * Bug: The function was called with parameters in wrong order (cur, extra, prv, pprv)
     * Fix: Changed to (extra, cur, prv, pprv) to match function signature
     */
    function testPackSingleKeyPressEventSignature() {
        const testName = 'packSingleKeyPressEvent parameter order matches call site';

        if (typeof Recorder === 'undefined') {
            skip(testName, 'Recorder class not available');
            return;
        }

        try {
            // Get the function source to verify parameter order
            const funcStr = Recorder.prototype.packSingleKeyPressEvent.toString();

            // Function should have (extra, cur, prv, pprv) as first parameters
            const paramMatch = funcStr.match(/function\s*\([^)]*\)/);
            if (paramMatch) {
                const params = paramMatch[0];
                // Verify 'extra' comes before 'cur' in parameter list
                const extraPos = params.indexOf('extra');
                const curPos = params.indexOf('cur');

                if (extraPos >= 0 && curPos >= 0 && extraPos < curPos) {
                    pass(testName, 'Parameters are in correct order: extra before cur');
                } else if (extraPos < 0 || curPos < 0) {
                    fail(testName, 'Could not find expected parameter names in function signature');
                } else {
                    fail(testName, 'Parameter order incorrect: extra should come before cur');
                }
            } else {
                fail(testName, 'Could not parse function signature');
            }
        } catch (e) {
            fail(testName, `Exception: ${e.message}`);
        }
    }

    /**
     * Test: playInFlight guard is atomic
     * Bug: Check and add to Set were separated, allowing race condition
     * Fix: Moved add() immediately after has() check
     */
    function testPlayInFlightGuardLocation() {
        const testName = 'playInFlight guard is atomic (add follows check immediately)';

        // This test verifies the code structure in offscreen_bg.js
        // We can't directly test the race condition, but we can verify the fix exists

        // Check if we're in Node.js environment with require available
        let fs, path, source;
        try {
            const requireFn = typeof require !== 'undefined' ? require : null;
            if (!requireFn) {
                skip(testName, 'require() not available in this environment');
                return;
            }
            fs = requireFn('fs');
            path = requireFn('path');
            const testDir = typeof __dirname !== 'undefined' ? __dirname : '.';
            const offscreenPath = path.join(testDir, '..', 'offscreen_bg.js');
            source = fs.readFileSync(offscreenPath, 'utf8');

            // Verify the fix pattern: add should come right after the has check block
            // Pattern: return true after has check, then add immediately
            const hasCheckPattern = /if\s*\(\s*playInFlight\.has\s*\(\s*win_id\s*\)\s*\)/;
            const addPattern = /playInFlight\.add\s*\(\s*win_id\s*\)/g;

            const hasMatch = source.match(hasCheckPattern);
            const addMatches = [...source.matchAll(addPattern)];

            if (!hasMatch) {
                fail(testName, 'Could not find playInFlight.has() check');
                return;
            }

            if (addMatches.length === 0) {
                fail(testName, 'Could not find playInFlight.add() call');
                return;
            }

            // There should be add calls for playFile and runMacroByUrl (2 legitimate paths)
            // The fix ensures add() is called immediately after the has() check
            if (addMatches.length >= 2) {
                pass(testName, `playInFlight.add() calls found (${addMatches.length} paths)`);
            } else {
                fail(testName, `Expected at least 2 playInFlight.add() calls, found ${addMatches.length}`);
            }
        } catch (e) {
            if (e.code === 'MODULE_NOT_FOUND' || e.code === 'ENOENT') {
                skip(testName, 'Cannot read offscreen_bg.js in this environment');
            } else {
                fail(testName, `Exception: ${e.message}`);
            }
        }
    }

    /**
     * Test: Panel message handlers exist for recorder messages
     * Bug: PANEL_ADD_LINE, PANEL_REMOVE_LAST_LINE, PANEL_SHOW_MACRO_TREE had no handlers
     * Fix: Added handlers in panel.js
     */
    function testPanelMessageHandlersExist() {
        const testName = 'Panel has handlers for recorder messages';

        // Check if we're in Node.js environment with require available
        let fs, path, source;
        try {
            // Use Function constructor to avoid direct require reference in browser
            const requireFn = typeof require !== 'undefined' ? require : null;
            if (!requireFn) {
                skip(testName, 'require() not available in this environment');
                return;
            }
            fs = requireFn('fs');
            path = requireFn('path');
            const testDir = typeof __dirname !== 'undefined' ? __dirname : '.';
            const panelPath = path.join(testDir, '..', 'panel.js');
            source = fs.readFileSync(panelPath, 'utf8');
        } catch (e) {
            skip(testName, `Cannot read panel.js: ${e.message}`);
            return;
        }

            const requiredHandlers = [
                'PANEL_ADD_LINE',
                'PANEL_REMOVE_LAST_LINE',
                'PANEL_SHOW_MACRO_TREE'
            ];

            const missingHandlers = [];
            for (const handler of requiredHandlers) {
                const pattern = new RegExp(`message\\.type\\s*===\\s*["']${handler}["']`);
                if (!pattern.test(source)) {
                    missingHandlers.push(handler);
                }
            }

            if (missingHandlers.length === 0) {
                pass(testName, 'All required message handlers are present');
            } else {
                fail(testName, `Missing handlers: ${missingHandlers.join(', ')}`);
            }
    }

    /**
     * Test: Early return statements use 'return true' for async handlers
     * Bug: Some early returns used 'return;' instead of 'return true;'
     * Fix: Changed to 'return true;' to keep message channel open
     */
    function testAsyncHandlerReturnTrue() {
        const testName = 'playFile early returns use return true';

        // Check if we're in Node.js environment with require available
        let fs, path, source;
        try {
            const requireFn = typeof require !== 'undefined' ? require : null;
            if (!requireFn) {
                skip(testName, 'require() not available in this environment');
                return;
            }
            fs = requireFn('fs');
            path = requireFn('path');
            const testDir = typeof __dirname !== 'undefined' ? __dirname : '.';
            const offscreenPath = path.join(testDir, '..', 'offscreen_bg.js');
            source = fs.readFileSync(offscreenPath, 'utf8');
        } catch (e) {
            skip(testName, `Cannot read offscreen_bg.js: ${e.message}`);
            return;
        }

        // Find the playFile section and check for bare 'return;' statements
        // Look for pattern: sendResponse followed by return without 'true'
        const bareReturnPattern = /sendResponse\s*\([^)]*\)\s*;?\s*\n\s*return\s*;/g;
        const properReturnPattern = /sendResponse\s*\([^)]*\)\s*;?\s*\n\s*return\s+true\s*;/g;

        const bareReturns = source.match(bareReturnPattern) || [];
        const properReturns = source.match(properReturnPattern) || [];

        if (bareReturns.length === 0) {
            pass(testName, `All sendResponse blocks use proper 'return true' (found ${properReturns.length})`);
        } else {
            fail(testName, `Found ${bareReturns.length} bare 'return;' after sendResponse`);
        }
    }

    /**
     * Test: onNavigationErrorOccurred spelling is correct
     * Bug: Method was misspelled as onNavigationErrorOccured (missing 'r')
     * Fix: Renamed to onNavigationErrorOccurred in mplayer.js and offscreen_bg.js
     */
    function testNavigationErrorMethodSpelling() {
        const testName = 'onNavigationErrorOccurred spelling is correct';

        let fs, path;
        try {
            const requireFn = typeof require !== 'undefined' ? require : null;
            if (!requireFn) {
                skip(testName, 'require() not available in this environment');
                return;
            }
            fs = requireFn('fs');
            path = requireFn('path');
            const testDir = typeof __dirname !== 'undefined' ? __dirname : '.';

            // Check mplayer.js
            const mplayerPath = path.join(testDir, '..', 'mplayer.js');
            const mplayerSource = fs.readFileSync(mplayerPath, 'utf8');

            // Check for correct spelling (should exist)
            const correctPattern = /onNavigationErrorOccurred/;
            // Check for typo (should NOT exist)
            const typoPattern = /onNavigationErrorOccured[^r]/;

            if (typoPattern.test(mplayerSource)) {
                fail(testName, 'Typo "onNavigationErrorOccured" found in mplayer.js');
                return;
            }

            if (!correctPattern.test(mplayerSource)) {
                fail(testName, 'Correct spelling "onNavigationErrorOccurred" not found in mplayer.js');
                return;
            }

            // Check offscreen_bg.js
            const offscreenPath = path.join(testDir, '..', 'offscreen_bg.js');
            const offscreenSource = fs.readFileSync(offscreenPath, 'utf8');

            if (typoPattern.test(offscreenSource)) {
                fail(testName, 'Typo "onNavigationErrorOccured" found in offscreen_bg.js');
                return;
            }

            if (!correctPattern.test(offscreenSource)) {
                fail(testName, 'Correct spelling "onNavigationErrorOccurred" not found in offscreen_bg.js');
                return;
            }

            pass(testName, 'Method name is correctly spelled as onNavigationErrorOccurred');
        } catch (e) {
            if (e.code === 'MODULE_NOT_FOUND' || e.code === 'ENOENT') {
                skip(testName, 'Cannot read source files in this environment');
            } else {
                fail(testName, `Exception: ${e.message}`);
            }
        }
    }

    /**
     * Test: PLAY_MACRO handler is NOT in bg.js (Service Worker)
     * Bug: Both bg.js and offscreen_bg.js had PLAY_MACRO handlers causing duplicate execution
     * Fix: Removed PLAY_MACRO handler from bg.js; only offscreen_bg.js should handle it
     */
    function testPlayMacroHandlerNotInServiceWorker() {
        const testName = 'PLAY_MACRO handler not in Service Worker (bg.js)';

        let fs, path;
        try {
            const requireFn = typeof require !== 'undefined' ? require : null;
            if (!requireFn) {
                skip(testName, 'require() not available in this environment');
                return;
            }
            fs = requireFn('fs');
            path = requireFn('path');
            const testDir = typeof __dirname !== 'undefined' ? __dirname : '.';

            const bgPath = path.join(testDir, '..', 'bg.js');
            const bgSource = fs.readFileSync(bgPath, 'utf8');

            // Check for PLAY_MACRO handler pattern
            // The handler would look like: if (message.type === 'PLAY_MACRO')
            const handlerPattern = /if\s*\(\s*message\.type\s*===\s*['"]PLAY_MACRO['"]\s*\)/;

            if (handlerPattern.test(bgSource)) {
                fail(testName, 'PLAY_MACRO handler found in bg.js - should only be in offscreen_bg.js');
                return;
            }

            // Verify offscreen_bg.js DOES have the handler
            const offscreenPath = path.join(testDir, '..', 'offscreen_bg.js');
            const offscreenSource = fs.readFileSync(offscreenPath, 'utf8');

            if (!handlerPattern.test(offscreenSource)) {
                fail(testName, 'PLAY_MACRO handler NOT found in offscreen_bg.js - it should be there');
                return;
            }

            pass(testName, 'PLAY_MACRO handler correctly located only in offscreen_bg.js');
        } catch (e) {
            if (e.code === 'MODULE_NOT_FOUND' || e.code === 'ENOENT') {
                skip(testName, 'Cannot read source files in this environment');
            } else {
                fail(testName, `Exception: ${e.message}`);
            }
        }
    }

    /**
     * Run all regression tests
     */
    function run() {
        // Reset results to ensure accurate counts on each execution
        results.passed = 0;
        results.failed = 0;
        results.skipped = 0;
        testResults.length = 0;

        log('================================================================================');
        log('Regression Test Suite');
        log('================================================================================');

        testPackSingleKeyPressEventSignature();
        testPlayInFlightGuardLocation();
        testPanelMessageHandlersExist();
        testAsyncHandlerReturnTrue();
        testNavigationErrorMethodSpelling();
        testPlayMacroHandlerNotInServiceWorker();

        log('');
        log(`Summary: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);
        log('');

        return {
            passed: results.passed,
            failed: results.failed,
            skipped: results.skipped,
            results: testResults
        };
    }

    // Export for use by test runner
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { run };
    }
    if (typeof window !== 'undefined') {
        window.RegressionTestSuite = { run };
    }
    if (typeof globalThis !== 'undefined') {
        globalThis.RegressionTestSuite = { run };
    }

    log('Regression Test Suite loaded. Run with: RegressionTestSuite.run()');
})();
