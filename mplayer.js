/*
 * Simplified MacroPlayer implementation for MV3 test harness.
 * Focuses on variable expansion and RUN command support used in unit tests.
 */

// Provide a minimal RuntimeError definition when the shared utilities are not loaded.
if (typeof RuntimeError === 'undefined') {
    function RuntimeError(msg, num) {
        this.name = 'RuntimeError';
        this.message = msg;
        this.num = num;
    }
    RuntimeError.prototype = Error.prototype;
}

function MacroPlayer(win_id) {
    if (typeof VariableManager !== 'function') {
        throw new Error('VariableManager is not defined');
    }
    this.win_id = win_id || 'default-window';

    // Legacy containers
    this.vars = [];
    this.userVars = new Map();

    // Modern variable manager
    this.varManager = new VariableManager();

    // Execution state
    this.callStack = [];
    this.loopStack = [];
    this.runNestLevel = 0;
    this.autoplaySuppressed = false;

    // Macro context
    this.currentMacro = null;
    this.currentLoop = 0;
    this.macrosFolder = null;
    this.file_id = null;

    // Action queue used by the test harness
    this.action_stack = [];
    this._ActionTable = {};

    // Wire action handlers
    this.registerActionHandlers();
}

MacroPlayer.prototype.registerActionHandlers = function () {
    this._ActionTable = Object.assign({}, MacroPlayer.prototype.ActionTable);
    Object.keys(this._ActionTable).forEach(key => {
        this._ActionTable[key] = this._ActionTable[key].bind(this);
    });
};

MacroPlayer.prototype.deepCopy = function (value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => this.deepCopy(item));
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof RegExp) return new RegExp(value.source, value.flags);

    if (value.constructor === Object && Object.getPrototypeOf(value) === Object.prototype) {
        const result = {};
        for (const key in value) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                result[key] = this.deepCopy(value[key]);
            }
        }
        return result;
    }

    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch (err) {
            console.warn('[iMacros] structuredClone deepCopy fallback failed, trying manual copy', err);
        }
    }

    try {
        const clone = Object.create(Object.getPrototypeOf(value));
        for (const key of Object.keys(value)) {
            clone[key] = this.deepCopy(value[key]);
        }
        return clone;
    } catch (err) {
        console.error('[iMacros] deepCopy failed; unable to isolate value', err);
        return value;
    }
};

MacroPlayer.prototype.convertLimits = function (limits) {
    let convert = x => x === "unlimited" ? Number.MAX_SAFE_INTEGER : x;
    let obj = {};
    for (let key in limits) {
        obj[key] = convert(limits[key]);
    }
    obj.varsRe = limits.maxVariables === "unlimited" || limits.maxVariables >= 10 ?
        /^!var([0-9]+)$/i : new RegExp("^!var([1-" + limits.maxVariables + "])$", "i");
    obj.userVars = limits.maxVariables === "unlimited" || limits.maxVariables >= 10;
    return Object.freeze(obj);
};

MacroPlayer.prototype.next = function () {
    return true;
};

MacroPlayer.prototype._pushFrame = function (actionType, options) {
    if (this.runNestLevel >= 10) {
        throw new RuntimeError('Maximum RUN nesting exceeded (780)');
    }

    const frameOptions = options || {};
    const frame = {
        callerId: actionType,
        loopStack: this.deepCopy(this.loopStack),
        localContext: this.varManager.snapshotLocalContext(),
        autoplaySuppressed: Object.prototype.hasOwnProperty.call(frameOptions, 'autoplaySuppressed')
            ? frameOptions.autoplaySuppressed
            : this.autoplaySuppressed
    };
    this.callStack.push(frame);
    this.runNestLevel += 1;
};

MacroPlayer.prototype._popFrame = function () {
    if (!this.callStack.length) return;
    const frame = this.callStack.pop();
    this.loopStack = this.deepCopy(frame.loopStack);
    this.varManager.restoreLocalContext(frame.localContext);
    if (Object.prototype.hasOwnProperty.call(frame, 'autoplaySuppressed')) {
        this.autoplaySuppressed = frame.autoplaySuppressed;
    }
    this.runNestLevel = Math.max(0, this.runNestLevel - 1);
    this.next(frame.callerId || 'run');
};

MacroPlayer.prototype.resetVariableStateForNewMacro = function () {
    this.varManager = new VariableManager();
    this.vars = [];
    this.userVars.clear();
};

MacroPlayer.prototype._buildMacroCandidates = function (macroNameRaw) {
    if (!macroNameRaw || typeof macroNameRaw !== 'string') return [];
    const trimmed = macroNameRaw.trim();
    if (!trimmed) return [];

    const lastSegment = trimmed.split(/[\\/]/).pop();
    const macroHasExtension = /\.[^\\/.]+$/.test(lastSegment);

    if (macroHasExtension) {
        return [trimmed];
    }

    return [`${trimmed}.iim`, trimmed];
};

MacroPlayer.prototype.getColumnData = function (col) {
    if (typeof this.getColumnDataImpl === 'function') {
        return this.getColumnDataImpl(col);
    }
    return '';
};

/**
 * Recursively expands variable placeholders in the given string, supporting nested placeholders,
 * EVAL expressions, and column references. Detects and prevents circular references using a depth map.
 *
 * Placeholders are in the form {{!VAR}}, {{!EVAL(expr)}}, or {{!COLn}}.
 * Nested placeholders within variable names are supported.
 *
 * @param {string} param - The string containing variable placeholders to expand.
 * @param {string} [eval_id] - Optional evaluation context identifier for EVAL expressions.
 * @param {Map<string, boolean>} [depthMap] - Internal map used to track recursion depth and detect circular references.
 *        Should not be provided by callers; used internally during recursion.
 * @throws {BadParameter} If a placeholder contains whitespace, or if an unsupported variable is referenced.
 * @throws {RuntimeError} If a circular reference is detected (maximum expansion depth exceeded).
 * @returns {string} The input string with all variable placeholders recursively expanded.
 */
MacroPlayer.prototype.expandVariables = function (param, eval_id, depthMap) {
    const evalIdBase = eval_id || 'eval';
    const visited = depthMap || new Map();

    const replacePlaceholder = (match, inner) => {
        if (inner.trim() !== inner) {
            throw new BadParameter(`Whitespace is not allowed inside variable placeholder: {{${inner}}}`);
        }

        // Handle nested placeholders in variable names first
        if (/\{\{.*\}\}/.test(inner)) {
            inner = this.expandVariables(inner, evalIdBase, visited);
        }

        const varName = inner.replace(/^!/, '');
        if (visited.has(varName)) {
            throw new RuntimeError('Maximum placeholder expansion depth exceeded for !' + varName);
        }

        const markVisited = () => visited.set(varName, true);
        const unmarkVisited = () => visited.delete(varName);

        // Inline EVAL
        const evalMatch = inner.match(/^!EVAL\((.*)\)$/i);
        if (evalMatch) {
            let expr = evalMatch[1];
            if ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith("'") && expr.endsWith("'"))) {
                expr = expr.slice(1, -1);
            }
            const unique = Math.random().toString(36).slice(2, 11);
            const evalId = `${evalIdBase}_${Date.now().toString(36)}_${unique}`;
            return String(this.do_eval(expr, evalId));
        }

        // Datasource columns
        const colMatch = inner.match(/^!COL(\d+)$/i);
        if (colMatch) {
            return String(this.getColumnData(parseInt(colMatch[1], 10)));
        }

        // Standard variables via VariableManager
        const value = this.varManager.getVar(varName);
        const hasVar = this.varManager.globalVars.has(varName) ||
            Object.prototype.hasOwnProperty.call(this.varManager.localContext, varName);

        if (!hasVar && value === '') {
            throw new BadParameter('Unsupported variable !' + varName);
        }

        markVisited();
        try {
            const expanded = this.expandVariables(String(value), evalIdBase, visited);
            return expanded;
        } finally {
            unmarkVisited();
        }
    };

    let result = param;
    const MAX_EXPANSION_ITERATIONS = 50; // Prevent infinite loops in variable expansion
    let safety = 0;
    while (/\{\{[^{}]+\}\}/.test(result) && safety < MAX_EXPANSION_ITERATIONS) {
        result = result.replace(/\{\{([^{}]+)\}\}/g, replacePlaceholder);
        safety++;
    }
    if (safety >= MAX_EXPANSION_ITERATIONS && /\{\{[^{}]+\}\}/.test(result)) {
        throw new RuntimeError('Maximum placeholder expansion iterations exceeded');
    }
    return result;
};

/**
 * Resolves the full path to a macro file using a prioritized fallback strategy.
 *
 * Path resolution priority:
 *  1. If `this.macrosFolder` is set, returns its path joined with `macroPath`.
 *  2. Otherwise, if the global `afio` object is available and has `getDefaultDir`, uses its path.
 *  3. Otherwise, returns the raw `macroPath` as-is.
 *
 * Return value:
 *  - If the global `afio` object and its `openNode` function are available, returns the result of `afio.openNode(targetPath)`.
 *  - Otherwise, returns a plain object with `path`, `leafName`, and stub `append`/`clone` methods.
 *
 * Async behavior:
 *  - This function is asynchronous and may throw if afio methods (e.g., `getDefaultDir`, `openNode`) fail.
 *
 * @param {string} macroPath - The relative or raw path to the macro file.
 * @returns {Promise<Object>} A promise resolving to an afio node or a plain object representing the macro file path.
 * @throws {Error} If afio methods throw during path resolution.
 */
MacroPlayer.prototype.resolveMacroPath = async function (macroPath) {
    const buildPath = async () => {
        if (this.macrosFolder && this.macrosFolder.path) {
            return this.macrosFolder.path.replace(/\/$/, '') + '/' + macroPath;
        }
        if (typeof afio !== 'undefined' && afio.getDefaultDir) {
            const dir = await afio.getDefaultDir();
            return (dir.path || '').replace(/\/$/, '') + '/' + macroPath;
        }
        return macroPath;
    };

    const targetPath = await buildPath();
    if (typeof afio !== 'undefined' && typeof afio.openNode === 'function') {
        return afio.openNode(targetPath);
    }

    return {
        path: targetPath,
        leafName: targetPath.split('/').pop(),
        append() { },
        clone() { return Object.assign({}, this); }
    };
};

MacroPlayer.prototype.loadMacroFileFromFs = async function (macroNode) {
    if (typeof macroNode === 'string') return macroNode;
    if (typeof this.loadMacroFileImpl === 'function') {
        return this.loadMacroFileImpl(macroNode);
    }
    if (typeof afio !== 'undefined' && afio.readTextFile) {
        const content = await afio.readTextFile(macroNode);
        return content || '';
    }
    return '';
};

MacroPlayer.prototype.parseInlineMacro = function (content) {
    const actions = [];
    const lines = (content || '').split(/\r?\n/);
    lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const setMatch = trimmed.match(/^SET\s+(!?[^\s]+)\s+(.+)$/i);
        if (setMatch) {
            actions.push({ name: 'set', args: [null, setMatch[1], setMatch[2]], line: idx + 1 });
            return;
        }
        const urlMatch = trimmed.match(/^URL\s+GOTO=(.+)$/i);
        if (urlMatch) {
            actions.push({ name: 'url', args: [null, urlMatch[1]], line: idx + 1 });
            return;
        }
    });
    return actions;
};

MacroPlayer.prototype.ActionTable = {};

MacroPlayer.prototype.ActionTable['set'] = function (cmd) {
    const name = cmd[1];
    const value = this.expandVariables(cmd[2], 'set');
    if (/^!var\d+$/i.test(name)) {
        const index = parseInt(name.replace(/^!var/i, ''), 10);
        this.vars[index] = value;
        this.varManager.setVar('VAR' + index, value);
    } else {
        this.varManager.setVar(name, value);
        this.userVars.set(name.toLowerCase(), value);
    }
    this.next('SET');
};

MacroPlayer.prototype.ActionTable['url'] = function () {
    this.next('URL');
};

MacroPlayer.prototype.ActionTable['run'] = async function (cmd) {
    const macroParam = cmd[0] || '';
    const macroNameRaw = (macroParam.match(/macro\s*=\s*(.+)/i) || [null, cmd[1] || ''])[1];
    if (!macroNameRaw) {
        throw new BadParameter('macro parameter is required');
    }

    const macroCandidates = this._buildMacroCandidates(macroNameRaw);
    if (!macroCandidates.length) {
        throw new BadParameter('macro parameter is required');
    }

    const basePath = (this.macrosFolder && this.macrosFolder.path)
        ? this.macrosFolder.path.replace(/\/$/, '')
        : null;

    const tryInlineLoad = async () => {
        if (typeof this.loadMacroFile !== 'function') return null;
        for (const candidate of macroCandidates) {
            const inlineSource = await this.loadMacroFile(candidate);
            if (inlineSource !== null && typeof inlineSource !== 'undefined') {
                return { source: inlineSource, fullPath: candidate };
            }
        }
        return null;
    };

    const tryFilesystemLoad = async () => {
        for (const candidate of macroCandidates) {
            const macroNode = await this.resolveMacroPath(candidate);
            const resolvedPath = (macroNode && macroNode.path)
                ? macroNode.path
                : (basePath ? `${basePath}/${candidate}` : candidate);
            let source = null;

            try {
                source = await this.loadMacroFileFromFs(macroNode);
            } catch (err) {
                if (typeof Storage !== 'undefined' && Storage.getBool && Storage.getBool('debug')) {
                    console.debug('[iMacros] Failed to load macro from filesystem', resolvedPath, err);
                }
            }

            if (source !== null && typeof source !== 'undefined') {
                return { source, fullPath: resolvedPath };
            }
        }
        return null;
    };

    const inlineResult = await tryInlineLoad();
    const loadResult = inlineResult || await tryFilesystemLoad();
    if (!loadResult) {
        throw new RuntimeError('Macro file not found: ' + macroCandidates.map(p => `'${p}'`).join(', '), 781);
    }

    const { source, fullPath } = loadResult;

    this.file_id = fullPath;
    this.currentMacro = (fullPath && fullPath.split('/').pop()) || macroNameRaw;

    // Child macros must not mutate caller loop frames
    this.loopStack = this.deepCopy(this.loopStack);

    const autoplaySuppressedBeforeRun = this.autoplaySuppressed;
    this.autoplaySuppressed = false;

    this._pushFrame('run', { autoplaySuppressed: autoplaySuppressedBeforeRun });

    const actions = this.parseInlineMacro(source);
    actions.forEach(action => this.action_stack.push(action));
};

// Default inline EVAL executor; overridden by tests when needed. Not safe for untrusted input.
MacroPlayer.prototype.do_eval = function (s, eval_id) {
    return eval(s);
};

if (typeof window !== 'undefined') {
    window.MacroPlayer = MacroPlayer;
} else if (typeof global !== 'undefined') {
    global.MacroPlayer = MacroPlayer;
}
