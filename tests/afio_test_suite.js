/**
 * Comprehensive AsyncFileIO Test Suite
 *
 * This test suite validates all afio operations and tracks errors
 * with detailed stack traces, file locations, and line numbers.
 */

(function() {
    'use strict';

    /* global VirtualFileService, FileSyncBridge */

    // Error tracking system
    const ErrorTracker = {
        errors: [],
        warnings: [],

        logError: function(context, error, details) {
            const errorEntry = {
                timestamp: new Date().toISOString(),
                context: context,
                message: error.message || String(error),
                stack: error.stack || new Error().stack,
                details: details || {},
                type: 'ERROR'
            };
            const location = this.parseStackLocation(errorEntry.stack);
            errorEntry.file = location.file;
            errorEntry.line = location.line;
            errorEntry.column = location.column;
            this.errors.push(errorEntry);
            console.error(`[ERROR] ${context}:`, error);
            console.error('Details:', details);
            console.error('Stack:', error.stack);
        },

        logWarning: function(context, message, details) {
            const stack = new Error().stack;
            const location = this.parseStackLocation(stack);
            const warningEntry = {
                timestamp: new Date().toISOString(),
                context: context,
                message: message,
                details: details || {},
                type: 'WARNING',
                file: location.file,
                line: location.line,
                column: location.column
            };
            this.warnings.push(warningEntry);
            console.warn(`[WARNING] ${context}:`, message);
        },

        parseStackLocation: function(stack) {
            const fallback = { file: 'unknown', line: 0, column: 0 };
            if (!stack) {
                return fallback;
            }
            const lines = stack.toString().split(/\r?\n/);
            for (const line of lines) {
                const match = line.match(/(?:at\s+.*?\()?([^\s()]+):(\d+):(\d+)/);
                if (match) {
                    return {
                        file: match[1],
                        line: parseInt(match[2], 10) || 0,
                        column: parseInt(match[3], 10) || 0
                    };
                }
            }
            return fallback;
        },

        getReport: function() {
            return {
                totalErrors: this.errors.length,
                totalWarnings: this.warnings.length,
                errors: this.errors,
                warnings: this.warnings,
                summary: this.getSummary()
            };
        },

        getSummary: function() {
            const summary = {
                errorsByContext: {},
                errorsByType: {}
            };

            this.errors.forEach(err => {
                summary.errorsByContext[err.context] =
                    (summary.errorsByContext[err.context] || 0) + 1;

                const errorType = this.categorizeError(err.message);
                summary.errorsByType[errorType] =
                    (summary.errorsByType[errorType] || 0) + 1;
            });

            return summary;
        },

        categorizeError: function(message) {
            if (message.includes('quota')) return 'QUOTA_ERROR';
            if (message.includes('not found') || message.includes('does not exist'))
                return 'NOT_FOUND';
            if (message.includes('permission') || message.includes('writable'))
                return 'PERMISSION_ERROR';
            if (message.includes('Unsupported')) return 'UNSUPPORTED_METHOD';
            if (message.includes('directory')) return 'DIRECTORY_ERROR';
            return 'OTHER';
        },

        exportReport: function() {
            const report = this.getReport();
            const blob = new Blob([JSON.stringify(report, null, 2)],
                { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `afio_test_report_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    // Test runner
    const TestRunner = {
        tests: [],
        results: {
            passed: 0,
            failed: 0,
            skipped: 0
        },

        addTest: function(name, testFn, options = {}) {
            // テストパラメータの検証
            if (!name || typeof name !== 'string') {
                console.error('[TestRunner] Invalid test name provided');
                return false;
            }
            if (typeof testFn !== 'function') {
                console.error(`[TestRunner] Invalid test function for "${name}"`);
                return false;
            }

            this.tests.push({
                name: name,
                fn: testFn,
                timeout: options.timeout || 5000,
                skip: options.skip || false,
                critical: options.critical || false,
                category: options.category || 'TEST',
                expectsErrors: options.expectsErrors || false
            });
            return true;
        },

        async runAll() {
            console.log('='.repeat(80));
            console.log('Starting AsyncFileIO Test Suite');
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
                // タイムアウト処理を強化（テスト名を含む詳細なエラーメッセージ）
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(
                        `Test timeout after ${test.timeout}ms: ${test.name}`
                    )), test.timeout);
                });

                // テスト実行前のエラーカウントを記録（予期されたエラーのテストはスキップ）
                let initialErrorCount;
                if (!test.expectsErrors) {
                    initialErrorCount = typeof GlobalErrorLogger !== 'undefined'
                        ? GlobalErrorLogger.errors.length
                        : ErrorTracker.errors.length;
                }

                // テストとタイムアウトを競合
                await Promise.race([
                    Promise.resolve().then(() => test.fn()),
                    timeoutPromise
                ]);

                // テスト実行後のエラーチェック（予期されたエラーのテストはスキップ）
                if (!test.expectsErrors) {
                    const currentErrorCount = typeof GlobalErrorLogger !== 'undefined'
                        ? GlobalErrorLogger.errors.length
                        : ErrorTracker.errors.length;

                    if (currentErrorCount > initialErrorCount) {
                        const newErrors = currentErrorCount - initialErrorCount;
                        const errorList = typeof GlobalErrorLogger !== 'undefined'
                            ? GlobalErrorLogger.errors.slice(initialErrorCount)
                            : ErrorTracker.errors.slice(initialErrorCount);

                        throw new Error(
                            `Test generated ${newErrors} error(s) during execution:\n` +
                            errorList.map(e => `- ${e.message}`).join('\n')
                        );
                    }
                }

                const duration = Date.now() - startTime;
                console.log(`[PASS] ${test.name} (${duration}ms)`);
                this.results.passed++;

            } catch (error) {
                const duration = Date.now() - startTime;
                console.error(`[FAIL] ${test.name} (${duration}ms)`);

                // GlobalErrorLoggerが利用可能な場合はそれを使用
                if (typeof GlobalErrorLogger !== 'undefined') {
                    GlobalErrorLogger.logError(test.name, error, {
                        critical: test.critical,
                        category: test.category || 'ASYNC_OPERATION',
                        severity: test.critical ? 'CRITICAL' : 'HIGH',
                        testDuration: duration,
                        testContext: {
                            name: test.name,
                            category: test.category,
                            timeout: test.timeout,
                            critical: test.critical
                        }
                    });
                } else {
                    // フォールバック: ErrorTrackerを使用
                    ErrorTracker.logError(test.name, error, { critical: test.critical });
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

            // GlobalErrorLoggerが利用可能な場合はそれを使用
            if (typeof GlobalErrorLogger !== 'undefined') {
                const report = GlobalErrorLogger.getReport();
                if (report.totalErrors > 0) {
                    console.log('\nGlobalErrorLogger Summary:');
                    console.log(`Total Errors: ${report.totalErrors}`);
                    console.log(`Total Warnings: ${report.totalWarnings}`);
                    if (report.summary.criticalErrors.length > 0) {
                        console.log(`\nCritical Errors: ${report.summary.criticalErrors.length}`);
                        report.summary.criticalErrors.forEach((err, i) => {
                            console.log(`  ${i + 1}. ${err.context}: ${err.message}`);
                        });
                    }
                    console.log('\nErrors by Category:');
                    console.log(JSON.stringify(report.summary.errorsByCategory, null, 2));
                    console.log('\nErrors by Severity:');
                    console.log(JSON.stringify(report.summary.errorsBySeverity, null, 2));
                }
            } else {
                // フォールバック: ErrorTrackerを使用
                const errorReport = ErrorTracker.getReport();
                if (errorReport.totalErrors > 0) {
                    console.log('\nError Summary:');
                    console.log(JSON.stringify(errorReport.summary, null, 2));
                }
            }
        }
    };

    // === BASIC VFS TESTS ===

    TestRunner.addTest('VFS: Initialization', async function() {
        if (!afio._vfs) {
            throw new Error('VFS not available');
        }
        await afio._vfs.init();
        if (!afio._vfs.initialized) {
            throw new Error('VFS initialization failed');
        }
    }, { critical: true });

    TestRunner.addTest('afio.isInstalled()', async function() {
        const installed = await afio.isInstalled();
        if (!installed) {
            throw new Error('afio.isInstalled() returned false');
        }
    }, { critical: true });

    TestRunner.addTest('afio.queryLimits()', async function() {
        const limits = await afio.queryLimits();
        if (!limits.maxFileSize || !limits.maxStorageSize) {
            throw new Error('queryLimits() returned invalid data');
        }
    });

    // === NODE OBJECT TESTS ===

    TestRunner.addTest('afio.openNode()', function() {
        const node = afio.openNode('/VirtualMacros/test.iim');
        if (!node || !node._path) {
            throw new Error('openNode() failed to create node');
        }
        if (node._path !== '/VirtualMacros/test.iim') {
            throw new Error('openNode() created node with wrong path');
        }
    }, { critical: true });

    TestRunner.addTest('NodeObject.path getter', function() {
        const node = afio.openNode('/VirtualMacros/test.iim');
        if (node.path !== '/VirtualMacros/test.iim') {
            throw new Error('NodeObject.path getter failed');
        }
    });

    TestRunner.addTest('NodeObject.leafName getter', function() {
        const node = afio.openNode('/VirtualMacros/test.iim');
        if (node.leafName !== 'test.iim') {
            throw new Error('NodeObject.leafName getter failed');
        }
    });

    TestRunner.addTest('NodeObject.parent getter', function() {
        const node = afio.openNode('/VirtualMacros/test.iim');
        const parent = node.parent;
        if (parent.path !== '/VirtualMacros') {
            throw new Error('NodeObject.parent getter failed');
        }
    });

    TestRunner.addTest('NodeObject.append()', function() {
        const node = afio.openNode('/VirtualMacros/');
        node.append('test.iim');
        if (node.path !== '/VirtualMacros/test.iim') {
            throw new Error('NodeObject.append() failed');
        }
    });

    TestRunner.addTest('NodeObject.clone()', function() {
        const node = afio.openNode('/VirtualMacros/test.iim');
        const clone = node.clone();
        if (clone.path !== node.path) {
            throw new Error('NodeObject.clone() failed');
        }
    });

    // === DIRECTORY TESTS ===

    TestRunner.addTest('afio.getLogicalDrives()', async function() {
        const drives = await afio.getLogicalDrives();
        if (!Array.isArray(drives) || drives.length === 0) {
            throw new Error('getLogicalDrives() failed');
        }
    });

    TestRunner.addTest('afio.getDefaultDir()', async function() {
        const savePath = await afio.getDefaultDir('savepath');
        if (!savePath || !savePath._path) {
            throw new Error('getDefaultDir(savepath) failed');
        }
    });

    TestRunner.addTest('afio.makeDirectory()', async function() {
        const dir = afio.openNode('/VirtualMacros/TestDir/');
        await afio.makeDirectory(dir);

        const exists = await dir.exists();
        if (!exists) {
            throw new Error('makeDirectory() did not create directory');
        }

        const isDir = await dir.isDir();
        if (!isDir) {
            throw new Error('Created path is not a directory');
        }
    });

    TestRunner.addTest('afio.getNodesInDir()', async function() {
        const dir = afio.openNode('/VirtualMacros/');
        const nodes = await afio.getNodesInDir(dir);

        if (!Array.isArray(nodes)) {
            throw new Error('getNodesInDir() did not return array');
        }
    });

    // === FILE OPERATION TESTS ===

    TestRunner.addTest('afio.writeTextFile()', async function() {
        const file = afio.openNode('/VirtualMacros/test_write.iim');
        const content = 'TAB T=1\nWAIT SECONDS=1';

        await afio.writeTextFile(file, content);

        const exists = await file.exists();
        if (!exists) {
            throw new Error('writeTextFile() did not create file');
        }
    });

    TestRunner.addTest('afio.readTextFile()', async function() {
        const file = afio.openNode('/VirtualMacros/test_read.iim');
        const content = 'TAB T=1\nWAIT SECONDS=1';

        await afio.writeTextFile(file, content);
        const readContent = await afio.readTextFile(file);

        if (readContent !== content) {
            throw new Error('readTextFile() returned different content');
        }
    });

    TestRunner.addTest('afio.appendTextFile()', async function() {
        const file = afio.openNode('/VirtualMacros/test_append.iim');

        await afio.writeTextFile(file, 'Line 1\n');
        await afio.appendTextFile(file, 'Line 2\n');

        const content = await afio.readTextFile(file);
        if (content !== 'Line 1\nLine 2\n') {
            throw new Error('appendTextFile() failed');
        }
    });

    TestRunner.addTest('NodeObject.exists()', async function() {
        const file = afio.openNode('/VirtualMacros/exists_test.iim');

        // Clean up any existing file from previous test runs
        // (VirtualFileService persists data across runs)
        const existsInitially = await file.exists();
        if (existsInitially) {
            await file.remove();
            // Verify cleanup was successful
            const stillExists = await file.exists();
            if (stillExists) {
                throw new Error('Failed to remove existing file during cleanup');
            }
        }

        let exists = await file.exists();
        if (exists) {
            throw new Error('Non-existent file reports as existing');
        }

        await afio.writeTextFile(file, 'test');
        exists = await file.exists();

        if (!exists) {
            throw new Error('exists() returned false for existing file');
        }
    });

    TestRunner.addTest('NodeObject.isWritable()', async function() {
        const file = afio.openNode('/VirtualMacros/writable_test.iim');
        const writable = await file.isWritable();

        if (!writable) {
            throw new Error('isWritable() returned false');
        }
    });

    TestRunner.addTest('NodeObject.isReadable()', async function() {
        const file = afio.openNode('/VirtualMacros/readable_test.iim');
        await afio.writeTextFile(file, 'test');

        const readable = await file.isReadable();
        if (!readable) {
            throw new Error('isReadable() returned false for existing file');
        }
    });

    TestRunner.addTest('NodeObject.copyTo()', async function() {
        const src = afio.openNode('/VirtualMacros/copy_src.iim');
        const dst = afio.openNode('/VirtualMacros/copy_dst.iim');

        await afio.writeTextFile(src, 'test content');
        await src.copyTo(dst);

        const exists = await dst.exists();
        if (!exists) {
            throw new Error('copyTo() did not create destination file');
        }

        const content = await afio.readTextFile(dst);
        if (content !== 'test content') {
            throw new Error('copyTo() did not copy content correctly');
        }
    });

    TestRunner.addTest('NodeObject.moveTo()', async function() {
        const src = afio.openNode('/VirtualMacros/move_src.iim');
        const dst = afio.openNode('/VirtualMacros/move_dst.iim');

        await afio.writeTextFile(src, 'test content');
        await src.moveTo(dst);

        const srcExists = await src.exists();
        const dstExists = await dst.exists();

        if (srcExists) {
            throw new Error('moveTo() did not remove source file');
        }
        if (!dstExists) {
            throw new Error('moveTo() did not create destination file');
        }
    });

    TestRunner.addTest('NodeObject.remove()', async function() {
        const file = afio.openNode('/VirtualMacros/remove_test.iim');

        await afio.writeTextFile(file, 'test');
        await file.remove();

        const exists = await file.exists();
        if (exists) {
            throw new Error('remove() did not delete file');
        }
    });

    // === IMAGE TESTS ===

    TestRunner.addTest('afio.writeImageToFile()', async function() {
        const file = afio.openNode('/VirtualMacros/test_image.png');
        const imageData = {
            image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            encoding: 'base64',
            mimeType: 'image/png'
        };

        await afio.writeImageToFile(file, imageData);

        const exists = await file.exists();
        if (!exists) {
            throw new Error('writeImageToFile() did not create file');
        }
    });

    // === USAGE PATTERN TESTS (from actual codebase) ===

    TestRunner.addTest('Usage: mplayer.js pattern - writeTextFile with default dir', async function() {
        // Simulates: var default_dir = afio.openNode(localStorage["defdatapath"]);
        localStorage["defdatapath"] = "/VirtualMacros/Datasources/";
        const defaultDir = afio.openNode(localStorage["defdatapath"]);
        const file = defaultDir.clone();
        file.append('test_datasource.csv');

        await afio.writeTextFile(file, 'col1,col2\nval1,val2');

        const content = await afio.readTextFile(file);
        if (!content.includes('col1,col2')) {
            throw new Error('mplayer.js pattern test failed');
        }
    });

    TestRunner.addTest('Usage: bg.js pattern - getDefaultDir and makeDirectory', async function() {
        // Simulates: afio.getDefaultDir("savepath").then(...)
        const savepath = await afio.getDefaultDir("savepath");
        const testDir = savepath.clone();
        testDir.append('TestSubDir');

        await afio.makeDirectory(testDir);

        const exists = await testDir.exists();
        if (!exists) {
            throw new Error('bg.js pattern test failed');
        }
    });

    TestRunner.addTest('Usage: fileView.js pattern - getNodesInDir with filter', async function() {
        // Simulates: afio.getNodesInDir(root_node).then(...)
        const dir = afio.openNode('/VirtualMacros/');

        // Create some test files
        await afio.writeTextFile(afio.openNode('/VirtualMacros/test1.iim'), 'test');
        await afio.writeTextFile(afio.openNode('/VirtualMacros/test2.iim'), 'test');
        await afio.writeTextFile(afio.openNode('/VirtualMacros/test.txt'), 'test');

        const nodes = await afio.getNodesInDir(dir);

        if (!Array.isArray(nodes) || nodes.length === 0) {
            throw new Error('fileView.js pattern test failed');
        }
    });

    // === EDGE CASE TESTS ===

    TestRunner.addTest('Edge: Large file handling', async function() {
        const file = afio.openNode('/VirtualMacros/large_file.txt');
        const largeContent = 'x'.repeat(1024 * 100); // 100KB

        await afio.writeTextFile(file, largeContent);
        const content = await afio.readTextFile(file);

        if (content.length !== largeContent.length) {
            throw new Error('Large file handling failed');
        }
    });

    TestRunner.addTest('Edge: Path with special characters', async function() {
        const file = afio.openNode('/VirtualMacros/test-file_123.iim');
        await afio.writeTextFile(file, 'test');

        const exists = await file.exists();
        if (!exists) {
            throw new Error('Special character path handling failed');
        }
    });

    TestRunner.addTest('Edge: Nested directory creation', async function() {
        const deepDir = afio.openNode('/VirtualMacros/Level1/Level2/Level3/');
        await afio.makeDirectory(deepDir);

        const exists = await deepDir.exists();
        if (!exists) {
            throw new Error('Nested directory creation failed');
        }
    });

    TestRunner.addTest('Edge: Empty file handling', async function() {
        const file = afio.openNode('/VirtualMacros/empty.txt');
        await afio.writeTextFile(file, '');

        const content = await afio.readTextFile(file);
        if (content !== '') {
            throw new Error('Empty file handling failed');
        }
    });

    TestRunner.addTest('Error: Read non-existent file', async function() {
        const file = afio.openNode('/VirtualMacros/nonexistent.iim');

        try {
            await afio.readTextFile(file);
            throw new Error('Should have thrown error for non-existent file');
        } catch (e) {
            if (!e.message.includes('does not exist')) {
                throw new Error('Wrong error message: ' + e.message);
            }
        }
    }, { expectsErrors: true });

    TestRunner.addTest('Error: Directory as file operations', async function() {
        const dir = afio.openNode('/VirtualMacros/');

        try {
            await afio.readTextFile(dir);
            throw new Error('Should have thrown error reading directory as file');
        } catch (e) {
            if (!e.message.includes('directory')) {
                throw new Error('Wrong error message: ' + e.message);
            }
        }
    }, { expectsErrors: true });

    TestRunner.addTest('afio.getBackendType()', async function() {
        await afio._vfs.init();
        await afio.isInstalled();
        const backendType = afio.getBackendType();
        if (!backendType || typeof backendType !== 'string') {
            throw new Error('Backend type not reported');
        }
    });

    TestRunner.addTest('VirtualFileService export/import', async function() {
        await afio._vfs.init();
        const file = afio.openNode('/VirtualMacros/export_check.iim');
        await afio.writeTextFile(file, 'EXPORT TEST');
        const bundle = await afio._vfs.exportTree();
        if (!bundle.files['/VirtualMacros/export_check.iim']) {
            throw new Error('Export bundle missing test file');
        }
        const isolatedService = new VirtualFileService({
            storageKeys: {
                tree: 'vfs_tree_test_suite',
                config: 'vfs_config_test_suite',
                stats: 'vfs_stats_test_suite',
                deleted: 'vfs_deleted_test_suite'
            }
        });
        await isolatedService.importTree(bundle);
        const imported = await isolatedService.readTextFile('/VirtualMacros/export_check.iim');
        if (imported !== 'EXPORT TEST') {
            throw new Error('Import bundle did not round-trip data');
        }
        await afio._vfs.node_remove('/VirtualMacros/export_check.iim');
        const cleanupKeys = ['vfs_tree_test_suite', 'vfs_config_test_suite', 'vfs_stats_test_suite', 'vfs_deleted_test_suite'];
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await new Promise((resolve) => chrome.storage.local.remove(cleanupKeys, resolve));
        } else {
            cleanupKeys.forEach((key) => localStorage.removeItem(key));
        }
    });

    TestRunner.addTest('FileSyncBridge emits change events', async function() {
        await afio._vfs.init();
        const bridge = new FileSyncBridge({ mode: 'background', vfs: afio._vfs, exportInterval: 60000 });
        const events = [];
        const unsubscribe = bridge.onChange((event) => events.push(event));
        bridge.start();
        const node = afio.openNode('/VirtualMacros/bridge_test.iim');
        await afio.writeTextFile(node, 'BRIDGE');
        await new Promise((resolve) => setTimeout(resolve, 100));
        unsubscribe();
        bridge.stop();
        const seen = events.some((event) => event && event.path === '/VirtualMacros/bridge_test.iim');
        if (!seen) {
            throw new Error('FileSyncBridge did not emit change event for write');
        }
        await afio._vfs.node_remove('/VirtualMacros/bridge_test.iim');
    });

    TestRunner.addTest('ErrorTracker captures locations', function() {
        const initialLength = ErrorTracker.errors.length;
        try {
            throw new Error('Synthetic failure');
        } catch (err) {
            ErrorTracker.logError('SyntheticTest', err);
        }
        const lastEntry = ErrorTracker.errors[ErrorTracker.errors.length - 1];
        if (!lastEntry || lastEntry.file === 'unknown' || lastEntry.line <= 0) {
            throw new Error('ErrorTracker did not capture file/line information');
        }
        ErrorTracker.errors.pop();
        if (ErrorTracker.errors.length !== initialLength) {
            throw new Error('ErrorTracker cleanup failed');
        }
    });

    // Export test suite
    window.AfioTestSuite = {
        run: async function() {
            try {
                const results = await TestRunner.runAll();
                const report = ErrorTracker.getReport();

                return {
                    success: results.failed === 0,
                    results: results,
                    errors: report,
                    exportReport: ErrorTracker.exportReport.bind(ErrorTracker)
                };
            } catch (e) {
                ErrorTracker.logError('TEST_SUITE', e);
                return {
                    success: false,
                    fatalError: e.message,
                    errors: ErrorTracker.getReport()
                };
            }
        },

        getErrorReport: function() {
            return ErrorTracker.getReport();
        },

        exportErrorReport: function() {
            ErrorTracker.exportReport();
        }
    };

    console.log('AsyncFileIO Test Suite loaded. Run with: AfioTestSuite.run()');
})();
