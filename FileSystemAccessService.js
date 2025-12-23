/**
 * FileSystemAccessService.js
 *
 * File System Access API を使用してローカルファイルシステムへのアクセスを提供
 * ネイティブモジュールなしで実際のローカルファイルシステムにアクセス可能
 *
 * 要件: Chrome 86+ (Chromiumベース)
 */

// グローバルエラーロガーのヘルパー関数
// errorLogger.js のグローバル関数とインスタンスを使用
/* global ErrorLogger, ErrorLevel, ErrorCodes, logWarning, logInfo */

// Error code constant to prevent ReferenceError in test environments
const FS_ACCESS_DEFAULT_ERROR_CODE =
    typeof ErrorCodes !== 'undefined' && ErrorCodes.MANUAL
        ? ErrorCodes.MANUAL
        : "IMX-9000";

function fsAccessLogError(context, error, details = {}) {
    if (typeof ErrorLogger !== 'undefined' && typeof ErrorLevel !== 'undefined') {
        // Use ErrorLogger instance directly to preserve original error stack
        const errorMessage = error?.message || String(error);
        const stack = error?.stack || new Error().stack;

        // Extract caller info from the original error stack
        const caller = ErrorLogger.extractCallerFromStack(stack, 0);

        return ErrorLogger.logError({
            level: ErrorLevel.ERROR,
            message: `[FileSystemAccess][${context}]: ${errorMessage}`,
            code: FS_ACCESS_DEFAULT_ERROR_CODE,
            filename: caller.filename,
            lineno: caller.lineno,
            colno: 0,
            stack: stack,
            context: {
                ...details,
                originalError: error,
                fsContext: context
            }
        });
    } else {
        console.error(`[FileSystemAccess][${context}]`, error, details);
    }
}

function fsAccessLogWarning(context, message, details = {}) {
    if (typeof logWarning !== 'undefined') {
        const fullMessage = `[FileSystemAccess][${context}]: ${message}`;
        return logWarning(fullMessage, { ...details, fsContext: context }, FS_ACCESS_DEFAULT_ERROR_CODE);
    } else {
        console.warn(`[FileSystemAccess][${context}]`, message, details);
    }
}

function fsAccessLogInfo(context, message, details = {}) {
    if (typeof logInfo !== 'undefined') {
        const fullMessage = `[FileSystemAccess][${context}]: ${message}`;
        return logInfo(fullMessage, { ...details, fsContext: context }, FS_ACCESS_DEFAULT_ERROR_CODE);
    } else {
        console.info(`[FileSystemAccess][${context}]`, message, details);
    }
}

// IndexedDB でディレクトリハンドルを永続化するためのキー
const IDB_NAME = 'iMacrosFileSystemAccess';
const IDB_VERSION = 1;
const IDB_STORE_NAME = 'directoryHandles';

/**
 * Glob パターンを正規表現に変換
 */
function globToRegex(pattern) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped.replace(/\\\*/g, '.*'));
}

class FileSystemAccessService {
    constructor(options = {}) {
        this.ready = false;
        this.rootHandle = null;
        this.rootPath = null;
        this.eventHandlers = {};
        this.db = null;
        this.pathMappingService = null; // WindowsPathMappingService インスタンス

        // デフォルトオプション
        this.options = {
            autoPrompt: options.autoPrompt !== false, // 初期化時に自動的にディレクトリ選択を促すか
            persistPermissions: options.persistPermissions !== false,
            enableWindowsPathMapping: options.enableWindowsPathMapping !== false, // Windowsパスマッピングを有効化
            ...options
        };
    }

    /**
     * ブラウザがFile System Access APIをサポートしているかチェック
     */
    static isSupported() {
        return typeof window !== 'undefined' &&
            'showDirectoryPicker' in window &&
            'showOpenFilePicker' in window &&
            'showSaveFilePicker' in window;
    }

    /**
     * IndexedDBを初期化
     */
    async _initDB() {
        if (this.db) return this.db;

        try {
            return await new Promise((resolve, reject) => {
                const request = indexedDB.open(IDB_NAME, IDB_VERSION);

                request.onerror = () => {
                    fsAccessLogError('FileSystemAccessService._initDB', request.error || new Error('IndexedDB open failed'), {
                        database: IDB_NAME,
                        version: IDB_VERSION
                    });
                    reject(request.error);
                };

                request.onsuccess = () => {
                    try {
                        this.db = request.result;
                        fsAccessLogInfo('FileSystemAccessService._initDB', 'IndexedDB initialized successfully', {
                            database: IDB_NAME
                        });
                        resolve(this.db);
                    } catch (err) {
                        fsAccessLogError('FileSystemAccessService._initDB.onsuccess', err, {
                            database: IDB_NAME
                        });
                        reject(err);
                    }
                };

                request.onupgradeneeded = (event) => {
                    try {
                        const db = event.target.result;
                        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
                            db.createObjectStore(IDB_STORE_NAME);
                            fsAccessLogInfo('FileSystemAccessService._initDB', 'Created object store', {
                                store: IDB_STORE_NAME
                            });
                        }
                    } catch (err) {
                        fsAccessLogError('FileSystemAccessService._initDB.onupgradeneeded', err, {
                            database: IDB_NAME
                        });
                        reject(err);
                    }
                };
            });
        } catch (err) {
            fsAccessLogError('FileSystemAccessService._initDB', err, {
                database: IDB_NAME,
                version: IDB_VERSION
            });
            throw err;
        }
    }

    /**
     * ディレクトリハンドルをIndexedDBに保存
     */
    async _saveDirectoryHandle(key, handle) {
        if (!this.options.persistPermissions) return;

        const db = await this._initDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([IDB_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(IDB_STORE_NAME);
            const request = store.put(handle, key);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * IndexedDBからディレクトリハンドルを読み込み
     */
    async _loadDirectoryHandle(key) {
        if (!this.options.persistPermissions) return null;

        try {
            const db = await this._initDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([IDB_STORE_NAME], 'readonly');
                const store = transaction.objectStore(IDB_STORE_NAME);
                const request = store.get(key);

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (err) {
            fsAccessLogWarning(
                'FileSystemAccessService._loadDirectoryHandle',
                'Failed to load directory handle from IndexedDB',
                { key: key, error: err.message }
            );
            return null;
        }
    }

    /**
     * 保存されたディレクトリハンドルの許可を確認・要求
     */
    async _verifyPermission(handle, mode = 'read', options = {}) {
        const permOptions = {};
        if (mode === 'readwrite') {
            permOptions.mode = 'readwrite';
        }

        // 既に許可があるかチェック
        const permissionState = await handle.queryPermission(permOptions);
        if (permissionState === 'granted') {
            return true;
        }

        // skipRequest が true の場合は要求しない（バックグラウンドコンテキスト）
        if (options.skipRequest === true) {
            return false;
        }

        // ユーザーに許可を要求（ユーザー操作が必要）
        // 注: permissionState が 'denied' でも、ユーザーが明示的にボタンをクリックした場合は
        // requestPermission を試みる。ブラウザが許可ダイアログを表示するかは
        // ブラウザのポリシー次第だが、少なくとも試行する機会を与える。
        try {
            const result = await handle.requestPermission(permOptions);
            if (result === 'granted') {
                return true;
            } else {
                // ユーザーが拒否した、またはブラウザが許可しなかった
                fsAccessLogWarning(
                    'FileSystemAccessService._verifyPermission',
                    `Permission request returned: ${result}`,
                    { mode: mode, previousState: permissionState }
                );
                return false;
            }
        } catch (err) {
            // requestPermission が失敗した場合（例：ユーザー操作がないコンテキスト）
            fsAccessLogWarning(
                'FileSystemAccessService._verifyPermission',
                'requestPermission failed - may require user interaction',
                { error: err.message, mode: mode }
            );
            return false;
        }
    }

    /**
     * サービスを初期化
     */
    async init() {
        try {
            const canPickDirectories = FileSystemAccessService.isSupported();

            if (!canPickDirectories) {
                // In contexts where showDirectoryPicker is not available (e.g., chrome-extension://),
                // we can still use saved handles from IndexedDB
                fsAccessLogInfo('FileSystemAccessService.init', 'Directory picker not available in this context, will try to use saved handle');
            }

            // Initialize IndexedDB first
            await this._initDB();
            fsAccessLogInfo('FileSystemAccessService.init', 'IndexedDB initialized successfully', {
                database: IDB_NAME
            });

            fsAccessLogInfo('FileSystemAccessService.init', 'Initializing FileSystemAccessService', {
                autoPrompt: this.options.autoPrompt,
                enableWindowsPathMapping: this.options.enableWindowsPathMapping
            });

            // WindowsPathMappingServiceを初期化
            if (this.options.enableWindowsPathMapping && typeof WindowsPathMappingService !== 'undefined') {
                try {
                    this.pathMappingService = new WindowsPathMappingService({
                        autoPrompt: this.options.autoPrompt
                    });
                    await this.pathMappingService.init();
                    fsAccessLogInfo('FileSystemAccessService.init', 'WindowsPathMappingService initialized');
                } catch (err) {
                    fsAccessLogError('FileSystemAccessService.init', err, {
                        context: 'WindowsPathMappingService initialization',
                        severity: 'HIGH'
                    });
                    // Continue without Windows path mapping
                    this.pathMappingService = null;
                }
            }

            // 保存されたルートディレクトリハンドルを読み込み
            const savedHandle = await this._loadDirectoryHandle('rootDirectory');

            if (savedHandle) {
                try {
                    // 許可を確認（バックグラウンドコンテキストでは requestPermission をスキップ）
                    // queryPermission のみで確認し、'granted' の場合のみ使用
                    const hasPermission = await this._verifyPermission(
                        savedHandle,
                        'readwrite',
                        { skipRequest: !this.options.autoPrompt }
                    );

                    if (hasPermission) {
                        this.rootHandle = savedHandle;
                        this.rootName = savedHandle.name;
                        this.rootPath = '/';
                        this.ready = true;
                        this._emit('ready', { rootHandle: this.rootHandle });
                        fsAccessLogInfo('FileSystemAccessService.init', 'Service initialized with saved handle', {
                            directoryName: savedHandle.name
                        });
                        return true;
                    } else {
                        // 権限がない場合でも、ハンドルは保持しておく
                        // ユーザーが後でアクセスを許可できるように
                        this.rootHandle = savedHandle;
                        this.rootName = savedHandle.name;
                        this.rootPath = '/';
                        this.ready = false; // ready は false のまま
                        fsAccessLogWarning(
                            'FileSystemAccessService.init',
                            'Directory handle found but permission expired - user must re-grant access via options page',
                            {
                                directoryName: savedHandle.name,
                                permissionState: 'expired', // Custom app state, not a standard File System Access API value
                                action: 'User should click Browse button in options to re-select directory'
                            }
                        );
                        // autoPrompt が true の場合は、ユーザーにプロンプトを表示
                        if (this.options.autoPrompt) {
                            return await this.promptForDirectory();
                        }
                        return false;
                    }
                } catch (err) {
                    fsAccessLogError('FileSystemAccessService.init', err, {
                        context: 'Permission verification for saved handle'
                    });
                    // Even if permission check fails, preserve the handle for later restoration
                    this.rootHandle = savedHandle;
                    this.rootName = savedHandle.name;
                    this.rootPath = '/';
                    this.ready = false;
                    fsAccessLogWarning(
                        'FileSystemAccessService.init',
                        'Saved handle found but permission verification failed - handle preserved for later restoration'
                    );
                    return false;
                }
            }

            // 保存されたハンドルがないか許可がない場合
            if (this.options.autoPrompt) {
                fsAccessLogInfo('FileSystemAccessService.init', 'Prompting user for directory');
                return await this.promptForDirectory();
            }

            fsAccessLogInfo('FileSystemAccessService.init', 'Service initialized without root handle (autoPrompt=false)');
            return false;

        } catch (err) {
            fsAccessLogError('FileSystemAccessService.init', err, {
                options: this.options,
                severity: 'CRITICAL'
            });
            throw err;
        }
    }

    /**
     * ユーザーにディレクトリ選択ダイアログを表示
     */
    async promptForDirectory() {
        try {
            const handle = await window.showDirectoryPicker({
                mode: 'readwrite',
                startIn: 'documents'
            });

            this.rootHandle = handle;
            this.rootName = handle.name;
            this.rootPath = '/';
            this.ready = true;

            // ディレクトリハンドルを保存
            await this._saveDirectoryHandle('rootDirectory', handle);

            this._emit('ready', { rootHandle: this.rootHandle });
            this._emit('change', { type: 'rootChanged', path: '/' });

            return true;
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('User cancelled directory selection');
            } else {
                fsAccessLogError('FileSystemAccessService.promptForDirectory', err);
            }
            return false;
        }
    }

    /**
     * 保存されたディレクトリハンドルの権限を再要求
     * ユーザー操作が必要（例：ボタンクリック後に呼び出す）
     */
    async requestPermission() {
        if (!this.rootHandle) {
            fsAccessLogWarning(
                'FileSystemAccessService.requestPermission',
                'No saved handle to request permission for'
            );
            return false;
        }

        try {
            const hasPermission = await this._verifyPermission(
                this.rootHandle,
                'readwrite',
                { skipRequest: false } // 明示的に requestPermission を呼び出す
            );

            if (hasPermission) {
                this.ready = true;
                this._emit('ready', { rootHandle: this.rootHandle });
                fsAccessLogInfo('FileSystemAccessService.requestPermission', 'Permission granted');
                return true;
            } else {
                fsAccessLogWarning('FileSystemAccessService.requestPermission', 'Permission denied by user');
                return false;
            }
        } catch (err) {
            fsAccessLogError('FileSystemAccessService.requestPermission', err, {
                severity: 'HIGH'
            });
            return false;
        }
    }

    /**
     * Windowsの絶対パスかどうかを判定
     */
    _isWindowsAbsolutePath(path) {
        if (!path) return false;
        return /^[a-z]:[/\\]/i.test(path);
    }

    /**
     * パスを解決して、適切なルートハンドルと相対パスを返す
     * Windowsパスの場合は WindowsPathMappingService を使用
     * 仮想パスの場合は rootHandle を使用
     */
    async _resolvePathAndHandle(path) {
        // Windowsの絶対パスの場合
        if (this._isWindowsAbsolutePath(path)) {
            if (!this.pathMappingService) {
                const err = new Error(
                    `Windows absolute path detected: ${path}\n` +
                    `Windows path mapping is not enabled. ` +
                    `Please enable it by setting enableWindowsPathMapping: true in options, ` +
                    `or use Native File Access.`
                );
                fsAccessLogError('FileSystemAccessService._resolvePathAndHandle', err, {
                    path: path,
                    severity: 'HIGH',
                    category: 'PATH_MAPPING'
                });
                throw err;
            }

            try {
                const resolved = await this.pathMappingService.resolveWindowsPath(path);
                return {
                    rootHandle: resolved.handle,
                    relativePath: resolved.relativePath,
                    isWindowsPath: true,
                    mappedPath: resolved.mappedPath
                };
            } catch (err) {
                const wrappedErr = new Error(
                    `Failed to resolve Windows path: ${path}\n` +
                    `${err.message}`
                );
                fsAccessLogError('FileSystemAccessService._resolvePathAndHandle', wrappedErr, {
                    path: path,
                    originalError: err.message,
                    severity: 'HIGH',
                    category: 'PATH_RESOLUTION'
                });
                throw wrappedErr;
            }
        }

        // 仮想パス（/で始まる）の場合
        if (!this.ready || !this.rootHandle) {
            const err = new Error('FileSystemAccessService is not initialized');
            fsAccessLogError('FileSystemAccessService._resolvePathAndHandle', err, {
                path: path,
                ready: this.ready,
                hasRootHandle: !!this.rootHandle,
                severity: 'CRITICAL',
                category: 'INITIALIZATION'
            });
            throw err;
        }

        let relativePath = path.startsWith('/') ? path.substring(1) : path;

        // ルートディレクトリ名で始まるパスの処理
        // 例: rootName="Macros", path="Macros/Demo.iim" -> relativePath="Demo.iim"
        if (this.rootName) {
            // パスセパレータを統一
            const normalizedPath = relativePath.replace(/\\/g, '/');
            const parts = normalizedPath.split('/');

            if (parts.length > 0 && parts[0] === this.rootName) {
                // 最初のパス要素がルート名と一致する場合、それを削除
                parts.shift();
                relativePath = parts.join('/');
            }
        }

        return {
            rootHandle: this.rootHandle,
            relativePath: relativePath,
            isWindowsPath: false,
            mappedPath: null
        };
    }

    /**
     * パスを配列に分割
     */
    _splitPath(path) {
        if (!path || path === '/') return [];

        // Windowsパスの場合、バックスラッシュをスラッシュに変換
        path = path.replace(/\\/g, '/');

        // 先頭のスラッシュを削除し、連続したスラッシュを1つに
        const normalized = path.replace(/^\/+/, '').replace(/\/+/g, '/');
        return normalized.split('/').filter(p => p.length > 0);
    }

    /**
     * パスを結合（Windows/Unix両対応）
     */
    _joinPath(basePath, ...parts) {
        // basePathが空の場合、最初のパーツがWindowsパスかチェック
        if (!basePath) {
            const firstPart = parts.find(p => p && p.trim());
            const isWindowsPath = firstPart ? this._isWindowsAbsolutePath(firstPart) : false;
            const separator = isWindowsPath ? '\\' : '/';
            return parts.filter(p => p && p.trim()).join(separator);
        }

        // Windowsパスの場合、適切なセパレータを使用
        const isWindowsPath = this._isWindowsAbsolutePath(basePath);
        const separator = isWindowsPath ? '\\' : '/';

        // ベースパスを正規化（内部のセパレータも統一）
        let result = basePath.replace(/[/\\]+/g, separator).replace(/[/\\]+$/, '');

        // 各パーツを追加
        for (const part of parts) {
            if (part) {
                // パーツ内部のセパレータを統一し、先頭と末尾のスラッシュを削除
                const normalizedPart = part.replace(/[/\\]+/g, separator);
                const cleanPart = normalizedPart.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');
                if (cleanPart) {
                    result += separator + cleanPart;
                }
            }
        }

        return result;
    }

    /**
     * パスからディレクトリハンドルを取得
     */
    async _getDirectoryHandle(path, create = false) {
        // パスを解決してルートハンドルと相対パスを取得
        const resolved = await this._resolvePathAndHandle(path);
        const parts = this._splitPath(resolved.relativePath);
        let currentHandle = resolved.rootHandle;

        for (const part of parts) {
            try {
                currentHandle = await currentHandle.getDirectoryHandle(part, { create });
            } catch (err) {
                if (err.name === 'NotFoundError') {
                    fsAccessLogWarning('FileSystemAccessService._getDirectoryHandle',
                        `Directory not found: ${path}`, {
                        path: path,
                        missingPart: part,
                        create: create
                    });
                    return null;
                }
                fsAccessLogError('FileSystemAccessService._getDirectoryHandle', err, {
                    path: path,
                    currentPart: part,
                    severity: 'HIGH',
                    category: 'FILE_SYSTEM'
                });
                throw err;
            }
        }

        return currentHandle;
    }

    /**
     * パスからファイルハンドルを取得
     */
    async _getFileHandle(path, create = false) {
        // パスを解決してルートハンドルと相対パスを取得
        const resolved = await this._resolvePathAndHandle(path);
        const parts = this._splitPath(resolved.relativePath);

        if (parts.length === 0) {
            const err = new Error('Invalid file path');
            fsAccessLogError('FileSystemAccessService._getFileHandle', err, {
                path: path,
                severity: 'MEDIUM',
                category: 'VALIDATION'
            });
            throw err;
        }

        const fileName = parts.pop();

        // ディレクトリハンドルを取得（相対パスでディレクトリを再構築）
        let currentHandle = resolved.rootHandle;
        for (const part of parts) {
            try {
                currentHandle = await currentHandle.getDirectoryHandle(part, { create });
            } catch (err) {
                if (err.name === 'NotFoundError') {
                    fsAccessLogWarning('FileSystemAccessService._getFileHandle',
                        `Directory not found in path: ${path}`, {
                        path: path,
                        missingPart: part,
                        create: create
                    });
                    return null;
                }
                fsAccessLogError('FileSystemAccessService._getFileHandle', err, {
                    path: path,
                    currentPart: part,
                    severity: 'HIGH',
                    category: 'FILE_SYSTEM'
                });
                throw err;
            }
        }

        try {
            return await currentHandle.getFileHandle(fileName, { create });
        } catch (err) {
            if (err.name === 'NotFoundError') {
                fsAccessLogWarning('FileSystemAccessService._getFileHandle',
                    `File not found: ${path}`, {
                    path: path,
                    fileName: fileName,
                    create: create
                });
                return null;
            }
            fsAccessLogError('FileSystemAccessService._getFileHandle', err, {
                path: path,
                fileName: fileName,
                severity: 'HIGH',
                category: 'FILE_SYSTEM'
            });
            throw err;
        }
    }

    /**
     * ノード(ファイルまたはディレクトリ)が存在するかチェック
     */
    async node_exists(path) {
        try {
            // パスを解決してルートハンドルと相対パスを取得
            const resolved = await this._resolvePathAndHandle(path);
            const parts = this._splitPath(resolved.relativePath);

            if (parts.length === 0) {
                return true; // ルートディレクトリ
            }

            const fileName = parts.pop();

            // 親ディレクトリハンドルを取得
            let currentHandle = resolved.rootHandle;
            for (const part of parts) {
                try {
                    currentHandle = await currentHandle.getDirectoryHandle(part);
                } catch (err) {
                    if (err.name === 'NotFoundError') {
                        return false;
                    }
                    throw err;
                }
            }

            // ファイルまたはディレクトリとして存在するかチェック
            try {
                await currentHandle.getFileHandle(fileName);
                return true;
            } catch (err) {
                if (err.name === 'TypeMismatchError' || err.name === 'NotFoundError') {
                    // ディレクトリとして試す
                    try {
                        await currentHandle.getDirectoryHandle(fileName);
                        return true;
                    } catch (err2) {
                        if (err2.name === 'NotFoundError') {
                            return false;
                        }
                        throw err2;
                    }
                }
                throw err;
            }
        } catch (err) {
            fsAccessLogError('FileSystemAccessService.node_exists', err);
            return false;
        }
    }

    /**
     * ノードがディレクトリかどうかチェック
     */
    async node_isDir(path) {
        try {
            const parts = this._splitPath(path);
            if (parts.length === 0) {
                return true; // ルートディレクトリ
            }

            const dirHandle = await this._getDirectoryHandle(path);
            return dirHandle !== null;
        } catch (err) {
            return false;
        }
    }

    /**
     * ディレクトリを作成
     */
    async makeDirectory(path) {
        const handle = await this._getDirectoryHandle(path, true);
        this._emit('change', { type: 'directoryCreated', path });
        return handle;
    }

    /**
     * テキストファイルを読み込み
     */
    async readTextFile(path) {
        try {
            const fileHandle = await this._getFileHandle(path);
            if (!fileHandle) {
                const error = new Error(`File not found: ${path}`);
                error.name = 'NotFoundError';
                fsAccessLogError('FileSystemAccessService.readTextFile', error, {
                    path: path,
                    severity: 'MEDIUM',
                    category: 'NOT_FOUND'
                });
                throw error;
            }

            const file = await fileHandle.getFile();
            const text = await file.text();
            fsAccessLogInfo('FileSystemAccessService.readTextFile', `Successfully read file: ${path}`, {
                path: path,
                size: text.length
            });
            return text;
        } catch (err) {
            // Only log if not already logged
            if (err.name !== 'NotFoundError') {
                fsAccessLogError('FileSystemAccessService.readTextFile', err, {
                    path: path,
                    severity: 'HIGH',
                    category: 'FILE_SYSTEM'
                });
            }
            throw err;
        }
    }

    /**
     * バイナリファイルを読み込み（Base64 data URL形式で返す）
     * 主に画像ファイルのIMAGESEARCHコマンド用
     */
    async readBinaryFile(path) {
        try {
            const fileHandle = await this._getFileHandle(path);
            if (!fileHandle) {
                const error = new Error(`File not found: ${path}`);
                error.name = 'NotFoundError';
                fsAccessLogError('FileSystemAccessService.readBinaryFile', error, {
                    path: path,
                    severity: 'MEDIUM',
                    category: 'NOT_FOUND'
                });
                throw error;
            }

            const file = await fileHandle.getFile();

            // FileReaderを使ってBase64 data URLに変換
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    fsAccessLogInfo('FileSystemAccessService.readBinaryFile', `Successfully read binary file: ${path}`, {
                        path: path,
                        size: file.size,
                        type: file.type
                    });
                    resolve(reader.result); // data:mime/type;base64,... 形式
                };
                reader.onerror = () => {
                    const error = new Error(`Failed to read binary file: ${path}. Original error: ${reader.error ? reader.error.message : 'Unknown'}`);
                    fsAccessLogError('FileSystemAccessService.readBinaryFile', error, {
                        path: path,
                        severity: 'HIGH',
                        category: 'FILE_READ',
                        readerError: reader.error
                    });
                    reject(error);
                };
                reader.readAsDataURL(file);
            });
        } catch (err) {
            // Only log if not already logged
            if (err.name !== 'NotFoundError') {
                fsAccessLogError('FileSystemAccessService.readBinaryFile', err, {
                    path: path,
                    severity: 'HIGH',
                    category: 'FILE_SYSTEM'
                });
            }
            throw err;
        }
    }

    /**
     * テキストファイルに書き込み
     */
    async writeTextFile(path, data) {
        try {
            const fileHandle = await this._getFileHandle(path, true);
            const writable = await fileHandle.createWritable();
            await writable.write(data);
            await writable.close();

            this._emit('change', { type: 'fileWritten', path });
            fsAccessLogInfo('FileSystemAccessService.writeTextFile', `Successfully wrote file: ${path}`, {
                path: path,
                size: data ? data.length : 0
            });
            return true;
        } catch (err) {
            fsAccessLogError('FileSystemAccessService.writeTextFile', err, {
                path: path,
                dataSize: data ? data.length : 0,
                severity: 'HIGH',
                category: 'FILE_SYSTEM'
            });
            throw err;
        }
    }

    /**
     * テキストファイルに追記
     */
    async appendTextFile(path, data) {
        try {
            // 既存の内容を読み込み
            const existingContent = await this.readTextFile(path);
            // 追記して書き込み
            await this.writeTextFile(path, existingContent + data);
        } catch (err) {
            if (err && err.name === 'NotFoundError') {
                // ファイルが存在しない場合は新規作成
                await this.writeTextFile(path, data);
            } else {
                throw err;
            }
        }

        return true;
    }

    /**
     * 画像ファイルを書き込み
     */
    async writeImageToFile(path, imageData) {
        // imageData は data URL または Blob
        let blob;

        if (typeof imageData === 'string' && imageData.startsWith('data:')) {
            // data URL から Blob に変換
            const response = await fetch(imageData);
            blob = await response.blob();
        } else if (imageData instanceof Blob) {
            blob = imageData;
        } else {
            throw new Error('Invalid image data format');
        }

        const fileHandle = await this._getFileHandle(path, true);
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();

        this._emit('change', { type: 'fileWritten', path });
        return true;
    }

    /**
     * ディレクトリ内のノード一覧を取得
     */
    async getNodesInDir(path, filter = {}) {
        const dirHandle = await this._getDirectoryHandle(path);
        if (!dirHandle) {
            throw new Error(`Directory not found: ${path}`);
        }

        // フィルタの正規化: 文字列の場合は { pattern: filter } に変換
        // 特殊フィルタ ":is_dir" はディレクトリのみを返す
        let filterObj;
        if (typeof filter === 'string' && filter.length > 0) {
            if (filter === ':is_dir') {
                filterObj = { dirs_only: true };
            } else {
                filterObj = { pattern: filter };
            }
        } else {
            filterObj = filter || {};
        }

        const filesOnly = !!filterObj.files_only;
        const dirsOnly = !!filterObj.dirs_only;
        const regex = filterObj.pattern instanceof RegExp
            ? filterObj.pattern
            : (filterObj.pattern ? globToRegex(filterObj.pattern) : null);

        const nodes = [];

        for await (const [name, handle] of dirHandle.entries()) {
            const isDirectory = handle.kind === 'directory';

            // フィルタ適用
            if (filesOnly && isDirectory) continue;
            if (dirsOnly && !isDirectory) continue;
            if (regex && !regex.test(name)) continue;

            const nodePath = path === '/' ? `/${name}` : `${path}/${name}`;

            nodes.push({
                name,
                path: nodePath,
                isDirectory,
                kind: handle.kind,
                handle
            });
        }

        return nodes;
    }

    /**
     * ファイルまたはディレクトリを削除
     */
    async remove(path) {
        // パスを解決してルートハンドルと相対パスを取得
        const resolved = await this._resolvePathAndHandle(path);
        const parts = this._splitPath(resolved.relativePath);

        if (parts.length === 0) {
            throw new Error('Cannot remove root directory');
        }

        const name = parts.pop();

        // 親ディレクトリハンドルを取得
        let parentHandle = resolved.rootHandle;
        try {
            for (const part of parts) {
                parentHandle = await parentHandle.getDirectoryHandle(part);
            }
        } catch (err) {
            if (err.name === 'NotFoundError') {
                throw new Error(`Parent directory not found: ${path}`);
            }
            throw err;
        }

        await parentHandle.removeEntry(name, { recursive: true });
        this._emit('change', { type: 'nodeRemoved', path });
        return true;
    }

    /**
     * ファイルまたはディレクトリを移動/リネーム
     */
    async moveTo(sourcePath, destPath) {
        // File System Access API には直接的な移動/リネーム機能がないため、
        // コピー → 削除 で実装

        const isDir = await this.node_isDir(sourcePath);

        if (isDir) {
            // ディレクトリの移動
            await this._moveDirectory(sourcePath, destPath);
        } else {
            // ファイルの移動
            await this._moveFile(sourcePath, destPath);
        }

        this._emit('change', { type: 'nodeMoved', from: sourcePath, to: destPath });
        return true;
    }

    async _copyFile(sourcePath, destPath) {
        // バイナリ/テキスト問わず安全にコピー
        const srcHandle = await this._getFileHandle(sourcePath);
        if (!srcHandle) {
            throw new Error(`File not found: ${sourcePath}`);
        }
        const file = await srcHandle.getFile();

        const dstHandle = await this._getFileHandle(destPath, true);
        const writable = await dstHandle.createWritable();
        await writable.write(file);
        await writable.close();
    }

    async _moveFile(sourcePath, destPath) {
        // ファイルをコピーして元を削除
        await this._copyFile(sourcePath, destPath);
        await this.remove(sourcePath);
    }

    async _moveDirectory(sourcePath, destPath) {
        // 再帰的にディレクトリをコピー
        await this.makeDirectory(destPath);

        const nodes = await this.getNodesInDir(sourcePath);

        for (const node of nodes) {
            // パスを適切に結合（Windows/Unix両対応）
            const newPath = this._joinPath(destPath, node.name);

            if (node.isDirectory) {
                await this._moveDirectory(node.path, newPath);
            } else {
                await this._moveFile(node.path, newPath);
            }
        }

        // 元のディレクトリを削除
        await this.remove(sourcePath);
    }

    /**
     * ファイル情報を取得
     */
    async getFileInfo(path) {
        const fileHandle = await this._getFileHandle(path);
        if (!fileHandle) {
            throw new Error(`File not found: ${path}`);
        }

        const file = await fileHandle.getFile();

        return {
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            lastModifiedDate: new Date(file.lastModified)
        };
    }

    /**
     * イベントハンドラを登録
     */
    on(event, handler) {
        if (!this.eventHandlers[event]) {
            this.eventHandlers[event] = [];
        }
        this.eventHandlers[event].push(handler);

        return () => {
            const index = this.eventHandlers[event].indexOf(handler);
            if (index > -1) {
                this.eventHandlers[event].splice(index, 1);
            }
        };
    }

    /**
     * イベントを発火
     */
    _emit(event, data) {
        if (this.eventHandlers[event]) {
            this.eventHandlers[event].forEach(handler => {
                try {
                    handler(data);
                } catch (err) {
                    fsAccessLogError(`FileSystemAccessService.${event} handler`, err);
                }
            });
        }
    }

    /**
     * ルートディレクトリをリセット
     */
    async resetRootDirectory() {
        this.rootHandle = null;
        this.rootPath = null;
        this.ready = false;

        // IndexedDBから削除
        if (this.db) {
            const transaction = this.db.transaction([IDB_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(IDB_STORE_NAME);
            await new Promise((resolve, reject) => {
                const request = store.delete('rootDirectory');
                request.onsuccess = resolve;
                request.onerror = () => reject(request.error);
            });
        }

        this._emit('change', { type: 'rootReset' });
    }

    /**
     * Windowsパスのマッピングを追加
     * ユーザーにディレクトリ選択ダイアログを表示
     */
    async addWindowsPathMapping(windowsPath) {
        if (!this.pathMappingService) {
            throw new Error('Windows path mapping is not enabled');
        }

        return await this.pathMappingService.promptForPath(windowsPath);
    }

    /**
     * Windowsパスのマッピングを削除
     */
    async removeWindowsPathMapping(windowsPath) {
        if (!this.pathMappingService) {
            throw new Error('Windows path mapping is not enabled');
        }

        return await this.pathMappingService.removeMapping(windowsPath);
    }

    /**
     * すべてのWindowsパスマッピングを取得
     */
    getAllWindowsPathMappings() {
        if (!this.pathMappingService) {
            return [];
        }

        return this.pathMappingService.getAllMappings();
    }

    /**
     * すべてのWindowsパスマッピングをクリア
     */
    async clearAllWindowsPathMappings() {
        if (!this.pathMappingService) {
            return;
        }

        return await this.pathMappingService.clearAllMappings();
    }
}

// グローバルインスタンスを作成(シングルトン)
if (typeof window !== 'undefined') {
    window.FileSystemAccessService = FileSystemAccessService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FileSystemAccessService;
}
