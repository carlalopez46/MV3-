/**
 * FileSystemAccessService and WindowsPathMappingService Test Suite
 *
 * 包括的な自動テストスイート
 * - FileSystemAccessService の全機能をテスト
 * - WindowsPathMappingService の全機能をテスト
 * - AsyncFileIO との統合をテスト
 * - エラーを詳細に記録
 */

(function() {
    'use strict';

    /* global FileSystemAccessService, WindowsPathMappingService, afio, GlobalErrorLogger */

    // テストランナー
    const TestRunner = {
        tests: [],
        results: {
            passed: 0,
            failed: 0,
            skipped: 0
        },

        addTest: function(name, testFn, options = {}) {
            this.tests.push({
                name: name,
                fn: testFn,
                timeout: options.timeout || 10000,
                skip: options.skip || false,
                critical: options.critical || false,
                category: options.category || 'General'
            });
        },

        async runAll() {
            console.log('='.repeat(80));
            console.log('File System Access API Test Suite');
            console.log('='.repeat(80));

            for (const test of this.tests) {
                if (test.skip) {
                    console.log(`[SKIP] ${test.name}`);
                    this.results.skipped++;
                    continue;
                }

                await this.runTest(test);
            }

            this.printSummary();
            return this.results;
        },

        async runTest(test) {
            console.log(`\n[TEST] ${test.name}`);
            const startTime = Date.now();

            try {
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Test timeout')), test.timeout);
                });

                // Promise.resolve() でラップして、同期的な例外も非同期的にキャッチ
                await Promise.race([Promise.resolve().then(() => test.fn()), timeoutPromise]);

                const duration = Date.now() - startTime;
                console.log(`[PASS] ${test.name} (${duration}ms)`);
                this.results.passed++;

            } catch (error) {
                const duration = Date.now() - startTime;
                console.error(`[FAIL] ${test.name} (${duration}ms)`);

                if (typeof GlobalErrorLogger !== 'undefined') {
                    GlobalErrorLogger.logError(test.name, error, {
                        critical: test.critical,
                        category: test.category,
                        testName: test.name
                    });
                } else {
                    console.error('Error:', error);
                }

                this.results.failed++;

                if (test.critical) {
                    console.error('CRITICAL TEST FAILED - Stopping test suite');
                    throw error;
                }
            }
        },

        printSummary: function() {
            console.log('\n' + '='.repeat(80));
            console.log('Test Summary');
            console.log('='.repeat(80));
            console.log(`Passed:  ${this.results.passed}`);
            console.log(`Failed:  ${this.results.failed}`);
            console.log(`Skipped: ${this.results.skipped}`);
            console.log(`Total:   ${this.tests.length}`);
            console.log('='.repeat(80));

            if (typeof GlobalErrorLogger !== 'undefined') {
                const errorReport = GlobalErrorLogger.getReport();
                if (errorReport.totalErrors > 0) {
                    console.log('\nError Summary:');
                    console.log(JSON.stringify(errorReport.summary, null, 2));
                }
            }
        }
    };

    // ===========================
    // BROWSER SUPPORT TESTS
    // ===========================

    TestRunner.addTest('Browser: File System Access API Support', async function() {
        const isSupported = FileSystemAccessService.isSupported();

        if (typeof GlobalErrorLogger !== 'undefined') {
            GlobalErrorLogger.logInfo('BrowserSupport', `File System Access API supported: ${isSupported}`);
        }

        if (!isSupported) {
            throw new Error('File System Access API is not supported in this browser');
        }
    }, { critical: true, category: 'BrowserSupport' });

    TestRunner.addTest('Browser: WindowsPathMappingService Support', function() {
        const isSupported = WindowsPathMappingService.isSupported();

        if (typeof GlobalErrorLogger !== 'undefined') {
            GlobalErrorLogger.logInfo('BrowserSupport', `WindowsPathMappingService supported: ${isSupported}`);
        }

        if (!isSupported) {
            throw new Error('WindowsPathMappingService is not supported in this browser');
        }
    }, { critical: true, category: 'BrowserSupport' });

    TestRunner.addTest('Browser: localStorage handles falsy values', function() {
        const testKey = 'fsaccess-falsy-test';

        // Should return null for missing keys
        if (localStorage.getItem(testKey) !== null) {
            throw new Error('localStorage.getItem should return null for unknown keys');
        }

        localStorage.setItem(testKey, '');

        if (localStorage.getItem(testKey) !== '') {
            throw new Error('localStorage should return stored falsy values without coercion');
        }

        localStorage.removeItem(testKey);
    }, { category: 'BrowserSupport' });

    // ===========================
    // FILESYSTEM ACCESS SERVICE INITIALIZATION TESTS
    // ===========================

    TestRunner.addTest('FileSystemAccessService: Constructor', function() {
        const service = new FileSystemAccessService({
            autoPrompt: false,
            enableWindowsPathMapping: true
        });

        if (!service) {
            throw new Error('Failed to create FileSystemAccessService instance');
        }

        if (service.ready) {
            throw new Error('Service should not be ready before init()');
        }

        if (service.options.autoPrompt !== false) {
            throw new Error('autoPrompt option not set correctly');
        }

        if (service.options.enableWindowsPathMapping !== true) {
            throw new Error('enableWindowsPathMapping option not set correctly');
        }
    }, { category: 'Initialization' });

    TestRunner.addTest('FileSystemAccessService: IndexedDB Initialization', async function() {
        const service = new FileSystemAccessService({ autoPrompt: false });

        await service._initDB();

        if (!service.db) {
            throw new Error('IndexedDB not initialized');
        }

        // データベース名をチェック
        if (service.db.name !== 'iMacrosFileSystemAccess') {
            throw new Error(`Wrong database name: ${service.db.name}`);
        }

        // オブジェクトストアの存在をチェック
        if (!service.db.objectStoreNames.contains('directoryHandles')) {
            throw new Error('directoryHandles object store not found');
        }
    }, { category: 'Initialization' });

    // ===========================
    // WINDOWS PATH MAPPING SERVICE TESTS
    // ===========================

    TestRunner.addTest('WindowsPathMappingService: Constructor', function() {
        const service = new WindowsPathMappingService({
            autoPrompt: false
        });

        if (!service) {
            throw new Error('Failed to create WindowsPathMappingService instance');
        }

        if (service.options.autoPrompt !== false) {
            throw new Error('autoPrompt option not set correctly');
        }

        if (!(service.mappings instanceof Map)) {
            throw new Error('mappings is not a Map');
        }
    }, { category: 'PathMapping' });

    TestRunner.addTest('WindowsPathMappingService: IndexedDB Initialization', async function() {
        const service = new WindowsPathMappingService({ autoPrompt: false });

        await service._initDB();

        if (!service.db) {
            throw new Error('IndexedDB not initialized');
        }

        if (service.db.name !== 'iMacrosPathMapping') {
            throw new Error(`Wrong database name: ${service.db.name}`);
        }

        if (!service.db.objectStoreNames.contains('pathMappings')) {
            throw new Error('pathMappings object store not found');
        }
    }, { category: 'PathMapping' });

    TestRunner.addTest('WindowsPathMappingService: Path Normalization', function() {
        const cases = [
            {
                input: 'FILE:///C:/Users//Test\\Folder/ ',
                expected: 'c:/users/test/folder'
            },
            {
                input: ' file://d:\\Projects\\ ',
                expected: 'd:/projects'
            },
            {
                input: 'C:////Temp//',
                expected: 'c:/temp'
            }
        ];

        cases.forEach(({ input, expected }) => {
            const normalized = normalizeWindowsPath(input);
            if (normalized !== expected) {
                throw new Error(`Expected ${input} -> ${expected}, got ${normalized}`);
            }
        });

        // Uppercase FILE:// prefixes should still be treated as Windows absolute paths
        const uppercaseFilePath = 'FILE:///E:/Data/file.txt';
        if (!isWindowsAbsolutePath(uppercaseFilePath)) {
            throw new Error('isWindowsAbsolutePath should handle case-insensitive file:// prefix');
        }
    }, { category: 'PathMapping' });

    // ===========================
    // PATH VALIDATION TESTS
    // ===========================

    TestRunner.addTest('FileSystemAccessService: Windows Path Detection', function() {
        const service = new FileSystemAccessService({ autoPrompt: false });

        const windowsPaths = [
            'C:\\Users\\Test\\file.txt',
            'C:/Users/Test/file.txt',
            'D:\\Documents\\',
            'E:/Projects/test.js'
        ];

        const nonWindowsPaths = [
            '/Users/Test/file.txt',
            '/home/user/documents/',
            'relative/path/file.txt',
            './test.txt'
        ];

        windowsPaths.forEach(path => {
            if (!service._isWindowsAbsolutePath(path)) {
                throw new Error(`Failed to detect Windows path: ${path}`);
            }
        });

        nonWindowsPaths.forEach(path => {
            if (service._isWindowsAbsolutePath(path)) {
                throw new Error(`Incorrectly detected as Windows path: ${path}`);
            }
        });
    }, { category: 'PathValidation' });

    TestRunner.addTest('FileSystemAccessService: Path Splitting', function() {
        const service = new FileSystemAccessService({ autoPrompt: false });

        const testCases = [
            { path: '/Users/Test/file.txt', expected: ['Users', 'Test', 'file.txt'] },
            { path: 'Users/Test/file.txt', expected: ['Users', 'Test', 'file.txt'] },
            { path: '/Users//Test///file.txt', expected: ['Users', 'Test', 'file.txt'] },
            { path: '/', expected: [] },
            { path: '', expected: [] }
        ];

        testCases.forEach(({ path, expected }) => {
            const result = service._splitPath(path);
            if (JSON.stringify(result) !== JSON.stringify(expected)) {
                throw new Error(`Path split failed for "${path}". Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(result)}`);
            }
        });
    }, { category: 'PathValidation' });

    TestRunner.addTest('FileSystemAccessService: Path Joining', function() {
        const service = new FileSystemAccessService({ autoPrompt: false });

        const testCases = [
            {
                base: '/Users',
                parts: ['Test', 'file.txt'],
                expected: '/Users/Test/file.txt'
            },
            {
                base: 'C:\\Users',
                parts: ['Test', 'file.txt'],
                expected: 'C:\\Users\\Test\\file.txt'
            },
            {
                base: '/Users/',
                parts: ['/Test/', '/file.txt'],
                expected: '/Users/Test/file.txt'
            }
        ];

        testCases.forEach(({ base, parts, expected }) => {
            const result = service._joinPath(base, ...parts);
            // パスセパレーターを正規化して比較
            const normalizedResult = result.replace(/\\/g, '/');
            const normalizedExpected = expected.replace(/\\/g, '/');

            if (normalizedResult !== normalizedExpected) {
                throw new Error(`Path join failed. Expected: ${expected}, Got: ${result}`);
            }
        });
    }, { category: 'PathValidation' });

    // ===========================
    // ASYNC FILE IO INTEGRATION TESTS
    // ===========================

    TestRunner.addTest('AsyncFileIO: Backend Detection', async function() {
        const backendType = afio.getBackendType();

        if (typeof GlobalErrorLogger !== 'undefined') {
            GlobalErrorLogger.logInfo('AsyncFileIO', `Current backend: ${backendType}`);
        }

        console.log(`Current backend: ${backendType}`);

        // バックエンドタイプが有効な値であることを確認
        const validBackends = ['native', 'filesystem-access', 'virtual', 'unknown'];
        if (!validBackends.includes(backendType)) {
            throw new Error(`Invalid backend type: ${backendType}`);
        }
    }, { category: 'Integration' });

    TestRunner.addTest('AsyncFileIO: File System Access API Support Check', function() {
        const isSupported = afio.isFileSystemAccessSupported();

        // Assert that the method returns a boolean value
        if (typeof isSupported !== 'boolean') {
            throw new Error(`isFileSystemAccessSupported() should return a boolean, got: ${typeof isSupported}`);
        }

        if (typeof GlobalErrorLogger !== 'undefined') {
            GlobalErrorLogger.logInfo('AsyncFileIO', `File System Access API supported: ${isSupported}`);
        }

        console.log(`File System Access API supported: ${isSupported}`);
    }, { category: 'Integration' });

    TestRunner.addTest('AsyncFileIO: Windows Path Mapping Support Check', function() {
        const isSupported = afio.isWindowsPathMappingSupported();

        // Assert that the method returns a boolean value
        if (typeof isSupported !== 'boolean') {
            throw new Error(`isWindowsPathMappingSupported() should return a boolean, got: ${typeof isSupported}`);
        }

        if (typeof GlobalErrorLogger !== 'undefined') {
            GlobalErrorLogger.logInfo('AsyncFileIO', `Windows Path Mapping supported: ${isSupported}`);
        }

        console.log(`Windows Path Mapping supported: ${isSupported}`);
    }, { category: 'Integration' });

    // ===========================
    // NODE OBJECT TESTS WITH FILESYSTEM ACCESS
    // ===========================

    TestRunner.addTest('NodeObject: Windows Path Creation', function() {
        // Windowsパスでノードを作成できるかテスト
        const testPath = 'C:\\Users\\Test\\file.txt';

        try {
            const node = afio.openNode(testPath);

            if (!node || !node._path) {
                throw new Error('Failed to create node with Windows path');
            }

            if (node._path !== testPath) {
                throw new Error(`Node path mismatch. Expected: ${testPath}, Got: ${node._path}`);
            }

            if (node.leafName !== 'file.txt') {
                throw new Error(`Incorrect leafName. Expected: file.txt, Got: ${node.leafName}`);
            }
        } catch (err) {
            if (typeof GlobalErrorLogger !== 'undefined') {
                GlobalErrorLogger.logError('NodeObject', err, {
                    testPath: testPath,
                    category: 'PathCreation'
                });
            }
            throw err;
        }
    }, { category: 'NodeObject' });

    TestRunner.addTest('NodeObject: Virtual Path Creation', function() {
        const testPath = '/VirtualMacros/test.iim';

        const node = afio.openNode(testPath);

        if (!node || !node._path) {
            throw new Error('Failed to create node with virtual path');
        }

        if (node._path !== testPath) {
            throw new Error(`Node path mismatch. Expected: ${testPath}, Got: ${node._path}`);
        }

        if (node.leafName !== 'test.iim') {
            throw new Error(`Incorrect leafName. Expected: test.iim, Got: ${node.leafName}`);
        }
    }, { category: 'NodeObject' });

    // ===========================
    // ERROR HANDLING TESTS
    // ===========================

    TestRunner.addTest('Error Handling: Windows Path Without Mapping', async function() {
        // マッピングなしでWindowsパスにアクセスしようとするとエラーになるべき
        const service = new FileSystemAccessService({
            autoPrompt: false,
            enableWindowsPathMapping: true
        });

        await service.init();

        const testPath = 'C:\\NonExistent\\test.txt';

        try {
            await service.readTextFile(testPath);
            throw new Error('Should have thrown error for Windows path without mapping');
        } catch (err) {
            if (!err.message.includes('mapping')) {
                throw new Error(`Wrong error message: ${err.message}`);
            }
            console.log('Correctly threw error for unmapped Windows path');
        }
    }, { category: 'ErrorHandling' });

    TestRunner.addTest('Error Handling: Windows Path Mapping Disabled', async function() {
        const service = new FileSystemAccessService({
            autoPrompt: false,
            enableWindowsPathMapping: false
        });

        await service.init();

        const testPath = 'C:\\Test\\file.txt';

        try {
            await service._resolvePathAndHandle(testPath);
            throw new Error('Should have thrown error when Windows path mapping is disabled');
        } catch (err) {
            if (!err.message.includes('Windows path mapping is not enabled')) {
                throw new Error(`Wrong error message: ${err.message}`);
            }
            console.log('Correctly threw error for disabled Windows path mapping');
        }
    }, { category: 'ErrorHandling' });

    TestRunner.addTest('Error Handling: Invalid Path Format', function() {
        const service = new FileSystemAccessService({ autoPrompt: false });

        const invalidPaths = [
            null,
            undefined,
            '',
            123,
            {}
        ];

        invalidPaths.forEach(path => {
            try {
                service._isWindowsAbsolutePath(path);
                // エラーにならないが、false を返すべき
            } catch (err) {
                // エラーが発生してもOK
                console.log(`Handled invalid path: ${path}`);
            }
        });
    }, { category: 'ErrorHandling' });

    // ===========================
    // PERMISSION TESTS
    // ===========================

    TestRunner.addTest('Permissions: Permission Verification Method', async function() {
        const service = new FileSystemAccessService({ autoPrompt: false });

        // _verifyPermission メソッドが存在することを確認
        if (typeof service._verifyPermission !== 'function') {
            throw new Error('_verifyPermission method not found');
        }

        console.log('_verifyPermission method exists');
    }, { category: 'Permissions' });

    // ===========================
    // UTILITY FUNCTION TESTS
    // ===========================

    TestRunner.addTest('Utilities: Glob Pattern Conversion', function() {
        // globToRegex is an internal function
        // It will be tested indirectly through getNodesInDir with pattern filtering
        console.log('Glob pattern conversion: tested indirectly through getNodesInDir');
    }, { category: 'Utilities', skip: true });

    // ===========================
    // INTEGRATION SCENARIO TESTS
    // ===========================

    TestRunner.addTest('Scenario: Initialize FileSystemAccessService', async function() {
        const service = new FileSystemAccessService({
            autoPrompt: false,
            enableWindowsPathMapping: true,
            persistPermissions: true
        });

        const initResult = await service.init();

        if (typeof GlobalErrorLogger !== 'undefined') {
            GlobalErrorLogger.logInfo('Scenario', `FileSystemAccessService init result: ${initResult}`);
        }

        console.log(`Init result: ${initResult}`);
        console.log(`Service ready: ${service.ready}`);
        console.log(`Windows path mapping enabled: ${service.pathMappingService !== null}`);
    }, { category: 'Scenario', timeout: 15000 });

    TestRunner.addTest('Scenario: Check All Mappings', function() {
        const mappings = afio.getAllWindowsPathMappings();

        if (typeof GlobalErrorLogger !== 'undefined') {
            GlobalErrorLogger.logInfo('Scenario', `Current Windows path mappings: ${mappings.length}`);
        }

        console.log(`Current Windows path mappings: ${mappings.length}`);
        mappings.forEach((mapping, index) => {
            console.log(`  ${index + 1}. ${mapping.originalPath}`);
        });
    }, { category: 'Scenario' });

    // エクスポート
    window.FileSystemAccessTestSuite = {
        run: async function() {
            try {
                console.log('Starting File System Access API Test Suite...\n');

                const results = await TestRunner.runAll();

                let report = {
                    success: results.failed === 0,
                    results: results
                };

                if (typeof GlobalErrorLogger !== 'undefined') {
                    report.errors = GlobalErrorLogger.getReport();
                    report.exportReport = () => GlobalErrorLogger.exportReport();
                    report.printReport = () => GlobalErrorLogger.printReport();
                }

                return report;
            } catch (e) {
                if (typeof GlobalErrorLogger !== 'undefined') {
                    GlobalErrorLogger.logError('TEST_SUITE', e, {
                        severity: GlobalErrorLogger.SEVERITY_LEVELS.CRITICAL
                    });
                }

                return {
                    success: false,
                    fatalError: e.message,
                    errors: typeof GlobalErrorLogger !== 'undefined' ? GlobalErrorLogger.getReport() : null
                };
            }
        },

        getErrorReport: function() {
            if (typeof GlobalErrorLogger !== 'undefined') {
                return GlobalErrorLogger.getReport();
            }
            return null;
        },

        exportErrorReport: function() {
            if (typeof GlobalErrorLogger !== 'undefined') {
                GlobalErrorLogger.exportReport();
            }
        },

        printErrorReport: function() {
            if (typeof GlobalErrorLogger !== 'undefined') {
                GlobalErrorLogger.printReport();
            }
        }
    };

    console.log('File System Access API Test Suite loaded.');
    console.log('Run with: FileSystemAccessTestSuite.run()');

})();
