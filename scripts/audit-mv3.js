#!/usr/bin/env node
/**
 * MV3 Policy Audit Script
 * 
 * Scans the codebase for MV3 policy violations:
 * - eval() / new Function() outside sandbox pages
 * - chrome.tabs.executeScript (MV2 API)
 * - chrome.tabs.insertCSS (MV2 API)
 * - browserAction/pageAction (MV2 APIs)
 * - background.scripts in manifest (MV2 pattern)
 * - window/localStorage in Service Worker
 * - Unchecked runtime.lastError patterns
 * 
 * Exit code: 0 if no violations, 1 if violations found
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

// Directories to skip
const IGNORED_DIRS = new Set([
    'node_modules', '.git', 'old_file', 'vendor', 'docs',
    'samples', 'Datasources', 'Downloads', 'Macros', 'skin',
    'scripts', 'tests', '.github'
]);

// Files that are allowed to use eval (sandbox pages)
const SANDBOX_FILES = new Set([
    'sandbox.js',
    'sandbox.html',
    'sandbox/eval_executor.js',
    'sandbox/eval_executor.html'
]);

// Patterns to detect with their severity
const PATTERNS = [
    {
        name: 'eval() usage',
        regex: /\beval\s*\(/g,
        severity: 'ERROR',
        category: 'CSP_VIOLATION',
        sandboxExempt: true,
        description: 'eval() is prohibited in MV3 extension pages. Move to sandbox page.'
    },
    {
        name: 'new Function() usage',
        regex: /\bnew\s+Function\s*\(/g,
        severity: 'ERROR',
        category: 'CSP_VIOLATION',
        sandboxExempt: true,
        description: 'new Function() is prohibited in MV3 extension pages. Move to sandbox page.'
    },
    {
        name: 'Function() constructor',
        regex: /(?<!new\s)\bFunction\s*\(/g,
        severity: 'ERROR',
        category: 'CSP_VIOLATION',
        sandboxExempt: true,
        description: 'Function() constructor is prohibited in MV3 extension pages.'
    },
    {
        name: 'chrome.tabs.executeScript (MV2)',
        regex: /chrome\.tabs\.executeScript\s*\(/g,
        severity: 'ERROR',
        category: 'MV2_API',
        description: 'Use chrome.scripting.executeScript instead.'
    },
    {
        name: 'chrome.tabs.insertCSS (MV2)',
        regex: /chrome\.tabs\.insertCSS\s*\(/g,
        severity: 'ERROR',
        category: 'MV2_API',
        description: 'Use chrome.scripting.insertCSS instead.'
    },
    {
        name: 'browserAction (MV2)',
        regex: /chrome\.browserAction\./g,
        severity: 'WARNING',
        category: 'MV2_API',
        description: 'Use chrome.action instead.'
    },
    {
        name: 'pageAction (MV2)',
        regex: /chrome\.pageAction\./g,
        severity: 'WARNING',
        category: 'MV2_API',
        description: 'Use chrome.action instead.'
    },
    {
        name: 'window. in Service Worker',
        regex: /\bwindow\./g,
        severity: 'WARNING',
        category: 'SW_INCOMPATIBLE',
        swOnly: true,
        description: 'window object is not available in Service Workers. Use self or globalThis.'
    },
    {
        name: 'localStorage in Service Worker',
        regex: /\blocalStorage\./g,
        severity: 'WARNING',
        category: 'SW_INCOMPATIBLE',
        swOnly: true,
        description: 'localStorage is not available in Service Workers. Use chrome.storage.'
    },
    {
        name: 'Unchecked lastError',
        regex: /sendMessage\s*\([^)]*\)\s*(?:;|\})/g,
        severity: 'INFO',
        category: 'RUNTIME_ERROR',
        description: 'Consider checking chrome.runtime.lastError in callback.'
    },
    {
        name: 'setTimeout dependency for long waits',
        regex: /setTimeout\s*\([^,]+,\s*(\d{5,})/g,
        severity: 'INFO',
        category: 'SW_INCOMPATIBLE',
        swOnly: true,
        description: 'Long setTimeout may not survive Service Worker termination. Consider chrome.alarms.'
    }
];

// Service Worker files
const SW_FILES = new Set(['background.js']);

function isIgnoredDir(name) {
    return IGNORED_DIRS.has(name);
}

function isSandboxFile(relativePath) {
    const normalized = relativePath.replace(/\\/g, '/');
    for (const sandboxFile of SANDBOX_FILES) {
        if (normalized === sandboxFile || normalized.endsWith('/' + sandboxFile)) {
            return true;
        }
    }
    return false;
}

function isServiceWorkerFile(relativePath) {
    const basename = path.basename(relativePath);
    return SW_FILES.has(basename);
}

function scanFile(filePath, relativePath) {
    const issues = [];
    
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        
        const isSandbox = isSandboxFile(relativePath);
        const isSW = isServiceWorkerFile(relativePath);
        
        for (const pattern of PATTERNS) {
            // Skip sandbox-exempt patterns for sandbox files
            if (pattern.sandboxExempt && isSandbox) {
                continue;
            }
            
            // Skip SW-only patterns for non-SW files
            if (pattern.swOnly && !isSW) {
                continue;
            }
            
            // Reset regex state
            pattern.regex.lastIndex = 0;
            
            let match;
            while ((match = pattern.regex.exec(content)) !== null) {
                // Find line number
                const beforeMatch = content.substring(0, match.index);
                const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
                const line = lines[lineNumber - 1] || '';
                
                // Skip if it's in a comment
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*')) {
                    continue;
                }
                
                issues.push({
                    file: relativePath,
                    line: lineNumber,
                    column: match.index - beforeMatch.lastIndexOf('\n'),
                    pattern: pattern.name,
                    severity: pattern.severity,
                    category: pattern.category,
                    description: pattern.description,
                    context: line.trim().substring(0, 100)
                });
            }
        }
    } catch (err) {
        console.error(`Error reading file ${filePath}:`, err.message);
    }
    
    return issues;
}

function walkDirectory(dir, relativePath = '') {
    const issues = [];
    
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relPath = path.join(relativePath, entry.name);
            
            if (entry.isDirectory()) {
                if (!isIgnoredDir(entry.name)) {
                    issues.push(...walkDirectory(fullPath, relPath));
                }
            } else if (entry.isFile()) {
                // Only scan JS and HTML files
                const ext = path.extname(entry.name).toLowerCase();
                if (['.js', '.html', '.htm'].includes(ext)) {
                    issues.push(...scanFile(fullPath, relPath));
                }
            }
        }
    } catch (err) {
        console.error(`Error reading directory ${dir}:`, err.message);
    }
    
    return issues;
}

function checkManifest() {
    const issues = [];
    const manifestPath = path.join(ROOT_DIR, 'manifest.json');
    
    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        
        // Check manifest_version
        if (manifest.manifest_version !== 3) {
            issues.push({
                file: 'manifest.json',
                line: 1,
                severity: 'ERROR',
                category: 'MANIFEST',
                pattern: 'manifest_version',
                description: `manifest_version is ${manifest.manifest_version}, should be 3`
            });
        }
        
        // Check for background.scripts (MV2)
        if (manifest.background && manifest.background.scripts) {
            issues.push({
                file: 'manifest.json',
                line: 1,
                severity: 'ERROR',
                category: 'MANIFEST',
                pattern: 'background.scripts',
                description: 'background.scripts is MV2 pattern. Use background.service_worker instead.'
            });
        }
        
        // Check for service_worker
        if (manifest.background && !manifest.background.service_worker) {
            issues.push({
                file: 'manifest.json',
                line: 1,
                severity: 'ERROR',
                category: 'MANIFEST',
                pattern: 'background.service_worker',
                description: 'MV3 requires background.service_worker'
            });
        }
        
        // Check CSP for unsafe-eval in extension_pages
        if (manifest.content_security_policy && manifest.content_security_policy.extension_pages) {
            const csp = manifest.content_security_policy.extension_pages;
            if (csp.includes('unsafe-eval')) {
                issues.push({
                    file: 'manifest.json',
                    line: 1,
                    severity: 'ERROR',
                    category: 'CSP_VIOLATION',
                    pattern: 'unsafe-eval in extension_pages',
                    description: 'unsafe-eval is not allowed in extension_pages CSP in MV3'
                });
            }
        }
        
        // Check for offscreen permission if offscreen.html exists
        if (fs.existsSync(path.join(ROOT_DIR, 'offscreen.html'))) {
            if (!manifest.permissions || !manifest.permissions.includes('offscreen')) {
                issues.push({
                    file: 'manifest.json',
                    line: 1,
                    severity: 'WARNING',
                    category: 'MANIFEST',
                    pattern: 'offscreen permission',
                    description: 'offscreen.html exists but offscreen permission not declared'
                });
            }
        }
        
    } catch (err) {
        issues.push({
            file: 'manifest.json',
            line: 1,
            severity: 'ERROR',
            category: 'MANIFEST',
            pattern: 'parse error',
            description: `Failed to parse manifest.json: ${err.message}`
        });
    }
    
    return issues;
}

function main() {
    console.log('='.repeat(80));
    console.log('MV3 Policy Audit');
    console.log('='.repeat(80));
    console.log('');
    
    // Check manifest
    console.log('Checking manifest.json...');
    const manifestIssues = checkManifest();
    
    // Scan source files
    console.log('Scanning source files...');
    const sourceIssues = walkDirectory(ROOT_DIR);
    
    const allIssues = [...manifestIssues, ...sourceIssues];
    
    // Group by severity
    const errors = allIssues.filter(i => i.severity === 'ERROR');
    const warnings = allIssues.filter(i => i.severity === 'WARNING');
    const infos = allIssues.filter(i => i.severity === 'INFO');
    
    // Print results
    console.log('');
    console.log('='.repeat(80));
    console.log('Results');
    console.log('='.repeat(80));
    
    if (errors.length > 0) {
        console.log('\n❌ ERRORS (' + errors.length + '):');
        for (const issue of errors) {
            console.log(`  ${issue.file}:${issue.line || 1}`);
            console.log(`    [${issue.category}] ${issue.pattern}`);
            console.log(`    ${issue.description}`);
            if (issue.context) {
                console.log(`    Context: ${issue.context}`);
            }
            console.log('');
        }
    }
    
    if (warnings.length > 0) {
        console.log('\n⚠️  WARNINGS (' + warnings.length + '):');
        for (const issue of warnings) {
            console.log(`  ${issue.file}:${issue.line || 1}`);
            console.log(`    [${issue.category}] ${issue.pattern}`);
            console.log(`    ${issue.description}`);
            if (issue.context) {
                console.log(`    Context: ${issue.context}`);
            }
            console.log('');
        }
    }
    
    if (infos.length > 0) {
        console.log('\nℹ️  INFO (' + infos.length + '):');
        for (const issue of infos) {
            console.log(`  ${issue.file}:${issue.line || 1} - ${issue.pattern}`);
        }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('Summary');
    console.log('='.repeat(80));
    console.log(`  Errors:   ${errors.length}`);
    console.log(`  Warnings: ${warnings.length}`);
    console.log(`  Info:     ${infos.length}`);
    console.log('');
    
    if (errors.length > 0) {
        console.log('❌ AUDIT FAILED - Fix errors before proceeding');
        process.exit(1);
    } else if (warnings.length > 0) {
        console.log('⚠️  AUDIT PASSED WITH WARNINGS');
        process.exit(0);
    } else {
        console.log('✅ AUDIT PASSED');
        process.exit(0);
    }
}

main();
