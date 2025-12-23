#!/usr/bin/env node
/**
 * CLI Test Runner for iMacros MV3
 *
 * Executes all tests in a headless environment and reports results.
 * This enables automated testing without requiring a browser.
 *
 * Usage:
 *   node run_tests_cli.js [options]
 *
 * Options:
 *   --suite=<name>  Run specific test suite (security|fsaccess|afio|vars|macro|panel|recorder|compat|all)
 *   --verbose       Show detailed output
 *   --watch         Watch for file changes and re-run tests
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Blob } = require('buffer');

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m'
};

function colorize(text, color) {
    return `${colors[color]}${text}${colors.reset}`;
}

function logHeader(text) {
    console.log('\n' + colorize('='.repeat(80), 'cyan'));
    console.log(colorize(text, 'bright'));
    console.log(colorize('='.repeat(80), 'cyan') + '\n');
}

function logSuccess(text) {
    console.log(colorize('✓ ' + text, 'green'));
}

function logError(text) {
    console.log(colorize('✗ ' + text, 'red'));
}

function logWarning(text) {
    console.log(colorize('⚠ ' + text, 'yellow'));
}

function logInfo(text) {
    console.log(colorize('ℹ ' + text, 'blue'));
}

/**
 * Recursively scan the repository for MV2-only background page calls.
 *
 * We intentionally ignore backup/reference folders (old_file, docs, tests,
 * vendor, samples, data folders) and focus on shippable JS/HTML assets.
 */
function scanForMV2BackgroundUsage(rootDir) {
    const ignoredDirs = new Set([
        'old_file', 'docs', 'tests', 'vendor', 'node_modules', '.git',
        'samples', 'Datasources', 'Downloads', 'Macros', 'skin'
    ]);
    const allowedExt = new Set(['.js', '.html', '.htm']);
    const allowedFiles = new Set(['mv3_compat.js']);
    const disallowedPattern = /chrome\.(?:extension|runtime)\.getBackgroundPage\s*\(/;
    const findings = [];

    function walk(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (ignoredDirs.has(entry.name)) {
                continue;
            }

            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile()) {
                if (allowedFiles.has(entry.name)) {
                    continue;
                }
                const ext = path.extname(entry.name).toLowerCase();
                if (!allowedExt.has(ext)) continue;

                const relPath = path.relative(rootDir, fullPath);
                const content = fs.readFileSync(fullPath, 'utf8');
                const lines = content.split(/\r?\n/);
                lines.forEach((line, idx) => {
                    if (disallowedPattern.test(line)) {
                        findings.push({
                            file: relPath,
                            line: idx + 1,
                            code: line.trim()
                        });
                    }
                });
            }
        }
    }

    walk(rootDir);
    return findings;
}

/**
 * Ensure manifest.json does not reference archived MV2 assets.
 */
function scanManifestForLegacyPaths(rootDir) {
    const manifestPath = path.join(rootDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        return [];
    }

    const manifestText = fs.readFileSync(manifestPath, 'utf8');
    const issues = [];
    if (manifestText.includes('old_file/')) {
        issues.push({
            file: path.relative(rootDir, manifestPath),
            message: 'manifest.json references old_file/ assets'
        });
    }
    return issues;
}

/**
 * Guard against MV3 "re-injection" issues where the service worker retries
 * content script injection after seeing "Receiving end does not exist".
 *
 * When that happens, connector/recorder/player may be executed multiple times
 * in the same document. These scripts must be idempotent and must not register
 * duplicate listeners/handlers.
 */
function runContentScriptIdempotenceGuards(rootDir) {
    const baseDir = rootDir;
    const errors = [];
    let passed = 0;
    let failed = 0;

    const recordFailure = (name, err) => {
        failed += 1;
        logError(`${name}: ${err.message || err}`);
        errors.push({
            context: 'ContentScriptIdempotenceGuard',
            message: `${name}: ${err.message || err}`,
            stack: err && err.stack ? err.stack : ''
        });
    };

    const safeRead = (relativePath) => {
        const fullPath = path.join(baseDir, relativePath);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`Missing file: ${relativePath}`);
        }
        return fs.readFileSync(fullPath, 'utf8');
    };

    const guard = (name, fn) => {
        try {
            fn();
            passed += 1;
            logSuccess(name);
        } catch (err) {
            recordFailure(name, err);
        }
    };

    guard('content_scripts/connector.js is idempotent', () => {
        const relPath = path.join('content_scripts', 'connector.js');
        const code = safeRead(relPath);

        const counters = { onMessageAdd: 0 };
        const sandbox = Object.create(null);
        sandbox.console = console;
        sandbox.Map = Map;
        sandbox.Set = Set;
        sandbox.WeakMap = WeakMap;
        sandbox.WeakSet = WeakSet;
        sandbox.Date = Date;
        sandbox.Math = Math;
        sandbox.String = String;
        sandbox.Number = Number;
        sandbox.Boolean = Boolean;
        sandbox.Error = Error;
        sandbox.TypeError = TypeError;

        sandbox.location = { href: 'https://example.invalid/' };
        sandbox.frames = [];
        sandbox.frameElement = null;
        sandbox.top = sandbox;
        sandbox.window = sandbox;
        sandbox.self = sandbox;
        sandbox.globalThis = sandbox;
        sandbox.addEventListener = () => { };
        sandbox.removeEventListener = () => { };

        sandbox.logWarning = () => { };
        sandbox.logError = () => { };

        sandbox.chrome = {
            runtime: {
                lastError: null,
                onMessage: {
                    addListener(fn) {
                        counters.onMessageAdd += 1;
                        // Keep a reference so tests can optionally inspect.
                        sandbox.__imacros_runtime_listener__ = fn;
                    }
                },
                sendMessage(_message, callback) {
                    if (typeof callback === 'function') callback(undefined);
                }
            }
        };

        const context = vm.createContext(sandbox);
        vm.runInContext(code, context, { filename: relPath });

        const firstInstance = sandbox.__imacros_mv3_connector_instance__;
        if (!firstInstance) {
            throw new Error('Expected __imacros_mv3_connector_instance__ to be set after first load');
        }
        if (counters.onMessageAdd !== 1) {
            throw new Error(`Expected chrome.runtime.onMessage.addListener to be called once, got ${counters.onMessageAdd}`);
        }

        vm.runInContext(code, context, { filename: relPath });
        if (counters.onMessageAdd !== 1) {
            throw new Error(`Expected no additional onMessage listeners on reinjection, got ${counters.onMessageAdd}`);
        }
        if (sandbox.__imacros_mv3_connector_instance__ !== firstInstance) {
            throw new Error('Connector instance changed across reinjection');
        }
    });

    guard('content_scripts/recorder.js is idempotent', () => {
        const relPath = path.join('content_scripts', 'recorder.js');
        const code = safeRead(relPath);

        const counters = { registerHandler: 0, postMessage: 0 };
        const sandbox = Object.create(null);
        sandbox.console = console;
        sandbox.Map = Map;
        sandbox.Set = Set;
        sandbox.WeakMap = WeakMap;
        sandbox.WeakSet = WeakSet;
        sandbox.Date = Date;
        sandbox.Math = Math;
        sandbox.String = String;
        sandbox.Number = Number;
        sandbox.Boolean = Boolean;
        sandbox.Error = Error;
        sandbox.TypeError = TypeError;
        sandbox.parseInt = parseInt;
        sandbox.isNaN = isNaN;

        sandbox.location = { href: 'https://example.invalid/' };
        sandbox.window = sandbox;
        sandbox.self = sandbox;
        sandbox.globalThis = sandbox;
        sandbox.globalScope = sandbox;
        sandbox.document = {
            getElementById() { return null; }
        };

        sandbox.imns = Object.create(null);
        sandbox.logWarning = () => { };
        sandbox.logInfo = () => { };
        sandbox.logError = () => { };

        sandbox.connector = {
            registerHandler(_topic, _handler) {
                counters.registerHandler += 1;
            },
            postMessage(topic, _data, callback) {
                counters.postMessage += 1;
                if (typeof callback === 'function') {
                    if (topic === 'query-state') {
                        callback({ state: 'idle' });
                    } else {
                        callback({});
                    }
                }
            }
        };

        const context = vm.createContext(sandbox);
        vm.runInContext(code, context, { filename: relPath });

        if (!sandbox.__imacros_mv3_cs_recorder_instance__) {
            throw new Error('Expected __imacros_mv3_cs_recorder_instance__ to be set after first load');
        }
        if (counters.registerHandler !== 3) {
            throw new Error(`Expected 3 registerHandler calls on first load, got ${counters.registerHandler}`);
        }
        if (counters.postMessage < 1) {
            throw new Error('Expected query-state postMessage call on first load');
        }

        vm.runInContext(code, context, { filename: relPath });
        if (counters.registerHandler !== 3) {
            throw new Error(`Expected no additional registerHandler calls on reinjection, got ${counters.registerHandler}`);
        }
    });

    guard('content_scripts/bookmarks_handler.js is idempotent', () => {
        const relPath = path.join('content_scripts', 'bookmarks_handler.js');
        const code = safeRead(relPath);

        const counters = { addEventListener: 0, eventTypes: [] };
        const sandbox = Object.create(null);
        sandbox.console = console;
        sandbox.Map = Map;
        sandbox.Set = Set;
        sandbox.Date = Date;
        sandbox.Math = Math;
        sandbox.String = String;
        sandbox.Number = Number;
        sandbox.Boolean = Boolean;
        sandbox.Error = Error;
        sandbox.TypeError = TypeError;

        sandbox.location = { href: 'https://example.invalid/' };
        sandbox.window = sandbox;
        sandbox.self = sandbox;
        sandbox.globalThis = sandbox;

        sandbox.document = {
            readyState: 'complete',
            evaluate() {
                return { iterateNext() { return null; } };
            },
            documentElement: {
                getAttribute() { return ''; }
            }
        };

        sandbox.XPathResult = { ORDERED_NODE_ITERATOR_TYPE: 5 };
        sandbox.CustomEvent = function CustomEvent() { };
        sandbox.atob = (value) => value;
        sandbox.btoa = (value) => value;
        sandbox.decodeURIComponent = decodeURIComponent;
        sandbox.encodeURIComponent = encodeURIComponent;

        sandbox.connector = {};
        sandbox.imns = { escapeLine(value) { return value; } };

        sandbox.window.addEventListener = (type) => {
            counters.addEventListener += 1;
            counters.eventTypes.push(type);
        };
        sandbox.window.dispatchEvent = () => { };
        sandbox.setInterval = () => 1;
        sandbox.clearInterval = () => { };

        const context = vm.createContext(sandbox);
        vm.runInContext(code, context, { filename: relPath });

        if (!sandbox.__imacros_mv3_bookmarks_handler_initialized__) {
            throw new Error('Expected bookmarks handler guard to be set after first load');
        }
        if (counters.addEventListener !== 1 || !counters.eventTypes.includes('iMacrosRunMacro')) {
            throw new Error(`Expected iMacrosRunMacro listener to be registered once; got ${JSON.stringify(counters.eventTypes)}`);
        }

        vm.runInContext(code, context, { filename: relPath });
        if (counters.addEventListener !== 1) {
            throw new Error(`Expected no additional event listeners on reinjection, got ${counters.addEventListener}`);
        }
    });

    guard('content_scripts/player.js is idempotent (bootstrap scheduling)', () => {
        const relPath = path.join('content_scripts', 'player.js');
        const code = safeRead(relPath);

        const counters = { addEventListener: 0, eventTypes: [] };
        const sandbox = Object.create(null);
        sandbox.console = console;
        sandbox.Map = Map;
        sandbox.Set = Set;
        sandbox.WeakMap = WeakMap;
        sandbox.WeakSet = WeakSet;
        sandbox.Date = Date;
        sandbox.Math = Math;
        sandbox.String = String;
        sandbox.Number = Number;
        sandbox.Boolean = Boolean;
        sandbox.Error = Error;
        sandbox.TypeError = TypeError;

        sandbox.location = { href: 'https://example.invalid/' };
        sandbox.window = sandbox;
        sandbox.self = sandbox;
        sandbox.globalThis = sandbox;

        sandbox.Node = { ELEMENT_NODE: 1 };
        sandbox.document = {
            readyState: 'loading',
            querySelectorAll() { return []; },
            createElement() { return {}; },
            getElementById() { return null; },
            body: {
                style: Object.create(null),
                scrollWidth: 0,
                scrollHeight: 0,
                appendChild() { }
            },
            documentElement: {
                style: { overflow: '' },
                scrollWidth: 0,
                scrollHeight: 0
            }
        };

        sandbox.addEventListener = (type) => {
            counters.addEventListener += 1;
            counters.eventTypes.push(type);
        };

        sandbox.setTimeout = () => { };

        const context = vm.createContext(sandbox);
        vm.runInContext(code, context, { filename: relPath });

        if (!sandbox.__imacros_mv3_csplayer_bootstrap__) {
            throw new Error('Expected __imacros_mv3_csplayer_bootstrap__ to be set after first load');
        }
        if (counters.addEventListener !== 2 ||
            !counters.eventTypes.includes('DOMContentLoaded') ||
            !counters.eventTypes.includes('load')) {
            throw new Error(`Expected DOMContentLoaded/load listeners to be registered once; got ${JSON.stringify(counters.eventTypes)}`);
        }

        vm.runInContext(code, context, { filename: relPath });
        if (counters.addEventListener !== 2) {
            throw new Error(`Expected no additional event listeners on reinjection, got ${counters.addEventListener}`);
        }
    });

    guard('content_scripts/connector.js query-state fallback returns state', () => {
        const relPath = path.join('content_scripts', 'connector.js');
        const code = safeRead(relPath);

        const sandbox = Object.create(null);
        sandbox.console = console;
        sandbox.Map = Map;
        sandbox.Set = Set;
        sandbox.Date = Date;
        sandbox.Math = Math;
        sandbox.String = String;
        sandbox.Number = Number;
        sandbox.Boolean = Boolean;
        sandbox.Error = Error;
        sandbox.TypeError = TypeError;

        sandbox.location = { href: 'https://example.invalid/' };
        sandbox.window = sandbox;
        sandbox.self = sandbox;
        sandbox.globalThis = sandbox;
        sandbox.top = sandbox;
        sandbox.frames = [];
        sandbox.frameElement = null;

        sandbox.chrome = {
            runtime: {
                lastError: null,
                onMessage: { addListener() { } },
                sendMessage(_message, callback) {
                    if (typeof callback === 'function') callback(undefined);
                }
            }
        };

        const context = vm.createContext(sandbox);
        vm.runInContext(code, context, { filename: relPath });

        let response = null;
        sandbox.connector.postMessage('query-state', {}, (payload) => {
            response = payload;
        });

        if (!response || response.state !== 'idle') {
            throw new Error(`Expected query-state fallback to provide state, got ${JSON.stringify(response)}`);
        }
    });

    guard('utils.js is idempotent (asyncRun message listener)', () => {
        const relPath = 'utils.js';
        const code = safeRead(relPath);

        const counters = { addEventListener: 0, types: [] };
        const sandbox = Object.create(null);
        sandbox.console = {
            log() { },
            info() { },
            warn() { },
            error() { },
            debug() { }
        };

        sandbox.Map = Map;
        sandbox.Set = Set;
        sandbox.WeakMap = WeakMap;
        sandbox.WeakSet = WeakSet;
        sandbox.Date = Date;
        sandbox.Math = Math;
        sandbox.String = String;
        sandbox.Number = Number;
        sandbox.Boolean = Boolean;
        sandbox.Error = Error;
        sandbox.TypeError = TypeError;
        sandbox.Promise = Promise;
        sandbox.Proxy = Proxy;

        sandbox.navigator = { platform: 'MacIntel' };
        sandbox.location = { href: 'https://example.invalid/' };
        sandbox.window = sandbox;
        sandbox.self = sandbox;
        sandbox.globalThis = sandbox;

        sandbox.localStorage = {
            getItem() { return null; },
            setItem() { },
            removeItem() { },
            clear() { },
            key() { return null; },
            get length() { return 0; }
        };

        sandbox.postMessage = () => { };
        sandbox.addEventListener = (type) => {
            counters.addEventListener += 1;
            counters.types.push(type);
        };
        sandbox.setTimeout = () => { };
        sandbox.clearTimeout = () => { };

        sandbox.chrome = {
            storage: { local: { get(_keys, cb) { if (typeof cb === 'function') cb({}); } } },
            runtime: { lastError: null }
        };

        const context = vm.createContext(sandbox);
        vm.runInContext(code, context, { filename: relPath });
        const firstAsyncRun = sandbox.asyncRun;
        if (typeof firstAsyncRun !== 'function') {
            throw new Error('Expected asyncRun to be defined after first load');
        }
        if (counters.addEventListener !== 1 || !counters.types.includes('message')) {
            throw new Error(`Expected exactly one message listener, got ${JSON.stringify(counters.types)}`);
        }

        vm.runInContext(code, context, { filename: relPath });
        if (sandbox.asyncRun !== firstAsyncRun) {
            throw new Error('Expected asyncRun function identity to remain stable across reinjection');
        }
        if (counters.addEventListener !== 1) {
            throw new Error(`Expected no additional message listeners on reinjection, got ${counters.addEventListener}`);
        }
    });

    guard('errorLogger.js is idempotent (global handlers + console wrapper)', () => {
        const relPath = 'errorLogger.js';
        const code = safeRead(relPath);

        const counters = { addEventListener: 0, types: [] };
        const consoleStub = {
            error() { },
            warn() { },
            info() { },
            log() { },
            debug() { }
        };
        const sandbox = Object.create(null);
        sandbox.console = consoleStub;

        sandbox.Map = Map;
        sandbox.Set = Set;
        sandbox.WeakMap = WeakMap;
        sandbox.WeakSet = WeakSet;
        sandbox.Date = Date;
        sandbox.Math = Math;
        sandbox.String = String;
        sandbox.Number = Number;
        sandbox.Boolean = Boolean;
        sandbox.Error = Error;
        sandbox.TypeError = TypeError;
        sandbox.Promise = Promise;
        sandbox.JSON = JSON;

        sandbox.window = sandbox;
        sandbox.self = sandbox;
        sandbox.globalThis = sandbox;
        sandbox.addEventListener = (type) => {
            counters.addEventListener += 1;
            counters.types.push(type);
        };

        sandbox.localStorage = {
            getItem() { return null; },
            setItem() { },
            removeItem() { },
            clear() { },
            key() { return null; },
            get length() { return 0; }
        };

        const context = vm.createContext(sandbox);
        vm.runInContext(code, context, { filename: relPath });

        const firstLogger = sandbox.ErrorLogger;
        const firstConsoleError = sandbox.console.error;
        if (!firstLogger || typeof firstLogger.logError !== 'function') {
            throw new Error('Expected ErrorLogger singleton to be installed after first load');
        }
        if (counters.addEventListener !== 2 ||
            !counters.types.includes('error') ||
            !counters.types.includes('unhandledrejection')) {
            throw new Error(`Expected error/unhandledrejection listeners exactly once, got ${JSON.stringify(counters.types)}`);
        }
        if (!firstConsoleError || firstConsoleError.__imacros_errorLoggerWrapped !== true) {
            throw new Error('Expected console.error to be wrapped (marker missing)');
        }

        vm.runInContext(code, context, { filename: relPath });
        if (sandbox.ErrorLogger !== firstLogger) {
            throw new Error('Expected ErrorLogger singleton to be reused across reinjection');
        }
        if (sandbox.console.error !== firstConsoleError) {
            throw new Error('Expected console.error wrapper to remain stable across reinjection');
        }
        if (counters.addEventListener !== 2) {
            throw new Error(`Expected no additional global handlers on reinjection, got ${counters.addEventListener}`);
        }
    });

    return { passed, failed, skipped: 0, errors };
}

function runCompatibilityGuards(rootDir) {
    logHeader('MV3 Compatibility Guards');

    const mv2Findings = scanForMV2BackgroundUsage(rootDir);
    const manifestIssues = scanManifestForLegacyPaths(rootDir);
    const contentScriptIdempotence = runContentScriptIdempotenceGuards(rootDir);

    const errors = [];
    let passed = 0;
    let failed = 0;

    if (mv2Findings.length === 0) {
        logSuccess('No chrome.*.getBackgroundPage calls detected in shipping assets');
        passed += 1;
    } else {
        mv2Findings.forEach(finding => {
            logError(`MV2 background API found in ${finding.file}:${finding.line}`);
            errors.push({
                context: 'MV3CompatibilityGuard',
                message: `${finding.file}:${finding.line} contains ${finding.code}`,
                stack: ''
            });
        });
        failed += mv2Findings.length;
    }

    if (manifestIssues.length === 0) {
        logSuccess('manifest.json does not reference archived old_file assets');
        passed += 1;
    } else {
        manifestIssues.forEach(issue => {
            logError(issue.message);
            errors.push({
                context: 'MV3CompatibilityGuard',
                message: issue.message,
                stack: ''
            });
        });
        failed += manifestIssues.length;
    }

    passed += contentScriptIdempotence.passed || 0;
    failed += contentScriptIdempotence.failed || 0;
    if (Array.isArray(contentScriptIdempotence.errors)) {
        errors.push(...contentScriptIdempotence.errors);
    }

    return { passed, failed, skipped: 0, errors };
}

/**
 * Guard against a timing-dependent race where the user presses Stop while a
 * playFile request is still asynchronously loading the macro source.
 *
 * Regression target:
 * - playFile starts, awaits afio.readTextFile(), user issues stop()
 * - readTextFile resolves later and must NOT start mplayer.play()
 * - if a newer play takes ownership after stop, the older request must NOT
 *   send macroStopped / clear guards for the newer request.
 */
async function runOffscreenPlayStopRaceGuards(rootDir) {
    const baseDir = rootDir;
    const errors = [];
    let passed = 0;
    let failed = 0;

    const recordFailure = (name, err) => {
        failed += 1;
        logError(`${name}: ${err && err.message ? err.message : String(err)}`);
        errors.push({
            context: 'OffscreenPlayStopRaceGuard',
            message: `${name}: ${err && err.message ? err.message : String(err)}`,
            stack: err && err.stack ? err.stack : ''
        });
    };

    const safeRead = (relativePath) => {
        const fullPath = path.join(baseDir, relativePath);
        if (!fs.existsSync(fullPath)) {
            throw new Error(`Missing file: ${relativePath}`);
        }
        return fs.readFileSync(fullPath, 'utf8');
    };

    const tick = (times = 1) => new Promise((resolve) => {
        let remaining = Math.max(1, times);
        const step = () => {
            remaining -= 1;
            if (remaining <= 0) {
                resolve();
                return;
            }
            setTimeout(step, 0);
        };
        setTimeout(step, 0);
    });

    const runCase = async (name, fn) => {
        try {
            await fn();
            passed += 1;
            logSuccess(name);
        } catch (err) {
            recordFailure(name, err);
        }
    };

    const createDeferred = () => {
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    };

    const createHarness = () => {
        const code = safeRead('offscreen_bg.js');
        const sentMessages = [];
        const readDeferreds = [];
        const mplayerPlayCalls = [];
        const mplayerStopCalls = [];

        const quietConsole = {
            log() { },
            info() { },
            warn() { },
            error() { },
            debug() { }
        };

        const createEvent = () => {
            const listeners = [];
            return {
                addListener(fn) { listeners.push(fn); },
                dispatch(...args) {
                    listeners.forEach((fn) => fn(...args));
                },
                _listeners: listeners
            };
        };

        const runtimeOnMessage = createEvent();
        const extensionId = 'test-extension';
        const extensionOrigin = `chrome-extension://${extensionId}/`;

        const sandbox = Object.create(null);
        sandbox.console = quietConsole;
        sandbox.setTimeout = setTimeout;
        sandbox.clearTimeout = clearTimeout;
        sandbox.Promise = Promise;
        sandbox.Map = Map;
        sandbox.Set = Set;
        sandbox.WeakMap = WeakMap;
        sandbox.WeakSet = WeakSet;
        sandbox.Date = Date;
        sandbox.Math = Math;
        sandbox.String = String;
        sandbox.Number = Number;
        sandbox.Boolean = Boolean;
        sandbox.Error = Error;
        sandbox.TypeError = TypeError;
        sandbox.parseInt = parseInt;
        sandbox.isNaN = isNaN;
        sandbox.Object = Object;
        sandbox.Array = Array;

        sandbox.crypto = { randomUUID: () => 'test-uuid' };

        sandbox.window = sandbox;
        sandbox.self = sandbox;
        sandbox.globalThis = sandbox;
        sandbox.globalScope = sandbox;
        sandbox.document = {
            getElementById() { return null; }
        };
        sandbox.addEventListener = () => { };
        sandbox.removeEventListener = () => { };

        sandbox.registerSharedBackgroundHandlers = () => { };

        sandbox.communicator = {
            handlers: Object.create(null),
            registerHandler(topic, handler) {
                this.handlers[topic] = handler;
            },
            _execHandlers(msg, tab_id, win_id, sendResponse) {
                const handler = msg && msg.topic ? this.handlers[msg.topic] : null;
                if (typeof handler === 'function') {
                    return handler(msg.data, tab_id, win_id, sendResponse);
                }
                if (typeof sendResponse === 'function') {
                    sendResponse({ success: false, error: 'No handler registered' });
                }
                return undefined;
            }
        };

        sandbox.nm_connector = {
            startServer() { }
        };

        sandbox.chrome = {
            runtime: {
                id: extensionId,
                lastError: null,
                getURL(pathname = '') {
                    return extensionOrigin + String(pathname || '');
                },
                sendMessage(message) {
                    sentMessages.push(message);
                    return Promise.resolve();
                },
                onMessage: runtimeOnMessage
            }
        };

        sandbox.isPrivilegedSender = (sender, expectedId, origin) => {
            if (!sender || typeof sender !== 'object') return false;
            if (sender.id !== expectedId) return false;
            if (typeof sender.url === 'string' && sender.url.startsWith(origin)) return true;
            const hasTab = !!(sender.tab && typeof sender.tab === 'object');
            return !sender.url && !hasTab;
        };

        sandbox.Storage = {
            getBool(key) {
                return key === 'already-installed';
            },
            setBool() { },
            getChar() { return ''; },
            setChar() { }
        };

        sandbox.getLimits = () => Promise.resolve({});

        sandbox.notifyPanelStatLine = () => { };
        sandbox.showNotification = () => { };
        sandbox.notifyPanel = () => { };

        sandbox.__is_full_path = () => false;

        sandbox.afio = {
            getDefaultDir() {
                return Promise.resolve({
                    path: 'Macros',
                    append(segment) {
                        const cleanSegment = String(segment || '').replace(/^[\\/]+/, '');
                        this.path = cleanSegment ? `Macros/${cleanSegment}` : 'Macros';
                    }
                });
            },
            openNode(filePath) {
                const leaf = String(filePath || '').split(/[\\/]/).pop();
                return {
                    leafName: leaf || '',
                    _path: filePath,
                    exists() { return Promise.resolve(true); }
                };
            },
            readTextFile() {
                const deferred = createDeferred();
                readDeferreds.push(deferred);
                return deferred.promise;
            }
        };

        const ctxStore = Object.create(null);
        ctxStore.init = (id) => {
            const key = typeof id === 'number' ? id : parseInt(id, 10);
            const ctx = ctxStore[key] || Object.create(null);
            ctx._initialized = true;
            if (!ctx.mplayer) {
                ctx.mplayer = {
                    playing: false,
                    play(macro, limits, callback) {
                        mplayerPlayCalls.push({ macro, limits });
                        setTimeout(() => {
                            if (typeof callback === 'function') callback({});
                        }, 0);
                    },
                    stop() {
                        mplayerStopCalls.push(key);
                    }
                };
            }
            if (!ctx.recorder) {
                ctx.recorder = { recording: false, stop() { } };
            }
            ctxStore[key] = ctx;
            return Promise.resolve(ctx);
        };
        sandbox.context = ctxStore;

        const contextVm = vm.createContext(sandbox);
        const guardCode = safeRead('macro_execution_guard.js');
        vm.runInContext(guardCode, contextVm, { filename: 'macro_execution_guard.js' });
        vm.runInContext(code, contextVm, { filename: 'offscreen_bg.js' });

        const listener = runtimeOnMessage._listeners[0];
        if (typeof listener !== 'function') {
            throw new Error('Expected offscreen_bg.js to register chrome.runtime.onMessage listener');
        }

        const sender = {
            id: extensionId,
            url: extensionOrigin + 'offscreen.html'
        };

        const dispatch = async (message) => {
            const responses = [];
            listener(message, sender, (payload) => {
                responses.push(payload);
            });
            await tick(2);
            return responses;
        };

        const dispatchAll = async (message) => {
            const responses = [];
            runtimeOnMessage._listeners.forEach((handler) => {
                handler(message, sender, (payload) => {
                    responses.push(payload);
                });
            });
            await tick(2);
            return responses;
        };

        return {
            dispatch,
            dispatchAll,
            tick,
            context: ctxStore,
            sentMessages,
            readDeferreds,
            mplayerPlayCalls,
            mplayerStopCalls
        };
    };

    logHeader('Offscreen play/stop race guards');

    await runCase('offscreen_bg playFile aborts when stop called during file load', async () => {
        const harness = createHarness();
        const win_id = 1;

        await harness.dispatch({
            target: 'offscreen',
            command: 'CALL_CONTEXT_METHOD',
            method: 'playFile',
            win_id,
            args: ['Macros/a.iim', 1],
            requestId: 'reqA'
        });

        if (harness.readDeferreds.length !== 1) {
            throw new Error(`Expected exactly 1 readTextFile call, got ${harness.readDeferreds.length}`);
        }

        await harness.dispatch({
            target: 'offscreen',
            command: 'CALL_CONTEXT_METHOD',
            method: 'stop',
            win_id,
            args: []
        });

        harness.readDeferreds[0].resolve('CODE');
        await harness.tick(4);

        if (harness.mplayerPlayCalls.length !== 0) {
            throw new Error(`Expected mplayer.play not to be called, got ${harness.mplayerPlayCalls.length}`);
        }
    });

    await runCase('offscreen_bg playFile aborts when win_id is string and stop uses number', async () => {
        const harness = createHarness();
        const win_id = '1';

        await harness.dispatch({
            target: 'offscreen',
            command: 'CALL_CONTEXT_METHOD',
            method: 'playFile',
            win_id,
            args: ['Macros/a.iim', 1],
            requestId: 'reqStr'
        });

        if (harness.readDeferreds.length !== 1) {
            throw new Error(`Expected exactly 1 readTextFile call, got ${harness.readDeferreds.length}`);
        }

        await harness.dispatch({
            target: 'offscreen',
            command: 'CALL_CONTEXT_METHOD',
            method: 'stop',
            win_id: 1,
            args: []
        });

        harness.readDeferreds[0].resolve('CODE');
        await harness.tick(4);

        if (harness.mplayerPlayCalls.length !== 0) {
            throw new Error(`Expected mplayer.play not to be called, got ${harness.mplayerPlayCalls.length}`);
        }
    });

    return { passed, failed, skipped: 0, errors };
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
    suite: 'all',
    verbose: false,
    watch: false
};

// Shared sandbox for executing source and test files
const sharedSandbox = Object.create(null);
sharedSandbox.global = sharedSandbox;
sharedSandbox.globalThis = sharedSandbox;
sharedSandbox.console = console;
sharedSandbox.setTimeout = setTimeout;
sharedSandbox.setInterval = setInterval;
sharedSandbox.clearTimeout = clearTimeout;
sharedSandbox.clearInterval = clearInterval;
sharedSandbox.setImmediate = setImmediate;
sharedSandbox.clearImmediate = clearImmediate;
sharedSandbox.Promise = Promise;
sharedSandbox.Map = Map;
sharedSandbox.Set = Set;
sharedSandbox.Array = Array;
sharedSandbox.Object = Object;
sharedSandbox.String = String;
sharedSandbox.Number = Number;
sharedSandbox.Boolean = Boolean;
sharedSandbox.Error = Error;
sharedSandbox.TypeError = TypeError;
sharedSandbox.ReferenceError = ReferenceError;
sharedSandbox.SyntaxError = SyntaxError;
sharedSandbox.RangeError = RangeError;
sharedSandbox.Date = Date;
sharedSandbox.JSON = JSON;
sharedSandbox.Math = Math;
sharedSandbox.RegExp = RegExp;
sharedSandbox.Symbol = Symbol;
sharedSandbox.Function = Function;
sharedSandbox.WeakMap = WeakMap;
sharedSandbox.WeakSet = WeakSet;
sharedSandbox.Uint8Array = Uint8Array;
sharedSandbox.Int8Array = Int8Array;
sharedSandbox.Uint16Array = Uint16Array;
sharedSandbox.Uint32Array = Uint32Array;
sharedSandbox.Float32Array = Float32Array;
sharedSandbox.Float64Array = Float64Array;
sharedSandbox.BigInt64Array = BigInt64Array;
sharedSandbox.BigUint64Array = BigUint64Array;
sharedSandbox.ArrayBuffer = ArrayBuffer;
sharedSandbox.TextEncoder = TextEncoder;
sharedSandbox.TextDecoder = TextDecoder;
sharedSandbox.BigInt = BigInt;
sharedSandbox.URL = URL;
sharedSandbox.AbortController = AbortController;
sharedSandbox.Blob = Blob;
// Deliberately omit Node internals (process, require, module, etc.) to reduce
// sandbox escape surface; add only broadly safe, browser-like globals.
const sharedContext = vm.createContext(sharedSandbox);

args.forEach(arg => {
    if (arg.startsWith('--suite=')) {
        options.suite = arg.split('=')[1];
    } else if (arg === '--verbose') {
        options.verbose = true;
    } else if (arg === '--watch') {
        options.watch = true;
    }
});

/**
 * Simulate browser environment for tests
 */
function setupBrowserEnvironment() {
    // Minimal DOM simulation
    const eventListeners = {};

    // Use the shared sandbox itself as the window/global object so that
    // globals attached to window (e.g., test suites) are visible to the
    // runner through the root context. This mirrors browser behavior where
    // the global object is also exposed as window/self.
    const windowObject = sharedSandbox;

    windowObject.showDirectoryPicker = () => Promise.reject(new Error('File Picker not available in CLI tests'));
    windowObject.showOpenFilePicker = () => Promise.reject(new Error('File Picker not available in CLI tests'));
    windowObject.showSaveFilePicker = () => Promise.reject(new Error('File Picker not available in CLI tests'));
    windowObject.addEventListener = function (type, handler) {
        if (!eventListeners[type]) {
            eventListeners[type] = [];
        }
        eventListeners[type].push(handler);
    };
    windowObject.removeEventListener = function (type, handler) {
        if (!eventListeners[type]) return;
        eventListeners[type] = eventListeners[type].filter(h => h !== handler);
    };
    windowObject.postMessage = function (message, targetOrigin) {
        if (!eventListeners.message) return;
        const event = {
            data: message,
            source: windowObject,
            origin: targetOrigin || '*'
        };
        eventListeners.message.forEach(handler => {
            try {
                handler(event);
            } catch (err) {
                console.error('Error in message handler:', err);
            }
        });
    };
    windowObject.location = {
        href: 'http://localhost/',
        origin: 'http://localhost',
        protocol: 'http:',
        host: 'localhost',
        hostname: 'localhost',
        port: '',
        pathname: '/',
        search: '',
        hash: '',
        toString() {
            return this.href;
        }
    };
    windowObject.screen = {
        width: 1280,
        height: 720
    };
    windowObject.open = function () { return null; };

    // Provide symmetry references
    windowObject.window = windowObject;
    windowObject.self = windowObject;

    sharedSandbox.document = {
        createElement: () => ({}),
        getElementById: () => null
    };

    sharedSandbox.navigator = {
        userAgent: 'Node.js Test Environment',
        platform: 'Win32',
        language: 'en-US'
    };

    // Minimal chrome.* mock used for offscreen/background message handlers.
    // Individual suites may override this for scenario-specific behavior.
    function createEvent() {
        const listeners = new Set();
        return {
            addListener(fn) { listeners.add(fn); },
            removeListener(fn) { listeners.delete(fn); },
            hasListener(fn) { return listeners.has(fn); },
            dispatch(...args) {
                listeners.forEach((fn) => {
                    try {
                        fn(...args);
                    } catch (err) {
                        console.error('Error in chrome event listener:', err);
                    }
                });
            },
            _listeners: listeners
        };
    }

    const runtimeOnMessage = createEvent();
    const extensionId = 'test-extension';
    const extensionOrigin = `chrome-extension://${extensionId}/`;
    const storageLocalData = Object.create(null);

    sharedSandbox.chrome = {
        runtime: {
            id: extensionId,
            lastError: null,
            getURL(pathname = '') {
                const normalized = String(pathname || '').replace(/^\/+/, '');
                return extensionOrigin + normalized;
            },
            onMessage: runtimeOnMessage,
            sendMessage(_message, callback) {
                if (typeof callback === 'function') callback(undefined);
            }
        },
        storage: {
            local: {
                get(keys, callback) {
                    const result = {};
                    if (keys == null) {
                        Object.assign(result, storageLocalData);
                    } else if (Array.isArray(keys)) {
                        keys.forEach((key) => {
                            if (Object.prototype.hasOwnProperty.call(storageLocalData, key)) {
                                result[key] = storageLocalData[key];
                            }
                        });
                    } else if (typeof keys === 'string') {
                        if (Object.prototype.hasOwnProperty.call(storageLocalData, keys)) {
                            result[keys] = storageLocalData[keys];
                        }
                    } else if (keys && typeof keys === 'object') {
                        Object.keys(keys).forEach((key) => {
                            if (Object.prototype.hasOwnProperty.call(storageLocalData, key)) {
                                result[key] = storageLocalData[key];
                            } else {
                                result[key] = keys[key];
                            }
                        });
                    }
                    if (typeof callback === 'function') callback(result);
                },
                set(items, callback) {
                    if (items && typeof items === 'object') {
                        Object.keys(items).forEach((key) => {
                            storageLocalData[key] = items[key];
                        });
                    }
                    if (typeof callback === 'function') callback();
                },
                remove(keys, callback) {
                    const keyList = Array.isArray(keys) ? keys : [keys];
                    keyList.forEach((key) => {
                        delete storageLocalData[key];
                    });
                    if (typeof callback === 'function') callback();
                }
            }
        }
    };

    // IndexedDB mock (minimal, in-memory)
    const mockStores = new Map();
    function createObjectStore(name) {
        if (!mockStores.has(name)) {
            mockStores.set(name, new Map());
        }
        return mockStores.get(name);
    }

    const mockDB = {
        name: 'MockIndexedDB',
        objectStoreNames: {
            contains: (name) => mockStores.has(name)
        },
        createObjectStore: (name) => createObjectStore(name),
        transaction: (storeNames) => {
            const stores = Array.isArray(storeNames) ? storeNames : [storeNames];
            const tx = {
                objectStore: (name) => {
                    if (!stores.includes(name)) {
                        throw new Error(`Object store ${name} not part of transaction`);
                    }
                    const store = createObjectStore(name);
                    return {
                        put: (value, key) => {
                            const request = {};
                            setTimeout(() => {
                                store.set(key, value);
                                if (typeof request.onsuccess === 'function') {
                                    request.result = value;
                                    request.onsuccess({ target: { result: value } });
                                }
                            }, 0);
                            return request;
                        },
                        get: (key) => {
                            const request = {};
                            setTimeout(() => {
                                const result = store.get(key);
                                if (typeof request.onsuccess === 'function') {
                                    request.result = result;
                                    request.onsuccess({ target: { result } });
                                }
                            }, 0);
                            return request;
                        },
                        openCursor: () => {
                            const entries = Array.from(store.entries());
                            let index = 0;
                            const request = {};
                            const continueCursor = () => {
                                const [key, value] = entries[index] || [];
                                if (index < entries.length) {
                                    const cursor = {
                                        key,
                                        value,
                                        continue: () => {
                                            index += 1;
                                            setTimeout(continueCursor, 0);
                                        }
                                    };
                                    if (typeof request.onsuccess === 'function') {
                                        request.result = cursor;
                                        request.onsuccess({ target: { result: cursor } });
                                    }
                                } else if (typeof request.onsuccess === 'function') {
                                    request.result = null;
                                    request.onsuccess({ target: { result: null } });
                                }
                            };
                            setTimeout(continueCursor, 0);
                            return request;
                        },
                        delete: (key) => {
                            const request = {};
                            setTimeout(() => {
                                store.delete(key);
                                if (typeof request.onsuccess === 'function') {
                                    request.result = undefined;
                                    request.onsuccess({ target: { result: undefined } });
                                }
                            }, 0);
                            return request;
                        }
                    };
                }
            };
            setTimeout(() => {
                if (typeof tx.oncomplete === 'function') {
                    tx.oncomplete({});
                }
            }, 0);
            return tx;
        }
    };

    sharedSandbox.indexedDB = {
        open: (name, version) => {
            const db = { ...mockDB, name: name || 'MockIndexedDB', version: version || 1 };
            const request = { result: db };
            setTimeout(() => {
                if (typeof request.onupgradeneeded === 'function') {
                    request.onupgradeneeded({ target: { result: db } });
                }
                if (typeof request.onsuccess === 'function') {
                    request.onsuccess({ target: { result: db } });
                }
            }, 0);
            return request;
        }
    };

    // Storage mock
    sharedSandbox.Storage = class Storage {
        constructor() {
            this.data = {};
        }
        get length() {
            return Object.keys(this.data).length;
        }
        key(index) {
            return Object.keys(this.data)[index] || null;
        }
        getItem(key) {
            return key in this.data ? this.data[key] : null;
        }
        setItem(key, value) {
            this.data[key] = String(value);
        }
        removeItem(key) {
            delete this.data[key];
        }
        clear() {
            this.data = {};
        }
    };

    sharedSandbox.localStorage = new sharedSandbox.Storage();
    sharedSandbox.sessionStorage = new sharedSandbox.Storage();

    // Provide require() to allow regression tests to inspect source files
    sharedSandbox.require = require;
    // Provide __dirname so test suites can resolve project-relative paths.
    sharedSandbox.__dirname = __dirname;

    logSuccess('Browser environment simulated');
}

/**
 * Load source files
 */
function loadSourceFiles() {
    const baseDir = path.join(__dirname, '..');
    const sourceFiles = [
        'utils.js',
        'communicator.js',
        'macro_execution_guard.js',
        'security_utils.js',
        'download_correlation.js',
        'GlobalErrorLogger.js',
        'VirtualFileService.js',
        'WindowsPathMappingService.js',
        'FileSystemAccessService.js',
        'FileSyncBridge.js',
        'AsyncFileIO.js',
        'variable-manager.js',
        'mplayer.js',
        'mrecorder.js',
        'panel.js',
        'offscreen.js'
    ];

    logInfo('Loading source files...');

    sourceFiles.forEach(file => {
        const filePath = path.join(baseDir, file);
        if (fs.existsSync(filePath)) {
            try {
                // Read file content
                const code = fs.readFileSync(filePath, 'utf8');

                // Execute in shared sandbox to preserve lexical bindings across files
                // while keeping Node.js globals isolated.
                vm.runInContext(code, sharedContext, { filename: file });

                if (options.verbose) {
                    logSuccess(`  ${file}`);
                }
            } catch (err) {
                logError(`  Failed to load ${file}: ${err.message}`);
                if (options.verbose) {
                    console.error(err.stack);
                }
            }
        } else {
            logWarning(`  ${file} not found`);
        }
    });

    // Promote loaded bindings to the shared sandbox so they are visible when
    // test suites execute in a new VM context. We perform the promotion inside
    // the shared VM context so lexical bindings created with `const`/`class`
    // are hoisted onto `globalThis`.
    const exportedGlobals = [
        'FileSystemAccessService',
        'WindowsPathMappingService',
        'FileSyncBridge',
        'VirtualFileService',
        'AsyncFileIO',
        'GlobalErrorLogger',
        'afio',
        'communicator'
    ];

    const promoteScript = new vm.Script(`
        (function promoteGlobals(names) {
            names.forEach(name => {
                try {
                    // Access lexical binding inside the shared context
                    const value = eval(name);

                    if (typeof value !== 'undefined') {
                        globalThis[name] = value;
                    } else if (typeof window !== 'undefined' && typeof window[name] !== 'undefined') {
                        globalThis[name] = window[name];
                    }
                } catch (err) {
                    if (typeof window !== 'undefined' && typeof window[name] !== 'undefined') {
                        globalThis[name] = window[name];
                    }
                }
            });
        })(${JSON.stringify(exportedGlobals)});
    `);

    promoteScript.runInContext(sharedContext);

    logSuccess(`Loaded ${sourceFiles.length} source files`);
}

/**
 * Load test suites
 */
function loadTestSuites() {
    const testDir = __dirname;
    const testFiles = [
        'filesystem_access_test_suite.js',
        'afio_test_suite.js',
        'variable_expansion_test_suite.js',
        'security_utils_test_suite.js',
        'offscreen_security_test_suite.js',
        'dedup_guard_test_suite.js',
        'download_correlation_test_suite.js',
        'recorder_event_forwarding_test_suite.js',
        'panel_play_response_test_suite.js',
        'macro_run_test_suite.js',
        'regression_test_suite.js'
    ];

    logInfo('Loading test suites...');

    testFiles.forEach(file => {
        const filePath = path.join(testDir, file);
        if (fs.existsSync(filePath)) {
            try {
                const code = fs.readFileSync(filePath, 'utf8');
                // Execute tests in the shared sandbox so they see the same globals
                vm.runInContext(code, sharedContext, { filename: file });

                if (options.verbose) {
                    logSuccess(`  ${file}`);
                }
            } catch (err) {
                logError(`  Failed to load ${file}: ${err.message}`);
                if (options.verbose) {
                    console.error(err.stack);
                }
            }
        } else {
            logWarning(`  ${file} not found`);
        }
    });

    // Expose suites placed on the simulated window to the shared sandbox so
    // the CLI runner (executing in the Node context) can access them.
    const suiteGlobals = [
        'FileSystemAccessTestSuite',
        'AfioTestSuite',
        'VariableExpansionTestSuite',
        'SecurityUtilsTestSuite',
        'OffscreenSecurityTestSuite',
        'MacroRunTestSuite',
        'DedupGuardTestSuite',
        'DownloadCorrelationTestSuite',
        'RecorderEventForwardingTestSuite',
        'PanelPlayResponseTestSuite',
        'RegressionTestSuite'
    ];
    suiteGlobals.forEach(name => {
        if (sharedSandbox.window && typeof sharedSandbox.window[name] !== 'undefined') {
            sharedSandbox[name] = sharedSandbox.window[name];
        }
    });

    logSuccess('Test suites loaded');
}

/**
 * Run tests and collect results
 */
async function runTests() {
    logHeader('iMacros MV3 Test Suite - CLI Runner');

    const results = {
        passed: 0,
        failed: 0,
        skipped: 0,
        errors: []
    };

    // MV3 compatibility guardrail: detect MV2-only background usage
    if (options.suite === 'all' || options.suite === 'compat') {
        const compatResult = runCompatibilityGuards(path.resolve(__dirname, '..'));
        results.passed += compatResult.passed;
        results.failed += compatResult.failed;
        results.skipped += compatResult.skipped || 0;
        results.errors.push(...compatResult.errors);

        // If only compat suite requested, short-circuit after guard
        if (options.suite === 'compat') {
            printSummary(results);
            process.exit(results.failed > 0 ? 1 : 0);
        }
    }

    // Setup environment
    setupBrowserEnvironment();

    // Load files
    loadSourceFiles();
    loadTestSuites();

    const {
        FileSystemAccessTestSuite,
        AfioTestSuite,
        VariableExpansionTestSuite,
        SecurityUtilsTestSuite,
        OffscreenSecurityTestSuite,
        MacroRunTestSuite,
        DedupGuardTestSuite,
        DownloadCorrelationTestSuite,
        RecorderEventForwardingTestSuite,
        PanelPlayResponseTestSuite,
        RegressionTestSuite
    } = sharedSandbox;

    function normalizeSuiteResult(rawResult, suiteName) {
        const defaultResults = { passed: 0, failed: 0, skipped: 0 };
        if (!rawResult || typeof rawResult !== 'object') {
            return { results: { ...defaultResults }, errors: [] };
        }

        const results = rawResult.results ? rawResult.results : { ...defaultResults };
        let errors = [];
        if (Array.isArray(rawResult.errors)) {
            errors = rawResult.errors;
        } else if (rawResult.errors && Array.isArray(rawResult.errors.errors)) {
            errors = rawResult.errors.errors;
        }
        return { results, errors };
    }

    try {
        // Run security utils tests
        if (options.suite === 'all' || options.suite === 'security') {
            logHeader('Security Utils Tests');

            if (typeof SecurityUtilsTestSuite !== 'undefined') {
                try {
                    const securityResult = normalizeSuiteResult(await SecurityUtilsTestSuite.run(), 'SecurityUtilsTestSuite');
                    results.passed += securityResult.results.passed || 0;
                    results.failed += securityResult.results.failed || 0;
                    results.skipped += securityResult.results.skipped || 0;
                    results.errors.push(...securityResult.errors);
                } catch (err) {
                    logError(`Fatal error in Security Utils tests: ${err.message}`);
                    results.errors.push({
                        context: 'SecurityUtilsTestSuite',
                        message: err.message,
                        stack: err.stack
                    });
                }
            } else {
                logWarning('SecurityUtilsTestSuite not available');
            }

            if (typeof OffscreenSecurityTestSuite !== 'undefined') {
                try {
                    const offscreenResult = normalizeSuiteResult(await OffscreenSecurityTestSuite.run(), 'OffscreenSecurityTestSuite');
                    results.passed += offscreenResult.results.passed || 0;
                    results.failed += offscreenResult.results.failed || 0;
                    results.skipped += offscreenResult.results.skipped || 0;
                    results.errors.push(...offscreenResult.errors);
                } catch (err) {
                    logError(`Fatal error in Offscreen Security tests: ${err.message}`);
                    results.errors.push({
                        context: 'OffscreenSecurityTestSuite',
                        message: err.message,
                        stack: err.stack
                    });
                }
            } else {
                logWarning('OffscreenSecurityTestSuite not available');
            }
        }

        // Run variable expansion tests
        if (options.suite === 'all' || options.suite === 'vars') {
            logHeader('Variable Expansion Tests');

            if (typeof VariableExpansionTestSuite !== 'undefined') {
                try {
                    const expansionResult = normalizeSuiteResult(await VariableExpansionTestSuite.run(), 'VariableExpansionTestSuite');
                    results.passed += expansionResult.results.passed || 0;
                    results.failed += expansionResult.results.failed || 0;
                    results.skipped += expansionResult.results.skipped || 0;
                    results.errors.push(...expansionResult.errors);
                } catch (err) {
                    logError(`Fatal error in Variable Expansion tests: ${err.message}`);
                    results.errors.push({
                        context: 'VariableExpansionTestSuite',
                        message: err.message,
                        stack: err.stack
                    });
                }
            } else {
                logWarning('VariableExpansionTestSuite not available');
            }
        }

        // Run RUN/macro chaining tests
        if (options.suite === 'all' || options.suite === 'macro') {
            const raceResult = await runOffscreenPlayStopRaceGuards(path.resolve(__dirname, '..'));
            results.passed += raceResult.passed || 0;
            results.failed += raceResult.failed || 0;
            results.skipped += raceResult.skipped || 0;
            results.errors.push(...(raceResult.errors || []));

            logHeader('Deduplication Guard Tests');

            if (typeof DedupGuardTestSuite !== 'undefined') {
                try {
                    const guardResult = normalizeSuiteResult(await DedupGuardTestSuite.run(), 'DedupGuardTestSuite');
                    results.passed += guardResult.results.passed || 0;
                    results.failed += guardResult.results.failed || 0;
                    results.skipped += guardResult.results.skipped || 0;
                    results.errors.push(...guardResult.errors);
                } catch (err) {
                    logError(`Fatal error in Dedup Guard tests: ${err.message}`);
                    results.errors.push({
                        context: 'DedupGuardTestSuite',
                        message: err.message,
                        stack: err.stack
                    });
                }
            } else {
                logWarning('DedupGuardTestSuite not available');
            }

            logHeader('Macro RUN Command Tests');

            if (typeof MacroRunTestSuite !== 'undefined') {
                try {
                    const macroRunResult = normalizeSuiteResult(await MacroRunTestSuite.run(), 'MacroRunTestSuite');
                    results.passed += macroRunResult.results.passed || 0;
                    results.failed += macroRunResult.results.failed || 0;
                    results.skipped += macroRunResult.results.skipped || 0;
                    results.errors.push(...macroRunResult.errors);
                } catch (err) {
                    logError(`Fatal error in Macro RUN tests: ${err.message}`);
                    results.errors.push({
                        context: 'MacroRunTestSuite',
                        message: err.message,
                        stack: err.stack
                    });
                }
            } else {
                logWarning('MacroRunTestSuite not available');
            }
        }

        // Run Panel play response tests (keeps UI from getting stuck on error-only responses)
        if (options.suite === 'all' || options.suite === 'panel') {
            logHeader('Panel Play Response Tests');

            if (typeof PanelPlayResponseTestSuite !== 'undefined') {
                try {
                    const panelResult = normalizeSuiteResult(await PanelPlayResponseTestSuite.run(), 'PanelPlayResponseTestSuite');
                    results.passed += panelResult.results.passed || 0;
                    results.failed += panelResult.results.failed || 0;
                    results.skipped += panelResult.results.skipped || 0;
                    results.errors.push(...panelResult.errors);
                } catch (err) {
                    logError(`Fatal error in Panel play response tests: ${err.message}`);
                    results.errors.push({
                        context: 'PanelPlayResponseTestSuite',
                        message: err.message,
                        stack: err.stack
                    });
                }
            } else {
                logWarning('PanelPlayResponseTestSuite not available');
            }
        }

        // Run Recorder forwarded-event tests (prevents duplicate recording and restores ONDOWNLOAD)
        if (options.suite === 'all' || options.suite === 'recorder') {
            logHeader('Download Correlation Tests');

            if (typeof DownloadCorrelationTestSuite !== 'undefined') {
                try {
                    const corrResult = normalizeSuiteResult(await DownloadCorrelationTestSuite.run(), 'DownloadCorrelationTestSuite');
                    results.passed += corrResult.results.passed || 0;
                    results.failed += corrResult.results.failed || 0;
                    results.skipped += corrResult.results.skipped || 0;
                    results.errors.push(...corrResult.errors);
                } catch (err) {
                    logError(`Fatal error in Download correlation tests: ${err.message}`);
                    results.errors.push({
                        context: 'DownloadCorrelationTestSuite',
                        message: err.message,
                        stack: err.stack
                    });
                }
            } else {
                logWarning('DownloadCorrelationTestSuite not available');
            }

            logHeader('Recorder Event Forwarding Tests');

            if (typeof RecorderEventForwardingTestSuite !== 'undefined') {
                try {
                    const recorderResult = normalizeSuiteResult(await RecorderEventForwardingTestSuite.run(), 'RecorderEventForwardingTestSuite');
                    results.passed += recorderResult.results.passed || 0;
                    results.failed += recorderResult.results.failed || 0;
                    results.skipped += recorderResult.results.skipped || 0;
                    results.errors.push(...recorderResult.errors);
                } catch (err) {
                    logError(`Fatal error in Recorder forwarding tests: ${err.message}`);
                    results.errors.push({
                        context: 'RecorderEventForwardingTestSuite',
                        message: err.message,
                        stack: err.stack
                    });
                }
            } else {
                logWarning('RecorderEventForwardingTestSuite not available');
            }
        }

        // Run File System Access tests
        if (options.suite === 'all' || options.suite === 'fsaccess') {
            logHeader('File System Access API Tests');

            if (typeof FileSystemAccessTestSuite !== 'undefined') {
                try {
                    const fsResult = normalizeSuiteResult(await FileSystemAccessTestSuite.run(), 'FileSystemAccessTestSuite');
                    results.passed += fsResult.results.passed || 0;
                    results.failed += fsResult.results.failed || 0;
                    results.skipped += fsResult.results.skipped || 0;
                    results.errors.push(...fsResult.errors);
                } catch (err) {
                    logError(`Fatal error in FS Access tests: ${err.message}`);
                    results.errors.push({
                        context: 'FileSystemAccessTestSuite',
                        message: err.message,
                        stack: err.stack
                    });
                }
            } else {
                logWarning('FileSystemAccessTestSuite not available');
            }
        }

        // Run AFIO tests
        if (options.suite === 'all' || options.suite === 'afio') {
            logHeader('AsyncFileIO Tests');

            if (typeof AfioTestSuite !== 'undefined') {
                try {
                    const afioResult = normalizeSuiteResult(await AfioTestSuite.run(), 'AfioTestSuite');
                    results.passed += afioResult.results.passed || 0;
                    results.failed += afioResult.results.failed || 0;
                    results.skipped += afioResult.results.skipped || 0;
                    results.errors.push(...afioResult.errors);
                } catch (err) {
                    logError(`Fatal error in AFIO tests: ${err.message}`);
                    results.errors.push({
                        context: 'AfioTestSuite',
                        message: err.message,
                        stack: err.stack
                    });
                }
            } else {
                logWarning('AfioTestSuite not available');
            }
        }

        // Run regression tests
        if (options.suite === 'all' || options.suite === 'regression') {
            logHeader('Regression Tests');

            if (typeof RegressionTestSuite !== 'undefined') {
                try {
                    const regressionResult = normalizeSuiteResult(await RegressionTestSuite.run(), 'RegressionTestSuite');
                    results.passed += regressionResult.results.passed || 0;
                    results.failed += regressionResult.results.failed || 0;
                    results.skipped += regressionResult.results.skipped || 0;
                    results.errors.push(...regressionResult.errors);
                } catch (err) {
                    logError(`Fatal error in Regression tests: ${err.message}`);
                    results.errors.push({
                        context: 'RegressionTestSuite',
                        message: err.message,
                        stack: err.stack
                    });
                }
            } else {
                logWarning('RegressionTestSuite not available');
            }
        }

    } catch (err) {
        logError(`Fatal error: ${err.message}`);
        if (options.verbose) {
            console.error(err.stack);
        }
    }

    // Print summary
    printSummary(results);

    // Exit with appropriate code
    process.exit(results.failed > 0 ? 1 : 0);
}

/**
 * Print test summary
 */
function printSummary(results) {
    logHeader('Test Summary');

    const total = results.passed + results.failed + results.skipped;
    const passRate = total > 0 ? Math.round((results.passed / total) * 100) : 0;

    console.log(colorize(`  Total:   ${total}`, 'bright'));
    console.log(colorize(`  Passed:  ${results.passed} (${passRate}%)`, 'green'));
    console.log(colorize(`  Failed:  ${results.failed}`, results.failed > 0 ? 'red' : 'white'));
    console.log(colorize(`  Skipped: ${results.skipped}`, results.skipped > 0 ? 'yellow' : 'white'));

    if (results.failed > 0) {
        console.log('\n' + colorize('Failed Tests:', 'red'));
        results.errors.slice(0, 10).forEach(error => {
            console.log(colorize(`  ✗ ${error.context}: ${error.message}`, 'red'));
            if (options.verbose && error.stack) {
                console.log(colorize(`    ${error.stack.split('\n')[0]}`, 'white'));
            }
        });

        if (results.errors.length > 10) {
            console.log(colorize(`  ... and ${results.errors.length - 10} more errors`, 'yellow'));
        }
    }

    console.log('');

    if (results.failed === 0 && results.passed > 0) {
        console.log(colorize('  ✓ ALL TESTS PASSED!', 'bgGreen'));
    } else if (results.failed > 0) {
        console.log(colorize(`  ✗ ${results.failed} TEST(S) FAILED`, 'bgRed'));
    } else {
        console.log(colorize('  ⚠ NO TESTS EXECUTED', 'bgYellow'));
    }

    console.log('');
}

// Run tests
runTests().catch(err => {
    logError(`Unhandled error: ${err.message}`);
    console.error(err);
    process.exit(1);
});
