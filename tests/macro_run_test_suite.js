(function () {
    'use strict';

    /* global MacroPlayer, RuntimeError */

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

    function assertEqual(actual, expected, context) {
        if (actual !== expected) {
            const err = new Error(`Expected "${expected}" but got "${actual}" (${context})`);
            throw err;
        }
    }

    function ensureTestHarnessGlobals(debugFlag = false) {
        const globalScope = typeof globalThis !== 'undefined'
            ? globalThis
            : (typeof window !== 'undefined' ? window : global);

        globalScope.imns = globalScope.imns || {};
        const imnsRef = globalScope.imns;
        imnsRef.unwrap = imnsRef.unwrap || (value => value);
        imnsRef.s2i = imnsRef.s2i || (value => parseInt(value, 10));
        imnsRef.escapeTextContent = imnsRef.escapeTextContent || (value => value);
        imnsRef.escapeREChars = imnsRef.escapeREChars || (value => value);

        if (!globalScope.Storage) {
            globalScope.Storage = {};
        }
        const debugEnabled = !!debugFlag;
        globalScope.Storage.getBool = (key) => debugEnabled && key === 'debug';
        globalScope.Storage.getNumber = globalScope.Storage.getNumber || (() => 0);
        globalScope.Storage.getChar = globalScope.Storage.getChar || (() => '');

        globalScope.asyncRun = globalScope.asyncRun || (fn => fn());
        globalScope.badge = globalScope.badge || { set: () => {} };
        globalScope.context = globalScope.context || {};

        return globalScope;
    }

    function createPlayer(setup = {}) {
        if (typeof MacroPlayer === 'undefined') {
            throw new Error('MacroPlayer not loaded');
        }

        const globalScope = ensureTestHarnessGlobals(!!setup.debug);

        const player = new MacroPlayer();
        player.playing = true;
        player.delay = 0;
        player.action_stack = [];
        player.actions = [];
        player.loopStack = [];
        player.currentAction = null;
        player.win_id = player.win_id || 'test-runner-window';
        globalScope.context[player.win_id] = globalScope.context[player.win_id] || { panelWindow: null };
        player.limits = player.convertLimits({
            maxVariables: 'unlimited',
            maxCSVRows: 'unlimited',
            maxCSVCols: 'unlimited',
            maxMacroLen: 'unlimited',
            maxIterations: 'unlimited'
        });

        player.profiler = {
            init() { },
            start() { },
            end() { },
            enabled: false
        };

        // Stub file resolution/loading for RUN
        player.resolveMacroPath = async function (macroPath) {
            return macroPath;
        };
        player.loadMacroFile = async function (macroPath) {
            if (setup.macros && Object.prototype.hasOwnProperty.call(setup.macros, macroPath)) {
                return setup.macros[macroPath];
            }
            return null;
        };

        if (setup.variables) {
            Object.keys(setup.variables).forEach(key => player.varManager.setVar(key, setup.variables[key]));
        }

        return player;
    }

    function wrapNext(player) {
        const originalNext = player.next.bind(player);
        let nextCalled = false;

        player.next = function wrappedNext(callerId) {
            nextCalled = true;
            return originalNext(callerId);
        };

        return () => nextCalled;
    }

    async function waitForPlayerToDrain(player, maxSpins = 10) {
        let spins = 0;
        while ((player.action_stack.length || player.callStack.length) && spins < maxSpins) {
            while (player.action_stack.length) {
                const action = player.action_stack.pop();
                player.currentAction = action;
                await player._ActionTable[action.name](action.args);
            }

            if (player.callStack.length) {
                player._popFrame();
            }

            spins++;
        }

        if (player.action_stack.length || player.callStack.length) {
            throw new Error('Player did not drain action stack');
        }
    }

    const tests = [
        {
            name: 'RUN executes sub-macro actions and shares globals',
            async run() {
                const player = createPlayer({
                    macros: {
                        'Sub.iim': 'SET !VAR1 Changed\nSET !VAR_CUSTOM Updated'
                    }
                });
                player.varManager.setVar('VAR1', 'Original');
                player.varManager.setVar('VAR_CUSTOM', 'Initial');
                const wasNextCalled = wrapNext(player);

                try {
                    await MacroPlayer.prototype.ActionTable["run"].call(player,
                        ['macro=Sub.iim', 'Sub.iim']);
                    await waitForPlayerToDrain(player);
                } catch (err) {
                    log(err && err.stack ? err.stack : String(err));
                    throw err;
                }

                assertEqual(player.varManager.getVar('VAR1'), 'Changed', 'VAR1 updated by RUN');
                assertEqual(player.varManager.getVar('VAR_CUSTOM'), 'Updated', 'Custom variable updated by RUN');
                assertEqual(player.runNestLevel, 0, 'RUN nesting counter restored');
                assertEqual(wasNextCalled(), true, 'Caller continuation invoked');
            }
        },
        {
            name: 'RUN isolates loop stack and restores caller context',
            async run() {
                const player = createPlayer({
                    macros: {
                        'LoopSub.iim': 'SET !VAR1 Child'
                    }
                });

                // Simulate an active parent loop state that must survive RUN
                player.loopStack = [{ level: 99, startStackPosition: 0, endStackPosition: 0 }];
                player.varManager.localContext.LOOP = 5;
                player.varManager.setVar('VAR1', '0');
                const wasNextCalled = wrapNext(player);

                try {
                    await MacroPlayer.prototype.ActionTable["run"].call(player,
                        ['macro=LoopSub.iim', 'LoopSub.iim']);
                    await waitForPlayerToDrain(player);
                } catch (err) {
                    log(err && err.stack ? err.stack : String(err));
                    throw err;
                }

                assertEqual(player.varManager.getVar('VAR1'), 'Child', 'Sub-macro executed actions');
                assertEqual(player.varManager.getVar('LOOP'), 5, 'Parent loop counter restored');
                assertEqual(player.loopStack.length, 1, 'Loop stack restored to caller state');
                assertEqual(player.loopStack[0].level, 99, 'Original loop frame preserved');
                assertEqual(wasNextCalled(), true, 'Caller continuation invoked');
            }
        },
        {
            name: 'RUN does not let child loops mutate caller loop frames',
            async run() {
                const player = createPlayer({
                    macros: {
                        'LoopChild.iim': 'URL GOTO=https://example.com'
                    }
                });

                const parentLoopFrame = {
                    level: 1,
                    loopVarName: 'LOOP',
                    count: 3,
                    current: 1,
                    startLine: 10,
                    endLine: 12,
                    loopBody: [{ name: 'loop', line: 12, args: [null, '1'] }]
                };

                player.loopStack = [parentLoopFrame];
                player.varManager.setVar('LOOP', 1);
                player.parseInlineMacro = () => []; // Avoid executing real actions

                const wasNextCalled = wrapNext(player);

                await MacroPlayer.prototype.ActionTable["run"].call(player,
                    ['macro=LoopChild.iim', 'LoopChild.iim']);

                // Mutate child loop stack while RUN frame is active
                player.loopStack[0].current = 99;
                player.loopStack[0].loopBody.push({ name: 'noop', line: 999, args: [] });

                // Simulate RUN completion
                player._popFrame();

                assertEqual(player.loopStack[0].current, 1, 'Caller loop counter restored');
                assertEqual(player.loopStack[0].loopBody.length, parentLoopFrame.loopBody.length,
                    'Caller loop body not altered by child');
                assertEqual(wasNextCalled(), true, 'Caller continuation invoked');
            }
        },
        {
            name: 'VariableManager resets between standalone macro runs',
            async run() {
                const player = createPlayer();

                // Seed legacy and VariableManager-backed variables
                player.varManager.setVar('VAR1', 'stale');
                player.varManager.setVar('CUSTOM_VAR', 'keep');
                player.varManager.setVar('LOOP', 7);
                player.vars[1] = 'legacy';
                player.userVars.set('temp', 'legacy');

                player.resetVariableStateForNewMacro();

                assertEqual(player.varManager.getVar('VAR1'), '', 'Standard variable cleared');
                assertEqual(player.varManager.getVar('CUSTOM_VAR'), '', 'Custom variable cleared');
                assertEqual(player.varManager.getVar('LOOP'), 0, 'Local loop counter reset');
                assertEqual(player.vars[1], undefined, 'Legacy VAR array cleared');
                assertEqual(player.userVars.has('temp'), false, 'Legacy user variable cleared');
            }
        }
    ];

    const MacroRunTestSuite = {
        async run() {
            resetResults();
            log('='.repeat(80));
            log('Macro RUN Command Test Suite');
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
        window.MacroRunTestSuite = MacroRunTestSuite;
    } else if (typeof global !== 'undefined') {
        global.MacroRunTestSuite = MacroRunTestSuite;
    }
})();
