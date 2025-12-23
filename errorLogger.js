/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

/**
 * Comprehensive Error Logging System for iMacros Chrome Extension
 *
 * This module provides centralized error handling and logging capabilities:
 * - Captures all JavaScript errors with file name, line number, and stack trace
 * - Records errors to localStorage for persistence across sessions
 * - Provides error retrieval and analysis functions
 * - Supports different error severity levels (ERROR, WARNING, INFO)
 * - Includes automatic error reporting to console with detailed context
 */

(function (window) {
    "use strict";

    // Error severity levels
    const ErrorLevel = {
        ERROR: "ERROR",
        WARNING: "WARNING",
        INFO: "INFO",
        CRITICAL: "CRITICAL"
    };

    // Maximum number of errors to store
    const MAX_ERROR_LOG_SIZE = 1000;

    // Storage key for error logs
    const ERROR_LOG_KEY = "imacros_error_log";
    const ERROR_STATS_KEY = "imacros_error_stats";

    // Error codes (documented in ERROR_LOGGING_AND_TROUBLESHOOTING.md)
    const ErrorCodes = {
        UNKNOWN: "IMX-0000",
        UNCAUGHT: "IMX-1001",
        UNHANDLED_PROMISE: "IMX-1002",
        CONSOLE_ERROR: "IMX-1003",
        CHROME_API: "IMX-2001",
        STORAGE_FAILURE: "IMX-3001",
        MANUAL: "IMX-9000"
    };

    class ErrorLogger {
        constructor() {
            this.errors = [];
            this.stats = {
                totalErrors: 0,
                totalWarnings: 0,
                totalInfo: 0,
                totalCritical: 0,
                sessionStart: new Date().toISOString()
            };

            // In MV3 service worker, localStorage polyfill initializes asynchronously
            // Wait for initialization if the promise is available, otherwise load immediately
            if (typeof globalThis !== 'undefined' && globalThis.localStorageInitPromise) {
                // Defer loading from storage until initialization completes
                globalThis.localStorageInitPromise.then(() => {
                    this.loadFromStorage();
                }).catch(err => {
                    console.warn('[iMacros] Failed to wait for localStorage init, loading anyway:', err);
                    this.loadFromStorage();
                });
            } else {
                // Standard context (content script, popup, etc.) - load immediately
                this.loadFromStorage();
            }

            this.setupGlobalHandlers();
        }

	        /**
	         * Setup global error handlers to catch all uncaught errors
	         */
	        setupGlobalHandlers() {
	            // MV3 service worker/content scripts may end up evaluating this file more than once.
	            // Ensure global handlers (and console wrapping) are installed only once per realm.
	            if (this.__imacrosGlobalHandlersInstalled) {
	                return;
	            }
	            this.__imacrosGlobalHandlersInstalled = true;
	
	            if (window && window.__imacros_errorLogger_globalHandlersInstalled) {
	                // Handlers already installed by a previous evaluation.
	                // Preserve access to the original console.error if it was wrapped.
	                try {
	                    const existingConsoleError = console.error;
	                    if (existingConsoleError && existingConsoleError.__imacros_originalConsoleError) {
	                        this.originalConsoleError = existingConsoleError.__imacros_originalConsoleError;
	                    }
	                } catch (e) {
	                    // Ignore console access errors in restricted contexts.
	                }
	                return;
	            }
	            if (window) {
	                window.__imacros_errorLogger_globalHandlersInstalled = true;
	            }

	            // Catch uncaught errors in the main thread, including resource load failures
	            window.addEventListener('error', (event) => {
                // Ignore benign ResizeObserver errors commonly seen in modern web apps
                if (event.message && (
                    event.message.includes('ResizeObserver loop completed with undelivered notifications') ||
                    event.message.includes('ResizeObserver loop limit exceeded')
                )) {
                    return false;
                }

                // Handle resource loading errors where event.error is not populated
                if (event.target && event.target !== window && !event.error) {
                    const target = event.target;
                    const url = target.src || target.href || target.currentSrc || "unknown";
                    const tag = target.tagName || "unknown";

                    // Ignore benign resource load failures for specific tags
                    if (tag === 'INCLUDE-FRAGMENT') {
                        return false;
                    }

                    const filename = this.extractResourceFilename(url);

                    this.logError({
                        level: ErrorLevel.ERROR,
                        message: `Resource load failure (${tag}) ${url}`,
                        code: ErrorCodes.UNCAUGHT,
                        filename: filename || "unknown",
                        lineno: 0,
                        colno: 0,
                        stack: "Resource failed to load",
                        timestamp: new Date().toISOString(),
                        type: "ResourceError",
                        context: { tag, url }
                    });
                    return false;
                }

                this.logError({
                    level: ErrorLevel.ERROR,
                    message: event.message || "Unknown error",
                    code: ErrorCodes.UNCAUGHT,
                    filename: event.filename || "unknown",
                    lineno: event.lineno || 0,
                    colno: event.colno || 0,
                    stack: event.error ? event.error.stack : "No stack trace available",
                    timestamp: new Date().toISOString(),
                    type: "UncaughtError"
                });
                return false; // Allow default error handling
            }, true);

            // Catch unhandled promise rejections
            window.addEventListener('unhandledrejection', (event) => {
                const reason = event.reason;
                const stack = reason && reason.stack ? reason.stack : "No stack trace available";
                const caller = this.extractCallerFromStack(stack, 0);

                // Safely convert reason to string, avoiding JSON.stringify errors
                let message;
                if (reason && reason.message) {
                    message = reason.message;
                } else if (typeof reason === 'string') {
                    message = reason;
                } else {
                    try {
                        message = JSON.stringify(reason);
                    } catch (e) {
                        // Fallback for circular references or non-serializable objects
                        message = String(reason);
                    }
                }

                this.logError({
                    level: ErrorLevel.ERROR,
                    message: "Unhandled Promise Rejection: " + message,
                    code: ErrorCodes.UNHANDLED_PROMISE,
                    filename: caller.filename,
                    lineno: caller.lineno,
                    colno: 0,
                    stack: stack,
                    timestamp: new Date().toISOString(),
                    type: "UnhandledPromiseRejection"
                });
            });

	            // Monitor console.error calls
	            const originalConsoleError = console.error;
	            const self = this;
	            if (originalConsoleError && originalConsoleError.__imacros_errorLoggerWrapped) {
	                // Already wrapped by a previous evaluation; keep the existing wrapper.
	                this.originalConsoleError = originalConsoleError.__imacros_originalConsoleError || originalConsoleError;
	                return;
	            }
	
	            const wrappedConsoleError = (...args) => {
	                // Don't re-log if this is already an ErrorLogger formatted message
	                if (typeof args[0] === 'string' && args[0].indexOf('[iMacros ') === 0) {
	                    return originalConsoleError.apply(console, args);
	                }

                const message = args.map(arg => {
                    if (typeof arg === 'object') {
                        try {
                            return JSON.stringify(arg);
                        } catch (e) {
                            return String(arg);
                        }
                    }
                    return String(arg);
                }).join(' ');

                const stack = new Error().stack;
                const caller = self.extractCallerFromStack(stack, 1);

                self.logError({
                    level: ErrorLevel.WARNING,
                    message: "Console Error: " + message,
                    code: ErrorCodes.CONSOLE_ERROR,
                    filename: caller.filename,
                    lineno: caller.lineno,
                    colno: 0,
                    stack: stack,
                    timestamp: new Date().toISOString(),
                    type: "ConsoleError"
                });

	                // Call original console.error
	                originalConsoleError.apply(console, args);
	            };
	
	            try {
	                wrappedConsoleError.__imacros_errorLoggerWrapped = true;
	                wrappedConsoleError.__imacros_originalConsoleError = originalConsoleError;
	            } catch (e) {
	                // Ignore failures to annotate functions (should be rare).
	            }
	            console.error = wrappedConsoleError;

	            // Store reference for use in outputToConsole
	            this.originalConsoleError = originalConsoleError;
	        }

        /**
         * Extract filename from stack trace
         * Handles multiple browser formats:
         * - Chrome: "at functionName (http://url/file.js:10:5)"
         * - Firefox: "functionName@http://url/file.js:10:5"
         * - Edge: Similar to Chrome
         */
        extractFilenameFromStack(stack) {
            if (!stack) return "unknown";

            // Try Chrome/Edge format first: at ... (url:line:col) or at url:line:col
            let matches = stack.match(/(?:at\s+)?(?:.*?\s+)?\(?(.+?):(\d+):(\d+)\)?/);

            // Try Firefox format: func@url:line:col
            if (!matches) {
                matches = stack.match(/(.+?)@(.+?):(\d+):(\d+)/);
                if (matches && matches[2]) {
                    const fullPath = matches[2];
                    return fullPath.split('/').pop().split('\\').pop();
                }
            }

            if (matches && matches[1]) {
                const fullPath = matches[1];
                // Extract just the filename from URL or file path
                return fullPath.split('/').pop().split('\\').pop();
            }

            return "unknown";
        }

        /**
         * Extract line number from stack trace
         * Handles multiple browser formats
         */
        extractLineNumberFromStack(stack) {
            if (!stack) return 0;

            // Try Chrome/Edge format first
            let matches = stack.match(/(?:at\s+)?(?:.*?\s+)?\(?(.+?):(\d+):(\d+)\)?/);

            // Try Firefox format: func@url:line:col
            if (!matches) {
                matches = stack.match(/(.+?)@(.+?):(\d+):(\d+)/);
                if (matches && matches[3]) {
                    return parseInt(matches[3], 10);
                }
            }

            if (matches && matches[2]) {
                return parseInt(matches[2], 10);
            }

            return 0;
        }

        /**
         * Extract caller information from stack trace
         * Skips the first frame (which is the current function) and returns the caller
         * @param {number} skipFrames - Number of frames to skip (default: 1)
         */
        extractCallerFromStack(stack, skipFrames = 1) {
            if (!stack) return { filename: "unknown", lineno: 0 };

            const lines = stack.split('\n');
            // Skip the Error line and the requested number of frames
            const targetLine = lines[skipFrames + 1];

            if (!targetLine) {
                return { filename: "unknown", lineno: 0 };
            }

            // Try Chrome/Edge format
            let matches = targetLine.match(/(?:at\s+)?(?:.*?\s+)?\(?(.+?):(\d+):(\d+)\)?/);

            // Try Firefox format
            if (!matches) {
                matches = targetLine.match(/(.+?)@(.+?):(\d+):(\d+)/);
                if (matches && matches[2] && matches[3]) {
                    const fullPath = matches[2];
                    const filename = fullPath.split('/').pop().split('\\').pop();
                    return { filename: filename, lineno: parseInt(matches[3], 10) };
                }
            }

            if (matches && matches[1] && matches[2]) {
                const fullPath = matches[1];
                const filename = fullPath.split('/').pop().split('\\').pop();
                return { filename: filename, lineno: parseInt(matches[2], 10) };
            }

            return { filename: "unknown", lineno: 0 };
        }

        /**
         * Log an error with full context
         * @param {Object} errorInfo - Error information object
         */
        logError(errorInfo) {
            const enrichedError = {
                id: Date.now() + "_" + Math.random().toString(36).substr(2, 9),
                level: errorInfo.level || ErrorLevel.ERROR,
                message: errorInfo.message,
                code: errorInfo.code || ErrorCodes.UNKNOWN,
                filename: errorInfo.filename || "unknown",
                lineno: errorInfo.lineno || 0,
                colno: errorInfo.colno || 0,
                stack: errorInfo.stack || this.captureStackTrace(),
                timestamp: errorInfo.timestamp || new Date().toISOString(),
                type: errorInfo.type || "ManualLog",
                context: errorInfo.context || {},
                userAgent: navigator.userAgent,
                url: window.location ? window.location.href : "unknown"
            };

            // Add to in-memory log
            this.errors.push(enrichedError);

            // Update statistics
            this.updateStats(enrichedError.level);

            // Trim log if too large
            if (this.errors.length > MAX_ERROR_LOG_SIZE) {
                this.errors = this.errors.slice(-MAX_ERROR_LOG_SIZE);
            }

            // Save to localStorage
            this.saveToStorage();

            // Output to console with formatting
            this.outputToConsole(enrichedError);

            return enrichedError;
        }

        /**
         * Capture current stack trace
         */
        captureStackTrace() {
            try {
                throw new Error();
            } catch (e) {
                return e.stack || "No stack trace available";
            }
        }

        /**
         * Update error statistics
         */
        updateStats(level) {
            switch (level) {
                case ErrorLevel.ERROR:
                    this.stats.totalErrors++;
                    break;
                case ErrorLevel.WARNING:
                    this.stats.totalWarnings++;
                    break;
                case ErrorLevel.INFO:
                    this.stats.totalInfo++;
                    break;
                case ErrorLevel.CRITICAL:
                    this.stats.totalCritical++;
                    break;
            }
        }

        /**
         * Output error to console with formatting
         * Uses original console methods to avoid recursive logging
         */
        outputToConsole(errorInfo) {
            const prefix = `[iMacros ${errorInfo.level}]`;
            const codeLabel = errorInfo.code ? ` ${errorInfo.code}` : "";
            const location = `${errorInfo.filename}:${errorInfo.lineno}:${errorInfo.colno}`;
            const fullMessage = `${prefix}${codeLabel} ${errorInfo.message}\n   at ${location}\n   ${errorInfo.timestamp}`;

            // Use original console methods to avoid triggering the wrapped console.error
            // which would cause recursive logging
            switch (errorInfo.level) {
                case ErrorLevel.CRITICAL:
                case ErrorLevel.ERROR:
                    this.originalConsoleError.call(console, fullMessage);
                    if (errorInfo.stack) {
                        this.originalConsoleError.call(console, "Stack trace:", errorInfo.stack);
                    }
                    break;
                case ErrorLevel.WARNING:
                    console.warn(fullMessage);
                    break;
                case ErrorLevel.INFO:
                    console.info(fullMessage);
                    break;
            }

            if (errorInfo.context && Object.keys(errorInfo.context).length > 0) {
                console.log("Context:", errorInfo.context);
            }
        }

        /**
         * Wrap a function with error handling
         * @param {Function} fn - Function to wrap
         * @param {String} fnName - Function name for logging
         * @param {String} filename - Source filename
         * @returns {Function} - Wrapped function
         */
        wrapFunction(fn, fnName, filename) {
            const self = this;
            return function (...args) {
                try {
                    return fn.apply(this, args);
                } catch (error) {
                    self.logError({
                        level: ErrorLevel.ERROR,
                        message: `Error in ${fnName}: ${error.message}`,
                        filename: filename || "unknown",
                        lineno: 0,
                        colno: 0,
                        stack: error.stack,
                        type: "CaughtError",
                        context: {
                            functionName: fnName,
                            arguments: args
                        }
                    });
                    throw error; // Re-throw to maintain original behavior
                }
            };
        }

        /**
         * Wrap an async function with error handling
         * @param {Function} fn - Async function to wrap
         * @param {String} fnName - Function name for logging
         * @param {String} filename - Source filename
         * @returns {Function} - Wrapped async function
         */
        wrapAsyncFunction(fn, fnName, filename) {
            const self = this;
            return async function (...args) {
                try {
                    return await fn.apply(this, args);
                } catch (error) {
                    self.logError({
                        level: ErrorLevel.ERROR,
                        message: `Error in async ${fnName}: ${error.message}`,
                        filename: filename || "unknown",
                        lineno: 0,
                        colno: 0,
                        stack: error.stack,
                        type: "AsyncCaughtError",
                        context: {
                            functionName: fnName,
                            arguments: args
                        }
                    });
                    throw error; // Re-throw to maintain original behavior
                }
            };
        }

        /**
         * Save error log to localStorage
         */
        saveToStorage() {
            try {
                // Check if localStorage is accessible
                // In Service Worker, window/localStorage might not be available
                if (typeof window === 'undefined' || !window.localStorage) {
                    return;
                }

                // Store only the most recent errors
                const recentErrors = this.errors.slice(-MAX_ERROR_LOG_SIZE);
                window.localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(recentErrors));
                window.localStorage.setItem(ERROR_STATS_KEY, JSON.stringify(this.stats));
            } catch (e) {
                // If localStorage is full or unavailable, emit an explicit warning with a code
                const errorDetails = e.name ? `${e.name}: ${e.message}` : String(e);
                console.warn(`[iMacros WARNING] ${ErrorCodes.STORAGE_FAILURE} Failed to save error log to localStorage: ${errorDetails}`);
            }
        }

        /**
         * Extract a concise filename/identifier from a resource URL.
         * - Strips query/hash for network URLs
         * - Handles data: URIs by returning the mime type or "data"
         * - Safely returns "unknown" for unparsable values
         */
        extractResourceFilename(url) {
            if (!url || url === "unknown") return "unknown";

            // Handle data URIs separately to avoid logging long payloads
            if (url.startsWith("data:")) {
                const meta = url.slice(5, url.indexOf(',') === -1 ? undefined : url.indexOf(','));
                const mime = meta.split(';')[0];
                return mime || "data";
            }

            try {
                const parsed = new URL(url, window.location && window.location.href ? window.location.href : undefined);
                const pathname = parsed.pathname || "";
                const cleanPath = pathname.split('?')[0].split('#')[0];
                const filename = cleanPath.split('/').pop().split('\\').pop();
                if (filename) {
                    return filename;
                }
            } catch (e) {
                // fall through to manual parsing
            }

            // Fallback: manually strip query/hash and extract last segment
            const withoutFragments = url.split('#')[0].split('?')[0];
            const filename = withoutFragments.split('/').pop().split('\\').pop();
            return filename || "unknown";
        }

        /**
         * Load error log from localStorage
         * Merges stored errors with any errors captured before initialization
         */
        loadFromStorage() {
            try {
                // Check if localStorage is accessible
                // In Service Worker or restricted contexts, window/localStorage might not be available
                if (typeof window === 'undefined') {
                    return;
                }

                try {
                    if (!window.localStorage) {
                        return;
                    }
                    // Try a read operation to verify access permissions
                    const test = window.localStorage.getItem(ERROR_LOG_KEY);
                } catch (e) {
                    // Expected in sandboxed environments or when window is defined but localStorage throws
                    return;
                }

                const storedErrors = window.localStorage.getItem(ERROR_LOG_KEY);
                const storedStats = window.localStorage.getItem(ERROR_STATS_KEY);

                // Preserve errors that were logged before storage initialization completed
                // This is critical in MV3 service workers where startup errors may be captured
                // before the localStorage polyfill cache is populated from chrome.storage.local
                const existingErrors = [...this.errors];

                if (storedErrors) {
                    const loadedErrors = JSON.parse(storedErrors);
                    // Merge: stored errors first, then any new errors captured during initialization
                    this.errors = [...loadedErrors, ...existingErrors];

                    // Trim if the combined log exceeds size limit
                    if (this.errors.length > MAX_ERROR_LOG_SIZE) {
                        this.errors = this.errors.slice(-MAX_ERROR_LOG_SIZE);
                    }
                } else if (existingErrors.length > 0) {
                    // No stored errors, but we have startup errors - keep them
                    this.errors = existingErrors;
                }

                if (storedStats) {
                    const loadedStats = JSON.parse(storedStats);
                    // Merge stats: add counts from errors captured during initialization
                    this.stats = {
                        totalErrors: loadedStats.totalErrors + (this.stats.totalErrors || 0),
                        totalWarnings: loadedStats.totalWarnings + (this.stats.totalWarnings || 0),
                        totalInfo: loadedStats.totalInfo + (this.stats.totalInfo || 0),
                        totalCritical: loadedStats.totalCritical + (this.stats.totalCritical || 0),
                        sessionStart: loadedStats.sessionStart || new Date().toISOString()
                    };
                } else {
                    // Initialize stats if not found (keep any counts from startup errors)
                    this.stats.sessionStart = this.stats.sessionStart || new Date().toISOString();
                }

                if (existingErrors.length > 0) {
                    console.log(`[iMacros] Preserved ${existingErrors.length} startup error(s) during storage load`);
                }
            } catch (e) {
                const errorDetails = e.name ? `${e.name}: ${e.message}` : String(e);
                console.warn(`[iMacros WARNING] ${ErrorCodes.STORAGE_FAILURE} Failed to load error log from localStorage: ${errorDetails}`);
                // On parse failure, keep any existing errors rather than resetting
                // Only reset stats if we can't parse them
                if (!this.stats.sessionStart) {
                    this.stats = {
                        totalErrors: this.stats.totalErrors || 0,
                        totalWarnings: this.stats.totalWarnings || 0,
                        totalInfo: this.stats.totalInfo || 0,
                        totalCritical: this.stats.totalCritical || 0,
                        sessionStart: new Date().toISOString()
                    };
                }
            }
        }

        /**
         * Get all errors
         * @returns {Array} Array of error objects
         */
        getAllErrors() {
            return [...this.errors];
        }

        /**
         * Get errors by level
         * @param {String} level - Error level to filter by
         * @returns {Array} Filtered array of error objects
         */
        getErrorsByLevel(level) {
            return this.errors.filter(e => e.level === level);
        }

        /**
         * Get errors by filename
         * @param {String} filename - Filename to filter by
         * @returns {Array} Filtered array of error objects
         */
        getErrorsByFilename(filename) {
            return this.errors.filter(e => e.filename.includes(filename));
        }

        /**
         * Get errors within a time range
         * @param {Date} startTime - Start time
         * @param {Date} endTime - End time
         * @returns {Array} Filtered array of error objects
         */
        getErrorsByTimeRange(startTime, endTime) {
            return this.errors.filter(e => {
                const errorTime = new Date(e.timestamp);
                return errorTime >= startTime && errorTime <= endTime;
            });
        }

        /**
         * Get error statistics
         * @returns {Object} Error statistics
         */
        getStats() {
            return {
                ...this.stats,
                currentErrorCount: this.errors.length
            };
        }

        /**
         * Clear all error logs
         */
        clearLogs() {
            this.errors = [];
            this.stats = {
                totalErrors: 0,
                totalWarnings: 0,
                totalInfo: 0,
                totalCritical: 0,
                sessionStart: new Date().toISOString()
            };
            this.saveToStorage();
        }

        /**
         * Export error log as JSON with full data
         * @private
         * @returns {String} JSON string of complete error log
         */
        _fullExport() {
            return JSON.stringify({
                errors: this.errors,
                stats: this.stats,
                exportDate: new Date().toISOString()
            }, null, 2);
        }

        /**
         * Export minimal error log when full export fails
         * @private
         * @param {Error} error - The serialization error that occurred
         * @returns {String} JSON string of minimal error log
         */
        _minimalExport(error) {
            try {
                return JSON.stringify({
                    errors: [],
                    stats: this.stats,
                    exportDate: new Date().toISOString(),
                    serializationError: true,
                    errorMessage: error.message,
                    totalErrorCount: this.errors.length
                }, null, 2);
            } catch (fallbackError) {
                // Ultimate fallback with safe stats extraction
                return JSON.stringify({
                    errors: [],
                    stats: {
                        totalErrors: this.stats.totalErrors || 0,
                        totalWarnings: this.stats.totalWarnings || 0,
                        totalInfo: this.stats.totalInfo || 0,
                        totalCritical: this.stats.totalCritical || 0
                    },
                    exportDate: new Date().toISOString(),
                    serializationError: true,
                    errorMessage: "Complete serialization failure"
                }, null, 2);
            }
        }

        /**
         * Export error log as JSON
         * Uses 3-level fallback: full export -> minimal export -> ultimate fallback
         * @returns {String} JSON string of error log
         */
        exportAsJSON() {
            try {
                return this._fullExport();
            } catch (e) {
                console.warn("Failed to serialize full error log for export:", e);
                return this._minimalExport(e);
            }
        }

        /**
         * Backwards-compatible alias for exporting logs
         * @returns {String}
         */
        exportLog() {
            return this.exportAsJSON();
        }

        /**
         * Generate error report
         * @returns {String} Formatted error report
         */
        generateReport() {
            const lines = [];
            lines.push("=== iMacros Error Report ===");
            lines.push(`Generated: ${new Date().toISOString()}`);
            lines.push(`Session Started: ${this.stats.sessionStart}`);
            lines.push("");
            lines.push("=== Statistics ===");
            lines.push(`Total Errors: ${this.stats.totalErrors}`);
            lines.push(`Total Warnings: ${this.stats.totalWarnings}`);
            lines.push(`Total Info: ${this.stats.totalInfo}`);
            lines.push(`Total Critical: ${this.stats.totalCritical}`);
            lines.push(`Current Log Size: ${this.errors.length}`);
            lines.push("");

            // Group errors by filename
            const errorsByFile = {};
            this.errors.forEach(error => {
                if (!errorsByFile[error.filename]) {
                    errorsByFile[error.filename] = [];
                }
                errorsByFile[error.filename].push(error);
            });

            lines.push("=== Errors by File ===");
            Object.keys(errorsByFile).sort().forEach(filename => {
                const fileErrors = errorsByFile[filename];
                lines.push(`\n${filename}: ${fileErrors.length} error(s)`);

                // Show up to 5 most recent errors for this file
                const recentErrors = fileErrors.slice(-5);
                recentErrors.forEach(error => {
                    const codeFragment = error.code ? ` (${error.code})` : "";
                    lines.push(`  [${error.level}] Line ${error.lineno}: ${error.message}${codeFragment}`);
                    lines.push(`    at ${error.timestamp}`);
                });
            });

            return lines.join('\n');
        }
	    }

	    // Create/reuse singleton instance (idempotent across MV3 re-injection).
	    const existingLogger = window && window.ErrorLogger;
	    const isNewInstance = !(existingLogger && typeof existingLogger.logError === 'function');
	    const errorLogger = isNewInstance
	        ? new ErrorLogger()
	        : existingLogger;
	    try {
	        errorLogger.__imacrosErrorLoggerSingleton = true;
	    } catch (e) {
	        // ignore
	    }

	    // Export to window for global access
	    window.ErrorLogger = errorLogger;
    window.ErrorLevel = ErrorLevel;
    window.ErrorCodes = ErrorCodes;

    const createCallerContext = () => {
        const stack = new Error().stack;
        const caller = errorLogger.extractCallerFromStack(stack, 1);
        return { stack, caller };
    };

    const createLegacyLogger = (level) => {
        return function (message, context, code, providedStack, providedCaller) {
            const stack = providedStack || new Error().stack;
            const caller = providedCaller || errorLogger.extractCallerFromStack(stack, 1);
            return errorLogger.logError({
                level: level,
                message: message,
                code: code || ErrorCodes.UNKNOWN,
                filename: caller.filename,
                lineno: caller.lineno,
                context: context,
                stack: stack
            });
        };
    };

    const legacyLoggers = {
        error: createLegacyLogger(ErrorLevel.ERROR),
        warning: createLegacyLogger(ErrorLevel.WARNING),
        info: createLegacyLogger(ErrorLevel.INFO),
        critical: createLegacyLogger(ErrorLevel.CRITICAL)
    };

    /**
     * Global helper functions for convenient logging
     *
     * These functions use extractCallerFromStack(stack, 1) to correctly identify
     * the actual caller's location instead of the helper function's own location.
     *
     * Note: These may be overridden below if GlobalErrorLogger is available.
     */
    window.logError = legacyLoggers.error;
    window.logWarning = legacyLoggers.warning;
    window.logInfo = legacyLoggers.info;
    window.logCritical = legacyLoggers.critical;

    /**
     * Check and log chrome.runtime.lastError
     * @param {String} operationName - Name of the operation being performed
     * @param {Object} additionalContext - Additional context to log
     * @returns {Boolean} - True if there was an error, false otherwise
     */
    function checkChromeError(operationName, additionalContext) {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
            const stack = new Error().stack;
            const caller = errorLogger.extractCallerFromStack(stack, 1);
            const baseContext = {
                operation: operationName,
                chromeError: chrome.runtime.lastError.message
            };

            errorLogger.logError({
                level: ErrorLevel.ERROR,
                message: `Chrome API Error in ${operationName}: ${chrome.runtime.lastError.message}`,
                code: ErrorCodes.CHROME_API,
                filename: caller.filename,
                lineno: caller.lineno,
                context: Object.assign(baseContext, additionalContext || {}),
                stack: stack,
                type: "ChromeAPIError"
            });
            return true;
        }
        return false;
    }

    window.checkChromeError = checkChromeError;

    /**
     * Wrap a Chrome API callback to automatically check for lastError
     * @param {Function} callback - Original callback function
     * @param {String} operationName - Name of the operation for error logging
     * @returns {Function} - Wrapped callback
     *
     * Note: This wrapper logs errors but maintains the original Chrome API callback signature.
     * The callback is still invoked with the original arguments even if an error occurred.
     */
    window.wrapChromeCallback = function (callback, operationName) {
        return function (...args) {
            // Log error if present, but don't change the callback signature
            checkChromeError(operationName);

            // Always call the original callback with original arguments
            if (callback) {
                return callback(...args);
            }
        };
    };

    /**
     * Wrap a Promise-returning function with error logging
     * @param {Function} fn - Function that returns a Promise
     * @param {String} operationName - Name of the operation for error logging
     * @returns {Function} - Wrapped function
     */
    window.wrapPromise = function (fn, operationName) {
        return function (...args) {
            return fn.apply(this, args)
                .catch(error => {
                    const stack = (error && error.stack) ? error.stack : new Error().stack;
                    const caller = errorLogger.extractCallerFromStack(stack, 1);
                    const message = (error && error.message) ? error.message : String(error);
                    const errorType = (error && error.constructor && error.constructor.name) || typeof error;
                    errorLogger.logError({
                        level: ErrorLevel.ERROR,
                        message: `Promise rejection in ${operationName}: ${message}`,
                        code: ErrorCodes.UNHANDLED_PROMISE,
                        filename: caller.filename,
                        lineno: caller.lineno,
                        context: {
                            operation: operationName,
                            errorType: errorType
                        },
                        stack: stack,
                        type: "PromiseRejection"
                    });
                    throw error; // Re-throw to maintain Promise chain
                });
        };
    };

    /**
     * Create a safe version of chrome.storage API with automatic error logging
     */
    if (typeof chrome !== 'undefined' && chrome.storage) {
        window.safeStorage = {
            local: {
                get: function (keys) {
                    return new Promise((resolve, reject) => {
                        chrome.storage.local.get(keys, (result) => {
                            if (checkChromeError('chrome.storage.local.get', { keys })) {
                                reject(chrome.runtime.lastError);
                            } else {
                                resolve(result);
                            }
                        });
                    });
                },
                set: function (items) {
                    return new Promise((resolve, reject) => {
                        chrome.storage.local.set(items, () => {
                            if (checkChromeError('chrome.storage.local.set', { keys: Object.keys(items) })) {
                                reject(chrome.runtime.lastError);
                            } else {
                                resolve();
                            }
                        });
                    });
                },
                remove: function (keys) {
                    return new Promise((resolve, reject) => {
                        chrome.storage.local.remove(keys, () => {
                            if (checkChromeError('chrome.storage.local.remove', { keys })) {
                                reject(chrome.runtime.lastError);
                            } else {
                                resolve();
                            }
                        });
                    });
                }
            },
            sync: {
                get: function (keys) {
                    return new Promise((resolve, reject) => {
                        chrome.storage.sync.get(keys, (result) => {
                            if (checkChromeError('chrome.storage.sync.get', { keys })) {
                                reject(chrome.runtime.lastError);
                            } else {
                                resolve(result);
                            }
                        });
                    });
                },
                set: function (items) {
                    return new Promise((resolve, reject) => {
                        chrome.storage.sync.set(items, () => {
                            if (checkChromeError('chrome.storage.sync.set', { keys: Object.keys(items) })) {
                                reject(chrome.runtime.lastError);
                            } else {
                                resolve();
                            }
                        });
                    });
                },
                remove: function (keys) {
                    return new Promise((resolve, reject) => {
                        chrome.storage.sync.remove(keys, () => {
                            if (checkChromeError('chrome.storage.sync.remove', { keys })) {
                                reject(chrome.runtime.lastError);
                            } else {
                                resolve();
                            }
                        });
                    });
                }
            }
        };
    }

    // Only log initialization messages when a new instance is actually created
    // This prevents duplicate messages across MV3 contexts (service worker, panel, content scripts, etc.)
    if (isNewInstance) {
        console.info("[iMacros] Error Logger initialized successfully");
        console.info("[iMacros] Use ErrorLogger to access error logs");
        console.info("[iMacros] Use logError(), logWarning(), logInfo(), logCritical() for logging");
        console.info("[iMacros] Use checkChromeError(), wrapChromeCallback(), wrapPromise() for Chrome API error handling");
    }

    // ========================================================================
    // Legacy Compatibility Layer - Delegates to GlobalErrorLogger
    // ========================================================================
    // If GlobalErrorLogger is available (loaded before this file), override the legacy
    // functions to use it as the backend for better stack trace parsing
    // Track whether legacy compatibility has been set up to avoid duplicate messages
    const legacyCompatKey = '__imacros_legacy_compat_logged';
    if (typeof GlobalErrorLogger !== 'undefined' && !window[legacyCompatKey]) {
        window[legacyCompatKey] = true;
        console.info("[iMacros] GlobalErrorLogger detected - delegating legacy functions to it");

        // Override the legacy functions that were just defined above
        // These will now use GlobalErrorLogger instead of ErrorLogger
        window.logError = function (message, context, code) {
            try {
                // Convert legacy signature (message, context, code) to new (context, error, details)
                return GlobalErrorLogger.logError(
                    context || 'Legacy',
                    message,
                    { code: code, legacyCall: true }
                );
            } catch (err) {
                // Fallback to console if GlobalErrorLogger fails
                console.error('[errorLogger] GlobalErrorLogger.logError failed:', err);
                console.error('[Legacy logError]', message, context, code);
            }
        };

        window.logWarning = function (message, context, code) {
            try {
                return GlobalErrorLogger.logWarning(
                    context || 'Legacy',
                    message,
                    { code: code, legacyCall: true }
                );
            } catch (err) {
                console.warn('[errorLogger] GlobalErrorLogger.logWarning failed:', err);
                console.warn('[Legacy logWarning]', message, context, code);
            }
        };

        window.logInfo = function (message, context, code) {
            try {
                return GlobalErrorLogger.logInfo(
                    context || 'Legacy',
                    message,
                    { code: code, legacyCall: true }
                );
            } catch (err) {
                console.info('[errorLogger] GlobalErrorLogger.logInfo failed:', err);
                console.info('[Legacy logInfo]', message, context, code);
            }
        };

        window.logCritical = function (message, context, code) {
            try {
                return GlobalErrorLogger.logError(
                    context || 'Legacy',
                    message,
                    { code: code, severity: 'CRITICAL', legacyCall: true }
                );
            } catch (err) {
                console.error('[errorLogger] GlobalErrorLogger.logError (critical) failed:', err);
                console.error('[Legacy logCritical]', message, context, code);
            }
        };

        console.info("[iMacros] Legacy compatibility layer active - all log functions now use GlobalErrorLogger");
    }

})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : this);
