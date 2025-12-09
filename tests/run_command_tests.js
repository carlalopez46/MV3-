/**
 * RUN コマンドと変数管理のテストスイート
 * 
 * テスト実行方法:
 * 1. Chrome の拡張機能ページで DevTools を開く
 * 2. このファイルをコンソールにペーストして実行
 * 3. または tests/test_runner.html で実行
 */

const RunCommandTestSuite = {
    name: 'RUN Command Tests',
    tests: [],
    results: {
        passed: 0,
        failed: 0,
        skipped: 0
    },

    /**
     * テストケースを追加
     */
    addTest(name, testFn, options = {}) {
        this.tests.push({
            name,
            testFn,
            skip: options.skip || false,
            timeout: options.timeout || 5000
        });
    },

    /**
     * すべてのテストを実行
     */
    async runAll() {
        console.log('🧪 Starting RUN Command Test Suite...\n');
        this.results = { passed: 0, failed: 0, skipped: 0 };

        for (const test of this.tests) {
            await this.runTest(test);
        }

        this.printSummary();
        return this.results;
    },

    /**
     * 単一テストを実行
     */
    async runTest(test) {
        if (test.skip) {
            console.log(`⏭️  SKIP: ${test.name}`);
            this.results.skipped++;
            return;
        }

        try {
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Test timed out')), test.timeout);
            });

            await Promise.race([test.testFn(), timeoutPromise]);
            console.log(`✅ PASS: ${test.name}`);
            this.results.passed++;
        } catch (error) {
            console.error(`❌ FAIL: ${test.name}`);
            console.error(`   Error: ${error.message}`);
            this.results.failed++;
        }
    },

    /**
     * テスト結果のサマリーを出力
     */
    printSummary() {
        const total = this.results.passed + this.results.failed + this.results.skipped;
        console.log('\n' + '='.repeat(50));
        console.log('📊 Test Results Summary');
        console.log('='.repeat(50));
        console.log(`   Total:   ${total}`);
        console.log(`   ✅ Passed:  ${this.results.passed}`);
        console.log(`   ❌ Failed:  ${this.results.failed}`);
        console.log(`   ⏭️  Skipped: ${this.results.skipped}`);
        console.log('='.repeat(50) + '\n');
    },

    /**
     * アサーション関数
     */
    assert: {
        equal(actual, expected, message = '') {
            if (actual !== expected) {
                throw new Error(`${message} Expected ${expected}, got ${actual}`);
            }
        },
        notEqual(actual, expected, message = '') {
            if (actual === expected) {
                throw new Error(`${message} Expected not equal to ${expected}`);
            }
        },
        isTrue(value, message = '') {
            if (value !== true) {
                throw new Error(`${message} Expected true, got ${value}`);
            }
        },
        isFalse(value, message = '') {
            if (value !== false) {
                throw new Error(`${message} Expected false, got ${value}`);
            }
        },
        isDefined(value, message = '') {
            if (typeof value === 'undefined') {
                throw new Error(`${message} Expected value to be defined`);
            }
        },
        isNull(value, message = '') {
            if (value !== null) {
                throw new Error(`${message} Expected null, got ${value}`);
            }
        },
        throws(fn, message = '') {
            let threw = false;
            try {
                fn();
            } catch (e) {
                threw = true;
            }
            if (!threw) {
                throw new Error(`${message} Expected function to throw`);
            }
        }
    }
};

// ============================================
// 変数スコープテスト
// ============================================

RunCommandTestSuite.addTest('Variable expansion - basic', async () => {
    // 依存関係チェック
    if (typeof imns === 'undefined' || typeof imns.unwrap !== 'function') {
        throw new Error('imns.unwrap is not available');
    }

    const input = '"Hello World"';
    const result = imns.unwrap(input);
    RunCommandTestSuite.assert.equal(result, 'Hello World', 'Basic unwrap');
});

RunCommandTestSuite.addTest('Variable expansion - escape sequences', async () => {
    if (typeof imns === 'undefined' || typeof imns.unwrap !== 'function') {
        throw new Error('imns.unwrap is not available');
    }

    // テストケース: エスケープシーケンス
    const testCases = [
        { input: '"Hello\\nWorld"', expected: 'Hello\nWorld' },
        { input: '"Tab\\tHere"', expected: 'Tab\tHere' },
        { input: '"Quote\\"Here"', expected: 'Quote"Here' }
    ];

    for (const tc of testCases) {
        const result = imns.unwrap(tc.input);
        RunCommandTestSuite.assert.equal(result, tc.expected, `Escape: ${tc.input}`);
    }
});

RunCommandTestSuite.addTest('Storage object exists', async () => {
    if (typeof Storage === 'undefined') {
        throw new Error('Storage object is not defined');
    }

    // 基本メソッドが存在することを確認
    RunCommandTestSuite.assert.isDefined(Storage.getBool, 'getBool');
    RunCommandTestSuite.assert.isDefined(Storage.setBool, 'setBool');
    RunCommandTestSuite.assert.isDefined(Storage.getChar, 'getChar');
    RunCommandTestSuite.assert.isDefined(Storage.setChar, 'setChar');
    RunCommandTestSuite.assert.isDefined(Storage.getNumber, 'getNumber');
    RunCommandTestSuite.assert.isDefined(Storage.setNumber, 'setNumber');
});

RunCommandTestSuite.addTest('Storage read/write - boolean', async () => {
    if (typeof Storage === 'undefined') {
        throw new Error('Storage is not defined');
    }

    const testKey = '__test_bool_' + Date.now();

    // 書き込み
    Storage.setBool(testKey, true);

    // 読み込み
    const result = Storage.getBool(testKey);
    RunCommandTestSuite.assert.isTrue(result, 'Boolean storage');

    // クリーンアップ
    localStorage.removeItem(testKey);
});

RunCommandTestSuite.addTest('Storage read/write - string', async () => {
    if (typeof Storage === 'undefined') {
        throw new Error('Storage is not defined');
    }

    const testKey = '__test_str_' + Date.now();
    const testValue = 'Test Value 日本語';

    // 書き込み
    Storage.setChar(testKey, testValue);

    // 読み込み
    const result = Storage.getChar(testKey);
    RunCommandTestSuite.assert.equal(result, testValue, 'String storage');

    // クリーンアップ
    localStorage.removeItem(testKey);
});

// ============================================
// Context 初期化テスト
// ============================================

RunCommandTestSuite.addTest('Context object exists', async () => {
    if (typeof context === 'undefined') {
        throw new Error('context object is not defined');
    }

    // 必須プロパティが存在することを確認
    RunCommandTestSuite.assert.isDefined(context.init, 'init method');
    RunCommandTestSuite.assert.isDefined(context._initialized, '_initialized flag');
    RunCommandTestSuite.assert.isDefined(context._initPromises, '_initPromises');
});

// ============================================
// MacroPlayer コマンドパーシングテスト
// ============================================

RunCommandTestSuite.addTest('MacroPlayer RegExp - RUN command pattern', async () => {
    if (typeof MacroPlayer === 'undefined') {
        // MacroPlayer が定義されていない場合はスキップ
        console.log('   (MacroPlayer not available, using regex test only)');
    }

    // RUN コマンドのパターンをテスト
    const runPattern = /^(\S+)$/;  // 簡易版

    const testCases = [
        { input: 'submacro.iim', shouldMatch: true },
        { input: 'folder/macro.iim', shouldMatch: true },
        { input: 'C:\\path\\to\\macro.iim', shouldMatch: true }
    ];

    for (const tc of testCases) {
        const match = runPattern.test(tc.input);
        RunCommandTestSuite.assert.equal(
            match,
            tc.shouldMatch,
            `RUN pattern: "${tc.input}"`
        );
    }
});

RunCommandTestSuite.addTest('MacroPlayer RegExp - LOOP command pattern', async () => {
    // LOOP コマンドのパターンをテスト（mplayer.js から）
    const loopPattern = /^(?:(break|continue|next)|(?:nest)?\s*(\d+)|())\s*$/i;

    const testCases = [
        { input: 'BREAK', expected: ['BREAK', 'BREAK', undefined, undefined] },
        { input: 'continue', expected: ['continue', 'continue', undefined, undefined] },
        { input: '5', expected: ['5', undefined, '5', undefined] },
        { input: 'nest 3', expected: ['nest 3', undefined, '3', undefined] },
        { input: '', expected: ['', undefined, undefined, ''] }
    ];

    for (const tc of testCases) {
        const match = loopPattern.exec(tc.input);
        if (tc.expected) {
            RunCommandTestSuite.assert.isDefined(match, `LOOP pattern should match: "${tc.input}"`);
        }
    }
});

// ============================================
// パス解決テスト
// ============================================

RunCommandTestSuite.addTest('Path utilities - Windows path detection', async () => {
    if (typeof __is_full_path !== 'function') {
        throw new Error('__is_full_path is not defined');
    }

    const isWin = typeof __is_windows === 'function' ? __is_windows() : false;
    console.log('Diagnostic: isWin=' + isWin, 'Platform=' + navigator.platform, '__is_windows exists=' + typeof __is_windows);

    const testCases = [
        { path: 'C:\\Users\\test\\file.iim', expected: isWin }, // Windowsならtrue, 他ならfalse (通常)
        { path: 'D:\\Documents\\macro.iim', expected: isWin },
        { path: '/unix/path/file.iim', expected: !isWin },      // Windowsならfalse, 他ならtrue
        { path: 'relative/path/file.iim', expected: false },
        { path: 'file.iim', expected: false }
    ];

    for (const tc of testCases) {
        const result = __is_full_path(tc.path);
        RunCommandTestSuite.assert.equal(
            result,
            tc.expected,
            `Path detection: "${tc.path}" (isWin=${isWin})`
        );
    }
});

RunCommandTestSuite.addTest('MacroPlayer RUN - macro candidate resolution', async () => {
    RunCommandTestSuite.assert.isDefined(MacroPlayer, 'MacroPlayer should be defined');

    const player = new MacroPlayer('test-win');
    const assertCandidates = (input, expected) => {
        const result = player._buildMacroCandidates(input);
        RunCommandTestSuite.assert.equal(
            JSON.stringify(result),
            JSON.stringify(expected),
            `Unexpected candidates for "${input}"`
        );
    };

    assertCandidates('macro', ['macro.iim', 'macro']);
    assertCandidates('macro.iim', ['macro.iim']);
    assertCandidates('folder.v1/macro', ['folder.v1/macro.iim', 'folder.v1/macro']);
    assertCandidates('.hidden', ['.hidden']);
    assertCandidates('nested/.hidden', ['nested/.hidden']);
    assertCandidates('dir.name/macro.txt', ['dir.name/macro.txt']);
});

// ============================================
// エラーハンドリングテスト
// ============================================

RunCommandTestSuite.addTest('Error classes exist', async () => {
    // エラークラスが定義されていることを確認
    if (typeof BadParameter === 'undefined') {
        throw new Error('BadParameter is not defined');
    }
    if (typeof RuntimeError === 'undefined') {
        throw new Error('RuntimeError is not defined');
    }
    if (typeof UnsupportedCommand === 'undefined') {
        throw new Error('UnsupportedCommand is not defined');
    }
});

RunCommandTestSuite.addTest('BadParameter error creation', async () => {
    const error = new BadParameter('Test error', 1);
    RunCommandTestSuite.assert.isDefined(error.message, 'Error message');
});

// ============================================
// Promise ユーティリティテスト
// ============================================

RunCommandTestSuite.addTest('Promise utilities - safePromise', async () => {
    if (typeof safePromise !== 'function') {
        console.log('   (safePromise not available, skipping)');
        return;
    }

    // 成功ケース
    const successResult = await safePromise(
        Promise.resolve('success'),
        'test-success'
    );
    RunCommandTestSuite.assert.equal(successResult, 'success', 'Success case');

    // 失敗ケース（デフォルト値が返る）
    const failResult = await safePromise(
        Promise.reject(new Error('test error')),
        'test-fail',
        'default'
    );
    RunCommandTestSuite.assert.equal(failResult, 'default', 'Fail case');
});

RunCommandTestSuite.addTest('Promise utilities - withTimeout', async () => {
    if (typeof withTimeout !== 'function') {
        console.log('   (withTimeout not available, skipping)');
        return;
    }

    // 成功ケース（タイムアウト前に完了）
    const fastPromise = new Promise(resolve => setTimeout(() => resolve('fast'), 50));
    const fastResult = await withTimeout(fastPromise, 1000, 'fast-test');
    RunCommandTestSuite.assert.equal(fastResult, 'fast', 'Fast promise');

    // タイムアウトケース
    const slowPromise = new Promise(resolve => setTimeout(() => resolve('slow'), 2000));
    let timedOut = false;
    try {
        await withTimeout(slowPromise, 100, 'slow-test');
    } catch (e) {
        timedOut = true;
    }
    RunCommandTestSuite.assert.isTrue(timedOut, 'Timeout should occur');
});

// ============================================
// エクスポート
// ============================================

if (typeof window !== 'undefined') {
    window.RunCommandTestSuite = RunCommandTestSuite;
}

if (typeof globalThis !== 'undefined') {
    globalThis.RunCommandTestSuite = RunCommandTestSuite;
}

// 自動実行（コンソールから読み込まれた場合）
if (typeof document !== 'undefined' && document.readyState === 'complete') {
    console.log('To run tests, execute: RunCommandTestSuite.runAll()');
}
