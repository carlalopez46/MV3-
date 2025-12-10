/**
 * Integration Test for GlobalErrorLogger + errorLogger.js compatibility
 * 
 * This test verifies that:
 * 1. GlobalErrorLogger is loaded and functional
 * 2. Legacy errorLogger.js functions delegate to GlobalErrorLogger
 * 3. Both APIs work correctly
 */

// Mock browser environment
global.window = {
    addEventListener: () => { },
    location: { href: 'http://localhost/test' },
    screen: { width: 1920, height: 1080 }
};
global.self = global.window;
global.navigator = {
    userAgent: 'Test/1.0',
    platform: 'Test',
    language: 'en-US'
};

// Mock localStorage to prevent errors
global.localStorage = {
    _data: {},
    getItem(key) {
        return this._data[key] || null;
    },
    setItem(key, value) {
        this._data[key] = String(value);
    },
    removeItem(key) {
        delete this._data[key];
    },
    clear() {
        this._data = {};
    }
};
global.window.localStorage = global.localStorage;

// Load GlobalErrorLogger first (simulating background.js load order)
require('../GlobalErrorLogger.js');
// Mirror browser global resolution semantics so that references to GlobalErrorLogger
// resolve even when accessed as a global variable (as they would on window).
global.GlobalErrorLogger = global.window.GlobalErrorLogger;

// Load errorLogger (which should detect GlobalErrorLogger and use it as backend)
require('../errorLogger.js');

console.log('\n=== Integration Test: GlobalErrorLogger + errorLogger.js ===\n');

// Test 1: GlobalErrorLogger is available
console.log('Test 1: GlobalErrorLogger availability');
if (typeof global.window.GlobalErrorLogger === 'undefined') {
    console.error('❌ FAIL: GlobalErrorLogger not loaded');
    process.exit(1);
}
console.log('✅ PASS: GlobalErrorLogger is available');

// Test 2: Legacy functions are available
console.log('\nTest 2: Legacy function availability');
const legacyFunctions = ['logError', 'logWarning', 'logInfo'];
for (const fn of legacyFunctions) {
    if (typeof global.window[fn] !== 'function') {
        console.error(`❌ FAIL: ${fn} not available`);
        process.exit(1);
    }
}
console.log('✅ PASS: All legacy functions available');

// Test 3: Legacy functions delegate to GlobalErrorLogger
console.log('\nTest 3: Legacy functions delegate to GlobalErrorLogger');
global.window.GlobalErrorLogger.clear();

// Call legacy function
global.window.logInfo('Test message', 'TestContext');

// Check if it was recorded in GlobalErrorLogger
const report = global.window.GlobalErrorLogger.getReport();
if (report.totalInfos !== 1) {
    console.error(`❌ FAIL: Expected 1 info, got ${report.totalInfos}`);
    process.exit(1);
}

const entry = report.infos[0];
if (entry.context !== 'TestContext') {
    console.error(`❌ FAIL: Context mismatch. Expected 'TestContext', got '${entry.context}'`);
    process.exit(1);
}

if (entry.message !== 'Test message') {
    console.error(`❌ FAIL: Message mismatch. Expected 'Test message', got '${entry.message}'`);
    process.exit(1);
}

console.log('✅ PASS: Legacy logInfo delegates to GlobalErrorLogger');
console.log(`   - Context: ${entry.context}`);
console.log(`   - Message: ${entry.message}`);
console.log(`   - File: ${entry.file}:${entry.line}`);

// Test 4: Direct GlobalErrorLogger calls work
console.log('\nTest 4: Direct GlobalErrorLogger API');
global.window.GlobalErrorLogger.clear();

global.window.GlobalErrorLogger.logError('DirectContext', 'Direct error message');

const report2 = global.window.GlobalErrorLogger.getReport();
if (report2.totalErrors !== 1) {
    console.error(`❌ FAIL: Expected 1 error, got ${report2.totalErrors}`);
    process.exit(1);
}

console.log('✅ PASS: Direct GlobalErrorLogger.logError works');

// Test 5: Both APIs coexist
console.log('\nTest 5: Both APIs coexist');
global.window.GlobalErrorLogger.clear();

// Mix of legacy and new API calls
global.window.logInfo('Legacy info', 'LegacyContext');
global.window.GlobalErrorLogger.logWarning('NewContext', 'New warning');
global.window.logError('Legacy error', 'LegacyErrorContext');

const report3 = global.window.GlobalErrorLogger.getReport();
if (report3.totalInfos !== 1 || report3.totalWarnings !== 1 || report3.totalErrors !== 1) {
    console.error(`❌ FAIL: Expected 1 info, 1 warning, 1 error. Got ${report3.totalInfos}, ${report3.totalWarnings}, ${report3.totalErrors}`);
    process.exit(1);
}

console.log('✅ PASS: Both APIs coexist and record correctly');
console.log(`   - Total Infos: ${report3.totalInfos}`);
console.log(`   - Total Warnings: ${report3.totalWarnings}`);
console.log(`   - Total Errors: ${report3.totalErrors}`);

// Test 6: Legacy logCritical passes through extra details
console.log('\nTest 6: Legacy logCritical passes severity details');
global.window.GlobalErrorLogger.clear();

global.window.logCritical('Critical message', 'CriticalContext');

const criticalReport = global.window.GlobalErrorLogger.getReport();
const criticalEntry = criticalReport.errors[0];

if (criticalReport.totalErrors !== 1) {
    console.error(`❌ FAIL: Expected 1 critical error, got ${criticalReport.totalErrors}`);
    process.exit(1);
}

if (!criticalEntry.details || criticalEntry.details.severity !== 'CRITICAL') {
    console.error('❌ FAIL: logCritical did not forward severity detail');
    process.exit(1);
}

console.log('✅ PASS: Legacy logCritical forwards severity detail to GlobalErrorLogger');

// Test 6: GlobalErrorLogger.logFileError wrapper
console.log('\nTest 7: GlobalErrorLogger.logFileError wrapper availability');
global.window.GlobalErrorLogger.clear();

if (typeof global.window.GlobalErrorLogger.logFileError !== 'function') {
    console.error('❌ FAIL: GlobalErrorLogger.logFileError is not available');
    process.exit(1);
}

global.window.GlobalErrorLogger.logFileError('FileContext', new Error('IO failure'));

const fileErrorReport = global.window.GlobalErrorLogger.getReport();
const fileErrorEntry = fileErrorReport.errors[0];

if (fileErrorReport.totalErrors !== 1) {
    console.error(`❌ FAIL: Expected 1 file error, got ${fileErrorReport.totalErrors}`);
    process.exit(1);
}

if (fileErrorEntry.details.errorCode !== global.window.GlobalErrorLogger.FILE_ERROR_CODES.FILE_BACKEND_ERROR) {
    console.error('❌ FAIL: logFileError did not apply default FILE_BACKEND_ERROR code');
    process.exit(1);
}

console.log('✅ PASS: GlobalErrorLogger.logFileError is available and records file errors');
console.log(`   - Error code: ${fileErrorEntry.details.errorCode}`);
console.log(`   - Category: ${fileErrorEntry.details.category}`);

// Test 7: Stack trace accuracy
console.log('\nTest 8: Stack trace accuracy');
global.window.GlobalErrorLogger.clear();

// Line 123: This should be captured
global.window.logInfo('Stack trace test', 'StackContext');

const report4 = global.window.GlobalErrorLogger.getReport();
const stackEntry = report4.infos[0];

console.log(`   - Captured file: ${stackEntry.file}`);
console.log(`   - Captured line: ${stackEntry.line}`);

if (stackEntry.file === 'unknown' || stackEntry.line === 0) {
    console.error('❌ FAIL: Stack trace not captured correctly');
    process.exit(1);
}

console.log('✅ PASS: Stack trace captured');

console.log('\n=== All Integration Tests Passed! ===\n');
console.log('Summary:');
console.log('- GlobalErrorLogger loaded successfully');
console.log('- Legacy functions delegate to GlobalErrorLogger');
console.log('- Both APIs work correctly');
console.log('- Stack traces are captured accurately');
console.log('\nThe integration is working as expected.');

process.exit(0);
