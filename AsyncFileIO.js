/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

/* exported afio */
// Provides access to files using Native Messaging Host technology with fallback to File System Access API and virtual filesystem
var afio = (function () {
    'use strict';

    const BACKEND_PROXY = 'proxy';
    const fio_host = 'com.ipswitch.imacros.fio';
    const BACKEND_NATIVE = 'native';
    const BACKEND_FILESYSTEM_ACCESS = 'filesystem-access';
    const BACKEND_VIRTUAL = 'virtual';
    const BACKEND_UNKNOWN = 'unknown';
    const DETECTION_BASE_TIMEOUT = 3000;
    const DETECTION_MAX_TIMEOUT = 15000;
    const NATIVE_CALL_TIMEOUT = 5000;

    const vfs = new VirtualFileService();
    let fsAccess = null; // FileSystemAccessService インスタンス

    let backend = BACKEND_UNKNOWN;


    // Helper: Proxy call to Service Worker
    function callProxy(method, payload) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                target: 'background_afio',
                command: 'AFIO_CALL',
                method: method,
                payload: payload
            }, response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (!response) {
                    reject(new Error("Empty response from AFIO proxy"));
                } else if (response.error) {
                    reject(new Error(response.error));
                } else {
                    resolve(response.result);
                }
            });
        });
    }


    let detectionPromise = null;
    let fallbackPromise = null;
    // Tracks whether fallback init should keep the current backend (e.g., when a File System Access handle exists)
    let fallbackPromisePreserveBackend = false;
    let fsAccessPromise = null;
    let detectionAttempts = 0;
    let fallbackWarningShown = false;
    let fsAccessWarningShown = false;
    // Records that a File System Access handle is present even if permission is missing
    let fsAccessHandleDetected = false;

    function canUseNativeMessaging() {
        return typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendNativeMessage === 'function';
    }

    function updateInstallationFlag(value) {
        try {
            if (typeof Storage !== 'undefined' && Storage.setBool) {
                Storage.setBool('afio-installed', !!value);
            }
        } catch (err) {
            console.warn('Failed to update afio-installed flag', err);
        }
    }

    function saveBackendType(backendType) {
        try {
            if (typeof Storage !== 'undefined' && Storage.setChar) {
                Storage.setChar('afio-backend', backendType);
                console.log('[AsyncFileIO] Saved backend type:', backendType);
            }
        } catch (err) {
            console.warn('Failed to save backend type', err);
        }
    }

    function getSavedBackendType() {
        try {
            if (typeof Storage !== 'undefined' && Storage.getChar) {
                const savedBackend = Storage.getChar('afio-backend');
                if (savedBackend) {
                    console.log('[AsyncFileIO] Found saved backend type:', savedBackend);
                }
                return savedBackend;
            }
        } catch (err) {
            console.warn('Failed to get saved backend type', err);
        }
        return null;
    }

    function logFallback(reason, error) {
        if (fallbackWarningShown) {
            return;
        }
        fallbackWarningShown = true;
        const message = 'Native file access unavailable, using virtual filesystem fallback';
        console.info('[AsyncFileIO]', message, { reason, error: error ? error.message : undefined });

        // Use GlobalErrorLogger if available
        if (typeof GlobalErrorLogger !== 'undefined') {
            GlobalErrorLogger.logInfo('AsyncFileIO.logFallback', message, {
                reason: reason || 'unknown',
                error: error ? error.message : '',
                backend: backend,
                category: 'INITIALIZATION'
            });
        } else if (typeof logInfo === 'function') {
            // Fallback to old logInfo function
            logInfo(message, { reason: reason || 'unknown', error: error ? error.message : '' });
        }
    }

    async function detectNativeHost() {
        if (!canUseNativeMessaging()) {
            // Only fallback to virtual if backend not already determined
            if (backend === BACKEND_UNKNOWN) {
                backend = BACKEND_VIRTUAL;
                updateInstallationFlag(false);
            }
            return false;
        }
        if (backend === BACKEND_NATIVE) {
            return true;
        }
        if (detectionPromise) {
            return detectionPromise;
        }
        const timeout = Math.min(DETECTION_BASE_TIMEOUT * Math.pow(2, detectionAttempts || 0), DETECTION_MAX_TIMEOUT);
        detectionAttempts += 1;
        detectionPromise = new Promise((resolve) => {
            let resolved = false;
            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    resolve(false);
                }
            }, timeout);
            try {
                chrome.runtime.sendNativeMessage(fio_host, { method: 'isInstalled', version: Storage.getChar('version') }, (response) => {
                    if (resolved) {
                        return;
                    }
                    resolved = true;
                    clearTimeout(timer);
                    if (chrome.runtime.lastError || !response) {
                        resolve(false);
                        return;
                    }
                    backend = BACKEND_NATIVE;
                    updateInstallationFlag(true);
                    saveBackendType(BACKEND_NATIVE);
                    resolve(true);
                });
            } catch (err) {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    resolve(false);
                }
            }
        }).finally(() => {
            detectionPromise = null;
        });
        return detectionPromise;
    }

    function logFsAccessInfo(message) {
        if (fsAccessWarningShown) {
            return;
        }
        fsAccessWarningShown = true;
        console.info('[AsyncFileIO]', message);
    }

    function markFsAccessHandleDetected() {
        fsAccessHandleDetected = !!(fsAccess && fsAccess.rootHandle);
    }

    function hasFsAccessHandle() {
        return fsAccessHandleDetected;
    }

    async function detectFileSystemAccess() {
        // Guard against ReferenceError when FileSystemAccessService is not loaded
        if (typeof FileSystemAccessService === 'undefined') {
            return false;
        }

        // Note: We don't check isSupported() here because even in contexts where
        // showDirectoryPicker is not available (e.g., chrome-extension://),
        // we can still use saved handles from IndexedDB

        try {
            if (!fsAccess) {
                fsAccess = new FileSystemAccessService({ autoPrompt: false });
            }

            // 既に初期化済みの場合
            if (fsAccess.ready) {
                markFsAccessHandleDetected();
                return true;
            }

            // 保存されたハンドルがあるかチェック（権限がなくても存在は記録する）
            const initialized = await fsAccess.init();

            // Track whether we have a saved handle even if permission is missing
            markFsAccessHandleDetected();

            // MV3 Fix: If we have a handle, we consider it "installed" even if permission is missing.
            // This allows the UI to attempt operations (like listing files) which will trigger
            // permission prompts when initiated by user gestures (like clicking the Files tab).
            if (fsAccess.rootHandle) {
                console.log('[AsyncFileIO] File System Access API handle found (permission may be pending)');
                // バックエンドを File System Access に切り替える
                backend = BACKEND_FILESYSTEM_ACCESS;

                // インストールフラグを true に更新
                updateInstallationFlag(true);

                // バックエンドタイプを永続化
                saveBackendType(BACKEND_FILESYSTEM_ACCESS);

                // ハンドルが存在することを記録
                markFsAccessHandleDetected();

                // ready が false でも「インストール済み」とみなすので true を返す
                return true;
            }

            // 初期化が失敗しても、保存されたハンドルがあれば true を返す
            // ユーザーが後で権限を許可できるように
            if (!initialized && fsAccess.rootHandle) {
                console.log('[AsyncFileIO] File System Access API handle found but permission not yet granted');
                backend = BACKEND_FILESYSTEM_ACCESS;
                markFsAccessHandleDetected();
                saveBackendType(BACKEND_FILESYSTEM_ACCESS);
                return true;
            }

            return initialized;
        } catch (err) {
            console.warn('FileSystemAccessService initialization failed:', err);
            // エラーでも、rootHandle があれば backend を設定して true を返す
            if (fsAccess && fsAccess.rootHandle) {
                markFsAccessHandleDetected();
                backend = BACKEND_FILESYSTEM_ACCESS;
                saveBackendType(BACKEND_FILESYSTEM_ACCESS);
                console.log('[AsyncFileIO] File System Access API handle exists despite initialization error');
                return true;
            }
            return false;
        }
    }

    async function ensureFileSystemAccessInitialized(_reason) {
        if (backend === BACKEND_FILESYSTEM_ACCESS && fsAccess) {
            // すでに初期化済み
            if (fsAccess.ready) {
                return true;
            }

            // 保存済みハンドルがあるが ready でない場合は、
            // 権限の再要求を試みる（ユーザー操作が必要）
            if (fsAccess.rootHandle && typeof fsAccess.requestPermission === 'function') {
                try {
                    console.info('[AsyncFileIO] Attempting to restore File System Access permission');
                    const granted = await fsAccess.requestPermission();
                    if (granted) {
                        backend = BACKEND_FILESYSTEM_ACCESS;
                        updateInstallationFlag(true);
                        saveBackendType(BACKEND_FILESYSTEM_ACCESS);
                        return true;
                    }
                    return false;
                } catch (err) {
                    console.warn('[AsyncFileIO] Failed to restore File System Access permission', err);
                    return false;
                }
            }
        }

        if (fsAccessPromise) {
            return fsAccessPromise;
        }

        // Guard against ReferenceError when FileSystemAccessService is not loaded
        if (typeof FileSystemAccessService === 'undefined') {
            return false;
        }

        logFsAccessInfo('Attempting to use File System Access API for local filesystem access');

        fsAccessPromise = (async () => {
            try {
                if (!fsAccess) {
                    fsAccess = new FileSystemAccessService({
                        autoPrompt: false,
                        enableWindowsPathMapping: true
                    });
                }

                const initialized = await fsAccess.init();
                markFsAccessHandleDetected();

                if (initialized && fsAccess.ready) {
                    backend = BACKEND_FILESYSTEM_ACCESS;
                    updateInstallationFlag(true);
                    saveBackendType(BACKEND_FILESYSTEM_ACCESS);
                    logFsAccessInfo('File System Access API initialized successfully');
                    return true;
                }

                return false;
            } catch (err) {
                console.warn('Failed to initialize File System Access API:', err);
                return false;
            } finally {
                fsAccessPromise = null;
            }
        })();

        return fsAccessPromise;
    }

    async function ensureFallbackInitialized(reason, error, options = {}) {
        const preserveBackend = options.preserveBackend;

        if (vfs.isReady()) {
            if (!preserveBackend && backend !== BACKEND_VIRTUAL) {
                backend = BACKEND_VIRTUAL;
            }
            return true;
        }
        if (fallbackPromise) {
            if (!preserveBackend && fallbackPromisePreserveBackend) {
                return fallbackPromise.then((result) => {
                    backend = BACKEND_VIRTUAL;
                    return result;
                });
            }
            return fallbackPromise;
        }
        fallbackPromisePreserveBackend = !!preserveBackend;
        logFallback(reason, error);
        fallbackPromise = vfs.init()
            .then(() => {
                if (!fallbackPromisePreserveBackend) {
                    backend = BACKEND_VIRTUAL;
                }
                updateInstallationFlag(true);
                return true;
            })
            .catch((err) => {
                updateInstallationFlag(false);
                throw err;
            })
            .finally(() => {
                fallbackPromise = null;
                fallbackPromisePreserveBackend = false;
            });
        return fallbackPromise;
    }

    function callNative(payload) {
        if (!canUseNativeMessaging()) {
            const error = new Error('Native messaging not available');
            if (typeof GlobalErrorLogger !== 'undefined') {
                GlobalErrorLogger.logFileError('AsyncFileIO.callNative', error, {
                    errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_BACKEND_ERROR : undefined,
                    method: payload ? payload.method : 'unknown',
                    backend: 'native'
                });
            }
            return Promise.reject(error);
        }
        return new Promise((resolve, reject) => {
            let resolved = false;
            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    const error = new Error(`Native host timeout after ${NATIVE_CALL_TIMEOUT}ms`);
                    if (typeof GlobalErrorLogger !== 'undefined') {
                        GlobalErrorLogger.logFileError('AsyncFileIO.callNative.timeout', error, {
                            errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_TIMEOUT_ERROR : undefined,
                            method: payload.method,
                            timeout: NATIVE_CALL_TIMEOUT,
                            backend: 'native'
                        });
                    }
                    reject(error);
                }
            }, NATIVE_CALL_TIMEOUT);
            try {
                chrome.runtime.sendNativeMessage(fio_host, payload, (result) => {
                    if (resolved) {
                        return;
                    }
                    resolved = true;
                    clearTimeout(timer);
                    if (chrome.runtime.lastError) {
                        if (typeof GlobalErrorLogger !== 'undefined') {
                            GlobalErrorLogger.logFileError('AsyncFileIO.callNative.runtimeError', chrome.runtime.lastError, {
                                errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_BACKEND_ERROR : undefined,
                                method: payload.method,
                                backend: 'native'
                            });
                        }
                        reject(chrome.runtime.lastError);
                    } else if (!result) {
                        const error = new Error('Empty response from native host');
                        if (typeof GlobalErrorLogger !== 'undefined') {
                            GlobalErrorLogger.logFileError('AsyncFileIO.callNative.emptyResponse', error, {
                                errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_BACKEND_ERROR : undefined,
                                method: payload.method,
                                backend: 'native'
                            });
                        }
                        reject(error);
                    } else if (result.error) {
                        const error = new Error(result.error);
                        error.nativeOperationError = true;
                        if (result.code) {
                            error.nativeErrorCode = result.code;
                        }
                        if (typeof GlobalErrorLogger !== 'undefined') {
                            GlobalErrorLogger.logFileError('AsyncFileIO.callNative.nativeError', error, {
                                errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_BACKEND_ERROR : undefined,
                                method: payload.method,
                                backend: 'native'
                            });
                        }
                        reject(error);
                    } else {
                        resolve(result);
                    }
                });
            } catch (err) {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    if (typeof GlobalErrorLogger !== 'undefined') {
                        GlobalErrorLogger.logFileError('AsyncFileIO.callNative.exception', err, {
                            errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_BACKEND_ERROR : undefined,
                            method: payload.method,
                            backend: 'native'
                        });
                    }
                    reject(err);
                }
            }
        });
    }

    async function callFsAccess(method, payload) {
        await ensureFileSystemAccessInitialized(method);

        if (!fsAccess || !fsAccess.ready) {
            const error = new Error('File System Access API is not available');
            if (typeof GlobalErrorLogger !== 'undefined') {
                GlobalErrorLogger.logFileError('AsyncFileIO.callFsAccess', error, {
                    errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_BACKEND_ERROR : undefined,
                    method: method,
                    backend: backend
                });
            }
            throw error;
        }

        switch (method) {
            case 'node_exists':
                return { exists: await fsAccess.node_exists(payload.node._path) };
            case 'node_isDir':
                return { isDir: await fsAccess.node_isDir(payload.node._path) };
            case 'node_isWritable':
                // File System Access API では常に書き込み可能(許可が必要)
                return { isWritable: await fsAccess.node_exists(payload.node._path) };
            case 'node_isReadable':
                // File System Access API では常に読み取り可能(許可が必要)
                return { isReadable: await fsAccess.node_exists(payload.node._path) };
            case 'node_copyTo': {
                // ファイルのバイナリコピー（ディレクトリは未対応）
                const isDir = await fsAccess.node_isDir(payload.src._path);
                if (isDir) {
                    throw new Error('Directory copy not yet supported in File System Access API');
                }
                await fsAccess._copyFile(payload.src._path, payload.dst._path);
                return {};
            }
            case 'node_moveTo':
                await fsAccess.moveTo(payload.src._path, payload.dst._path);
                return {};
            case 'node_remove':
                await fsAccess.remove(payload.node._path);
                return {};
            case 'readTextFile':
                return { data: await fsAccess.readTextFile(payload.node._path) };
            case 'writeTextFile':
                await fsAccess.writeTextFile(payload.node._path, payload.data);
                return {};
            case 'appendTextFile':
                await fsAccess.appendTextFile(payload.node._path, payload.data);
                return {};
            case 'getNodesInDir': {
                const nodes = await fsAccess.getNodesInDir(payload.node._path, payload.filter);
                // VirtualFileService の形式に変換
                return {
                    nodes: nodes.map(n => ({
                        _path: n.path,
                        _is_dir_int: n.isDirectory ? 1 : 0
                    }))
                };
            }
            case 'getLogicalDrives':
                // File System Access API にはドライブ列挙がないため、ルートのみ返す
                return { nodes: [{ _path: '/', _is_dir_int: 1 }] };
            case 'getDefaultDir':
                // デフォルトディレクトリはルートディレクトリ
                return { node: { _path: '/' } };
            case 'makeDirectory':
                await fsAccess.makeDirectory(payload.node._path);
                return {};
            case 'writeImageToFile': {
                // Convert {image, encoding, mimeType} to data URL format
                const imageData = payload.imageData;
                let dataUrl;

                if (typeof imageData === 'string' && imageData.startsWith('data:')) {
                    // Already a data URL
                    dataUrl = imageData;
                } else if (imageData && imageData.image && imageData.encoding && imageData.mimeType) {
                    // Convert to data URL: data:<mimeType>;<encoding>,<image>
                    dataUrl = `data:${imageData.mimeType};${imageData.encoding},${imageData.image}`;
                } else {
                    throw new Error('Invalid image data format for File System Access API');
                }

                await fsAccess.writeImageToFile(payload.node._path, dataUrl);
                return {};
            }
            case 'queryLimits':
                // File System Access API には制限がない(ディスク容量による)
                return {
                    maxFileSize: Number.MAX_SAFE_INTEGER,
                    maxStorageSize: Number.MAX_SAFE_INTEGER,
                    currentUsage: 0
                };
            default:
                throw new Error('Unsupported File System Access method: ' + method);
        }
    }

    async function callFallback(method, payload) {
        await ensureFallbackInitialized(method);
        switch (method) {
            case 'node_exists':
                return { exists: await vfs.node_exists(payload.node._path) };
            case 'node_isDir':
                return { isDir: await vfs.node_isDir(payload.node._path) };
            case 'node_isWritable':
                return { isWritable: await vfs.node_isWritable(payload.node._path) };
            case 'node_isReadable':
                return { isReadable: await vfs.node_isReadable(payload.node._path) };
            case 'node_copyTo':
                await vfs.node_copyTo(payload.src._path, payload.dst._path);
                return {};
            case 'node_moveTo':
                await vfs.node_moveTo(payload.src._path, payload.dst._path);
                return {};
            case 'node_remove':
                await vfs.node_remove(payload.node._path);
                return {};
            case 'readTextFile':
                return { data: await vfs.readTextFile(payload.node._path) };
            case 'writeTextFile':
                await vfs.writeTextFile(payload.node._path, payload.data);
                return {};
            case 'appendTextFile':
                await vfs.appendTextFile(payload.node._path, payload.data);
                return {};
            case 'getNodesInDir':
                return { nodes: await vfs.getNodesInDir(payload.node._path, payload.filter) };
            case 'getLogicalDrives':
                return { nodes: await vfs.getLogicalDrives() };
            case 'getDefaultDir':
                return { node: await vfs.getDefaultDir(payload.name) };
            case 'makeDirectory':
                await vfs.makeDirectory(payload.node._path);
                return {};
            case 'writeImageToFile':
                await vfs.writeImageToFile(payload.node._path, payload.imageData);
                return {};
            case 'queryLimits':
                return await vfs.queryLimits();
            default:
                throw new Error('Unsupported fallback method: ' + method);
        }
    }

    // Helper to check if a path is a virtual path
    function isVirtualPath(path) {
        return path && typeof path === 'string' && path.startsWith('/VirtualMacros/');
    }

    // Helper to extract path from payload
    function getPathFromPayload(payload) {
        if (payload.node && payload.node._path) {
            return payload.node._path;
        }
        if (payload.src && payload.src._path) {
            return payload.src._path;
        }
        if (payload.dst && payload.dst._path) {
            return payload.dst._path;
        }
        return null;
    }

    async function callFileIO(method, payload) {
        // Wait for backend initialization to complete
        if (_backendInit) {
            await _backendInit;
        }

        // Check if the path is a virtual path - always route to virtual filesystem
        const path = getPathFromPayload(payload);
        if (isVirtualPath(path)) {
            await ensureFallbackInitialized('virtual-path');
            return callFallback(method, payload);
        }

        if (backend === BACKEND_UNKNOWN) {
            // Check for Proxy Capability (Offscreen with SW) first
            // If native messaging is NOT available (which is true in Offscreen), but we are in an extension context
            if (typeof chrome !== 'undefined' && chrome.runtime && !chrome.runtime.sendNativeMessage &&
                typeof location !== 'undefined' && location.pathname && location.pathname.endsWith('offscreen.html')) {
                console.log('[AsyncFileIO] Offscreen context detected, using Proxy backend');
                backend = BACKEND_PROXY;
                saveBackendType(BACKEND_PROXY);
            }

            if (backend === BACKEND_UNKNOWN) {
                // 優先順位: Native → FileSystemAccess → Virtual
                const nativeAvailable = await detectNativeHost();

                if (nativeAvailable) {
                    backend = BACKEND_NATIVE;
                } else {
                    // ネイティブが使えない場合、File System Access APIを試す
                    const fsAccessAvailable = await detectFileSystemAccess();
                    const handleDetected = hasFsAccessHandle();

                    if (fsAccessAvailable || handleDetected) {
                        backend = BACKEND_FILESYSTEM_ACCESS;
                        if (!fsAccessAvailable && handleDetected) {
                            console.warn('[AsyncFileIO] File System Access handle detected but permission is required; will attempt to restore');
                        }
                    } else {
                        // どちらも使えない場合は仮想ファイルシステム
                        backend = BACKEND_VIRTUAL;
                        await ensureFallbackInitialized('initialization');
                    }
                }
            }
        }

        // Proxy バックエンドを使用
        if (backend === BACKEND_PROXY) {
            return await callProxy(method, payload);
        }

        // Native バックエンドを使用
        if (backend === BACKEND_NATIVE) {
            try {
                return await callNative(payload);
            } catch (err) {
                if (err && err.nativeOperationError) {
                    throw err;
                }
                console.warn('Native host call failed, trying File System Access API', err);

                // File System Access APIにフォールバック
                const fsAccessAvailable = await detectFileSystemAccess();

                if (fsAccessAvailable) {
                    backend = BACKEND_FILESYSTEM_ACCESS;
                    return await callFsAccess(method, payload);
                }

                // File System Access APIも使えない場合は仮想ファイルシステム
                console.warn('File System Access API not available, switching to virtual filesystem');
                backend = BACKEND_VIRTUAL;
                await ensureFallbackInitialized(method, err);
                return await callFallback(method, payload);
            }
        }

        if (backend === BACKEND_FILESYSTEM_ACCESS) {
            try {
                const ready = await ensureFileSystemAccessInitialized(method);
                if (!ready) {
                    throw new Error('File System Access API not ready');
                }
                return await callFsAccess(method, payload);
            } catch (err) {
                const hasHandle = hasFsAccessHandle();
                const preserveBackend = hasHandle;
                if (hasHandle) {
                    console.warn('[AsyncFileIO] File System Access API not ready - falling back to virtual filesystem while keeping saved handle', err);
                    // Keep detection open so a later call can retry permission restoration
                    backend = BACKEND_UNKNOWN;
                } else {
                    console.warn('File System Access API not available, switching to virtual filesystem', err);
                    backend = BACKEND_VIRTUAL;
                }
                await ensureFallbackInitialized(method, err, { preserveBackend });
                return await callFallback(method, payload);
            }
        }

        // Virtual バックエンドを使用
        return callFallback(method, payload);
    }

    function NodeObject(transferrable_node) {
        if (!transferrable_node || !transferrable_node._path)
            throw new Error('NodeObject cannot be constructed');
        this._path = transferrable_node._path;
        if (typeof (transferrable_node._is_dir_int) !== 'undefined')
            this._is_dir_int = transferrable_node._is_dir_int;
    }

    Object.defineProperty(NodeObject.prototype, 'path', {
        configurable: true,
        enumerable: false,
        get: function () {
            return this._path;
        }
    });

    Object.defineProperty(NodeObject.prototype, 'leafName', {
        configurable: true,
        enumerable: false,
        get: function () {
            if (__is_windows()) {
                if (/^[a-z]:\\?$/i.test(this._path))
                    return '';
            } else {
                if (this._path === '/')
                    return '';
            }
            // Virtual paths (starting with /) always use / as separator
            const sep = this._path.startsWith('/') ? '/' : __psep();
            return this._path.split(sep).pop();
        }
    });

    Object.defineProperty(NodeObject.prototype, 'parent', {
        configurable: true,
        enumerable: false,
        get: function () {
            // Handle root path for virtual filesystem (works on all platforms)
            if (this._path === '/') {
                return new NodeObject({ _path: this._path });
            }
            // Handle Windows drive root
            if (__is_windows() && /^[a-z]:\\?$/i.test(this._path)) {
                return new NodeObject({ _path: this._path });
            }
            // Virtual paths (starting with /) always use / as separator
            const sep = this._path.startsWith('/') ? '/' : __psep();
            var a = this._path.split(sep); a.pop();
            if (a.length === 1 && a[0] === '') {
                // This is a child of root, so parent is '/'
                a[0] = '/';
            } else if (__is_windows() && a.length === 1 && /^[a-z]:$/i.test(a[0])) {
                a[0] += '\\';
            } else if (a.length === 0) {
                // Edge case: empty path after split/pop, fallback to root
                return new NodeObject({ _path: '/' });
            }
            return new NodeObject({ _path: a.join(sep) });
        }
    });

    Object.defineProperty(NodeObject.prototype, 'isDirCached', {
        configurable: true,
        enumerable: false,
        get: function () {
            return typeof (this._is_dir_int) !== 'undefined';
        }
    });

    Object.defineProperty(NodeObject.prototype, 'is_dir', {
        configurable: true,
        enumerable: false,
        get: function () {
            return this._is_dir_int;
        }
    });

    NodeObject.prototype.exists = async function () {
        const result = await callFileIO('node_exists', {
            method: 'node_exists',
            node: this
        });
        return result.exists;
    };

    NodeObject.prototype.isDir = async function () {
        if (this.isDirCached) {
            return this.is_dir;
        }

        // File System Access API backend
        if (backend === BACKEND_FILESYSTEM_ACCESS && fsAccess && fsAccess.rootHandle) {
            try {
                const resolved = await fsAccess._resolvePathAndHandle(this._path);
                if (resolved && resolved.rootHandle) {
                    // Use the public API to check if it's a directory
                    return await fsAccess.node_isDir(this._path);
                }
            } catch (err) {
                console.warn('[AsyncFileIO] isDir check failed for FSA:', err);
                return false;
            }
        }

        // Native host backend
        const result = await callFileIO('node_isDir', {
            method: 'node_isDir',
            node: this
        });
        return result.isDir;
    };

    NodeObject.prototype.isWritable = async function () {
        const result = await callFileIO('node_isWritable', {
            method: 'node_isWritable',
            node: this
        });
        return result.isWritable;
    };

    NodeObject.prototype.isReadable = async function () {
        const result = await callFileIO('node_isReadable', {
            method: 'node_isReadable',
            node: this
        });
        return result.isReadable;
    };

    NodeObject.prototype.createDirectory = async function () {
        await callFileIO('makeDirectory', {
            method: 'makeDirectory',
            node: this
        });
    };

    NodeObject.prototype.append = function (bit) {
        // Virtual paths (starting with /) always use / as separator
        const sep = this._path.startsWith('/') ? '/' : __psep();
        while (bit[0] === sep)
            bit = bit.substring(1);
        this._path += this._path[this._path.length - 1] === sep ?
            bit : sep + bit;
    };

    NodeObject.prototype.clone = function () {
        return new NodeObject({ _path: this._path, _is_dir_int: this._is_dir_int });
    };

    NodeObject.prototype.copyTo = async function (node) {
        if (!node) {
            throw new Error('NodeObject.copyTo() no dest node provided');
        }
        await callFileIO('node_copyTo', {
            method: 'node_copyTo',
            src: this,
            dst: node
        });
    };

    NodeObject.prototype.moveTo = async function (node) {
        if (!node) {
            throw new Error('NodeObject.moveTo() no dest node provided');
        }
        await callFileIO('node_moveTo', {
            method: 'node_moveTo',
            src: this,
            dst: node
        });
    };

    NodeObject.prototype.remove = async function () {
        await callFileIO('node_remove', {
            method: 'node_remove',
            node: this
        });
    };

    var obj = {};

    obj.reinitFileSystem = async function () {
        if (fsAccess) {
            return await fsAccess.init();
        }
        return await detectFileSystemAccess();
    };

    obj.isInstalled = async function () {
        // Wait for backend initialization to complete to avoid race conditions
        if (_backendInit) {
            await _backendInit;
        }

        if (backend === BACKEND_NATIVE) {
            return true;
        }
        if (backend === BACKEND_FILESYSTEM_ACCESS && fsAccess && fsAccess.ready) {
            return true;
        }
        if (backend === BACKEND_FILESYSTEM_ACCESS && (hasFsAccessHandle() || (fsAccess && fsAccess.rootHandle))) {
            // If we have a handle, check if we need to restore permission
            if (fsAccess && fsAccess.rootHandle && !fsAccess.ready) {
                // Await fallback initialization to prevent unhandled promise rejections
                // This ensures virtual filesystem is ready while preserving the FSA backend setting
                try {
                    await ensureFallbackInitialized('isInstalled', null, { preserveBackend: true });
                } catch (e) {
                    console.warn('[AsyncFileIO] Background permission check failed:', e);
                }
            }
            return true;
        }
        if (backend === BACKEND_VIRTUAL && vfs.isReady()) {
            return true;
        }
        const nativeAvailable = await detectNativeHost();
        if (nativeAvailable) {
            return true;
        }
        try {
            await ensureFallbackInitialized('isInstalled');
            return true;
        } catch (err) {
            console.error('Failed to initialize virtual filesystem', err);
            return false;
        }
    };

    obj.queryLimits = async function () {
        const result = await callFileIO('queryLimits', {
            method: 'queryLimits'
        });
        return result;
    };

    obj.openNode = function (path) {
        if (!path) {
            const error = new Error('afio.openNode() no path provided');
            if (typeof GlobalErrorLogger !== 'undefined') {
                GlobalErrorLogger.logFileError('AsyncFileIO.openNode', error, {
                    errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_PATH_INVALID : undefined
                });
            }
            throw error;
        }
        if (typeof path !== 'string') {
            const error = new Error('afio.openNode() path must be a string');
            if (typeof GlobalErrorLogger !== 'undefined') {
                GlobalErrorLogger.logFileError('AsyncFileIO.openNode', error, {
                    errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_PATH_INVALID : undefined,
                    providedType: typeof path
                });
            }
            throw error;
        }
        return new NodeObject({ _path: path });
    };

    obj.readTextFile = async function (node) {
        if (!node) {
            const error = new Error('afio.readTextFile() no file node provided');
            if (typeof GlobalErrorLogger !== 'undefined') {
                GlobalErrorLogger.logFileError('AsyncFileIO.readTextFile', error, {
                    errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_PATH_INVALID : undefined
                });
            }
            throw error;
        }
        if (!node._path) {
            const error = new Error('afio.readTextFile() invalid node - missing _path');
            if (typeof GlobalErrorLogger !== 'undefined') {
                GlobalErrorLogger.logFileError('AsyncFileIO.readTextFile', error, {
                    errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_PATH_INVALID : undefined,
                    nodeType: typeof node,
                    hasPath: node && '_path' in node
                });
            }
            throw error;
        }
        try {
            const result = await callFileIO('readTextFile', {
                method: 'readTextFile',
                node: node
            });
            return result.data;
        } catch (err) {
            if (typeof GlobalErrorLogger !== 'undefined') {
                GlobalErrorLogger.logFileError('AsyncFileIO.readTextFile', err, {
                    errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_READ_ERROR : undefined,
                    path: node._path,
                    backend: backend
                });
            }
            throw err;
        }
    };

    // Read binary file as Base64 data URL (for images, etc.)
    obj.readBinaryFile = async function (node) {
        if (!node) {
            throw new Error('afio.readBinaryFile() no file node provided');
        }
        if (!node._path) {
            throw new Error('afio.readBinaryFile() invalid node - missing _path');
        }

        try {
            // Use File System Access API if available
            if (backend === 'filesystem-access' && fsAccess && fsAccess.ready) {
                const fileContent = await fsAccess.readBinaryFile(node._path);
                return fileContent; // Returns base64 data URL
            }

            // Fallback: try to read as text and assume it's already base64
            // or use the file path directly as image source
            const filePath = node._path;

            // For local file paths, create a file:// URL (works in some contexts)
            if (/^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('/')) {
                // Convert to file:// URL
                let fileUrl = filePath;
                if (!filePath.startsWith('file://')) {
                    fileUrl = 'file://' + (filePath.startsWith('/') ? '' : '/') + filePath.replace(/\\/g, '/');
                }
                return fileUrl;
            }

            throw new Error('Cannot read binary file: ' + filePath);
        } catch (err) {
            if (typeof GlobalErrorLogger !== 'undefined') {
                GlobalErrorLogger.logFileError('AsyncFileIO.readBinaryFile', err, {
                    path: node._path,
                    backend: backend
                });
            }
            throw err;
        }
    };

    obj.writeTextFile = async function (node, data) {
        if (!node) {
            const error = new Error('afio.writeTextFile() no file node provided');
            if (typeof GlobalErrorLogger !== 'undefined') {
                GlobalErrorLogger.logFileError('AsyncFileIO.writeTextFile', error, {
                    errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_PATH_INVALID : undefined
                });
            }
            throw error;
        }
        if (!node._path) {
            const error = new Error('afio.writeTextFile() invalid node - missing _path');
            if (typeof GlobalErrorLogger !== 'undefined') {
                GlobalErrorLogger.logFileError('AsyncFileIO.writeTextFile', error, {
                    errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_PATH_INVALID : undefined,
                    nodeType: typeof node,
                    hasPath: node && '_path' in node
                });
            }
            throw error;
        }
        const safeData = String(typeof data === 'undefined' ? '' : data);
        try {
            await callFileIO('writeTextFile', {
                method: 'writeTextFile',
                node: node,
                data: safeData
            });
        } catch (err) {
            if (typeof GlobalErrorLogger !== 'undefined') {
                GlobalErrorLogger.logFileError('AsyncFileIO.writeTextFile', err, {
                    errorCode: GlobalErrorLogger.FILE_ERROR_CODES ? GlobalErrorLogger.FILE_ERROR_CODES.FILE_WRITE_ERROR : undefined,
                    path: node._path,
                    backend: backend,
                    dataLength: safeData.length
                });
            }
            throw err;
        }
    };

    obj.appendTextFile = async function (node, data) {
        if (!node) {
            throw new Error('afio.appendTextFile() no file provided');
        }
        const safeData = String(typeof data === 'undefined' ? '' : data);
        await callFileIO('appendTextFile', {
            method: 'appendTextFile',
            node: node,
            data: safeData
        });
    };

    obj.getNodesInDir = async function (node, filter) {
        if (!node) {
            throw new Error('afio.getNodesInDir() no file node provided');
        }
        const isDir = await node.isDir();
        if (!isDir) {
            throw new Error('afio.getNodesInDir() node is not a directory');
        }
        const req = { method: 'getNodesInDir', node: node };
        if (typeof filter === 'string') {
            req.filter = filter;
        }
        const result = await callFileIO('getNodesInDir', req);
        const nodes = result.nodes.map(function (x) {
            return new NodeObject(x);
        });
        if (typeof filter === 'function') {
            return nodes.filter(filter);
        }
        return nodes;
    };

    obj.getLogicalDrives = async function () {
        const result = await callFileIO('getLogicalDrives', {
            method: 'getLogicalDrives'
        });
        return result.nodes.map(function (x) {
            return new NodeObject(x);
        });
    };

    obj.getDefaultDir = async function (name) {
        if (!/^(?:downpath|datapath|logpath|savepath)$/.test(name)) {
            throw new Error('afio.getDefaultDir() wrong dir name ' + name);
        }

        // Wait for localStorage polyfill to initialize in MV3 service worker environment
        if (globalThis.localStorageInitPromise) {
            await globalThis.localStorageInitPromise;
        }

        if (localStorage['def' + name]) {
            return this.openNode(localStorage['def' + name]);
        }
        const result = await callFileIO('getDefaultDir', {
            method: 'getDefaultDir',
            name: name
        });
        return new NodeObject(result.node);
    };

    obj.makeDirectory = async function (node) {
        if (!node) {
            throw new Error('afio.makeDirectory() node is not provided');
        }
        await callFileIO('makeDirectory', {
            method: 'makeDirectory',
            node: node
        });
    };

    obj.writeImageToFile = async function (node, data) {
        if (!node) {
            throw new Error('afio.writeImageToFile() node is not provided');
        }
        if (!data || !data.image || !data.encoding || !data.mimeType) {
            throw new Error('afio.writeImageToFile() imageData is not provided or has wrong type');
        }
        await callFileIO('writeImageToFile', {
            method: 'writeImageToFile',
            node: node,
            imageData: data
        });
    };

    obj.watchPath = function (path, handler) {
        if (!path || typeof handler !== 'function' || typeof vfs.watchPath !== 'function') {
            return function noop() { };
        }
        return vfs.watchPath(path, handler);
    };

    obj.getBackendType = function () {
        return backend;
    };

    obj.promptForFileSystemAccess = async function () {
        // Guard against ReferenceError when FileSystemAccessService is not loaded
        if (typeof FileSystemAccessService === 'undefined' || !FileSystemAccessService.isSupported()) {
            throw new Error('File System Access API is not supported in this browser');
        }

        if (!fsAccess) {
            fsAccess = new FileSystemAccessService({
                autoPrompt: true,
                enableWindowsPathMapping: true
            });
        }

        const initialized = await fsAccess.promptForDirectory();

        if (initialized) {
            backend = BACKEND_FILESYSTEM_ACCESS;
            updateInstallationFlag(true);
            saveBackendType(BACKEND_FILESYSTEM_ACCESS);
            markFsAccessHandleDetected();

            // Save default save path for File System Access API
            // Wait for localStorage polyfill to initialize in MV3 service worker environment
            if (globalThis.localStorageInitPromise) {
                await globalThis.localStorageInitPromise;
            }

            // Set default save path to root of selected directory
            if (typeof localStorage !== 'undefined') {
                localStorage['defsavepath'] = '/';
                console.log('[AsyncFileIO] Set defsavepath to "/" for File System Access API');
            }

            return true;
        }

        return false;
    };

    obj.requestFileSystemAccessPermission = async function () {
        // Guard against ReferenceError when FileSystemAccessService is not loaded
        if (typeof FileSystemAccessService === 'undefined' || !FileSystemAccessService.isSupported()) {
            throw new Error('File System Access API is not supported in this browser');
        }

        if (!fsAccess || !fsAccess.rootHandle) {
            console.warn('[AsyncFileIO] No saved File System Access API handle found, use promptForFileSystemAccess instead');
            return await this.promptForFileSystemAccess();
        }

        const granted = await fsAccess.requestPermission();

        if (granted) {
            backend = BACKEND_FILESYSTEM_ACCESS;
            updateInstallationFlag(true);
            console.log('[AsyncFileIO] File System Access API permission granted');
            return true;
        }

        return false;
    };

    obj.resetFileSystemAccess = async function () {
        if (fsAccess) {
            await fsAccess.resetRootDirectory();
            fsAccess = null;
        }

        fsAccessHandleDetected = false;

        // Clear saved backend type and default path
        saveBackendType('');
        if (typeof localStorage !== 'undefined' && localStorage['defsavepath'] === '/') {
            delete localStorage['defsavepath'];
        }

        // バックエンドを再検出
        backend = BACKEND_UNKNOWN;
    };

    obj.isFileSystemAccessSupported = function () {
        return typeof FileSystemAccessService !== 'undefined' && FileSystemAccessService.isSupported();
    };

    obj.isWindowsPathMappingSupported = function () {
        return typeof WindowsPathMappingService !== 'undefined' && WindowsPathMappingService.isSupported();
    };

    obj.addWindowsPathMapping = async function (windowsPath) {
        // Auto-initialize File System Access API if needed
        if (!fsAccess) {
            const initialized = await ensureFileSystemAccessInitialized('addWindowsPathMapping');
            if (!initialized) {
                throw new Error(
                    'Failed to initialize File System Access API. ' +
                    'Your browser may not support it (Chrome 86+ required), or user cancelled the directory selection. ' +
                    'Alternatively, you can call afio.promptForFileSystemAccess() first.'
                );
            }
        }

        return await fsAccess.addWindowsPathMapping(windowsPath);
    };

    obj.removeWindowsPathMapping = async function (windowsPath) {
        // Auto-initialize File System Access API if needed
        if (!fsAccess) {
            const initialized = await ensureFileSystemAccessInitialized('removeWindowsPathMapping');
            if (!initialized) {
                throw new Error(
                    'Failed to initialize File System Access API. ' +
                    'Your browser may not support it (Chrome 86+ required), or user cancelled the directory selection. ' +
                    'Alternatively, you can call afio.promptForFileSystemAccess() first.'
                );
            }
        }

        return await fsAccess.removeWindowsPathMapping(windowsPath);
    };

    obj.getAllWindowsPathMappings = function () {
        if (!fsAccess) {
            return [];
        }

        return fsAccess.getAllWindowsPathMappings();
    };

    obj.clearAllWindowsPathMappings = async function () {
        // Auto-initialize File System Access API if needed
        if (!fsAccess) {
            const initialized = await ensureFileSystemAccessInitialized('clearAllWindowsPathMappings');
            if (!initialized) {
                throw new Error(
                    'Failed to initialize File System Access API. ' +
                    'Your browser may not support it (Chrome 86+ required), or user cancelled the directory selection. ' +
                    'Alternatively, you can call afio.promptForFileSystemAccess() first.'
                );
            }
        }

        return await fsAccess.clearAllWindowsPathMappings();
    };

    obj._vfs = vfs;
    obj._fsAccess = fsAccess;
    obj._useFallback = function () { return backend === BACKEND_VIRTUAL; };
    obj._useFileSystemAccess = function () { return backend === BACKEND_FILESYSTEM_ACCESS; };

    // Initialize backend based on saved preferences
    const _backendInit = (async function initializeBackend() {
        // Prevent re-initialization if backend already determined
        if (backend !== BACKEND_UNKNOWN) {
            console.info('[AsyncFileIO] Backend already initialized as', backend);
            return;
        }
        try {
            // ★FIX: Wait for localStorage polyfill to initialize in MV3 service worker environment
            // Add timeout to prevent indefinite blocking if polyfill promise hangs
            if (globalThis.localStorageInitPromise) {
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('localStorage polyfill timeout')), 10000);
                });
                try {
                    await Promise.race([globalThis.localStorageInitPromise, timeoutPromise]);
                    console.log('[AsyncFileIO] localStorage polyfill ready');
                } catch (timeoutErr) {
                    console.warn('[AsyncFileIO] localStorage polyfill wait timed out, proceeding with fallback:', timeoutErr);
                }
            }

            let savedBackend = getSavedBackendType();
            console.log('[AsyncFileIO] savedBackend after polyfill:', savedBackend);

            // ★FIX: Fallback - if polyfill didn't return a value, read directly from chrome.storage.local
            // Try multiple possible key formats for compatibility
            if (!savedBackend && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                try {
                    const result = await new Promise((resolve, reject) => {
                        chrome.storage.local.get(null, data => {
                            if (chrome.runtime && chrome.runtime.lastError) {
                                reject(chrome.runtime.lastError);
                            } else {
                                resolve(data || {});
                            }
                        });
                    });

                    // Try multiple key formats (prefix used by background.js polyfill)
                    const possibleKeys = [
                        '__imacros_ls__:afio-backend',  // Current polyfill prefix
                        'localStorage_afio-backend',    // Legacy format
                        'afio-backend'                   // Direct key
                    ];

                    for (const key of possibleKeys) {
                        if (result && result[key]) {
                            savedBackend = result[key];
                            console.info('[AsyncFileIO] Fallback retrieved backend from chrome.storage.local with key:', key, '=', savedBackend);
                            break;
                        }
                    }

                    if (!savedBackend) {
                        console.log('[AsyncFileIO] No saved backend found in chrome.storage.local, will detect backend');
                    }
                } catch (e) {
                    console.warn('[AsyncFileIO] Fallback retrieval of backend failed:', e);
                }
            }

            // If File System Access API was previously used, try to restore it
            if (savedBackend === BACKEND_FILESYSTEM_ACCESS) {
                console.log('[AsyncFileIO] Attempting to restore File System Access API backend');
                const available = await detectFileSystemAccess();
                if (available) {
                    backend = BACKEND_FILESYSTEM_ACCESS;
                    updateInstallationFlag(true);
                    saveBackendType(BACKEND_FILESYSTEM_ACCESS);
                    console.info('[AsyncFileIO] Restored File System Access API backend (saved handle)');
                    return; // Prevent further fallback logic
                } else if (hasFsAccessHandle()) {
                    backend = BACKEND_FILESYSTEM_ACCESS;
                    updateInstallationFlag(true);
                    saveBackendType(BACKEND_FILESYSTEM_ACCESS);
                    console.warn('[AsyncFileIO] File System Access handle detected but permission is required');
                    return;
                } else {
                    // In Service Worker context, we cannot access IndexedDB handles created in other contexts
                    // Trust the saved backend type and set it anyway
                    console.warn('[AsyncFileIO] Failed to detect File System Access handle (likely Service Worker context), but backend type is saved as filesystem-access');
                    backend = BACKEND_FILESYSTEM_ACCESS;
                    updateInstallationFlag(true);
                    console.info('[AsyncFileIO] Using File System Access API backend (based on saved preference)');
                    return;
                }
                // If backend already set to File System Access, skip further detection
                if (backend === BACKEND_FILESYSTEM_ACCESS) {
                    return; // backend already determined
                }
            }

            // If backend already determined as File System Access, skip further detection
            if (backend === BACKEND_FILESYSTEM_ACCESS) {
                return; // backend already set, no need to detect native host
            }
            // Try native host
            const nativeAvailable = await detectNativeHost();
            if (nativeAvailable) {
                return;
            }

            // If native failed and we haven't tried File System Access yet, try it now
            if (savedBackend !== BACKEND_FILESYSTEM_ACCESS) {
                const fsAccessAvailable = await detectFileSystemAccess();
                if (fsAccessAvailable) {
                    backend = BACKEND_FILESYSTEM_ACCESS;
                    updateInstallationFlag(true);
                    console.info('[AsyncFileIO] Using File System Access API backend');
                    return;
                }
            }

            // Fall back to virtual filesystem
            console.info('[AsyncFileIO] Using virtual filesystem (native host not installed, File System Access not configured)');
            await ensureFallbackInitialized('initialization');
        } catch (err) {
            console.error('[AsyncFileIO] Backend initialization failed', err);
            await ensureFallbackInitialized('initialization', err);
        }
    })();
    obj._initPromise = _backendInit;
    obj.isReady = function () {
        if (backend === BACKEND_FILESYSTEM_ACCESS) {
            return fsAccess && fsAccess.ready;
        }
        return true;
    };

    return obj;
})();
