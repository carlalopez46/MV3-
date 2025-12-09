(function () {
    'use strict';

    /* global MacroPlayer, VariableManager, BadParameter */

    const results = {
        passed: 0,
        failed: 0,
        skipped: 0
    };
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

    function assertEqual(actual, expected, context) {
        if (actual !== expected) {
            const error = new Error(`Expected "${expected}" but got "${actual}"`);
            throw error;
        }
    }

    function assertMatches(actual, regex, context) {
        if (!regex.test(actual)) {
            const error = new Error(`Value "${actual}" does not match ${regex}`);
            throw error;
        }
    }

    function createPlayer(setup = {}) {
        if (typeof MacroPlayer === 'undefined' || typeof VariableManager === 'undefined') {
            throw new Error('MacroPlayer or VariableManager not loaded');
        }

        const globalScope = typeof globalThis !== 'undefined'
            ? globalThis
            : (typeof window !== 'undefined' ? window : global);
        const imnsRef = globalScope.imns || (globalScope.imns = {});
        imnsRef.unwrap = imnsRef.unwrap || (value => value);
        imnsRef.s2i = imnsRef.s2i || (value => parseInt(value, 10));
        imnsRef.formatDate = imnsRef.formatDate || (() => 'DATE');

        const player = new MacroPlayer();
        player.limits = player.convertLimits({
            maxVariables: 'unlimited',
            maxCSVRows: 'unlimited',
            maxCSVCols: 'unlimited',
            maxMacroLen: 'unlimited',
            maxIterations: 'unlimited'
        });

        if (setup.do_eval) {
            player.do_eval = setup.do_eval;
        } else {
            // Inline !EVAL is explicitly stubbed in each test that needs it.
            player.do_eval = expr => {
                throw new Error('Default do_eval stub should not be called in tests: ' + expr);
            };
        }

        player.getColumnData = setup.getColumnData || (index => `col${index}`);
        player.varManager.setVar('VAR1', 'value1');
        player.varManager.setVar('VAR2', 'value2');
        player.varManager.setVar('VAR3', '15');
        if (setup.variables) {
            Object.keys(setup.variables).forEach(key => player.varManager.setVar(key, setup.variables[key]));
        }
        return player;
    }

    const tests = [
        {
            name: 'Inline EVAL with whitespace and nested parentheses',
            run() {
                const evalCalls = [];
                const player = createPlayer({
                    do_eval(expr, id) {
                        evalCalls.push({ expr, id });
                        if (expr === '(1 + (2 * 3))') {
                            return 7;
                        }
                        throw new Error('Unexpected expression in test: ' + expr);
                    }
                });
                const expanded = player.expandVariables('{{!EVAL("(1 + (2 * 3))")}}', 'eval_nested');
                assertEqual(expanded, '7', 'Inline EVAL result');
                assertEqual(evalCalls.length, 1, 'Inline EVAL call count');
                assertMatches(evalCalls[0].id, /^eval_nested_[a-z0-9]+_[a-z0-9]{9}$/i, 'Inline EVAL id uniqueness');
            }
        },
        {
            name: 'Concatenated variable placeholders',
            run() {
                const player = createPlayer();
                const expanded = player.expandVariables('{{!VAR1}}{{!VAR2}}', 'concat_vars');
                assertEqual(expanded, 'value1value2', 'Concatenated variables');
            }
        },
        {
            name: 'Whitespace in placeholders is rejected',
            run() {
                const player = createPlayer();
                try {
                    player.expandVariables('{{ !VAR1 }}', 'disallow_whitespace');
                    throw new Error('Whitespace should not be accepted in placeholders');
                } catch (err) {
                    const errName = err && (err.name || (err.constructor && err.constructor.name));
                    if (errName !== 'BadParameter' || !/Whitespace is not allowed/.test(err.message)) {
                        throw err;
                    }
                }
            }
        },
        {
            name: 'Undefined variables throw BadParameter',
            run() {
                const player = createPlayer();
                try {
                    player.expandVariables('{{!MISSING_VAR}}', 'missing');
                    throw new Error('Missing variables should trigger BadParameter');
                } catch (err) {
                    const errName = err && (err.name || (err.constructor && err.constructor.name));
                    if (errName !== 'BadParameter' || !/Unsupported variable !MISSING_VAR/.test(err.message)) {
                        throw err;
                    }
                }
            }
        },
        {
            name: 'Circular placeholder expansion is detected',
            run() {
                const player = createPlayer({
                    variables: {
                        VAR1: '{{!VAR2}}',
                        VAR2: '{{!VAR1}}'
                    }
                });
                try {
                    player.expandVariables('{{!VAR1}}', 'circular');
                    throw new Error('Circular expansion should have been detected');
                } catch (err) {
                    const errName = err && (err.name || (err.constructor && err.constructor.name));
                    if (errName !== 'RuntimeError' || !/Maximum placeholder expansion depth/.test(err.message)) {
                        throw err;
                    }
                }
            }
        },
        {
            name: 'Nested placeholder inside variable name',
            run() {
                const player = createPlayer({
                    getColumnData(index) {
                        const cols = ['first', 'column_value', 'third'];
                        return cols[index - 1];
                    }
                });
                player.varManager.setVar('VAR1', '2');
                const expanded = player.expandVariables('{{!COL{{!VAR1}}}}', 'nested_placeholder');
                assertEqual(expanded, 'column_value', 'Nested placeholder expansion');
            }
        },
        {
            name: 'Special characters in custom variable names',
            run() {
                const player = createPlayer({
                    variables: {
                        'MY-VAR': 'custom-value'
                    }
                });
                const expanded = player.expandVariables('{{!MY-VAR}}', 'special_chars');
                assertEqual(expanded, 'custom-value', 'Custom variable with special characters');
            }
        }
    ];

    const VariableExpansionTestSuite = {
        run() {
            resetResults();
            log('='.repeat(80));
            log('Variable Expansion Test Suite');
            log('='.repeat(80));
            for (const test of tests) {
                try {
                    test.run();
                    log(`[PASS] ${test.name}`);
                    results.passed++;
                } catch (err) {
                    log(`[FAIL] ${test.name}: ${err.message}`);
                    results.failed++;
                    errors.push({ context: test.name, message: err.message });
                }
            }
            log(`\nSummary: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);
            // Return shallow copies so callers cannot mutate internal counters/arrays.
            return { results: { ...results }, errors: errors.slice() };
        }
    };

    if (typeof window !== 'undefined') {
        window.VariableExpansionTestSuite = VariableExpansionTestSuite;
    } else if (typeof global !== 'undefined') {
        global.VariableExpansionTestSuite = VariableExpansionTestSuite;
    }
})();
