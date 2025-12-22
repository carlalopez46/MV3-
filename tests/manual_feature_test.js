#!/usr/bin/env node
/**
 * Manual Feature Test Script
 *
 * Tests critical functionality that can be verified without browser:
 * 1. Module loading and dependencies
 * 2. Code structure validation
 * 3. Critical function existence
 */

const fs = require('fs');
const path = require('path');

class FeatureTestRunner {
    constructor() {
        this.results = {
            passed: 0,
            failed: 0,
            warnings: 0
        };
        this.errors = [];
    }

    log(message, type = 'info') {
        const colors = {
            info: '\x1b[36m',
            success: '\x1b[32m',
            error: '\x1b[31m',
            warning: '\x1b[33m',
            reset: '\x1b[0m'
        };
        console.log(`${colors[type]}${message}${colors.reset}`);
    }

    pass(testName) {
        this.results.passed++;
        this.log(`✓ ${testName}`, 'success');
    }

    fail(testName, error) {
        this.results.failed++;
        this.errors.push({ test: testName, error: error.message || error });
        this.log(`✗ ${testName}: ${error.message || error}`, 'error');
    }

    warn(testName, warning) {
        this.results.warnings++;
        this.log(`⚠ ${testName}: ${warning}`, 'warning');
    }

    // Test 1: Check critical files exist
    testCriticalFilesExist() {
        this.log('\n=== Test 1: Critical Files Existence ===', 'info');

        const criticalFiles = [
            'background.js',
            'panel.js',
            'communicator.js',
            'AsyncFileIO.js',
            'utils.js',
            'bg.js',
            'mplayer.js',
            'manifest.json',
            'GlobalErrorLogger.js',
            'VirtualFileService.js',
            'WindowsPathMappingService.js',
            'FileSystemAccessService.js',
            'FileSyncBridge.js'
        ];

        for (const file of criticalFiles) {
            try {
                const filePath = path.join(process.cwd(), file);
                if (fs.existsSync(filePath)) {
                    this.pass(`File exists: ${file}`);
                } else {
                    this.fail(`File missing: ${file}`, new Error('File not found'));
                }
            } catch (err) {
                this.fail(`File check: ${file}`, err);
            }
        }
    }

    // Test 2: Check for common anti-patterns
    testCodeQuality() {
        this.log('\n=== Test 2: Code Quality Checks ===', 'info');

        const filesToCheck = [
            'background.js',
            'panel.js',
            'communicator.js',
            'bg.js'
        ];

        const antiPatterns = [
            { pattern: /chrome\.runtime\.getBackgroundPage\(/g, message: 'MV2 getBackgroundPage() usage detected' },
            { pattern: /chrome\.extension\.getBackgroundPage\(/g, message: 'Deprecated chrome.extension API usage' },
            { pattern: /window\.localStorage\[/g, message: 'Direct localStorage access (should use Storage polyfill)', severity: 'warning' },
            { pattern: /console\.log\(/g, message: 'console.log usage (consider using error logger)', severity: 'warning' }
        ];

        for (const file of filesToCheck) {
            try {
                const filePath = path.join(process.cwd(), file);
                if (!fs.existsSync(filePath)) continue;

                const content = fs.readFileSync(filePath, 'utf8');

                for (const { pattern, message, severity = 'error' } of antiPatterns) {
                    const matches = content.match(pattern);
                    if (matches && matches.length > 0) {
                        if (severity === 'warning') {
                            this.warn(`${file}`, `${message} (${matches.length} occurrences)`);
                        } else {
                            this.fail(`${file}`, new Error(`${message} (${matches.length} occurrences)`));
                        }
                    }
                }
            } catch (err) {
                this.fail(`Code quality check: ${file}`, err);
            }
        }

        this.pass('Code quality checks completed');
    }

    // Test 3: Verify message passing implementation
    testMessagePassingImplementation() {
        this.log('\n=== Test 3: Message Passing Implementation ===', 'info');

        const filesToCheck = [
            {
                file: 'communicator.js',
                patterns: ['chrome.tabs.sendMessage', 'chrome.runtime.onMessage'],
                description: 'Background-side communicator (uses tabs API)'
            },
            {
                file: 'background.js',
                patterns: ['chrome.runtime.onMessage', 'sendResponse', 'CALL_BG_FUNCTION'],
                description: 'Background message handlers'
            },
            {
                file: 'panel.js',
                patterns: ['chrome.runtime.sendMessage', 'CALL_BG_FUNCTION'],
                description: 'Panel message sending (uses runtime API)'
            }
        ];

        for (const { file, patterns, description } of filesToCheck) {
            try {
                const filePath = path.join(process.cwd(), file);
                if (!fs.existsSync(filePath)) {
                    this.warn(`Message passing: ${file}`, 'File not found, skipping');
                    continue;
                }

                const content = fs.readFileSync(filePath, 'utf8');
                let allPatternsFound = true;

                for (const pattern of patterns) {
                    if (!content.includes(pattern)) {
                        allPatternsFound = false;
                        this.fail(`Message passing: ${file}`, new Error(`Missing pattern: ${pattern}`));
                    }
                }

                if (allPatternsFound) {
                    this.pass(`Message passing: ${description}`);
                }
            } catch (err) {
                this.fail(`Message passing check: ${file}`, err);
            }
        }
    }

    // Test 4: Check AsyncFileIO structure
    testAsyncFileIOStructure() {
        this.log('\n=== Test 4: AsyncFileIO Structure ===', 'info');

        try {
            const filePath = path.join(process.cwd(), 'AsyncFileIO.js');
            if (!fs.existsSync(filePath)) {
                this.fail('AsyncFileIO structure', new Error('AsyncFileIO.js not found'));
                return;
            }

            const content = fs.readFileSync(filePath, 'utf8');

            // Check for critical methods
            const criticalMethods = [
                'isInstalled',
                'openNode',
                'getDefaultDir',
                'readTextFile',
                'writeTextFile',
                'exists',
                'getNodesInDir',
                'makeDirectory',
                'remove'
            ];

            for (const method of criticalMethods) {
                // Check both traditional and arrow function definitions
                const hasMethod = content.includes(`${method}:`) ||
                                  content.includes(`${method} =`) ||
                                  content.includes(`function ${method}(`);

                if (hasMethod) {
                    this.pass(`AsyncFileIO method: ${method}`);
                } else {
                    this.fail(`AsyncFileIO method: ${method}`, new Error('Method not found'));
                }
            }

            // Check for VFS implementation
            if (content.includes('VirtualFileService') || content.includes('_vfs')) {
                this.pass('AsyncFileIO VFS integration');
            } else {
                this.warn('AsyncFileIO VFS integration', 'VFS integration not detected');
            }

        } catch (err) {
            this.fail('AsyncFileIO structure check', err);
        }
    }

    // Test 5: Validate manifest.json
    testManifestValidity() {
        this.log('\n=== Test 5: Manifest Validation ===', 'info');

        try {
            const manifestPath = path.join(process.cwd(), 'manifest.json');
            const manifestContent = fs.readFileSync(manifestPath, 'utf8');
            const manifest = JSON.parse(manifestContent);

            // Check manifest version
            if (manifest.manifest_version === 3) {
                this.pass('Manifest version 3');
            } else {
                this.fail('Manifest version', new Error(`Expected version 3, got ${manifest.manifest_version}`));
            }

            // Check for service worker
            if (manifest.background && manifest.background.service_worker) {
                this.pass('Service worker configuration');
            } else {
                this.fail('Service worker', new Error('Service worker not configured'));
            }

            // Check critical permissions
            const requiredPermissions = ['storage', 'offscreen', 'scripting'];
            for (const perm of requiredPermissions) {
                if (manifest.permissions && manifest.permissions.includes(perm)) {
                    this.pass(`Permission: ${perm}`);
                } else {
                    this.fail(`Permission: ${perm}`, new Error('Missing required permission'));
                }
            }

            // Check content_security_policy
            if (manifest.content_security_policy) {
                this.pass('Content Security Policy defined');
            } else {
                this.warn('Content Security Policy', 'CSP not defined');
            }

        } catch (err) {
            this.fail('Manifest validation', err);
        }
    }

    // Test 6: Check panel HTML dependencies
    testPanelDependencies() {
        this.log('\n=== Test 6: Panel HTML Dependencies ===', 'info');

        try {
            const panelPath = path.join(process.cwd(), 'panel.html');
            if (!fs.existsSync(panelPath)) {
                this.warn('Panel dependencies', 'panel.html not found');
                return;
            }

            const content = fs.readFileSync(panelPath, 'utf8');

            // Check script loading order (panel.js uses chrome.runtime directly, no communicator needed)
            const requiredScripts = [
                'errorLogger.js',
                'utils.js',
                'panel.js',
                'VirtualFileService.js',
                'FileSystemAccessService.js',
                'AsyncFileIO.js'
            ];

            for (const script of requiredScripts) {
                const index = content.indexOf(script);
                if (index === -1) {
                    this.fail(`Panel dependency: ${script}`, new Error('Script not loaded'));
                } else {
                    this.pass(`Panel dependency: ${script}`);
                }
            }

            // Verify utils.js loads before AsyncFileIO.js (dependency requirement)
            const utilsIndex = content.indexOf('utils.js');
            const afioIndex = content.indexOf('AsyncFileIO.js');
            if (utilsIndex !== -1 && afioIndex !== -1) {
                if (utilsIndex < afioIndex) {
                    this.pass('Script load order: utils.js before AsyncFileIO.js');
                } else {
                    this.fail('Script load order', new Error('utils.js must load before AsyncFileIO.js'));
                }
            }

        } catch (err) {
            this.fail('Panel dependencies check', err);
        }
    }

    // Print summary
    printSummary() {
        this.log('\n' + '='.repeat(60), 'info');
        this.log('TEST SUMMARY', 'info');
        this.log('='.repeat(60), 'info');
        this.log(`Passed:   ${this.results.passed}`, 'success');
        this.log(`Failed:   ${this.results.failed}`, 'error');
        this.log(`Warnings: ${this.results.warnings}`, 'warning');

        if (this.errors.length > 0) {
            this.log('\n=== ERRORS ===', 'error');
            for (const err of this.errors) {
                this.log(`${err.test}: ${err.error}`, 'error');
            }
        }

        this.log('\n' + '='.repeat(60), 'info');

        if (this.results.failed === 0) {
            this.log('✓ ALL TESTS PASSED!', 'success');
            return 0;
        } else {
            this.log(`✗ ${this.results.failed} TEST(S) FAILED`, 'error');
            return 1;
        }
    }

    // Run all tests
    async run() {
        this.log('Starting iMacros MV3 Feature Tests...', 'info');
        this.log('Working directory: ' + process.cwd(), 'info');

        this.testCriticalFilesExist();
        this.testCodeQuality();
        this.testMessagePassingImplementation();
        this.testAsyncFileIOStructure();
        this.testManifestValidity();
        this.testPanelDependencies();

        return this.printSummary();
    }
}

// Run tests
const runner = new FeatureTestRunner();
runner.run().then(exitCode => {
    process.exit(exitCode);
}).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
