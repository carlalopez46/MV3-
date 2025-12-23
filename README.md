# iMacros MV3 Extension

This project is a migration of the iMacros extension to Manifest V3.

## Key Features
- Manifest V3 compatible background scripts using Service Workers.
- Offscreen Document pattern for DOM-dependent tasks (Macro engine, logic).
- Unified logging system with `GlobalErrorLogger`.
- File system access via File System Access API.

## File Access Modes
1. **Virtual Mode**: Uses `chrome.storage.local` to store macros and data sources.
2. **Native Mode**: Uses the File System Access API to map a local Windows directory.

## Troubleshooting
- If the panel fails to load, check the Service Worker logs in `chrome://extensions`.
- Ensure appropriate permissions are granted for folder access.

## Development
- Build: `npm run build` (if applicable)
- Development: Load the directory as an unpacked extension in Chrome.