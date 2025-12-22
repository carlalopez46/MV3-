# iMacros MV3 Development Log & Fixes

## Overview
This document records the modifications, bug fixes, and feature enhancements applied to the iMacros MV3 extension, specifically focusing on file persistence, settings synchronization, and the implementation of the File System Access API.

## Recent Updates
*   **Clipboard command resilience**: `SET !CLIPBOARD` no longer returns early when the Clipboard API yields a Promise, preventing macros from hanging while still logging write failures.
*   **Safer inline-eval testing**: The variable expansion test harness now uses explicit stubs instead of `eval`, and adds coverage for undefined-variable errors to guard expansion edge cases.

## Key Improvements & Fixes

### 1. Settings Persistence & Synchronization
*   **Issue**: Settings configured in the Options page were not persisting after restart and were not being shared with the background service worker (`bg.js`).
*   **Cause**: The Options page relied on the browser's native `localStorage`, while the MV3 Service Worker (`bg.js`) cannot access `localStorage` and uses `chrome.storage.local`. This caused a disconnect between the UI and the backend logic.
*   **Fix**: Modified the `Storage` object in `utils.js`.
    *   Implemented a dual-write mechanism: whenever `Storage.set*` is called, it writes to both `localStorage` (for immediate UI access) and `chrome.storage.local` (for persistence and sharing with the background script).
    *   Ensured that settings keys are prefixed correctly (`localStorage_`) for compatibility with the background script's polyfill.

### 2. Local File System Access (File System Access API)
*   **Issue**: The extension could not save macros to the local disk. The "Browse" button in Options opened a legacy `browse.html` window that caused an infinite loading loop on macOS.
*   **Fix**:
    *   Integrated `FileSystemAccessService.js` to leverage the modern Chrome File System Access API.
    *   Updated `options.js` to use `window.showDirectoryPicker()` instead of the legacy popup.
    *   Added missing dependencies (`errorLogger.js`, `WindowsPathMappingService.js`) to `options.html` to ensure the file system service loads correctly.
    *   Disabled the fallback to `browse.html` to prevent the infinite loading bug.

### 3. Path Resolution & Tree View Display
*   **Issue**: Even after selecting a folder, the "Files" tab tree view would not show the local files (showing Virtual Files instead), and the path in Options would display as `/`.
*   **Cause**: The `FileSystemAccessService` was treating the selected folder as the root `/`, but the rest of the application (including `options.js` and `AsyncFileIO.js`) expected to use the actual directory name (e.g., `Macros`). This mismatch caused path resolution failures (`NotFoundError`).
*   **Fix**:
    *   Updated `FileSystemAccessService.js` to store the root directory name (`rootName`).
    *   Modified the `_resolvePathAndHandle` method to intelligently strip the root directory name from paths if present, allowing paths like `Macros/Demo.iim` to resolve correctly against the root handle.
    *   Updated `options.js` to automatically set the `Datasources` and `Downloads` paths relative to the selected macro folder (e.g., `Macros/Datasources`), ensuring a complete and valid configuration.

### 4. Miscellaneous Fixes
*   **`mrecorder.js`**: Fixed a syntax error (missing closing brace) and logic issue in the `Recorder.prototype.capture` function.
*   **`bg.js`**: Cleaned up debug logs and verified the macro saving logic.

### 5. Variable expansion safety updates
*   **Inline EVAL policy**: Inline `!EVAL(...)` now only accepts code wrapped in double quotes (mirroring legacy `EVAL("")` usage) and logs a warning about executing arbitrary code. Unique evaluation IDs still use timestamp plus random components.
*   **Inline EVAL parsing**: Quoted inline expressions now tolerate escaped quotes (e.g., `\"`) while still rejecting unquoted whitespace tokens to avoid ambiguous debugging and parsing failures.
*   **Placeholder formatting**: Variable placeholders must not contain whitespace; inputs such as `{{ !VAR1 }}` or multi-line tokens now raise `BadParameter` errors to avoid ambiguous debugging scenarios. Nested placeholders (e.g., `{{!COL{{!VAR1}}}}`) remain supported without whitespace.

## Modified Files
*   `/utils.js`: Core storage logic updates.
*   `/options.js`: Path selection UI and logic updates.
*   `/options.html`: Added script tags for dependencies.
*   `/FileSystemAccessService.js`: Path resolution logic and root name handling.
*   `/bg.js`: Debugging and verification.
*   `/mrecorder.js`: Syntax fix.

## How to Use the New File Access
1.  Open **Options**.
2.  Click the **"..."** button next to "Path to Macros".
3.  Select your desired local folder (e.g., `Documents/iMacros/Macros`).
4.  The extension will automatically set the paths for Datasources and Downloads to subfolders within your selected folder.
5.  Open the **Files** tab to see your local files in the tree view.

---
*Generated by Antigravity on 2025-11-24*
