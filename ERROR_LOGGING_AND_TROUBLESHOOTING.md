# Error Logging and Troubleshooting

iMacros now ships with a centralized error logger that is injected into all HTML entry points (including dialogs, the editor, sandbox, and content UIs). The logger captures file names, line numbers, and stack traces for:

- Uncaught runtime errors (`window.onerror`)
- Unhandled promise rejections
- `console.error` calls
- Chrome API failures (via `checkChromeError`, `wrapChromeCallback`, and `wrapPromise`)

Error entries are persisted to `localStorage` under the key `imacros_error_log` with aggregate stats stored under `imacros_error_stats`. Each entry includes a severity, timestamp, URL, optional context object, and an error code.

## Quick navigation for failures
1. Open the Developer Tools for the failing page (popup/panel: right-click → Inspect; content pages: F12).
2. Filter the Console for `[iMacros` to see formatted errors. Codes are shown in brackets (e.g., `[iMacros ERROR] IMX-1001 ...`).
3. Use the line/column hint that follows the message to jump to the offending script.
4. Call `ErrorLogger.generateReport()` in the console to emit a grouped summary. Use `ErrorLogger.getAllErrors()` for the raw objects.
5. To capture Chrome API failures, always wrap callbacks with `wrapChromeCallback` or promises with `wrapPromise` and check `chrome.runtime.lastError` via `checkChromeError`.

## Inspecting and exporting logs
- **View recent entries**: `JSON.parse(localStorage.getItem('imacros_error_log') || '[]')`
- **View counters**: `JSON.parse(localStorage.getItem('imacros_error_stats') || '{}')`
- **Clear logs**: `ErrorLogger.clearLogs()` (use before re-running a scenario to avoid stale noise).
- **Export**: `ErrorLogger.exportAsJSON()` (or the alias `ErrorLogger.exportLog()`) yields JSON that can be attached to bug reports.

## Error codes and remedies
| Code | Meaning | Typical cause | Recommended action |
| --- | --- | --- | --- |
| IMX-1001 | Uncaught runtime error | Script exception bubbling to `window.onerror` | Inspect the file/line in the console output; add guards or input validation. |
| IMX-1002 | Unhandled promise rejection | Async call rejects without `catch` | Wrap with `wrapPromise` or add `.catch` handlers; log contextual arguments. |
| IMX-1003 | Console error escalation | `console.error` emitted by custom code | Treat as a warning; check the message payload for structured details. |
| IMX-2001 | Chrome API error | `chrome.runtime.lastError` populated | Log the API call + arguments, retry or surface a user-facing notification. |
| IMX-3001 | Storage/logging issue | localStorage unavailable or quota reached | Free space, or temporarily disable verbose logging. |
| IMX-9000 | Manual/diagnostic log | Explicit call to `logError`/`logWarning` with a supplied code | Align manual codes with the table as new categories are added. |
| IMX-0000 | Unknown code (default) | Entry did not specify a code | Add a code to the source site to aid future triage. |

## Troubleshooting workflow
1. Reproduce the issue with the console open to capture real-time logs and stack traces.
2. Confirm that `ErrorLogger` is available (`typeof ErrorLogger !== 'undefined'`). If not, verify that `errorLogger.js` is loaded in the HTML head.
3. If no logs are written, check localStorage availability and browser privacy settings.
4. For UI dialogs or sandbox pages, verify that the correct relative path to `errorLogger.js` is being used.
5. When errors originate from native messaging or storage operations, inspect the `context` object in the log entry for the arguments that were used.

Keeping the console open while interacting with the UI ensures developer tools capture stack traces for debugging. For environments without a browser UI, fetch `imacros_error_log` directly from localStorage as shown above.
