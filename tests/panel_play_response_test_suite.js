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

    function createElement() {
        const attrs = {};
        return {
            setAttribute(name, value) {
                attrs[name] = String(value);
            },
            removeAttribute(name) {
                delete attrs[name];
            },
            getAttribute(name) {
                return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
            },
            _attrs: attrs
        };
    }

    const tests = [
        {
            name: 'handlePlayStartResponse: no response sets idle',
            async run() {
                assert(typeof handlePlayStartResponse === 'function', 'handlePlayStartResponse must be available');

                const calls = [];
                let lastStatusEl = null;

                const originalUpdatePanelState = updatePanelState;
                const originalEnsureStatusLineElement = ensureStatusLineElement;

                try {
                    updatePanelState = function (state) { calls.push(state); };
                    ensureStatusLineElement = function () {
                        lastStatusEl = { textContent: '', style: {} };
                        return lastStatusEl;
                    };

                    handlePlayStartResponse(undefined, 'fail', 'no response', 'fail log');

                    assertEqual(calls.length, 1, 'updatePanelState should be called once');
                    assertEqual(calls[0], 'idle', 'panel should return to idle');
                    assert(lastStatusEl === null, 'status line should not be updated when there is no response');
                } finally {
                    updatePanelState = originalUpdatePanelState;
                    ensureStatusLineElement = originalEnsureStatusLineElement;
                }
            }
        },
        {
            name: 'handlePlayStartResponse: ignored status returns idle',
            async run() {
                const calls = [];
                let lastStatusEl = null;

                const originalUpdatePanelState = updatePanelState;
                const originalEnsureStatusLineElement = ensureStatusLineElement;

                try {
                    updatePanelState = function (state) { calls.push(state); };
                    ensureStatusLineElement = function () {
                        lastStatusEl = { textContent: '', style: {} };
                        return lastStatusEl;
                    };

                    handlePlayStartResponse(
                        { status: 'ignored', message: 'Duplicate request' },
                        'fail',
                        'no response',
                        'fail log'
                    );

                    assertEqual(calls.length, 1, 'updatePanelState should be called once');
                    assertEqual(calls[0], 'idle', 'panel should return to idle');
                    assert(lastStatusEl && typeof lastStatusEl === 'object', 'status line element should be updated');
                    assertEqual(lastStatusEl.textContent, 'Duplicate request', 'status text should reflect ignored message');
                    assertEqual(lastStatusEl.style.color, '#666', 'status color should indicate ignored');
                } finally {
                    updatePanelState = originalUpdatePanelState;
                    ensureStatusLineElement = originalEnsureStatusLineElement;
                }
            }
        },
        {
            name: 'handlePlayStartResponse: ignored_duplicate status returns idle',
            async run() {
                const calls = [];
                let lastStatusEl = null;

                const originalUpdatePanelState = updatePanelState;
                const originalEnsureStatusLineElement = ensureStatusLineElement;

                try {
                    updatePanelState = function (state) { calls.push(state); };
                    ensureStatusLineElement = function () {
                        lastStatusEl = { textContent: '', style: {} };
                        return lastStatusEl;
                    };

                    handlePlayStartResponse(
                        { status: 'ignored_duplicate', message: 'Duplicate request' },
                        'fail',
                        'no response',
                        'fail log'
                    );

                    assertEqual(calls.length, 1, 'updatePanelState should be called once');
                    assertEqual(calls[0], 'idle', 'panel should return to idle');
                    assert(lastStatusEl && typeof lastStatusEl === 'object', 'status line element should be updated');
                    assertEqual(lastStatusEl.textContent, 'Duplicate request', 'status text should reflect ignored message');
                    assertEqual(lastStatusEl.style.color, '#666', 'status color should indicate ignored');
                } finally {
                    updatePanelState = originalUpdatePanelState;
                    ensureStatusLineElement = originalEnsureStatusLineElement;
                }
            }
        },
        {
            name: 'handlePlayStartResponse: ignored boolean returns idle',
            async run() {
                const calls = [];
                let lastStatusEl = null;

                const originalUpdatePanelState = updatePanelState;
                const originalEnsureStatusLineElement = ensureStatusLineElement;

                try {
                    updatePanelState = function (state) { calls.push(state); };
                    ensureStatusLineElement = function () {
                        lastStatusEl = { textContent: '', style: {} };
                        return lastStatusEl;
                    };

                    handlePlayStartResponse(
                        { ignored: true, message: 'Ignored for test' },
                        'fail',
                        'no response',
                        'fail log'
                    );

                    assertEqual(calls.length, 1, 'updatePanelState should be called once');
                    assertEqual(calls[0], 'idle', 'panel should return to idle');
                    assert(lastStatusEl && typeof lastStatusEl === 'object', 'status line element should be updated');
                    assertEqual(lastStatusEl.textContent, 'Ignored for test', 'status text should reflect ignored message');
                    assertEqual(lastStatusEl.style.color, '#666', 'status color should indicate ignored');
                } finally {
                    updatePanelState = originalUpdatePanelState;
                    ensureStatusLineElement = originalEnsureStatusLineElement;
                }
            }
        },
        {
            name: 'handlePlayStartResponse: explicit failure returns idle',
            async run() {
                const calls = [];
                let lastStatusEl = null;

                const originalUpdatePanelState = updatePanelState;
                const originalEnsureStatusLineElement = ensureStatusLineElement;

                try {
                    updatePanelState = function (state) { calls.push(state); };
                    ensureStatusLineElement = function () {
                        lastStatusEl = { textContent: '', style: {} };
                        return lastStatusEl;
                    };

                    handlePlayStartResponse(
                        { success: false, error: 'Cannot determine window ID' },
                        'Failed to start playback.',
                        'no response',
                        'fail log'
                    );

                    assertEqual(calls.length, 1, 'updatePanelState should be called once');
                    assertEqual(calls[0], 'idle', 'panel should return to idle');
                    assert(lastStatusEl && typeof lastStatusEl === 'object', 'status line element should be updated');
                    assertEqual(lastStatusEl.textContent, 'Cannot determine window ID', 'status text should show error');
                    assertEqual(lastStatusEl.style.color, '#b00020', 'status color should indicate error');
                } finally {
                    updatePanelState = originalUpdatePanelState;
                    ensureStatusLineElement = originalEnsureStatusLineElement;
                }
            }
        },
        {
            name: 'handlePlayStartResponse: error-only payload returns idle',
            async run() {
                const calls = [];
                let lastStatusEl = null;

                const originalUpdatePanelState = updatePanelState;
                const originalEnsureStatusLineElement = ensureStatusLineElement;

                try {
                    updatePanelState = function (state) { calls.push(state); };
                    ensureStatusLineElement = function () {
                        lastStatusEl = { textContent: '', style: {} };
                        return lastStatusEl;
                    };

                    handlePlayStartResponse(
                        { error: 'Cannot determine window ID' },
                        'Failed to start playback.',
                        'no response',
                        'fail log'
                    );

                    assertEqual(calls.length, 1, 'updatePanelState should be called once');
                    assertEqual(calls[0], 'idle', 'panel should return to idle');
                    assert(lastStatusEl && typeof lastStatusEl === 'object', 'status line element should be updated');
                    assertEqual(lastStatusEl.textContent, 'Cannot determine window ID', 'status text should show error');
                    assertEqual(lastStatusEl.style.color, '#b00020', 'status color should indicate error');
                } finally {
                    updatePanelState = originalUpdatePanelState;
                    ensureStatusLineElement = originalEnsureStatusLineElement;
                }
            }
        },
        {
            name: 'handlePlayStartResponse: success does not force idle',
            async run() {
                const calls = [];
                let statusUpdated = false;

                const originalUpdatePanelState = updatePanelState;
                const originalEnsureStatusLineElement = ensureStatusLineElement;

                try {
                    updatePanelState = function (state) { calls.push(state); };
                    ensureStatusLineElement = function () {
                        statusUpdated = true;
                        return { textContent: '', style: {} };
                    };

                    handlePlayStartResponse(
                        { success: true },
                        'fail',
                        'no response',
                        'fail log'
                    );

                    assertEqual(calls.length, 0, 'updatePanelState should not be called on success');
                    assertEqual(statusUpdated, false, 'status line should not be updated on success');
                } finally {
                    updatePanelState = originalUpdatePanelState;
                    ensureStatusLineElement = originalEnsureStatusLineElement;
                }
            }
        },
        {
            name: 'command lock: updatePanelState does not release lock',
            async run() {
                assert(typeof acquireCommandLock === 'function', 'acquireCommandLock must be available');
                assert(typeof releaseCommandLock === 'function', 'releaseCommandLock must be available');
                assert(typeof updatePanelState === 'function', 'updatePanelState must be available');

                releaseCommandLock();
                updatePanelState('idle');

                assertEqual(acquireCommandLock('play'), true, 'first acquire should succeed');
                assertEqual(acquireCommandLock('play'), false, 'second acquire should be blocked');

                updatePanelState('idle');
                assertEqual(acquireCommandLock('play'), false, 'updatePanelState should not release the lock');

                releaseCommandLock();
                assertEqual(acquireCommandLock('play'), true, 'explicit release should allow acquiring again');
                releaseCommandLock();
            }
        },
        {
            name: 'command lock: play() releases lock after response',
            async run() {
                assert(typeof play === 'function', 'play must be available');
                assert(typeof onSelectionChanged === 'function', 'onSelectionChanged must be available');
                assert(typeof sendCommand === 'function', 'sendCommand must be available');

                releaseCommandLock();
                updatePanelState('idle');
                onSelectionChanged({ type: 'macro', id: 'Macro.iim', text: 'Macro' });

                const originalSendCommand = sendCommand;
                try {
                    sendCommand = () => Promise.resolve({ success: true });

                    play();

                    // While the command is in flight, the lock should be held.
                    assertEqual(acquireCommandLock('probe'), false, 'lock should be held during in-flight play');

                    // Allow microtasks to flush.
                    await new Promise(resolve => setTimeout(resolve, 0));

                    assertEqual(acquireCommandLock('probe2'), true, 'lock should be released after play response');
                    releaseCommandLock();
                } finally {
                    sendCommand = originalSendCommand;
                    updatePanelState('idle');
                    releaseCommandLock();
                }
            }
        },
        {
            name: 'updatePanelState: recording enables save/capture and disables play/loop/edit',
            async run() {
                assert(typeof updatePanelState === 'function', 'updatePanelState must be available');

                const elements = {
                    'play-button': createElement(),
                    'pause-button': createElement(),
                    'stop-replaying-button': createElement(),
                    'record-button': createElement(),
                    'stop-recording-button': createElement(),
                    'loop-button': createElement(),
                    'edit-button': createElement(),
                    'saveas-button': createElement(),
                    'capture-button': createElement()
                };

                const originalGetElementById = document.getElementById;
                try {
                    document.getElementById = (id) => elements[id] || null;

                    updatePanelState('recording');

                    assertEqual(elements['saveas-button'].getAttribute('disabled'), null, 'saveas should be enabled');
                    assertEqual(elements['capture-button'].getAttribute('disabled'), null, 'capture should be enabled');
                    assertEqual(elements['play-button'].getAttribute('disabled'), 'true', 'play should be disabled');
                    assertEqual(elements['loop-button'].getAttribute('disabled'), 'true', 'loop should be disabled');
                    assertEqual(elements['edit-button'].getAttribute('disabled'), 'true', 'edit should be disabled');
                    assertEqual(elements['record-button'].getAttribute('disabled'), 'true', 'record should be disabled');
                } finally {
                    document.getElementById = originalGetElementById;
                }
            }
        },
        {
            name: 'updatePanelState: paused shows play and keeps stop enabled',
            async run() {
                assert(typeof updatePanelState === 'function', 'updatePanelState must be available');

                const elements = {
                    'play-button': createElement(),
                    'pause-button': createElement(),
                    'stop-replaying-button': createElement(),
                    'record-button': createElement(),
                    'stop-recording-button': createElement(),
                    'loop-button': createElement(),
                    'edit-button': createElement(),
                    'saveas-button': createElement(),
                    'capture-button': createElement()
                };

                const originalGetElementById = document.getElementById;
                try {
                    document.getElementById = (id) => elements[id] || null;

                    updatePanelState('paused');

                    assertEqual(elements['play-button']._attrs.collapsed, 'false', 'play should be visible');
                    assertEqual(elements['pause-button']._attrs.collapsed, 'true', 'pause should be hidden');
                    assertEqual(elements['stop-replaying-button'].getAttribute('disabled'), null, 'stop should be enabled');
                    assertEqual(elements['saveas-button'].getAttribute('disabled'), 'true', 'saveas should be disabled');
                    assertEqual(elements['capture-button'].getAttribute('disabled'), 'true', 'capture should be disabled');
                } finally {
                    document.getElementById = originalGetElementById;
                }
            }
        },
        {
            name: 'updatePanelState: idle restores macro actions',
            async run() {
                assert(typeof updatePanelState === 'function', 'updatePanelState must be available');

                const elements = {
                    'play-button': createElement(),
                    'pause-button': createElement(),
                    'stop-replaying-button': createElement(),
                    'record-button': createElement(),
                    'stop-recording-button': createElement(),
                    'loop-button': createElement(),
                    'edit-button': createElement(),
                    'saveas-button': createElement(),
                    'capture-button': createElement()
                };

                const originalGetElementById = document.getElementById;
                const originalSelectedMacro = selectedMacro;
                try {
                    document.getElementById = (id) => elements[id] || null;
                    selectedMacro = { type: 'macro' };

                    updatePanelState('idle');

                    assertEqual(elements['play-button'].getAttribute('disabled'), null, 'play should be enabled');
                    assertEqual(elements['loop-button'].getAttribute('disabled'), null, 'loop should be enabled');
                    assertEqual(elements['edit-button'].getAttribute('disabled'), null, 'edit should be enabled');
                    assertEqual(elements['saveas-button'].getAttribute('disabled'), 'true', 'saveas should be disabled');
                    assertEqual(elements['capture-button'].getAttribute('disabled'), 'true', 'capture should be disabled');
                    assertEqual(elements['stop-replaying-button'].getAttribute('disabled'), 'true', 'stop replaying should be disabled');
                    assertEqual(elements['stop-recording-button'].getAttribute('disabled'), 'true', 'stop recording should be disabled');
                } finally {
                    selectedMacro = originalSelectedMacro;
                    document.getElementById = originalGetElementById;
                }
            }
        },
        {
            name: 'notifyPanelLoaded sends PANEL_LOADED and captures win_id',
            async run() {
                assert(typeof notifyPanelLoaded === 'function', 'notifyPanelLoaded must be available');

                const originalChrome = chrome;
                const originalCurrentWindowId = currentWindowId;
                const originalPanelWindowId = panelWindowId;

                let lastMessage = null;
                currentWindowId = null;
                panelWindowId = null;

                globalThis.chrome = {
                    runtime: {
                        lastError: null,
                        sendMessage(payload, callback) {
                            lastMessage = payload;
                            if (typeof callback === 'function') {
                                callback({ win_id: 7 });
                            }
                        }
                    },
                    windows: {
                        getCurrent(callback) {
                            callback({ id: 55 });
                        }
                    }
                };

                try {
                    await notifyPanelLoaded();
                    assert(lastMessage && lastMessage.type === 'PANEL_LOADED', 'PANEL_LOADED should be sent');
                    assertEqual(lastMessage.target, 'background', 'PANEL_LOADED should target background');
                    assertEqual(lastMessage.panelWindowId, 55, 'panelWindowId should come from getCurrent');
                    assertEqual(currentWindowId, 7, 'currentWindowId should be set from response');
                } finally {
                    currentWindowId = originalCurrentWindowId;
                    panelWindowId = originalPanelWindowId;
                    globalThis.chrome = originalChrome;
                }
            }
        },
        {
            name: 'notifyPanelClosing sends PANEL_CLOSING with ids and box',
            async run() {
                assert(typeof notifyPanelClosing === 'function', 'notifyPanelClosing must be available');

                const originalChrome = chrome;
                const originalCurrentWindowId = currentWindowId;
                const originalPanelWindowId = panelWindowId;
                const originalPanelClosingSent = panelClosingSent;

                let lastMessage = null;
                let sendCount = 0;

                currentWindowId = 12;
                panelWindowId = 99;
                panelClosingSent = false;

                globalThis.chrome = {
                    runtime: {
                        lastError: null,
                        sendMessage(payload) {
                            sendCount += 1;
                            lastMessage = payload;
                        }
                    }
                };

                try {
                    const panelBox = { left: 1, top: 2, width: 3, height: 4 };
                    notifyPanelClosing(panelBox);
                    notifyPanelClosing(panelBox);

                    assertEqual(sendCount, 1, 'PANEL_CLOSING should be sent once');
                    assert(lastMessage && lastMessage.type === 'PANEL_CLOSING', 'PANEL_CLOSING should be sent');
                    assertEqual(lastMessage.target, 'background', 'PANEL_CLOSING should target background');
                    assertEqual(lastMessage.win_id, 12, 'win_id should be attached');
                    assertEqual(lastMessage.panelWindowId, 99, 'panelWindowId should be attached');
                    assertEqual(lastMessage.panelBox.width, 3, 'panelBox should be attached');
                } finally {
                    currentWindowId = originalCurrentWindowId;
                    panelWindowId = originalPanelWindowId;
                    panelClosingSent = originalPanelClosingSent;
                    globalThis.chrome = originalChrome;
                }
            }
        },
        {
            name: 'saveAs/capture send recorder context methods',
            async run() {
                assert(typeof saveAs === 'function', 'saveAs must be available');
                assert(typeof capture === 'function', 'capture must be available');

                const originalSendContextMethod = sendContextMethod;
                const originalGetElementById = document.getElementById;
                const originalPanelState = { ...panelState };

                const elements = {
                    'saveas-button': createElement(),
                    'capture-button': createElement()
                };

                const calls = [];
                try {
                    panelState.isRecording = true;
                    panelState.isPlaying = false;
                    panelState.isPaused = false;

                    document.getElementById = (id) => elements[id] || null;
                    sendContextMethod = (objectPath, methodName, args) => {
                        calls.push({ objectPath, methodName, args });
                        return Promise.resolve({ success: true });
                    };

                    saveAs();
                    capture();

                    assertEqual(calls.length, 2, 'two recorder calls expected');
                    assertEqual(calls[0].objectPath, 'recorder', 'saveAs should target recorder');
                    assertEqual(calls[0].methodName, 'saveAs', 'saveAs method name');
                    assertEqual(calls[1].objectPath, 'recorder', 'capture should target recorder');
                    assertEqual(calls[1].methodName, 'capture', 'capture method name');
                } finally {
                    panelState.isRecording = originalPanelState.isRecording;
                    panelState.isPlaying = originalPanelState.isPlaying;
                    panelState.isPaused = originalPanelState.isPaused;
                    sendContextMethod = originalSendContextMethod;
                    document.getElementById = originalGetElementById;
                }
            }
        },
        {
            name: 'record starts without macro selection',
            async run() {
                assert(typeof record === 'function', 'record must be available');
                assert(typeof sendCommand === 'function', 'sendCommand must be available');

                const originalSendCommand = sendCommand;
                const originalAlert = (typeof alert !== 'undefined') ? alert : undefined;
                const originalSelectedMacro = selectedMacro;
                const originalPanelState = { ...panelState };

                let sentCommand = null;

                try {
                    selectedMacro = null;
                    panelState.isRecording = false;
                    panelState.isPlaying = false;
                    panelState.isPaused = false;

                    sendCommand = (command) => {
                        sentCommand = command;
                        return Promise.resolve({ success: true });
                    };
                    globalThis.alert = () => { throw new Error('alert should not be called'); };

                    record();

                    assertEqual(sentCommand, 'startRecording', 'record should send startRecording');
                } finally {
                    sendCommand = originalSendCommand;
                    if (typeof originalAlert === 'undefined') {
                        delete globalThis.alert;
                    } else {
                        globalThis.alert = originalAlert;
                    }
                    selectedMacro = originalSelectedMacro;
                    panelState.isRecording = originalPanelState.isRecording;
                    panelState.isPlaying = originalPanelState.isPlaying;
                    panelState.isPaused = originalPanelState.isPaused;
                    releaseCommandLock();
                }
            }
        }
    ];

    const PanelPlayResponseTestSuite = {
        async run() {
            resetResults();
            log('='.repeat(80));
            log('Panel Play Response Test Suite');
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
        window.PanelPlayResponseTestSuite = PanelPlayResponseTestSuite;
    } else if (typeof global !== 'undefined') {
        global.PanelPlayResponseTestSuite = PanelPlayResponseTestSuite;
    }
})();
