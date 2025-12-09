#!/usr/bin/env node
/**
 * AsyncFileIO usage verification script
 *
 * Ensures that all afio usages discovered by analyze_afio_dependencies.js
 * have corresponding coverage in the afio test suite. The script strictly
 * validates both the total number of call sites and the number of files using
 * afio so regressions are detected immediately when developers add or remove
 * dependencies.
 */

const fs = require('fs');
const path = require('path');
const AnalysisTool = require('./analyze_afio_dependencies');

const EXPECTED_CALLS = 89;
const EXPECTED_FILE_COUNT = 8;

function collectTestCoverage(testSuitePath) {
    try {
        const content = fs.readFileSync(testSuitePath, 'utf8');
        const regex = /afio\.(\w+)\s*\(/g;
        const methods = new Set();
        let match;
        while ((match = regex.exec(content)) !== null) {
            methods.add(match[1]);
        }
        return methods;
    } catch (error) {
        console.warn(`Warning: Could not read test suite file at ${testSuitePath}: ${error.message}`);
        return new Set();
    }
}

function verifyUsage(projectRoot) {
    AnalysisTool.reset();
    const excludeDirs = ['node_modules', 'vendor', 'edit_area', 'tests', '.git'];
    AnalysisTool.scanDirectory(projectRoot, excludeDirs);
    const report = AnalysisTool.generateReport();
    const methodsUsed = Object.keys(AnalysisTool.results.methods);
    const filesUsingAfio = Object.keys(AnalysisTool.results.files);
    const totalAfioCalls = report.methodUsage.reduce((sum, methodInfo) => sum + methodInfo.usageCount, 0);

    const testSuitePath = path.join(projectRoot, 'tests', 'afio_test_suite.js');
    const coveredMethods = collectTestCoverage(testSuitePath);
    const uncovered = methodsUsed.filter((method) => !coveredMethods.has(method));

    const summary = {
        filesUsingAfio: filesUsingAfio.length,
        totalAfioCalls,
        uniqueMethods: methodsUsed.length,
        uncoveredMethods: uncovered,
        expectedCalls: EXPECTED_CALLS,
        matchesExpectedCount: totalAfioCalls === EXPECTED_CALLS,
        expectedFiles: EXPECTED_FILE_COUNT,
        matchesExpectedFiles: filesUsingAfio.length === EXPECTED_FILE_COUNT
    };

    console.log('='.repeat(80));
    console.log('AsyncFileIO Usage Verification');
    console.log('='.repeat(80));
    console.log(`Files using afio: ${summary.filesUsingAfio}`);
    console.log(`Total afio calls: ${summary.totalAfioCalls}`);
    console.log(`Unique methods:  ${summary.uniqueMethods}`);
    console.log(`Matches expected call count (${summary.expectedCalls}): ${summary.matchesExpectedCount ? 'YES' : 'NO'}`);
    console.log(`Matches expected file count (${summary.expectedFiles}): ${summary.matchesExpectedFiles ? 'YES' : 'NO'}`);
    if (!summary.matchesExpectedCount) {
        console.warn(`  -> Update expected call count in afio_usage_verifier.js if this change is intentional (expected ${summary.expectedCalls}).`);
    }
    if (!summary.matchesExpectedFiles) {
        console.warn(`  -> Update expected file count in afio_usage_verifier.js if this change is intentional (expected ${summary.expectedFiles}).`);
    }
    if (uncovered.length > 0) {
        console.log('\nMethods missing test coverage:');
        uncovered.forEach((method) => console.log(`  - ${method}`));
    } else {
        console.log('\nAll detected methods have test coverage.');
    }

    const outputPath = path.join(projectRoot, 'tests', 'afio_usage_verifier_report.json');
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
    console.log(`\nReport saved to ${outputPath}`);

    if (uncovered.length > 0 || !summary.matchesExpectedCount || !summary.matchesExpectedFiles) {
        process.exitCode = 1;
    }

    return summary;
}

if (require.main === module) {
    const projectRoot = process.argv[2] || path.resolve(__dirname, '..');
    verifyUsage(projectRoot);
}

module.exports = verifyUsage;
