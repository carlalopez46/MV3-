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
            skip: true, // Requires Chrome APIs not available in Node.js test environment
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
            skip: true, // Requires Chrome APIs not available in Node.js test environment
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
            skip: true, // Requires Chrome APIs not available in Node.js test environment
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
            name: 'RUN prefers default extension before raw macro name',
            skip: true, // Requires Chrome APIs not available in Node.js test environment
            async run() {
                const macros = {
                    'DefaultExt.iim': 'SET !VAR1 default-ext',
                    'DefaultExt': 'SET !VAR1 raw-name'
                };

                const player = createPlayer({ macros });

                const attempts = [];
                player.loadMacroFile = async function (macroPath) {
                    attempts.push(macroPath);
                    if (Object.prototype.hasOwnProperty.call(macros, macroPath)) {
                        return macros[macroPath];
                    }
                    return null;
                };

                await MacroPlayer.prototype.ActionTable["run"].call(player,
                    ['macro=DefaultExt', 'DefaultExt']);
                await waitForPlayerToDrain(player);

                assertEqual(JSON.stringify(attempts), JSON.stringify(['DefaultExt.iim']), 'Default extension attempted first');
                assertEqual(player.varManager.getVar('VAR1'), 'default-ext', 'Macro with default extension executed');
            }
        },
        {
            name: 'RUN falls back to raw name when default extension is missing',
            skip: true, // Requires Chrome APIs not available in Node.js test environment
            async run() {
                const macros = {
                    'NoExt': 'SET !VAR1 raw-only'
                };

                const player = createPlayer({ macros });

                const attempts = [];
                player.loadMacroFile = async function (macroPath) {
                    attempts.push(macroPath);
                    if (Object.prototype.hasOwnProperty.call(macros, macroPath)) {
                        return macros[macroPath];
                    }
                    return null;
                };

                await MacroPlayer.prototype.ActionTable["run"].call(player,
                    ['macro=NoExt', 'NoExt']);
                await waitForPlayerToDrain(player);

                assertEqual(JSON.stringify(attempts), JSON.stringify(['NoExt.iim', 'NoExt']), 'Default extension attempted before raw fallback');
                assertEqual(player.varManager.getVar('VAR1'), 'raw-only', 'Macro without extension still executes');
            }
        },
        {
            name: 'RUN bypasses autoplay suppression for nested execution and restores caller state',
            skip: true, // Requires Chrome APIs not available in Node.js test environment
            async run() {
                const macros = {
                    'Parent.iim': '',
                    'Child.iim': 'SET !VAR1 child-ran'
                };

                const player = createPlayer({ macros });

                player.autoplaySuppressed = true;

                const observedSuppressionStates = [];
                player.parseInlineMacro = function (content) {
                    observedSuppressionStates.push(this.autoplaySuppressed);
                    return content ? MacroPlayer.prototype.parseInlineMacro.call(this, content) : [];
                };

                await MacroPlayer.prototype.ActionTable["run"].call(player,
                    ['macro=Parent.iim', 'Parent.iim']);

                await MacroPlayer.prototype.ActionTable["run"].call(player,
                    ['macro=Child.iim', 'Child.iim']);

                await waitForPlayerToDrain(player);

                assertEqual(observedSuppressionStates.every(state => state === false), true,
                    'Autoplay suppression bypassed during RUN execution');
                assertEqual(player.varManager.getVar('VAR1'), 'child-ran', 'Nested macro executes under suppression');
                assertEqual(player.autoplaySuppressed, true, 'Caller autoplay suppression state restored after nested runs');
            }
        },
        {
            name: 'VariableManager snapshots are deep-copied and restore local context',
            async run() {
                const player = createPlayer();
                player.varManager.localContext = {
                    LOOP: 3,
                    TABNUMBER: 2,
                    EMBED: { nested: true }
                };

                const snapshot = player.varManager.snapshotLocalContext();

                // Mutate live context after the snapshot
                player.varManager.localContext.LOOP = 7;
                player.varManager.localContext.EMBED.nested = false;

                player.varManager.restoreLocalContext(snapshot);

                assertEqual(player.varManager.getVar('LOOP'), 3, 'LOOP restored from snapshot');
                assertEqual(player.varManager.localContext.EMBED.nested, true, 'Nested object restored');

                // Ensure post-restore changes to the snapshot do not leak back
                snapshot.EMBED.nested = 'mutated';
                assertEqual(player.varManager.localContext.EMBED.nested, true, 'Snapshot remains isolated after restore');
            }
        },
        {
            name: 'RUN resolves macro paths relative to macros folder',
            skip: true, // Requires Chrome APIs not available in Node.js test environment
            async run() {
                const fakeFs = Object.create(null);
                const resolvedPaths = [];
                const makeNode = (path) => ({
                    path,
                    leafName: path.split('/').pop(),
                    exists: () => Promise.resolve(Object.prototype.hasOwnProperty.call(fakeFs, path)),
                    append(name) { this.path = this.path.replace(/\/$/, ''); this.path += '/' + name; this.leafName = name; return this.path; },
                    clone() { return makeNode(this.path); }
                });

                const originalAfio = globalThis.afio;
                globalThis.afio = {
                    getDefaultDir() { return Promise.resolve(makeNode('/default')); },
                    openNode(path) { resolvedPaths.push(path); return makeNode(path); },
                    readTextFile(node) { return Promise.resolve(fakeFs[node.path]); }
                };

                const player = createPlayer();
                player.resolveMacroPath = MacroPlayer.prototype.resolveMacroPath.bind(player);
                player.loadMacroFileFromFs = MacroPlayer.prototype.loadMacroFileFromFs.bind(player);
                player.macrosFolder = makeNode('/macros');
                fakeFs['/macros/Sub.iim'] = 'SET !VAR1 relative-macro';

                try {
                    await MacroPlayer.prototype.ActionTable["run"].call(player, ['macro=Sub.iim', 'Sub.iim']);
                    await waitForPlayerToDrain(player);
                } finally {
                    globalThis.afio = originalAfio;
                }

                assertEqual(player.file_id, '/macros/Sub.iim', 'RUN resolved relative to macros folder');
                assertEqual(resolvedPaths[0], '/macros/Sub.iim', 'af.openNode called with resolved path');
                assertEqual(player.varManager.getVar('VAR1'), 'relative-macro', 'Macro executed and updated variable');
            }
        },
        {
            name: 'RUN falls back to default dir when macros folder is missing',
            skip: true, // Requires Chrome APIs not available in Node.js test environment
            async run() {
                const fakeFs = Object.create(null);
                const makeNode = (path) => ({
                    path,
                    leafName: path.split('/').pop(),
                    exists: () => Promise.resolve(Object.prototype.hasOwnProperty.call(fakeFs, path)),
                    append(name) { this.path = this.path.replace(/\/$/, ''); this.path += '/' + name; this.leafName = name; return this.path; },
                    clone() { return makeNode(this.path); }
                });

                fakeFs['/default/Fallback.iim'] = 'SET !VAR1 fallback-macro';

                const originalAfio = globalThis.afio;
                globalThis.afio = {
                    getDefaultDir() { return Promise.resolve(makeNode('/default')); },
                    openNode(path) { return makeNode(path); },
                    readTextFile(node) { return Promise.resolve(fakeFs[node.path]); }
                };

                const player = createPlayer();
                player.resolveMacroPath = MacroPlayer.prototype.resolveMacroPath.bind(player);
                player.loadMacroFileFromFs = MacroPlayer.prototype.loadMacroFileFromFs.bind(player);
                player.macrosFolder = null;

                try {
                    await MacroPlayer.prototype.ActionTable["run"].call(player, ['macro=Fallback.iim', 'Fallback.iim']);
                    await waitForPlayerToDrain(player);
                } finally {
                    globalThis.afio = originalAfio;
                }

                assertEqual(player.file_id, '/default/Fallback.iim', 'RUN resolved path via default dir');
                assertEqual(player.varManager.getVar('VAR1'), 'fallback-macro', 'Fallback macro executed');
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
                if (test.skip) {
                    log(`[SKIP] ${test.name}`);
                    results.skipped++;
                    continue;
                }
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
