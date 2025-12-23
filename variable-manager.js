/*
 * VariableManager - Manages global and local variables for macro execution
 * 
 * This class separates global variables (shared across macros) from local variables
 * (specific to each macro execution context).
 */

function VariableManager() {
    // Global variables (shared across all macros)
    this.globalVars = new Map();

    // Local variables (specific to each macro execution)
    this.localContext = {};

    // List of local variable names
    this.LOCAL_VARS = [
        'LINE', 'LOOP', 'LOOP1', 'LOOP2', 'LOOP3',
        'LOOP4', 'LOOP5', 'LOOP6', 'LOOP7', 'LOOP8',
        'LOOP9', 'LOOP10', 'ERRORIGNORE', 'REPLAYSPEED',
        'TABNUMBER'
    ];

    // Initialize standard variables
    this.initializeStandardVars();
}

/**
 * Initialize standard global and local variables
 */
VariableManager.prototype.initializeStandardVars = function () {
    // Initialize standard global variables (VAR0-VAR9)
    for (let i = 0; i <= 9; i++) {
        this.globalVars.set('VAR' + i, '');
    }

    // Initialize other standard global variables
    this.globalVars.set('EXTRACT', '');
    this.globalVars.set('CLIPBOARD', '');
    this.globalVars.set('TIMEOUT_PAGE', 60);
    this.globalVars.set('TIMEOUT_STEP', 10);
    this.globalVars.set('DATASOURCE', '');
    this.globalVars.set('DATASOURCE_LINE', 0);
    this.globalVars.set('DATASOURCE_COLUMNS', 0);

    // Initialize local variables
    this.localContext.LINE = 1;
    this.localContext.LOOP = 0;
    for (let i = 1; i <= 10; i++) {
        this.localContext['LOOP' + i] = 0;
    }
    this.localContext.TABNUMBER = 1;
    this.localContext.ERRORIGNORE = false;
    this.localContext.REPLAYSPEED = 'FAST';
};

/**
 * Get a variable value
 * @param {string} name - Variable name (with or without '!' prefix)
 * @returns {*} Variable value or empty string if not found
 */
VariableManager.prototype.getVar = function (name) {
    // Remove '!' prefix if present
    name = name.replace(/^!/, '');

    // Check if it's a local variable
    if (this.LOCAL_VARS.includes(name)) {
        return this.localContext[name] !== undefined ?
            this.localContext[name] : '';
    }

    // Return global variable
    return this.globalVars.has(name) ?
        this.globalVars.get(name) : '';
};

/**
 * Set a variable value
 * @param {string} name - Variable name (with or without '!' prefix)
 * @param {*} value - Variable value
 */
VariableManager.prototype.setVar = function (name, value) {
    // Remove '!' prefix if present
    name = name.replace(/^!/, '');

    // Check if it's a local variable
    if (this.LOCAL_VARS.includes(name)) {
        this.localContext[name] = value;
    } else {
        // Set as global variable
        this.globalVars.set(name, value);
    }
};

/**
 * Create a snapshot of the local context
 * @returns {Object} Deep copy of local context
 */
VariableManager.prototype.snapshotLocalContext = function () {
    return JSON.parse(JSON.stringify(this.localContext));
};

/**
 * Restore local context from a snapshot
 * @param {Object} snapshot - Snapshot to restore
 */
VariableManager.prototype.restoreLocalContext = function (snapshot) {
    this.localContext = JSON.parse(JSON.stringify(snapshot));
};

/**
 * Get all variables (both global and local) as a plain object
 * Used for EVAL command
 * @returns {Object} All variables
 */
VariableManager.prototype.getAllVars = function () {
    const allVars = {};

    // Copy global variables
    for (let [key, value] of this.globalVars) {
        allVars[key] = value;
    }

    // Copy local variables
    for (let key in this.localContext) {
        allVars[key] = this.localContext[key];
    }

    return allVars;
};

/**
 * Reset local context to initial state
 * Used when starting a new macro execution
 */
VariableManager.prototype.resetLocalContext = function () {
    this.localContext = {
        LINE: 1,
        LOOP: 0,
        LOOP1: 0, LOOP2: 0, LOOP3: 0, LOOP4: 0, LOOP5: 0,
        LOOP6: 0, LOOP7: 0, LOOP8: 0, LOOP9: 0, LOOP10: 0,
        TABNUMBER: this.localContext.TABNUMBER || 1,
        ERRORIGNORE: false,
        REPLAYSPEED: this.localContext.REPLAYSPEED || 'FAST'
    };
};

/**
 * Clear all global variables (reset to initial state)
 */
VariableManager.prototype.clearGlobalVars = function () {
    this.globalVars.clear();
    this.initializeStandardVars();
};

/**
 * Check if a variable exists
 * @param {string} name - Variable name
 * @returns {boolean} True if variable exists
 */
VariableManager.prototype.hasVar = function (name) {
    name = name.replace(/^!/, '');
    return this.LOCAL_VARS.includes(name) || this.globalVars.has(name);
};

/**
 * Delete a global variable
 * @param {string} name - Variable name
 */
VariableManager.prototype.deleteVar = function (name) {
    name = name.replace(/^!/, '');
    if (!this.LOCAL_VARS.includes(name)) {
        this.globalVars.delete(name);
    }
};
