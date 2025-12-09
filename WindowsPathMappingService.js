/**
 * WindowsPathMappingService.js
 *
 * Windowsの実際のパス（C:\Users\...など）をFile System Access APIで
 * 選択したディレクトリにマッピングして管理するサービス
 *
 * 機能:
 * - Windowsの実パスを検出
 * - パスに対応するディレクトリハンドルを管理
 * - 複数のパスマッピングをIndexedDBに永続化
 * - ユーザーにディレクトリ選択を促す
 */

// IndexedDB設定
const PATH_MAPPING_IDB_NAME = 'iMacrosPathMapping';
const PATH_MAPPING_IDB_VERSION = 1;
const PATH_MAPPING_STORE_NAME = 'pathMappings';

/**
 * file:// URI形式のパスをWindowsパスに変換
 * 例: file:///C:/Users/... -> C:/Users/...
 */
function stripFileUriPrefix(path) {
    if (!path) return '';

    // 文字列化して余分な空白を除去
    let normalized = String(path).trim();

    // file:/// または file:// プレフィックスを大文字小文字を無視して削除
    const filePrefixMatch = normalized.match(/^file:\/\//i);
    if (filePrefixMatch) {
        normalized = normalized.substring(filePrefixMatch[0].length);
        // file:///C:/... のようにスラッシュが残る場合を考慮して先頭のスラッシュを1つだけ許容
        if (normalized.startsWith('/')) {
            normalized = normalized.replace(/^\/+/, '');
        }
    }

    return normalized;
}

/**
 * Windowsパスを正規化（大文字小文字を統一、スラッシュを統一）
 */
function normalizeWindowsPath(path) {
    if (!path) return '';

    // file:// URI形式の場合は変換
    path = stripFileUriPrefix(path);

    // バックスラッシュをスラッシュに変換
    let normalized = path.replace(/\\/g, '/');

    // 連続スラッシュを1つにまとめる（UNCパスは想定しないため単純圧縮でOK）
    normalized = normalized.replace(/\/+/g, '/');

    // 末尾のスラッシュを削除
    if (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }

    // Windowsパスは大文字小文字を区別しないため、小文字に統一
    normalized = normalized.toLowerCase();

    return normalized;
}

/**
 * パスがWindowsの絶対パスかどうかを判定
 * 例: C:\Users\..., D:\Documents\..., file:///C:/Users/...
 */
function isWindowsAbsolutePath(path) {
    if (!path) return false;

    // file:// URI形式の場合は変換
    path = stripFileUriPrefix(path);

    // C:\ や C:/ の形式
    return /^[a-z]:[/\\]/i.test(path);
}

/**
 * 2つのパスのうち、一方が他方の親パスかどうかを判定
 */
function isParentPath(parentPath, childPath) {
    const normalizedParent = normalizeWindowsPath(parentPath);
    const normalizedChild = normalizeWindowsPath(childPath);

    if (normalizedParent === normalizedChild) {
        return true;
    }

    return normalizedChild.startsWith(normalizedParent + '/');
}

/**
 * パスから相対パスを計算
 */
function getRelativePath(basePath, fullPath) {
    const normalizedBase = normalizeWindowsPath(basePath);
    const normalizedFull = normalizeWindowsPath(fullPath);

    if (normalizedBase === normalizedFull) {
        return '';
    }

    if (!normalizedFull.startsWith(normalizedBase + '/')) {
        return null; // 関係ないパス
    }

    return normalizedFull.substring(normalizedBase.length + 1);
}

class WindowsPathMappingService {
    constructor(options = {}) {
        this.db = null;
        this.mappings = new Map(); // normalizedPath -> { originalPath, handle, timestamp }
        this.options = {
            autoPrompt: options.autoPrompt !== false,
            ...options
        };
    }

    /**
     * ブラウザがFile System Access APIをサポートしているかチェック
     */
    static isSupported() {
        return typeof window !== 'undefined' &&
            'showDirectoryPicker' in window;
    }

    /**
     * IndexedDBを初期化
     */
    async _initDB() {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(PATH_MAPPING_IDB_NAME, PATH_MAPPING_IDB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(PATH_MAPPING_STORE_NAME)) {
                    // normalizedPathをキーとして使用
                    db.createObjectStore(PATH_MAPPING_STORE_NAME);
                }
            };
        });
    }

    /**
     * サービスを初期化（保存されたマッピングを読み込み）
     */
    async init() {
        if (!WindowsPathMappingService.isSupported()) {
            console.debug('File System Access API is not supported (Windows Path Mapping not needed on this platform)');
            return false;
        }

        try {
            const db = await this._initDB();

            // 保存されたすべてのマッピングを読み込み
            const mappings = await this._loadAllMappings();

            // 各マッピングのパーミッションを確認
            for (const [normalizedPath, mapping] of Object.entries(mappings)) {
                try {
                    const hasPermission = await this._verifyPermission(mapping.handle, 'readwrite');

                    if (hasPermission) {
                        this.mappings.set(normalizedPath, mapping);
                        console.info(`[WindowsPathMapping] Restored mapping: ${mapping.originalPath}`);
                    } else {
                        console.warn(`[WindowsPathMapping] Permission lost for: ${mapping.originalPath}`);
                        // パーミッションが失われている場合は削除
                        await this._removeMappingFromDB(normalizedPath);
                    }
                } catch (err) {
                    console.warn(`[WindowsPathMapping] Failed to verify mapping: ${mapping.originalPath}`, err);
                    await this._removeMappingFromDB(normalizedPath);
                }
            }

            return true;
        } catch (err) {
            console.error('Failed to initialize WindowsPathMappingService:', err);
            return false;
        }
    }

    /**
     * IndexedDBからすべてのマッピングを読み込み
     */
    async _loadAllMappings() {
        const db = await this._initDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([PATH_MAPPING_STORE_NAME], 'readonly');
            const store = transaction.objectStore(PATH_MAPPING_STORE_NAME);
            const request = store.openCursor();
            const mappings = {};

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    mappings[cursor.key] = cursor.value;
                    cursor.continue();
                } else {
                    resolve(mappings);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * マッピングをIndexedDBに保存
     */
    async _saveMappingToDB(normalizedPath, mapping) {
        const db = await this._initDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([PATH_MAPPING_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(PATH_MAPPING_STORE_NAME);
            const request = store.put(mapping, normalizedPath);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * IndexedDBからマッピングを削除
     */
    async _removeMappingFromDB(normalizedPath) {
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([PATH_MAPPING_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(PATH_MAPPING_STORE_NAME);
            const request = store.delete(normalizedPath);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * ディレクトリハンドルの許可を確認・要求
     */
    async _verifyPermission(handle, mode = 'read') {
        const options = {};
        if (mode === 'readwrite') {
            options.mode = 'readwrite';
        }

        // 既に許可があるかチェック
        if ((await handle.queryPermission(options)) === 'granted') {
            return true;
        }

        // ユーザーに許可を要求
        if ((await handle.requestPermission(options)) === 'granted') {
            return true;
        }

        return false;
    }

    /**
     * Windowsパスに対応するマッピングを取得
     * パス自体が登録されている場合、または親パスが登録されている場合に返す
     */
    async getMapping(windowsPath) {
        if (!isWindowsAbsolutePath(windowsPath)) {
            return null;
        }

        const normalizedPath = normalizeWindowsPath(windowsPath);

        // 完全一致するマッピングを探す
        if (this.mappings.has(normalizedPath)) {
            return this.mappings.get(normalizedPath);
        }

        // 親パスのマッピングを探す（最も長い親パスを優先）
        let bestMatch = null;
        let bestMatchLength = 0;

        for (const [mappedPath, mapping] of this.mappings.entries()) {
            if (isParentPath(mappedPath, normalizedPath)) {
                if (mappedPath.length > bestMatchLength) {
                    bestMatch = mapping;
                    bestMatchLength = mappedPath.length;
                }
            }
        }

        return bestMatch;
    }

    /**
     * Windowsパスからディレクトリハンドルと相対パスを取得
     */
    async resolveWindowsPath(windowsPath) {
        if (!isWindowsAbsolutePath(windowsPath)) {
            throw new Error(`Not a Windows absolute path: ${windowsPath}`);
        }

        const mapping = await this.getMapping(windowsPath);

        if (!mapping) {
            // マッピングが見つからない場合、ユーザーにディレクトリ選択を促す
            if (this.options.autoPrompt) {
                const newMapping = await this.promptForPath(windowsPath);
                if (newMapping) {
                    return this.resolveWindowsPath(windowsPath);
                }
            }

            throw new Error(
                `No File System Access mapping found for path: ${windowsPath}\n` +
                `Please select the directory using promptForPath() or enable Native File Access.`
            );
        }

        // 相対パスを計算
        const normalizedRequestedPath = normalizeWindowsPath(windowsPath);
        const normalizedMappedPath = normalizeWindowsPath(mapping.originalPath);
        const relativePath = getRelativePath(normalizedMappedPath, normalizedRequestedPath);

        return {
            handle: mapping.handle,
            relativePath: relativePath || '',
            mappedPath: mapping.originalPath
        };
    }

    /**
     * ユーザーにディレクトリ選択ダイアログを表示して、Windowsパスをマッピング
     */
    async promptForPath(windowsPath) {
        if (!isWindowsAbsolutePath(windowsPath)) {
            throw new Error(`Not a Windows absolute path: ${windowsPath}`);
        }

        try {
            // file:// URI形式の場合は変換してから処理
            const cleanPath = stripFileUriPrefix(windowsPath);

            // ユーザーにメッセージを表示
            console.info(`[WindowsPathMapping] Please select directory for: ${cleanPath}`);

            // ディレクトリ選択ダイアログを表示
            const handle = await window.showDirectoryPicker({
                mode: 'readwrite',
                startIn: 'documents'
            });

            // マッピングを保存（正規化されたWindowsパスを使用）
            const normalizedPath = normalizeWindowsPath(cleanPath);
            const mapping = {
                originalPath: cleanPath,
                normalizedPath: normalizedPath,
                handle: handle,
                timestamp: Date.now()
            };

            this.mappings.set(normalizedPath, mapping);
            await this._saveMappingToDB(normalizedPath, mapping);

            console.info(`[WindowsPathMapping] Mapping created: ${cleanPath}`);

            return mapping;
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('User cancelled directory selection');
            } else {
                console.error('Failed to select directory:', err);
            }
            return null;
        }
    }

    /**
     * マッピングを削除
     */
    async removeMapping(windowsPath) {
        const normalizedPath = normalizeWindowsPath(windowsPath);

        this.mappings.delete(normalizedPath);
        await this._removeMappingFromDB(normalizedPath);

        console.info(`[WindowsPathMapping] Mapping removed: ${windowsPath}`);
    }

    /**
     * すべてのマッピングを削除
     */
    async clearAllMappings() {
        this.mappings.clear();

        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([PATH_MAPPING_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(PATH_MAPPING_STORE_NAME);
            const request = store.clear();

            request.onsuccess = () => {
                console.info('[WindowsPathMapping] All mappings cleared');
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 現在のすべてのマッピングを取得
     */
    getAllMappings() {
        const result = [];
        for (const [normalizedPath, mapping] of this.mappings.entries()) {
            result.push({
                originalPath: mapping.originalPath,
                normalizedPath: normalizedPath,
                timestamp: mapping.timestamp
            });
        }
        return result;
    }
}

// グローバルインスタンスを作成（シングルトン）
if (typeof window !== 'undefined') {
    window.WindowsPathMappingService = WindowsPathMappingService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WindowsPathMappingService;
}
