# iMacrosMV3

## File Access Modes

iMacrosMV3 supports three file access modes, with automatic fallback:

### 1. Native File Access (Recommended)
To access real directories on your filesystem, you can install the native file access module. This provides:

- Access to actual directories on your computer
- Ability to read/write .iim macro files
- CSV datasource file support
- Full filesystem browsing capabilities
- Direct Windows path support (C:\Users\...)

**To enable native file access:**
1. Ensure you have a valid iMacros license (not available in freeware version)
2. Install the File Access for iMacros Extensions module
3. Configure the actual directory paths in the options page

For more information, see the [feature comparison chart](https://imacros.net/download/chrome-extension) and [installation guide](https://wiki.imacros.net/File_Access).

### 2. File System Access API with Windows Path Mapping (NEW!)
**No native module required!** Chrome 86+ supports direct filesystem access using the browser's File System Access API.

**Features:**
- ✅ Access real local files without installing native modules
- ✅ Support for Windows absolute paths (C:\Users\...)
- ✅ Persistent permissions (saved across browser sessions)
- ✅ Works on Chrome 86+ and Edge 86+
- ✅ No installation required

**How it works:**
1. When you use a Windows path like `C:\Users\John\Documents\test.txt`, the browser will prompt you to select that directory
2. Your selection is saved persistently
3. Next time, the same path will work automatically without prompting

**Example usage in macros:**
```text
SET !DATASOURCE C:\Users\John\Documents\data.csv
SAVEAS TYPE=EXTRACT FOLDER=C:\Users\John\Logs FILE=log.txt
```

See [Windows Path Mapping Documentation](docs/WINDOWS_PATH_MAPPING.md) for more details.

### 3. Virtual Filesystem (Fallback)
When neither native file access nor File System Access API is available, the extension automatically falls back to using a virtual filesystem. In this mode:

- Directory paths are set to virtual locations like `/VirtualMacros/`, `/VirtualMacros/Datasources/`, and `/VirtualMacros/Downloads/`
- Files are stored in browser storage (IndexedDB) rather than the actual filesystem
- You cannot use Windows absolute paths
- This mode works without additional installation but has limited functionality

**Console messages you might see:**
```
[AsyncFileIO] Native file access unavailable, using virtual filesystem fallback
IMX-0000 Native file access unavailable, using virtual filesystem fallback
```

### Priority Order

iMacrosMV3 automatically selects the best available file access mode:

1. **Native File Access** (if installed)
2. **File System Access API** (if supported by browser)
3. **Virtual Filesystem** (fallback)

## Troubleshooting

### "NodeObject cannot be constructed" error
This error can occur when:
- The virtual filesystem is being used but expects native file paths
- Invalid or empty paths are passed to file operations
- **Fix:** Ensure proper file path validation and error handling (fixed in recent commits)

### Test Suite Issues
If you see `AfioTestSuite is not defined` error:
- Ensure all scripts are loaded before running tests
- Check browser console for script loading errors
- Try refreshing the test runner page

### Native Messaging Connection Errors
Console spam about native messaging errors has been reduced. The extension will:
- Silently fall back to virtual filesystem when native host is unavailable
- Only show warnings for actual connection issues (not expected failures)

---

## Development

### Prerequisites

- Node.js 18+ 
- npm

### Setup

```bash
# Install dependencies
npm install
```

### Scripts

```bash
# Run tests
npm test

# Run ESLint
npm run lint

# Auto-fix ESLint issues
npm run lint:fix

# Run MV3 policy audit (checks for CSP violations)
npm run audit:mv3
```

### MV3 Policy Audit

The `audit:mv3` script scans the codebase for MV3 policy violations:

- `eval()` / `new Function()` outside sandbox pages
- MV2 API usage (deprecated APIs)
- Service Worker incompatibilities
- Manifest configuration issues

All errors must be resolved before the extension can be loaded in Chrome.

### Loading the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select the repository directory
4. Check the console for any errors (should be 0 errors)

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Service Worker                          │
│                    (background.js)                          │
│  - Event handling                                           │
│  - chrome.* API access                                      │
│  - Offscreen document lifecycle                             │
└─────────────────────┬───────────────────────────────────────┘
                      │ chrome.runtime messaging
┌─────────────────────┴───────────────────────────────────────┐
│                  Offscreen Document                          │
│                   (offscreen.html)                           │
│  - DOM operations                                            │
│  - Macro player/recorder logic                               │
│  - Bridge to sandbox                                         │
└─────────────────────┬───────────────────────────────────────┘
                      │ postMessage
┌─────────────────────┴───────────────────────────────────────┐
│                     Sandbox Page                             │
│              (sandbox.html / eval_executor.js)               │
│  - eval() / new Function() allowed here                      │
│  - No chrome.* API access                                    │
└─────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Description |
|------|-------------|
| `manifest.json` | Extension manifest (MV3) |
| `background.js` | Service Worker entry point |
| `offscreen.html/js` | Offscreen document for DOM operations |
| `sandbox.html/js` | Sandbox for eval operations |
| `mplayer.js` | Macro player engine |
| `mrecorder.js` | Macro recorder |
| `ERROR_AUDIT.md` | MV3 migration audit results |

### Testing

Tests are located in the `tests/` directory:

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:fsaccess  # File system access tests
npm run test:afio      # AsyncFileIO tests
```