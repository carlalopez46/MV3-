#!/usr/bin/env node
/**
 * AsyncFileIO Dependency Analyzer
 *
 * Analyzes all afio usage across the codebase to identify:
 * - Which files use afio
 * - What methods are called
 * - Potential compatibility issues
 * - Required helper functions
 */

const fs = require('fs');
const path = require('path');

const AnalysisTool = {
    results: null,

    reset: function() {
        this.results = {
            files: {},
            methods: {},
            patterns: {},
            warnings: [],
            dependencies: []
        };
    },

    // Scan a JavaScript file for afio usage
    analyzeFile: function(filePath, content) {
        const fileName = path.basename(filePath);
        const fileAnalysis = {
            path: filePath,
            methods: [],
            patterns: [],
            lines: []
        };

        // Find all afio method calls
        const afioMethodRegex = /afio\.(\w+)\s*\(/g;
        let match;

        while ((match = afioMethodRegex.exec(content)) !== null) {
            const method = match[1];
            const lineNumber = content.substring(0, match.index).split('\n').length;

            fileAnalysis.methods.push({
                method: method,
                line: lineNumber,
                context: this.getLineContext(content, lineNumber)
            });

            // Track method usage globally
            if (!this.results.methods[method]) {
                this.results.methods[method] = [];
            }
            this.results.methods[method].push({
                file: filePath,
                line: lineNumber
            });
        }

        // Find NodeObject method calls
        const nodeMethodRegex = /(\w+)\.(exists|isDir|isWritable|isReadable|copyTo|moveTo|remove|append|clone|parent|path|leafName)\s*\(/g;

        while ((match = nodeMethodRegex.exec(content)) !== null) {
            const varName = match[1];
            const method = match[2];
            const lineNumber = content.substring(0, match.index).split('\n').length;

            // Check if this variable is likely a NodeObject
            if (this.isLikelyNodeObject(content, varName)) {
                fileAnalysis.methods.push({
                    method: 'NodeObject.' + method,
                    line: lineNumber,
                    context: this.getLineContext(content, lineNumber)
                });
            }
        }

        // Detect common usage patterns
        this.detectPatterns(content, fileAnalysis);

        // Check for required helper functions
        this.checkHelperFunctions(content, filePath, fileAnalysis);

        if (fileAnalysis.methods.length > 0) {
            this.results.files[filePath] = fileAnalysis;
        }
    },

    getLineContext: function(content, lineNumber) {
        const lines = content.split('\n');
        const startLine = Math.max(0, lineNumber - 2);
        const endLine = Math.min(lines.length, lineNumber + 1);

        return {
            before: lines[lineNumber - 2] || '',
            current: lines[lineNumber - 1] || '',
            after: lines[lineNumber] || ''
        };
    },

    isLikelyNodeObject: function(content, varName) {
        // Check if variable is created with afio.openNode or getDefaultDir
        const patterns = [
            new RegExp(`${varName}\\s*=\\s*afio\\.openNode`, 'g'),
            new RegExp(`${varName}\\s*=\\s*afio\\.getDefaultDir`, 'g'),
            new RegExp(`${varName}\\s*=\\s*new\\s+NodeObject`, 'g'),
            new RegExp(`${varName}\\.clone\\(\\)`, 'g'),
            new RegExp(`${varName}\\.parent`, 'g')
        ];

        return patterns.some(pattern => pattern.test(content));
    },

    detectPatterns: function(content, fileAnalysis) {
        const patterns = [
            {
                name: 'localStorage_default_path',
                regex: /localStorage\["def(savepath|datapath|downpath|logpath)"\]/g,
                description: 'Uses localStorage for default paths'
            },
            {
                name: 'node_clone_append',
                regex: /\.clone\(\)[\s\S]{0,50}\.append\(/g,
                description: 'Clones node and appends path'
            },
            {
                name: 'promise_chain',
                regex: /afio\.\w+\([^)]*\)\.then\(/g,
                description: 'Uses promise chaining'
            },
            {
                name: 'async_await',
                regex: /await\s+afio\.\w+\(/g,
                description: 'Uses async/await'
            },
            {
                name: 'nested_directory',
                regex: /makeDirectory\([^)]*\)\.then\([^)]*makeDirectory/g,
                description: 'Creates nested directories'
            }
        ];

        patterns.forEach(pattern => {
            if (pattern.regex.test(content)) {
                fileAnalysis.patterns.push(pattern.name);

                if (!this.results.patterns[pattern.name]) {
                    this.results.patterns[pattern.name] = {
                        description: pattern.description,
                        files: []
                    };
                }
                this.results.patterns[pattern.name].files.push(fileAnalysis.path);
            }
        });
    },

    checkHelperFunctions: function(content, filePath, fileAnalysis) {
        const requiredHelpers = ['__is_windows', '__psep'];
        // Known global helpers defined in utils.js
        const globalHelpers = new Set(['__is_windows', '__psep', '__is_full_path']);

        requiredHelpers.forEach(helper => {
            if (content.includes(helper)) {
                // Check if helper is defined in this file
                const isDefinedLocally = new RegExp(`function\\s+${helper}`).test(content);

                // Check if this is a known global helper from utils.js
                const isGlobalHelper = globalHelpers.has(helper);

                // Check if this is an HTML file that might include utils.js
                const isHtmlFile = filePath.endsWith('.html');
                const hasUtilsScriptTag = content.includes('<script src="utils.js"');

                if (!isDefinedLocally && !isGlobalHelper && !isHtmlFile && !hasUtilsScriptTag && filePath.endsWith('.js')) {
                    this.results.warnings.push({
                        file: filePath,
                        type: 'MISSING_HELPER',
                        message: `AsyncFileIO uses ${helper} but it may not be available`,
                        helper: helper
                    });
                }
            }
        });
    },

    scanDirectory: function(dir, excludeDirs = []) {
        if (!this.results) {
            this.reset();
        }
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        entries.forEach(entry => {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (!excludeDirs.includes(entry.name)) {
                    this.scanDirectory(fullPath, excludeDirs);
                }
            } else if (entry.isFile() && entry.name.endsWith('.js')) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    if (content.includes('afio')) {
                        this.analyzeFile(fullPath, content);
                    }
                } catch (e) {
                    console.error(`Error reading ${fullPath}:`, e.message);
                }
            }
        });
    },

    generateReport: function() {
        const report = {
            summary: {
                totalFiles: Object.keys(this.results.files).length,
                totalMethods: Object.keys(this.results.methods).length,
                totalWarnings: this.results.warnings.length
            },
            fileDetails: [],
            methodUsage: [],
            patterns: [],
            warnings: this.results.warnings,
            recommendations: []
        };

        // File details
        Object.entries(this.results.files).forEach(([filePath, analysis]) => {
            report.fileDetails.push({
                file: filePath,
                methodCount: analysis.methods.length,
                methods: analysis.methods.map(m => m.method),
                patterns: analysis.patterns
            });
        });

        // Method usage statistics
        Object.entries(this.results.methods).forEach(([method, usages]) => {
            report.methodUsage.push({
                method: method,
                usageCount: usages.length,
                files: usages.map(u => u.file),
                locations: usages
            });
        });

        // Pattern usage
        Object.entries(this.results.patterns).forEach(([name, data]) => {
            report.patterns.push({
                pattern: name,
                description: data.description,
                fileCount: data.files.length,
                files: data.files
            });
        });

        // Generate recommendations
        this.generateRecommendations(report);

        return report;
    },

    generateRecommendations: function(report) {
        // Check for commonly used methods
        const criticalMethods = [
            'openNode', 'readTextFile', 'writeTextFile', 'getDefaultDir',
            'makeDirectory', 'getNodesInDir', 'isInstalled'
        ];

        criticalMethods.forEach(method => {
            const usage = this.results.methods[method];
            if (!usage || usage.length === 0) {
                report.recommendations.push({
                    priority: 'LOW',
                    type: 'UNUSED_METHOD',
                    message: `Method ${method} is not used in codebase but is commonly needed`
                });
            } else if (usage.length > 10) {
                report.recommendations.push({
                    priority: 'HIGH',
                    type: 'HEAVILY_USED',
                    message: `Method ${method} is heavily used (${usage.length} times) - ensure thorough testing`
                });
            }
        });

        // Check for missing error handling
        Object.entries(this.results.files).forEach(([filePath, analysis]) => {
            const hasAsyncCalls = analysis.methods.some(m =>
                ['readTextFile', 'writeTextFile', 'makeDirectory'].includes(m.method)
            );

            if (hasAsyncCalls) {
                const content = fs.readFileSync(filePath, 'utf8');
                const hasCatch = content.includes('.catch(') || content.includes('try {');

                if (!hasCatch) {
                    report.recommendations.push({
                        priority: 'MEDIUM',
                        type: 'MISSING_ERROR_HANDLING',
                        message: `${filePath} uses async afio methods but may lack error handling`,
                        file: filePath
                    });
                }
            }
        });

        // Check for Storage dependency
        const storageUsers = Object.keys(this.results.files).filter(filePath => {
            const content = fs.readFileSync(filePath, 'utf8');
            return content.includes('Storage.') && content.includes('afio');
        });

        if (storageUsers.length > 0) {
            report.recommendations.push({
                priority: 'HIGH',
                type: 'DEPENDENCY',
                message: 'AsyncFileIO.js requires Storage object from utils.js',
                affectedFiles: storageUsers
            });
        }
    },

    printReport: function(report) {
        console.log('='.repeat(80));
        console.log('AsyncFileIO Dependency Analysis Report');
        console.log('='.repeat(80));
        console.log('\nSummary:');
        console.log(`  Files using afio: ${report.summary.totalFiles}`);
        console.log(`  Unique methods: ${report.summary.totalMethods}`);
        console.log(`  Warnings: ${report.summary.totalWarnings}`);

        console.log('\n' + '-'.repeat(80));
        console.log('Method Usage:');
        console.log('-'.repeat(80));
        report.methodUsage
            .sort((a, b) => b.usageCount - a.usageCount)
            .forEach(m => {
                console.log(`  ${m.method}: ${m.usageCount} usages`);
            });

        if (report.warnings.length > 0) {
            console.log('\n' + '-'.repeat(80));
            console.log('Warnings:');
            console.log('-'.repeat(80));
            report.warnings.forEach(w => {
                console.log(`  [${w.type}] ${w.file}`);
                console.log(`    ${w.message}`);
            });
        }

        if (report.recommendations.length > 0) {
            console.log('\n' + '-'.repeat(80));
            console.log('Recommendations:');
            console.log('-'.repeat(80));
            report.recommendations
                .sort((a, b) => {
                    const priority = { HIGH: 3, MEDIUM: 2, LOW: 1 };
                    return priority[b.priority] - priority[a.priority];
                })
                .forEach(r => {
                    console.log(`  [${r.priority}] ${r.type}`);
                    console.log(`    ${r.message}`);
                });
        }

        console.log('\n' + '='.repeat(80));
    },

    saveReport: function(report, outputPath) {
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
        console.log(`\nReport saved to: ${outputPath}`);
    }
};

// P5 fix: Remove module-level initialization
// Callers must explicitly call reset() before use

// Main execution
if (require.main === module) {
    const projectRoot = process.argv[2] || '/home/user/iMacrosMV3';
    const outputFile = process.argv[3] || path.join(projectRoot, 'tests', 'afio_analysis_report.json');

    console.log(`Scanning directory: ${projectRoot}`);

    const excludeDirs = ['node_modules', 'vendor', 'edit_area', 'tests', '.git'];
    AnalysisTool.reset();
    AnalysisTool.scanDirectory(projectRoot, excludeDirs);

    const report = AnalysisTool.generateReport();
    AnalysisTool.printReport(report);
    AnalysisTool.saveReport(report, outputFile);

    process.exit(report.summary.totalWarnings > 0 ? 1 : 0);
}

module.exports = AnalysisTool;
