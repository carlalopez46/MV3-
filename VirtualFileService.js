/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

(function (globalScope) {
    'use strict';

    const DEFAULT_DIRECTORIES = [
        '/VirtualMacros/',
        '/VirtualMacros/Datasources/',
        '/VirtualMacros/Downloads/',
        '/VirtualMacros/Logs/'
    ];

    const DEFAULT_CONFIG = {
        defsavepath: '/VirtualMacros/',
        defdatapath: '/VirtualMacros/Datasources/',
        defdownpath: '/VirtualMacros/Downloads/',
        deflogpath: '/VirtualMacros/Logs/'
    };

    const STORAGE_KEYS = {
        tree: 'vfs_tree',
        config: 'vfs_config',
        stats: 'vfs_stats',
        deleted: 'vfs_recently_deleted'
    };

    const LEGACY_STORAGE_KEYS = {
        tree: 'vfs_data',
        config: 'vfs_config',
        stats: 'vfs_stats'
    };

    const CHUNK_PREFIX = 'vfs_chunk_';
    const MAX_STORAGE_SIZE = 8 * 1024 * 1024; // 8MB soft limit
    const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB per file
    const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
    const RECENTLY_DELETED_TTL = 24 * 60 * 60 * 1000;

    function now() {
        return Date.now();
    }

    function globToRegex(pattern) {
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escaped.replace(/\\\*/g, '.*'));
    }

    class VirtualFileService {
        constructor(options = {}) {
            this.chunkSize = options.chunkSize || CHUNK_SIZE;
            this.storageKeys = Object.assign({}, STORAGE_KEYS, options.storageKeys || {});
            this.maxStorageSize = options.maxStorageSize || MAX_STORAGE_SIZE;
            this.maxFileSize = options.maxFileSize || MAX_FILE_SIZE;
            this.tree = {};
            this.config = Object.assign({}, DEFAULT_CONFIG);
            this.stats = {
                totalSize: 0,
                lastAccess: {},
                lastChange: 0
            };
            this.recentlyDeleted = [];
            this.initialized = false;
            this.initializingPromise = null;
            this.listeners = new Map();
        }

        isReady() {
            return this.initialized;
        }

        async init() {
            if (this.initialized) {
                return;
            }
            if (this.initializingPromise) {
                return this.initializingPromise;
            }

            this.initializingPromise = this._loadFromStorage()
                .catch((err) => {
                    console.error('VFS initialization failed, rebuilding structure', err);
                    return this._initDefaultStructure();
                })
                .then(() => {
                    this.initialized = true;
                    this._purgeDeleted();
                })
                .finally(() => {
                    this.initializingPromise = null;
                });

            return this.initializingPromise;
        }

        async _loadFromStorage() {
            const keys = [
                this.storageKeys.tree,
                this.storageKeys.config,
                this.storageKeys.stats,
                this.storageKeys.deleted,
                LEGACY_STORAGE_KEYS.tree,
                LEGACY_STORAGE_KEYS.config,
                LEGACY_STORAGE_KEYS.stats
            ];
            const result = await this._storageGet(keys);
            const legacyTree = result[LEGACY_STORAGE_KEYS.tree];
            const legacyConfig = result[LEGACY_STORAGE_KEYS.config];
            const legacyStats = result[LEGACY_STORAGE_KEYS.stats];

            this.tree = result[this.storageKeys.tree] || {};
            this.config = Object.assign({}, DEFAULT_CONFIG, result[this.storageKeys.config] || {});
            this.stats = Object.assign({ totalSize: 0, lastAccess: {}, lastChange: 0 }, result[this.storageKeys.stats] || {});
            this.recentlyDeleted = Array.isArray(result[this.storageKeys.deleted]) ? result[this.storageKeys.deleted] : [];

            if (Object.keys(this.tree).length === 0 && legacyTree && Object.keys(legacyTree).length) {
                await this._migrateLegacyData({
                    tree: legacyTree,
                    config: legacyConfig,
                    stats: legacyStats
                });
                await this._storageRemove([LEGACY_STORAGE_KEYS.tree]);
                return;
            }

            if (Object.keys(this.tree).length === 0) {
                await this._initDefaultStructure();
            } else {
                this._ensureRootEntry();
            }
        }

        _ensureRootEntry() {
            const existing = this.tree['/'];
            if (!existing || existing.type !== 'dir') {
                this.tree['/'] = {
                    type: 'dir',
                    modified: existing && existing.modified ? existing.modified : now(),
                    children: {}
                };
            }
        }

        async _initDefaultStructure() {
            this.tree = {};
            this._ensureRootEntry();
            DEFAULT_DIRECTORIES.forEach((dir) => {
                this.tree[this._normalizePath(dir)] = { type: 'dir', modified: now(), children: {} };
            });
            this.config = Object.assign({}, DEFAULT_CONFIG);
            this.stats = { totalSize: 0, lastAccess: {}, lastChange: now() };
            this.recentlyDeleted = [];
            await this._persist();
        }

        async _migrateLegacyData(legacyData = {}) {
            console.info('VirtualFileService migrating legacy storage data');
            const legacyTree = legacyData.tree || {};
            const paths = Object.keys(legacyTree);
            this.tree = {};
            for (const path of paths) {
                const entry = legacyTree[path];
                if (!entry || !entry.type) {
                    continue;
                }
                const normalizedPath = this._normalizePath(path);
                if (entry.type === 'dir') {
                    this.tree[normalizedPath] = { type: 'dir', modified: entry.modified || now(), children: {} };
                } else if (entry.type === 'file') {
                    const content = typeof entry.content === 'string' ? entry.content : '';
                    const chunks = await this._writeChunks(content, null);
                    const size = typeof entry.size === 'number' ? entry.size : this._calculateSize(content);
                    this.tree[normalizedPath] = {
                        type: 'file',
                        size,
                        chunks,
                        modified: entry.modified || now()
                    };
                }
            }
            this._ensureRootEntry();
            for (const dir of DEFAULT_DIRECTORIES) {
                const normalizedDir = this._normalizePath(dir);
                const existing = this.tree[normalizedDir];
                if (!existing) {
                    // Create missing default directory
                    this.tree[normalizedDir] = { type: 'dir', modified: now(), children: {} };
                } else if (existing.type !== 'dir') {
                    // Edge case: file exists at default directory path - replace with directory
                    // Clean up orphaned chunks before replacing file entry with directory
                    if (existing.chunks && existing.chunks.length > 0) {
                        await this._removeChunks(existing.chunks);
                    }
                    console.warn(`VirtualFileService: Replacing file entry with directory at ${normalizedDir}`);
                    this.tree[normalizedDir] = { type: 'dir', modified: now(), children: {} };
                }
            }
            const legacyStats = legacyData.stats || {};
            const legacyAccess = legacyStats.lastAccess || {};
            const totalSize = Object.values(this.tree).reduce((sum, entry) => {
                if (entry.type === 'file') {
                    return sum + (entry.size || 0);
                }
                return sum;
            }, 0);
            this.config = Object.assign({}, DEFAULT_CONFIG, legacyData.config || {});
            this.stats = {
                totalSize,
                lastAccess: Object.assign({}, legacyAccess),
                lastChange: now()
            };
            this.recentlyDeleted = [];
            await this._persist();
        }

        async _persist() {
            await this._storageSet({
                [this.storageKeys.tree]: this.tree,
                [this.storageKeys.config]: this.config,
                [this.storageKeys.stats]: this.stats,
                [this.storageKeys.deleted]: this.recentlyDeleted
            });
        }

        _storageGet(keys) {
            const uniqueKeys = Array.from(new Set((keys || []).filter(Boolean)));
            return new Promise((resolve, reject) => {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.get(uniqueKeys, (result) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }
                        resolve(result || {});
                    });
                } else {
                    const result = {};
                    let lastError = null;
                    uniqueKeys.forEach((key) => {
                        try {
                            const raw = localStorage.getItem(key);
                            result[key] = raw ? JSON.parse(raw) : undefined;
                        } catch (err) {
                            console.warn('VFS localStorage read failed for key', key, err);
                            lastError = lastError || err;
                        }
                    });
                    if (lastError) {
                        reject(lastError);
                    } else {
                        resolve(result);
                    }
                }
            });
        }

        _storageSet(items) {
            return new Promise((resolve, reject) => {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.set(items, () => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve();
                        }
                    });
                } else {
                    let lastError = null;
                    Object.keys(items).forEach((key) => {
                        try {
                            localStorage.setItem(key, JSON.stringify(items[key]));
                        } catch (err) {
                            console.warn('VFS localStorage write failed for key', key, err);
                            lastError = lastError || err;
                        }
                    });
                    if (lastError) {
                        reject(lastError);
                    } else {
                        resolve();
                    }
                }
            });
        }

        _storageRemove(keys) {
            const targets = (keys || []).filter(Boolean);
            if (!targets.length) {
                return Promise.resolve();
            }
            return new Promise((resolve, reject) => {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.remove(targets, () => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                        } else {
                            resolve();
                        }
                    });
                } else {
                    let lastError = null;
                    targets.forEach((key) => {
                        try {
                            localStorage.removeItem(key);
                        } catch (err) {
                            console.warn('VFS localStorage remove failed for key', key, err);
                            lastError = lastError || err;
                        }
                    });
                    if (lastError) {
                        reject(lastError);
                    } else {
                        resolve();
                    }
                }
            });
        }

        async _removeChunks(chunkIds) {
            if (!chunkIds || chunkIds.length === 0) return;
            const removals = chunkIds.map((id) => CHUNK_PREFIX + id);
            await this._storageRemove(removals);
        }

        _normalizePath(path) {
            if (!path) return '/';

            // Check for Windows absolute paths (e.g., C:\, D:\, C:/)
            // Virtual filesystem only supports virtual paths like /VirtualMacros/
            if (/^[a-z]:[/\\]/i.test(path)) {
                throw new Error('Virtual filesystem does not support absolute file system paths. Use virtual paths like /VirtualMacros/ or enable native file access for real paths.');
            }

            if (__is_windows()) {
                path = path.replace(/\\/g, '/');
            }
            path = path.replace(/\/+/g, '/');
            if (!path.startsWith('/')) {
                path = '/' + path;
            }
            if (path.length > 1 && path.endsWith('/')) {
                path = path.slice(0, -1);
            }
            return path;
        }

        _ensureDirPath(path) {
            if (!path.endsWith('/')) {
                return path + '/';
            }
            return path;
        }

        _getEntry(path) {
            return this.tree[this._normalizePath(path)] || null;
        }

        _setEntry(path, entry) {
            const normalized = this._normalizePath(path);
            this.tree[normalized] = entry;
            this.stats.lastAccess[normalized] = now();
            this.stats.lastChange = now();
        }

        _deleteEntry(path) {
            const normalized = this._normalizePath(path);
            delete this.tree[normalized];
            delete this.stats.lastAccess[normalized];
            this.stats.lastChange = now();
        }

        _getChildrenPaths(path) {
            const prefix = this._ensureDirPath(this._normalizePath(path));
            return Object.keys(this.tree).filter((p) => p !== path && p.startsWith(prefix));
        }

        _calculateSize(content) {
            if (!content) return 0;
            return new Blob([content]).size;
        }

        async _checkQuota(delta) {
            if (delta <= 0) return;
            if (this.stats.totalSize + delta <= this.maxStorageSize) return;
            await this._cleanupOldFiles(delta);
            if (this.stats.totalSize + delta > this.maxStorageSize) {
                throw new Error('Storage quota exceeded. Please delete some files.');
            }
        }

        async _cleanupOldFiles(requiredBytes = 0) {
            const entries = Object.entries(this.stats.lastAccess)
                .filter(([path]) => this.tree[path] && this.tree[path].type === 'file')
                .sort((a, b) => a[1] - b[1]);
            let cleaned = 0;
            const target = Math.max(requiredBytes, this.maxStorageSize * 0.2);
            for (const [path] of entries) {
                const entry = this.tree[path];
                if (!entry) continue;
                await this.node_remove(path);
                cleaned += entry.size || 0;
                if (this.stats.totalSize + requiredBytes <= this.maxStorageSize || cleaned >= target) {
                    break;
                }
            }
            if (this.stats.totalSize + requiredBytes > this.maxStorageSize) {
                console.warn('VFS: Unable to free sufficient storage', {
                    requiredBytes,
                    cleaned
                });
            }
        }

        async _writeChunks(content, existingEntry) {
            const chunkIds = [];
            const payload = {};
            for (let offset = 0; offset < content.length; offset += this.chunkSize) {
                const chunkId = this._generateChunkId();
                chunkIds.push(chunkId);
                payload[CHUNK_PREFIX + chunkId] = content.slice(offset, offset + this.chunkSize);
            }
            if (Object.keys(payload).length) {
                await this._storageSet(payload);
            }
            if (existingEntry && existingEntry.chunks) {
                await this._removeChunks(existingEntry.chunks);
            }
            return chunkIds;
        }

        async _readChunks(entry, path = '') {
            if (!entry || !entry.chunks || entry.chunks.length === 0) {
                return entry && entry.content ? entry.content : '';
            }
            const keys = entry.chunks.map((id) => CHUNK_PREFIX + id);
            const result = await this._storageGet(keys);
            return entry.chunks.map((id) => {
                const key = CHUNK_PREFIX + id;
                if (result[key] == null) {
                    throw new Error('Missing file chunk data for ' + (path || 'entry'));
                }
                return result[key] || '';
            }).join('');
        }

        _generateChunkId() {
            const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function';
            if (hasCrypto) {
                const buffer = new Uint32Array(2);
                crypto.getRandomValues(buffer);
                return buffer[0].toString(36) + buffer[1].toString(36) + Date.now().toString(36);
            }
            const a = Math.floor(Math.random() * 0xFFFFFFFF);
            const b = Math.floor(Math.random() * 0xFFFFFFFF);
            return a.toString(36) + b.toString(36) + Date.now().toString(36);
        }

        _emit(event, payload) {
            const listeners = this.listeners.get(event);
            if (!listeners) return;
            listeners.forEach((cb) => {
                try {
                    cb(payload);
                } catch (err) {
                    console.error('VFS listener error', err);
                }
            });
        }

        on(event, handler) {
            if (!this.listeners.has(event)) {
                this.listeners.set(event, new Set());
            }
            const set = this.listeners.get(event);
            set.add(handler);
            return () => set.delete(handler);
        }

        watchPath(path, handler) {
            const normalized = this._normalizePath(path);
            return this.on('change', (event) => {
                if (event && event.path && this._normalizePath(event.path).startsWith(normalized)) {
                    handler(event);
                }
            });
        }

        async node_exists(path) {
            await this.init();
            return !!this._getEntry(path);
        }

        async node_isDir(path) {
            await this.init();
            const entry = this._getEntry(path);
            return !!entry && entry.type === 'dir';
        }

        async node_isWritable() {
            await this.init();
            return true;
        }

        async node_isReadable(path) {
            return this.node_exists(path);
        }

        async node_copyTo(srcPath, dstPath) {
            await this.init();
            const entry = this._getEntry(srcPath);
            if (!entry) throw new Error('Source does not exist: ' + srcPath);
            if (entry.type === 'dir') {
                await this.makeDirectory(dstPath);
                const children = this._getChildrenPaths(srcPath);
                for (const childPath of children) {
                    const relative = childPath.replace(this._ensureDirPath(this._normalizePath(srcPath)), '');
                    const target = this._ensureDirPath(this._normalizePath(dstPath)) + relative;
                    const childEntry = this._getEntry(childPath);
                    if (childEntry.type === 'dir') {
                        await this.makeDirectory(target);
                    } else {
                        const data = await this.readTextFile(childPath);
                        await this.writeTextFile(target, data);
                    }
                }
            } else {
                const data = await this.readTextFile(srcPath);
                await this.writeTextFile(dstPath, data);
            }
        }

        async node_moveTo(srcPath, dstPath) {
            await this.node_copyTo(srcPath, dstPath);
            await this.node_remove(srcPath);
        }

        async node_remove(path) {
            await this.init();
            const normalized = this._normalizePath(path);
            const entry = this._getEntry(normalized);
            if (!entry) throw new Error('Path does not exist: ' + normalized);
            if (entry.type === 'dir') {
                const children = this._getChildrenPaths(normalized)
                    .sort((a, b) => {
                        const depthA = a.split('/').length;
                        const depthB = b.split('/').length;
                        if (depthA === depthB) {
                            return b.length - a.length;
                        }
                        return depthB - depthA;
                    });
                for (const child of children) {
                    await this.node_remove(child);
                }
            } else {
                if (entry.size) {
                    this.stats.totalSize = Math.max(0, this.stats.totalSize - entry.size);
                }
                await this._removeChunks(entry.chunks);
            }
            this.recentlyDeleted.push({ path: normalized, removedAt: now() });
            this._deleteEntry(normalized);
            await this._persist();
            this._emit('change', { type: 'delete', path: normalized, timestamp: now() });
        }

        async readTextFile(path) {
            await this.init();
            const entry = this._getEntry(path);
            if (!entry) throw new Error('File does not exist: ' + path);
            if (entry.type === 'dir') throw new Error('Path is a directory: ' + path);
            this.stats.lastAccess[this._normalizePath(path)] = now();
            return this._readChunks(entry, this._normalizePath(path));
        }

        async writeTextFile(path, data) {
            await this.init();
            const normalized = this._normalizePath(path);
            const entry = this._getEntry(normalized);
            const size = this._calculateSize(data);
            if (size > this.maxFileSize) {
                throw new Error('File size exceeds limit: ' + size + ' bytes');
            }
            const parent = normalized === '/' ? '/' : normalized.substring(0, normalized.lastIndexOf('/')) || '/';
            if (parent && parent !== normalized) {
                const parentEntry = this._getEntry(parent);
                if (!parentEntry || parentEntry.type !== 'dir') {
                    await this.makeDirectory(parent);
                }
            }
            const delta = size - (entry && entry.size ? entry.size : 0);
            await this._checkQuota(delta);
            const chunks = await this._writeChunks(data || '', entry);
            this._setEntry(normalized, {
                type: 'file',
                size,
                chunks,
                modified: now()
            });
            this.stats.totalSize += delta;
            await this._persist();
            this._emit('change', { type: 'write', path: normalized, size, timestamp: now() });
        }

        async appendTextFile(path, data) {
            await this.init();
            const existing = await this.node_exists(path) ? await this.readTextFile(path) : '';
            await this.writeTextFile(path, existing + (data || ''));
        }

        async getNodesInDir(path, filter) {
            await this.init();
            const normalized = this._normalizePath(path);
            const entry = this._getEntry(normalized);
            if (!entry || entry.type !== 'dir') {
                throw new Error('Not a directory: ' + path);
            }
            const prefix = this._ensureDirPath(normalized);
            const nodes = [];
            Object.entries(this.tree).forEach(([nodePath, nodeEntry]) => {
                if (!nodePath.startsWith(prefix) || nodePath === normalized) return;
                const remainder = nodePath.substring(prefix.length);
                if (remainder.includes('/')) return;
                nodes.push({
                    _path: nodePath,
                    _is_dir_int: nodeEntry.type === 'dir' ? 1 : 0,
                    path: nodePath,
                    is_dir: nodeEntry.type === 'dir'
                });
            });
            if (typeof filter === 'string' && filter.length) {
                // 特殊フィルタ ":is_dir" はディレクトリのみを返す
                if (filter === ':is_dir') {
                    return nodes.filter((n) => n._is_dir_int === 1);
                }
                const regex = globToRegex(filter);
                return nodes.filter((n) => regex.test(n._path));
            }
            return nodes;
        }

        async getLogicalDrives() {
            await this.init();
            // Virtual filesystem only supports virtual root, not real OS drives
            // Real drive access requires native host or File System Access API
            return [{ _path: '/', _is_dir_int: 1 }];
        }

        async getDefaultDir(name) {
            await this.init();
            const key = 'def' + name;
            const path = this.config[key];
            if (!path) throw new Error('Default directory not configured: ' + name);
            const normalized = this._normalizePath(path);
            if (!(await this.node_exists(normalized))) {
                await this.makeDirectory(normalized);
            }
            return { _path: normalized, _is_dir_int: 1 };
        }

        async makeDirectory(path) {
            await this.init();
            const normalized = this._normalizePath(path);
            const existing = this._getEntry(normalized);
            if (existing) {
                if (existing.type === 'dir') {
                    return;
                }
                throw new Error('Path exists as file: ' + path);
            }
            const parent = normalized === '/' ? '/' : normalized.substring(0, normalized.lastIndexOf('/')) || '/';
            if (parent !== normalized && !(await this.node_isDir(parent))) {
                await this.makeDirectory(parent);
            }
            this._setEntry(normalized, { type: 'dir', modified: now(), children: {} });
            await this._persist();
            this._emit('change', { type: 'mkdir', path: normalized, timestamp: now() });
        }

        async writeImageToFile(path, imageData) {
            if (!imageData || !imageData.image || !imageData.encoding || !imageData.mimeType) {
                throw new Error('Invalid image data');
            }
            await this.writeTextFile(path, JSON.stringify(imageData));
        }

        async queryLimits() {
            await this.init();
            return {
                maxFileSize: this.maxFileSize,
                maxStorageSize: this.maxStorageSize,
                currentSize: this.stats.totalSize,
                availableSize: Math.max(0, this.maxStorageSize - this.stats.totalSize)
            };
        }

        async exportTree() {
            await this.init();
            const files = {};
            const fileEntries = Object.entries(this.tree).filter(([, entry]) => entry.type === 'file');
            for (const [path] of fileEntries) {
                files[path] = await this.readTextFile(path);
            }
            return {
                exportedAt: new Date().toISOString(),
                config: this.config,
                stats: this.stats,
                files
            };
        }

        async importTree(bundle) {
            if (!bundle || typeof bundle !== 'object' || !bundle.files) {
                throw new Error('Invalid import bundle');
            }
            await this._initDefaultStructure();
            for (const [path, content] of Object.entries(bundle.files)) {
                await this.writeTextFile(path, content);
            }
            this.config = Object.assign({}, this.config, bundle.config || {});
            await this._persist();
            this._emit('change', { type: 'import', timestamp: now() });
        }

        _purgeDeleted() {
            const cutoff = now() - RECENTLY_DELETED_TTL;
            this.recentlyDeleted = this.recentlyDeleted.filter((entry) => entry.removedAt >= cutoff);
        }


    }

    globalScope.VirtualFileService = VirtualFileService;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
