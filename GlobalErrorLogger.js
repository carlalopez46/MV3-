/**
 * GlobalErrorLogger.js
 *
 * 全てのJSファイルで使用できる統一されたエラーロギングシステム
 * すべてのエラーを収集し、ファイル、行番号、スタックトレースを記録
 *
 * 使用方法:
 * 1. 各JSファイルの先頭でこのファイルを読み込む
 * 2. try-catchブロックでGlobalErrorLogger.logError()を呼び出す
 * 3. GlobalErrorLogger.getReport()でレポートを取得
 */

(function (global) {
    'use strict';

    // Normalize the global reference for reuse throughout this module
    const globalScope = global;

    // エラーカテゴリ定数
    const ERROR_CATEGORIES = {
        FILE_SYSTEM: 'FILE_SYSTEM',
        PERMISSION: 'PERMISSION',
        INDEXEDDB: 'INDEXEDDB',
        PATH_MAPPING: 'PATH_MAPPING',
        PATH_RESOLUTION: 'PATH_RESOLUTION',
        NATIVE_MESSAGING: 'NATIVE_MESSAGING',
        INITIALIZATION: 'INITIALIZATION',
        NOT_FOUND: 'NOT_FOUND',
        QUOTA: 'QUOTA',
        VALIDATION: 'VALIDATION',
        ASYNC_OPERATION: 'ASYNC_OPERATION',
        NETWORK: 'NETWORK',
        BROWSER_API: 'BROWSER_API',
        UNKNOWN: 'UNKNOWN'
    };

    // エラー重要度レベル
    const SEVERITY_LEVELS = {
        CRITICAL: 'CRITICAL',  // システムが動作しない
        HIGH: 'HIGH',          // 主要機能が動作しない
        MEDIUM: 'MEDIUM',      // 一部機能に影響
        LOW: 'LOW',            // 軽微な問題
        INFO: 'INFO'           // 情報のみ
    };

    // ファイル操作エラーコード
    const FILE_ERROR_CODES = {
        FILE_BACKEND_ERROR: 'FILE_BACKEND_ERROR',
        FILE_TIMEOUT_ERROR: 'FILE_TIMEOUT_ERROR',
        FILE_PATH_INVALID: 'FILE_PATH_INVALID',
        FILE_READ_ERROR: 'FILE_READ_ERROR',
        FILE_WRITE_ERROR: 'FILE_WRITE_ERROR'
    };

    // ファイル操作エラーのデフォルト重要度
    const FILE_ERROR_SEVERITY = {
        [FILE_ERROR_CODES.FILE_BACKEND_ERROR]: SEVERITY_LEVELS.HIGH,
        [FILE_ERROR_CODES.FILE_TIMEOUT_ERROR]: SEVERITY_LEVELS.MEDIUM,
        [FILE_ERROR_CODES.FILE_PATH_INVALID]: SEVERITY_LEVELS.MEDIUM,
        [FILE_ERROR_CODES.FILE_READ_ERROR]: SEVERITY_LEVELS.HIGH,
        [FILE_ERROR_CODES.FILE_WRITE_ERROR]: SEVERITY_LEVELS.HIGH
    };

    // ループ処理エラーコード（後方互換のために保持）
    const LOOP_ERROR_CODES = {
        LOOP_INFINITE: 'LOOP_INFINITE',
        LOOP_MAX_ITERATIONS: 'LOOP_MAX_ITERATIONS',
        LOOP_BREAK: 'LOOP_BREAK'
    };

    const LOOP_ERROR_SEVERITY = {
        [LOOP_ERROR_CODES.LOOP_INFINITE]: SEVERITY_LEVELS.HIGH,
        [LOOP_ERROR_CODES.LOOP_MAX_ITERATIONS]: SEVERITY_LEVELS.MEDIUM,
        [LOOP_ERROR_CODES.LOOP_BREAK]: SEVERITY_LEVELS.LOW
    };

    // クリップボード操作エラーコード（後方互換のために保持）
    const CLIPBOARD_ERROR_CODES = {
        CLIPBOARD_READ_ERROR: 'CLIPBOARD_READ_ERROR',
        CLIPBOARD_WRITE_ERROR: 'CLIPBOARD_WRITE_ERROR',
        CLIPBOARD_PERMISSION_DENIED: 'CLIPBOARD_PERMISSION_DENIED'
    };

    const CLIPBOARD_ERROR_SEVERITY = {
        [CLIPBOARD_ERROR_CODES.CLIPBOARD_READ_ERROR]: SEVERITY_LEVELS.MEDIUM,
        [CLIPBOARD_ERROR_CODES.CLIPBOARD_WRITE_ERROR]: SEVERITY_LEVELS.MEDIUM,
        [CLIPBOARD_ERROR_CODES.CLIPBOARD_PERMISSION_DENIED]: SEVERITY_LEVELS.HIGH
    };

    class GlobalErrorLogger {
        constructor(options = {}) {
            this.errors = [];
            this.warnings = [];
            this.infos = [];
            this.enabled = true;
            this.maxErrors = 1000; // メモリ管理のため上限を設定
            this.startTime = Date.now();
            this.sessionId = this._generateSessionId();

            // クリティカルエラー保存のためのキュー（競合状態を防ぐ）
            this.criticalErrorQueue = Promise.resolve();

            // グローバルエラーハンドラを設定（オプショナル）
            // errorLogger.js との重複を避けるため、デフォルトは無効
            // テストなどで有効化したい場合は { setupGlobalHandlers: true } を渡す
            this.setupGlobalHandlers = options.setupGlobalHandlers === true;
            if (this.setupGlobalHandlers) {
                this._setupGlobalHandlers();
            }
        }

        /**
         * セッションIDを生成
         */
        _generateSessionId() {
            return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        }

        /**
         * グローバルエラーハンドラを設定
         */
        _setupGlobalHandlers() {
            // 未処理のエラーをキャッチ
            if (typeof window !== 'undefined') {
                window.addEventListener('error', (event) => {
                    this.logError(
                        'UNCAUGHT_ERROR',
                        event.error || new Error(event.message),
                        {
                            filename: event.filename,
                            lineno: event.lineno,
                            colno: event.colno,
                            severity: SEVERITY_LEVELS.HIGH
                        }
                    );
                });

                // 未処理のPromise rejectionsをキャッチ
                window.addEventListener('unhandledrejection', (event) => {
                    this.logError(
                        'UNHANDLED_REJECTION',
                        event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
                        {
                            promise: 'Promise rejection',
                            severity: SEVERITY_LEVELS.HIGH
                        }
                    );
                });
            }
        }

        /**
         * エラーを記録
         *
         * @param {string} context - エラーが発生したコンテキスト（関数名、モジュール名など）
         * @param {Error|string} error - エラーオブジェクトまたはメッセージ
         * @param {Object} details - 追加詳細情報
         */
        logError(context, error, details = {}) {
            if (!this.enabled) return;

            const isError = error instanceof Error;
            const errorObj = isError ? error : new Error(String(error));

            // For Error instances, use skipFrames=1 to get the actual throw site
            // For string messages, use skipFrames=2 to skip both Error() and logError()
            // If called via static wrapper, skip one more frame
            let location;
            const extraSkip = details._skipExtraFrame ? 1 : 0;

            if (isError && errorObj.stack) {
                // If it's an error object, the stack is already fixed at creation time.
                // We don't need to skip wrapper frames.
                location = this._parseStackLocation(errorObj.stack, 1);
            } else {
                const syntheticError = new Error();
                location = this._parseStackLocation(syntheticError.stack, 2 + extraSkip);
            }

            // Clean up internal flag
            if (details._skipExtraFrame) {
                delete details._skipExtraFrame;
            }

            const category = this._categorizeError(errorObj.message, details);
            const severity = details.severity || this._determineSeverity(errorObj.message, details);

            const errorEntry = {
                timestamp: new Date().toISOString(),
                timestampMs: Date.now(),
                sessionId: this.sessionId,
                context: context,
                message: errorObj.message || String(error),
                stack: errorObj.stack || new Error().stack,
                file: location.file,
                line: location.line,
                column: location.column,
                category: category,
                severity: severity,
                details: details,
                type: 'ERROR',
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
                url: typeof window !== 'undefined' ? window.location.href : 'unknown'
            };

            this.errors.push(errorEntry);
            this._maintainErrorLimit();

            // コンソールに出力
            console.error(`[GlobalErrorLogger] ${severity} - ${context}:`, errorObj);
            if (Object.keys(details).length > 0) {
                console.error('Details:', details);
            }
            console.error('Location:', `${location.file}:${location.line}:${location.column}`);

            // クリティカルエラーの場合は特別な処理
            if (severity === SEVERITY_LEVELS.CRITICAL) {
                this._handleCriticalError(errorEntry);
            }

            return errorEntry;
        }

        /**
         * クリティカルエラーを記録
         */
        logCritical(context, error, details = {}) {
            const severity = details.severity || SEVERITY_LEVELS.CRITICAL;
            return this.logError(context, error, { ...details, severity });
        }

        /**
         * 警告を記録
         */
        logWarning(context, message, details = {}) {
            if (!this.enabled) return;

            const stack = new Error().stack;
            const extraSkip = details._skipExtraFrame ? 1 : 0;
            // Skip 2 frames: "Error" line and "at GlobalErrorLogger.logWarning" line
            const location = this._parseStackLocation(stack, 2 + extraSkip);

            // Clean up internal flag
            if (details._skipExtraFrame) {
                delete details._skipExtraFrame;
            }

            const warningEntry = {
                timestamp: new Date().toISOString(),
                timestampMs: Date.now(),
                sessionId: this.sessionId,
                context: context,
                message: message,
                file: location.file,
                line: location.line,
                column: location.column,
                details: details,
                type: 'WARNING'
            };

            this.warnings.push(warningEntry);
            this._maintainWarningLimit();

            console.warn(`[GlobalErrorLogger] WARNING - ${context}:`, message);
            if (Object.keys(details).length > 0) {
                console.warn('Details:', details);
            }

            return warningEntry;
        }

        /**
         * 情報を記録
         */
        logInfo(context, message, details = {}) {
            if (!this.enabled) return;

            const stack = new Error().stack;
            const extraSkip = details._skipExtraFrame ? 1 : 0;
            // Skip 2 frames: "Error" line and "at GlobalErrorLogger.logInfo" line
            const location = this._parseStackLocation(stack, 2 + extraSkip);

            // Clean up internal flag
            if (details._skipExtraFrame) {
                delete details._skipExtraFrame;
            }

            const infoEntry = {
                timestamp: new Date().toISOString(),
                timestampMs: Date.now(),
                sessionId: this.sessionId,
                context: context,
                message: message,
                file: location.file,
                line: location.line,
                column: location.column,
                details: details,
                type: 'INFO'
            };

            this.infos.push(infoEntry);
            this._maintainInfoLimit();

            console.info(`[GlobalErrorLogger] INFO - ${context}:`, message);

            return infoEntry;
        }

        /**
         * ファイル操作のエラーを記録（後方互換ラッパー）
         */
        logFileError(context, error, details = {}) {
            const errorCode = details.errorCode || FILE_ERROR_CODES.FILE_BACKEND_ERROR;
            const severity = details.severity || FILE_ERROR_SEVERITY[errorCode] || SEVERITY_LEVELS.MEDIUM;
            const mergedDetails = {
                ...details,
                errorCode,
                severity,
                category: details.category || ERROR_CATEGORIES.FILE_SYSTEM,
                _skipExtraFrame: details._skipExtraFrame ?? true
            };
            return this.logError(context, error, mergedDetails);
        }

        /**
         * ループ処理のエラーを記録（後方互換ラッパー）
         */
        logLoopError(context, error, details = {}) {
            const errorCode = details.errorCode || LOOP_ERROR_CODES.LOOP_INFINITE;
            const severity = details.severity || LOOP_ERROR_SEVERITY[errorCode] || SEVERITY_LEVELS.MEDIUM;
            const mergedDetails = {
                ...details,
                errorCode,
                severity,
                category: details.category || ERROR_CATEGORIES.ASYNC_OPERATION,
                _skipExtraFrame: details._skipExtraFrame ?? true
            };
            return this.logError(context, error, mergedDetails);
        }

        /**
         * クリップボード操作のエラーを記録（後方互換ラッパー）
         */
        logClipboardError(context, error, details = {}) {
            const errorCode = details.errorCode || CLIPBOARD_ERROR_CODES.CLIPBOARD_READ_ERROR;
            const severity = details.severity || CLIPBOARD_ERROR_SEVERITY[errorCode] || SEVERITY_LEVELS.MEDIUM;
            const mergedDetails = {
                ...details,
                errorCode,
                severity,
                category: details.category || ERROR_CATEGORIES.BROWSER_API,
                _skipExtraFrame: details._skipExtraFrame ?? true
            };
            return this.logError(context, error, mergedDetails);
        }

        /**
         * スタックトレースから位置情報を解析
         * @param {string} stack - スタックトレース文字列
         * @param {number} skipFrames - スキップするフレーム数（デフォルト1）
         */
        _parseStackLocation(stack, skipFrames = 1) {
            const fallback = { file: 'unknown', line: 0, column: 0 };

            if (!stack) return fallback;

            const lines = stack.toString().split(/\r?\n/);

            // 指定されたフレーム数をスキップして実際の呼び出し元を取得
            for (let i = skipFrames; i < lines.length; i++) {
                const line = lines[i];

                // Chrome/Edge形式: "at functionName (file:line:column)" または "at file:line:column"
                // greedy マッチングで `:` を含む URL も正しくパース
                let match = line.match(/at\s+(?:.*?\s+\()?(.+):(\d+):(\d+)/);

                // Firefox形式: "functionName@file:line:column"
                if (!match) {
                    match = line.match(/([^@\s]+)@(.+):(\d+):(\d+)/);
                    if (match) {
                        match = [null, match[2], match[3], match[4]];
                    }
                }

                if (match && match[1]) {
                    // ファイルパスをクリーンアップ
                    let filePath = match[1];

                    // URLからファイル名のみを抽出
                    const fileNameMatch = filePath.match(/([^/\\]+)$/);
                    if (fileNameMatch) {
                        filePath = fileNameMatch[1];
                    }

                    return {
                        file: filePath,
                        line: parseInt(match[2], 10) || 0,
                        column: parseInt(match[3], 10) || 0
                    };
                }
            }

            return fallback;
        }

        /**
         * エラーメッセージからカテゴリを判定
         */
        _categorizeError(message, details = {}) {
            const msgLower = (message || '').toLowerCase();

            if (details.category) return details.category;

            if (msgLower.includes('file system access') || msgLower.includes('filesystem')) {
                return ERROR_CATEGORIES.FILE_SYSTEM;
            }
            if (msgLower.includes('permission') || msgLower.includes('denied')) {
                return ERROR_CATEGORIES.PERMISSION;
            }
            if (msgLower.includes('indexeddb') || msgLower.includes('idb')) {
                return ERROR_CATEGORIES.INDEXEDDB;
            }
            if (msgLower.includes('path mapping') || msgLower.includes('windows path')) {
                return ERROR_CATEGORIES.PATH_MAPPING;
            }
            if (msgLower.includes('resolve') || msgLower.includes('path')) {
                return ERROR_CATEGORIES.PATH_RESOLUTION;
            }
            if (msgLower.includes('native') || msgLower.includes('messaging')) {
                return ERROR_CATEGORIES.NATIVE_MESSAGING;
            }
            if (msgLower.includes('init') || msgLower.includes('initialization')) {
                return ERROR_CATEGORIES.INITIALIZATION;
            }
            if (msgLower.includes('not found') || msgLower.includes('does not exist')) {
                return ERROR_CATEGORIES.NOT_FOUND;
            }
            if (msgLower.includes('quota') || msgLower.includes('storage')) {
                return ERROR_CATEGORIES.QUOTA;
            }
            if (msgLower.includes('invalid') || msgLower.includes('validation')) {
                return ERROR_CATEGORIES.VALIDATION;
            }
            if (msgLower.includes('timeout') || msgLower.includes('async')) {
                return ERROR_CATEGORIES.ASYNC_OPERATION;
            }
            if (msgLower.includes('network') || msgLower.includes('fetch')) {
                return ERROR_CATEGORIES.NETWORK;
            }
            if (msgLower.includes('browser') || msgLower.includes('api')) {
                return ERROR_CATEGORIES.BROWSER_API;
            }

            return ERROR_CATEGORIES.UNKNOWN;
        }

        /**
         * エラーの重要度を判定
         */
        _determineSeverity(message, _details = {}) {
            const msgLower = (message || '').toLowerCase();

            // クリティカル: システムが初期化できない、主要機能が完全に動作しない
            if (msgLower.includes('critical') ||
                msgLower.includes('fatal') ||
                msgLower.includes('cannot initialize') ||
                (msgLower.includes('not supported') && msgLower.includes('browser'))) {
                return SEVERITY_LEVELS.CRITICAL;
            }

            // 高: 主要機能に影響
            if (msgLower.includes('permission denied') ||
                msgLower.includes('access denied') ||
                msgLower.includes('initialization failed') ||
                msgLower.includes('quota exceeded')) {
                return SEVERITY_LEVELS.HIGH;
            }

            // 中: 一部機能に影響
            if (msgLower.includes('not found') ||
                msgLower.includes('timeout') ||
                msgLower.includes('invalid')) {
                return SEVERITY_LEVELS.MEDIUM;
            }

            // 低: 軽微な問題
            if (msgLower.includes('warning') ||
                msgLower.includes('deprecated')) {
                return SEVERITY_LEVELS.LOW;
            }

            return SEVERITY_LEVELS.MEDIUM; // デフォルト
        }

        /**
         * クリティカルエラーの特別処理
         */
        async _handleCriticalError(errorEntry) {
            // クリティカルエラーの保存をキューに追加（競合状態を防ぐ）
            // 以前の保存が失敗しても次の保存を継続する
            this.criticalErrorQueue = this.criticalErrorQueue
                .catch(() => { }) // 以前のエラーを無視
                .then(() => this._saveCriticalError(errorEntry));

            // ユーザーに即座に通知（保存を待たない）
            console.error('*'.repeat(80));
            console.error('CRITICAL ERROR DETECTED:');
            console.error(`Context: ${errorEntry.context}`);
            console.error(`Message: ${errorEntry.message}`);
            console.error(`Location: ${errorEntry.file}:${errorEntry.line}`);
            console.error('*'.repeat(80));
        }

        /**
         * クリティカルエラーを保存（キューで直列化）
         */
        async _saveCriticalError(errorEntry) {
            try {
                let criticalErrors = [];

                // 既存のクリティカルエラーを取得
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    const result = await new Promise(resolve => {
                        chrome.storage.local.get(['critical_errors'], resolve);
                    });
                    if (result.critical_errors && Array.isArray(result.critical_errors)) {
                        criticalErrors = result.critical_errors;
                    }
                } else if (typeof localStorage !== 'undefined') {
                    try {
                        const stored = localStorage.getItem('critical_errors');
                        if (stored) {
                            criticalErrors = JSON.parse(stored);
                        }
                    } catch (e) {
                        // パース失敗時は空配列から開始
                    }
                }

                // 新しいエラーを追加（最新100件のみ保持）
                criticalErrors.push(errorEntry);
                if (criticalErrors.length > 100) {
                    criticalErrors = criticalErrors.slice(-100);
                }

                // 保存
                await this._persistToStorage('critical_errors', criticalErrors);
            } catch (err) {
                console.error('Failed to persist critical error:', err);
            }
        }

        /**
         * エラー数の上限を維持
         */
        _maintainErrorLimit() {
            if (this.errors.length > this.maxErrors) {
                this.errors = this.errors.slice(-this.maxErrors);
            }
        }

        _maintainWarningLimit() {
            if (this.warnings.length > this.maxErrors) {
                this.warnings = this.warnings.slice(-this.maxErrors);
            }
        }

        _maintainInfoLimit() {
            if (this.infos.length > this.maxErrors) {
                this.infos = this.infos.slice(-this.maxErrors);
            }
        }

        /**
         * 包括的なレポートを取得
         */
        getReport() {
            return {
                sessionId: this.sessionId,
                sessionDuration: Date.now() - this.startTime,
                totalErrors: this.errors.length,
                totalWarnings: this.warnings.length,
                totalInfos: this.infos.length,
                errors: this.errors,
                warnings: this.warnings,
                infos: this.infos,
                summary: this._getSummary(),
                environment: this._getEnvironment()
            };
        }

        /**
         * サマリーを生成
         */
        _getSummary() {
            const summary = {
                errorsByContext: {},
                errorsByCategory: {},
                errorsBySeverity: {},
                errorsByFile: {},
                recentErrors: this.errors.slice(-10),
                criticalErrors: this.errors.filter(e => e.severity === SEVERITY_LEVELS.CRITICAL),
                highSeverityErrors: this.errors.filter(e => e.severity === SEVERITY_LEVELS.HIGH)
            };

            this.errors.forEach(err => {
                // コンテキスト別
                summary.errorsByContext[err.context] =
                    (summary.errorsByContext[err.context] || 0) + 1;

                // カテゴリ別
                summary.errorsByCategory[err.category] =
                    (summary.errorsByCategory[err.category] || 0) + 1;

                // 重要度別
                summary.errorsBySeverity[err.severity] =
                    (summary.errorsBySeverity[err.severity] || 0) + 1;

                // ファイル別
                summary.errorsByFile[err.file] =
                    (summary.errorsByFile[err.file] || 0) + 1;
            });

            return summary;
        }

        /**
         * 環境情報を取得
         */
        _getEnvironment() {
            const env = {
                timestamp: new Date().toISOString(),
                platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
                language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
                url: typeof window !== 'undefined' ? window.location.href : 'unknown',
                screen: typeof window !== 'undefined' ? {
                    width: window.screen.width,
                    height: window.screen.height
                } : null
            };

            // File System Access API サポート
            if (typeof window !== 'undefined') {
                env.fileSystemAccessSupported = 'showDirectoryPicker' in window;
            }

            // Chrome情報
            if (typeof chrome !== 'undefined' && chrome.runtime) {
                env.extensionId = chrome.runtime.id;
                env.extensionVersion = chrome.runtime.getManifest ? chrome.runtime.getManifest().version : 'unknown';
            }

            return env;
        }

        /**
         * レポートをJSON形式でエクスポート
         */
        exportReport() {
            const report = this.getReport();

            // Check if DOM is available (won't work in background scripts/Service Workers)
            if (typeof document === 'undefined') {
                console.warn('exportReport: DOM not available. Use getReport() to retrieve data manually.');
                console.log('Error Report JSON:', JSON.stringify(report, null, 2));
                return report;
            }

            try {
                const blob = new Blob([JSON.stringify(report, null, 2)], {
                    type: 'application/json'
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `error_report_${this.sessionId}_${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);
                return report;
            } catch (err) {
                console.error('Failed to export report:', err);
                console.log('Error Report JSON:', JSON.stringify(report, null, 2));
                return report;
            }
        }

        /**
         * レポートをコンソールに出力
         */
        printReport() {
            const report = this.getReport();

            console.log('\n' + '='.repeat(80));
            console.log('GLOBAL ERROR LOGGER REPORT');
            console.log('='.repeat(80));
            console.log(`Session ID: ${report.sessionId}`);
            console.log(`Session Duration: ${(report.sessionDuration / 1000).toFixed(2)}s`);
            console.log(`Total Errors: ${report.totalErrors}`);
            console.log(`Total Warnings: ${report.totalWarnings}`);
            console.log(`Total Infos: ${report.totalInfos}`);
            console.log('='.repeat(80));

            if (report.summary.criticalErrors.length > 0) {
                console.log('\nCRITICAL ERRORS:');
                report.summary.criticalErrors.forEach((err, i) => {
                    console.log(`${i + 1}. ${err.context}: ${err.message}`);
                    console.log(`   Location: ${err.file}:${err.line}`);
                });
            }

            console.log('\nErrors by Category:');
            console.log(JSON.stringify(report.summary.errorsByCategory, null, 2));

            console.log('\nErrors by Severity:');
            console.log(JSON.stringify(report.summary.errorsBySeverity, null, 2));

            console.log('\nErrors by File:');
            console.log(JSON.stringify(report.summary.errorsByFile, null, 2));

            console.log('='.repeat(80) + '\n');
        }

        /**
         * ストレージにデータを永続化
         */
        async _persistToStorage(key, data) {
            try {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    await new Promise((resolve, reject) => {
                        chrome.storage.local.set({ [key]: data }, () => {
                            if (chrome.runtime.lastError) {
                                reject(chrome.runtime.lastError);
                            } else {
                                resolve();
                            }
                        });
                    });
                } else if (typeof localStorage !== 'undefined') {
                    localStorage.setItem(key, JSON.stringify(data));
                }
            } catch (err) {
                console.error('Failed to persist error data:', err);
                throw err; // Re-throw to allow caller to handle
            }
        }

        /**
         * エラーログをクリア
         */
        clear() {
            this.errors = [];
            this.warnings = [];
            this.infos = [];
        }

        /**
         * ロギングを有効/無効化
         */
        enable() {
            this.enabled = true;
        }

        disable() {
            this.enabled = false;
        }
    }



    // 共有の定数を付与
    const attachConstants = (target) => {
        target.ERROR_CATEGORIES = ERROR_CATEGORIES;
        target.SEVERITY_LEVELS = SEVERITY_LEVELS;
        target.FILE_ERROR_CODES = FILE_ERROR_CODES;
        target.FILE_ERROR_SEVERITY = FILE_ERROR_SEVERITY;
        target.LOOP_ERROR_CODES = LOOP_ERROR_CODES;
        target.LOOP_ERROR_SEVERITY = LOOP_ERROR_SEVERITY;
        target.CLIPBOARD_ERROR_CODES = CLIPBOARD_ERROR_CODES;
        target.CLIPBOARD_ERROR_SEVERITY = CLIPBOARD_ERROR_SEVERITY;
        return target;
    };

    // シングルトンインスタンスを初期化（既存のインスタンスがあれば再利用）
    // Check if the global class already has an instance (for module reloads)
    let exportedInstance;
    if (typeof globalScope.GlobalErrorLogger === 'function' &&
        globalScope.GlobalErrorLogger._instance instanceof GlobalErrorLogger) {
        // Reuse existing instance from previous load
        exportedInstance = globalScope.GlobalErrorLogger._instance;
    } else if (globalScope.GlobalErrorLogger instanceof GlobalErrorLogger) {
        // Legacy: global was an instance (shouldn't happen with new code, but kept for safety)
        exportedInstance = globalScope.GlobalErrorLogger;
    } else {
        // Create new instance
        // HEAD 側の意図を取り込んで、グローバルハンドラを無効化しておく
        exportedInstance = new GlobalErrorLogger({ setupGlobalHandlers: false });
        console.log('[GlobalErrorLogger] Singleton instance created (no global handlers)');
        console.debug('[GlobalErrorLogger] Singleton instance created (no global handlers)');
    }

    // クラスとインスタンスの両方に定数を付与
    attachConstants(GlobalErrorLogger);
    attachConstants(exportedInstance);

    // クラスへの参照をインスタンスに保持（必要に応じて新規インスタンスを作成可能）
    exportedInstance.Class = GlobalErrorLogger;

    // インスタンスへの参照をクラスに保持
    GlobalErrorLogger._instance = exportedInstance;

    // 既存コードとの後方互換用にグローバルへ公開（初回ロード時も参照可能にする）
    globalScope.GlobalErrorLogger = exportedInstance;

    /**
     * インスタンスを取得（存在しなければ作成）するヘルパー
     */
    const getOrCreateInstance = () => {
        let target = GlobalErrorLogger._instance || exportedInstance;
        if (!target) {
            target = new GlobalErrorLogger({ setupGlobalHandlers: false });
            attachConstants(target);
            target.Class = GlobalErrorLogger;
            GlobalErrorLogger._instance = target;
            exportedInstance = target;
            if (typeof globalScope !== 'undefined') {
                globalScope.GlobalErrorLogger = target;
            }
            console.warn('[GlobalErrorLogger] No instance found; created a fallback instance');
        }
        return target;
    };

    /**
     * インスタンスメソッドを static から呼び出すためのラッパー
     * - prototype を this にしない
     * - インスタンスが無ければオンデマンドで生成
     * - addSkipExtraFrame=true のときは details._skipExtraFrame を自動付与
     */
    const wrapInstanceMethod = (methodName, { addSkipExtraFrame = false } = {}) => {
        return (...args) => {
            const target = getOrCreateInstance();

            if (typeof target[methodName] !== 'function') {
                console.error(`[GlobalErrorLogger] Instance method ${methodName} not available`);
                return undefined;
            }

            if (addSkipExtraFrame) {
                // logError / logWarning / logInfo 用:
                // シグネチャは (context, errorOrMessage, details?)
                const [context, errorOrMessage, details = {}] = args;
                const newDetails = { ...details, _skipExtraFrame: true };
                return target[methodName](context, errorOrMessage, newDetails);
            }

            return target[methodName](...args);
        };
    };

    // レガシー互換性: クラスプロパティ経由でも最新のログ配列へアクセスできるようにする
    // これにより GlobalErrorLogger.errors.length のような既存コードが動作する
    const mirrorProperty = (prop) => Object.defineProperty(GlobalErrorLogger, prop, {
        get() { return getOrCreateInstance()[prop]; },
        set(value) { getOrCreateInstance()[prop] = value; },
        configurable: true
    });

    mirrorProperty('errors');
    mirrorProperty('warnings');
    mirrorProperty('infos');

    // ---- static ラッパー定義 ----

    const staticWrappers = {
        // 1. スタックトレース補正が必要なログ系（クラスメソッドとしても呼べる）
        logError: wrapInstanceMethod('logError', { addSkipExtraFrame: true }),
        logWarning: wrapInstanceMethod('logWarning', { addSkipExtraFrame: true }),
        logInfo: wrapInstanceMethod('logInfo', { addSkipExtraFrame: true }),

        // 2. 特化ログ（File / Loop / Clipboard）
        logFileError: wrapInstanceMethod('logFileError', { addSkipExtraFrame: true }),
        logLoopError: wrapInstanceMethod('logLoopError', { addSkipExtraFrame: true }),
        logClipboardError: wrapInstanceMethod('logClipboardError', { addSkipExtraFrame: true }),

        // 3. ユーティリティ / コントロールメソッド
        getReport: wrapInstanceMethod('getReport'),
        exportReport: wrapInstanceMethod('exportReport'),
        printReport: wrapInstanceMethod('printReport'),
        clear: wrapInstanceMethod('clear'),
        enable: wrapInstanceMethod('enable'),
        disable: wrapInstanceMethod('disable')
    };

    Object.assign(GlobalErrorLogger, staticWrappers);

    // Re-attach specialized file helpers and constants defensively to avoid
    // regressions when legacy call sites (e.g., AsyncFileIO) invoke static
    // APIs before the singleton instance is fully initialized.
    const ensureLegacyFileApi = (target) => {
        if (typeof target.logFileError !== 'function') {
            target.logFileError = staticWrappers.logFileError;
        }
        if (!target.FILE_ERROR_CODES) {
            target.FILE_ERROR_CODES = FILE_ERROR_CODES;
        }
        if (!target.FILE_ERROR_SEVERITY) {
            target.FILE_ERROR_SEVERITY = FILE_ERROR_SEVERITY;
        }
    };

    ensureLegacyFileApi(GlobalErrorLogger);

    // Legacy: only add wrappers to the exported instance when the method is missing
    // to avoid replacing prototype methods with wrappers and causing recursion
    Object.keys(staticWrappers).forEach((name) => {
        if (typeof exportedInstance[name] !== 'function') {
            exportedInstance[name] = staticWrappers[name];
        }
    });

    ensureLegacyFileApi(exportedInstance);

    // Export the CLASS separately for opt-in instantiation scenarios
    // This allows: const logger = new GlobalErrorLogger();
    // while keeping globalScope.GlobalErrorLogger as the shared singleton instance
    globalScope.GlobalErrorLoggerClass = GlobalErrorLogger;

    // console.log('[GlobalErrorLogger] Initialized successfully');

})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
