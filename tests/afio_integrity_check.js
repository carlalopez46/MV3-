#!/usr/bin/env node
/**
 * AsyncFileIO comprehensive integrity check
 *
 * This script orchestrates the existing analyzer and usage verifier to ensure
 * all afio call sites remain healthy. It records every failure with the script
 * name, message, and the exact file/line extracted from the stack trace so
 * regressions can be diagnosed quickly.
 */

const fs = require('fs');
const path = require('path');
const AnalysisTool = require('./analyze_afio_dependencies');
const verifyUsage = require('./afio_usage_verifier');

const DEFAULT_EXCLUDES = ['node_modules', 'vendor', 'edit_area', 'tests', '.git'];
const errors = [];
const steps = [];

function parseStackLocation(stack) {
    const fallback = { file: 'unknown', line: 0, column: 0 };
    if (!stack) return fallback;

    const lines = stack.toString().split(/\r?\n/);
    for (const line of lines) {
        // P3 fix: Handle file paths with spaces and Windows paths with colons
        // Match patterns like "at /path/to/file.js:123:45" or "at funcName (/path/to/file.js:123:45)"
        // Also handles Windows paths: "at C:\path\to\file.js:123:45"
        // (?:at\s+)? - optionally skip "at " prefix
        // (?:.*?\()? - optionally skip function name and opening paren
        // (.+) - capture file path (greedy, matches up to last :digit:digit pattern)
        const match = line.match(/(?:at\s+)?(?:.*?\()?(.+):(\d+):(\d+)\)?$/);
        if (match) {
            return {
                file: match[1].trim(),
                line: parseInt(match[2], 10) || 0,
                column: parseInt(match[3], 10) || 0
            };
        }
    }
    return fallback;
}

function recordError(context, error) {
    const location = parseStackLocation(error && error.stack);
    const entry = {
        timestamp: new Date().toISOString(),
        context,
        message: error && error.message ? error.message : String(error),
        stack: (error && error.stack) || 'no stack available',
        file: location.file,
        line: location.line,
        column: location.column,
        details: error && error.summary ? error.summary : undefined
    };
    errors.push(entry);
    console.error(`[FAIL] ${context}: ${entry.message}`);
    return entry;
}

async function runStep(name, fn) {
    console.log(`\n[RUN] ${name}`);
    const startedAt = Date.now();
    try {
        const details = await fn();
        const duration = Date.now() - startedAt;
        steps.push({ name, status: 'passed', duration, details });
        console.log(`[OK] ${name} (${duration}ms)`);
    } catch (err) {
        const duration = Date.now() - startedAt;
        const entry = recordError(name, err);
        steps.push({ name, status: 'failed', duration, error: entry });
    }
}

async function runIntegrityCheck(projectRoot) {
    // Reset accumulators for clean run (P2 fix)
    errors.length = 0;
    steps.length = 0;

    const reportsDir = path.join(projectRoot, 'tests');
    const outputPath = path.join(reportsDir, 'afio_integrity_report.json');

    // Ensure reports directory exists (P4 fix)
    if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
    }

    await runStep('analyze_afio_dependencies', () => {
        AnalysisTool.reset();
        AnalysisTool.scanDirectory(projectRoot, DEFAULT_EXCLUDES);
        const report = AnalysisTool.generateReport();
        const analysisPath = path.join(reportsDir, 'afio_analysis_report.json');
        AnalysisTool.saveReport(report, analysisPath);

        // P1 fix: Fail on warnings to match standalone analyzer behavior
        if (report.summary.totalWarnings > 0) {
            const err = new Error(`Analyzer detected ${report.summary.totalWarnings} warning(s)`);
            err.summary = {
                warnings: report.warnings,
                totalWarnings: report.summary.totalWarnings
            };
            throw err;
        }

        return {
            reportPath: analysisPath,
            files: report.summary.totalFiles,
            warnings: report.summary.totalWarnings
        };
    });

    await runStep('afio_usage_verifier', () => {
        const summary = verifyUsage(projectRoot);
        if (!summary.matchesExpectedCount || !summary.matchesExpectedFiles || summary.uncoveredMethods.length > 0) {
            const mismatch = new Error('Usage verifier detected afio call/site drift');
            mismatch.summary = summary;
            throw mismatch;
        }
        return summary;
    });

    const finalReport = {
        projectRoot,
        timestamp: new Date().toISOString(),
        steps,
        errors,
        success: errors.length === 0
    };

    fs.writeFileSync(outputPath, JSON.stringify(finalReport, null, 2));
    console.log(`\nIntegrity report written to ${outputPath}`);

    if (errors.length > 0) {
        console.error(`Captured ${errors.length} error(s). Review ${outputPath} for details.`);
        process.exitCode = 1;
    }

    return finalReport;
}

if (require.main === module) {
    const projectRoot = process.argv[2] || path.resolve(__dirname, '..');
    runIntegrityCheck(projectRoot);
}

module.exports = runIntegrityCheck;
