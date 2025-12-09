/*
 * Simplified MacroPlayer implementation for MV3 test harness.
 * Focuses on variable expansion and RUN command support used in unit tests.
 */

function MacroPlayer(win_id) {
    this.win_id = win_id || 'default-window';

    // Legacy containers
    this.vars = new Array();
    this.userVars = new Map();

    // Modern variable manager
    this.varManager = new VariableManager();

    // Execution state
    this.callStack = [];
    this.loopStack = [];
    this.runNestLevel = 0;

    // Action queue used by the test harness
    this.action_stack = [];
    this._ActionTable = {};

    // Macro context
    this.currentLoop = 0;
    this.macrosFolder = null;
    this.file_id = null;

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
    for (key in limits) {
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

MacroPlayer.prototype._pushFrame = function (callerId) {
    const frame = {
        callerId,
        loopStack: this.deepCopy(this.loopStack),
        localContext: this.varManager.snapshotLocalContext()
    };
    this.callStack.push(frame);
    this.runNestLevel += 1;
};

MacroPlayer.prototype._popFrame = function () {
    if (!this.callStack.length) return;
    const frame = this.callStack.pop();
    this.loopStack = this.deepCopy(frame.loopStack);
    this.varManager.restoreLocalContext(frame.localContext);
    this.runNestLevel = Math.max(0, this.runNestLevel - 1);
    this.next(frame.callerId || 'run');
};

MacroPlayer.prototype.resetVariableStateForNewMacro = function () {
    this.varManager = new VariableManager();
    this.vars = new Array();
    this.userVars.clear();
};

MacroPlayer.prototype.getColumnData = function (col) {
    if (typeof this.getColumnDataImpl === 'function') {
        return this.getColumnDataImpl(col);
    }
    return '';
};

MacroPlayer.prototype.expandVariables = function (param, eval_id, depthMap) {
    const evalIdBase = eval_id || 'eval';
    const visited = depthMap || new Map();

    const replacePlaceholder = (match, inner) => {
        if (inner.trim() !== inner) {
            throw new BadParameter('Whitespace is not allowed inside variable placeholder');
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

        try {
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
            const expanded = this.expandVariables(String(value), evalIdBase, visited);
            unmarkVisited();
            return expanded;
        } finally {
            visited.delete(varName);
        }
    };

    let result = param;
    let safety = 0;
    while (/\{\{[^{}]+\}\}/.test(result) && safety < 50) {
        result = result.replace(/\{\{([^{}]+)\}\}/g, replacePlaceholder);
        safety++;
    }
    return result;
};

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
    const macroName = (macroParam.match(/macro\s*=\s*(.+)/i) || [null, cmd[1] || ''])[1];
    if (!macroName) {
        throw new BadParameter('macro parameter is required');
    }

    const macroNode = await this.resolveMacroPath(macroName);
    const basePath = (this.macrosFolder && this.macrosFolder.path)
        ? this.macrosFolder.path.replace(/\/$/, '')
        : null;

    let content;
    if (Object.prototype.hasOwnProperty.call(this, 'loadMacroFile')) {
        content = await this.loadMacroFile(macroNode);
    }

    let resolvedPath = macroName;
    if (macroNode && macroNode.path) {
        resolvedPath = macroNode.path;
    } else if (basePath) {
        resolvedPath = basePath + '/' + macroName;
    } else if ((content === null || typeof content === 'undefined') &&
        typeof afio !== 'undefined' && typeof afio.getDefaultDir === 'function') {
        try {
            const dir = await afio.getDefaultDir();
            if (dir && dir.path) {
                resolvedPath = dir.path.replace(/\/$/, '') + '/' + macroName;
            }
        } catch (err) {
            resolvedPath = macroName;
        }
    } else if (typeof macroNode === 'string') {
        resolvedPath = macroNode;
    }

    this.file_id = resolvedPath;
    if (content === null || typeof content === 'undefined') {
        const loadTarget = (macroNode && macroNode.path) ? macroNode
            : (typeof afio !== 'undefined' && typeof afio.openNode === 'function'
                ? afio.openNode(resolvedPath)
                : resolvedPath);
        content = await this.loadMacroFileFromFs(loadTarget);
    }
    // Child macros must not mutate caller loop frames
    this.loopStack = this.deepCopy(this.loopStack);

    this._pushFrame('run');

    const actions = this.parseInlineMacro(content);
    actions.forEach(action => this.action_stack.push(action));
};

// Default inline EVAL executor; overridden by tests when needed
MacroPlayer.prototype.do_eval = function (s, eval_id) {
    return eval(s);
};

if (typeof window !== 'undefined') {
    window.MacroPlayer = MacroPlayer;
} else if (typeof global !== 'undefined') {
    global.MacroPlayer = MacroPlayer;
}

