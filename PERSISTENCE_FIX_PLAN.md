# Settings Persistence Fix Plan

## Problem Analysis

### 1. Path Settings Not Persisting
**Root Cause**: The options.js page loads before the Service Worker's localStorage polyfill is fully initialized with data from chrome.storage.local.

**Current Flow**:
1. User opens options.html
2. options.js immediately reads from localStorage (lines 289-297)
3. Service Worker's localStorage polyfill may not have loaded cache yet
4. Empty values are displayed

### 2. Recorder Settings Not Persisting
**Root Cause**: Same as above - settings are read before localStorage cache is loaded.

**Affected Settings**:
- `record-mode` (line 346)
- `recording-prefer-id` (line 379)
- `recording-prefer-css-selectors` (line 385)

### 3. CLIPBOARD Errors
**Root Cause**: Clipboard API requires user interaction or specific permissions in MV3.

## Solution

### Fix 1: Ensure localStorage is Ready Before Reading
Add initialization check in options.js to wait for localStorage to be ready:

```javascript
// At the top of options.js window.addEventListener("load", ...)
async function ensureStorageReady() {
    // In Service Worker context, wait for localStorage to be initialized
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
            // Load all localStorage values from chrome.storage.local
            const items = await chrome.storage.local.get(null);
            for (const key in items) {
                if (key.startsWith('localStorage_')) {
                    const localKey = key.substring(13);
                    if (!localStorage.getItem(localKey)) {
                        localStorage.setItem(localKey, items[key]);
                    }
                }
            }
        } catch (e) {
            console.error('Failed to load localStorage from chrome.storage:', e);
        }
    }
}
```

### Fix 2: Update options.js Load Handler
Wrap the entire load handler in async function and await storage ready:

```javascript
window.addEventListener("load", async function () {
    // Ensure storage is ready before reading settings
    await ensureStorageReady();
    
    // ... rest of the code
});
```

### Fix 3: Add Clipboard Permissions to manifest.json
Ensure clipboard permissions are properly declared:

```json
{
  "permissions": [
    "clipboardRead",
    "clipboardWrite"
  ]
}
```

### Fix 4: Improve Error Handling for Clipboard
Add better error messages and fallback for clipboard operations.

## Implementation Steps

1. ✅ Add `ensureStorageReady()` function to options.js
2. ✅ Make window load handler async and await storage
3. ✅ Check manifest.json for clipboard permissions
4. ✅ Test path persistence
5. ✅ Test recorder settings persistence
6. ✅ Test clipboard operations

## Testing Checklist

- [ ] Set macro directory path → Reload extension → Check if path persists
- [ ] Set datasource path → Reload extension → Check if path persists
- [ ] Set download path → Reload extension → Check if path persists
- [ ] Change recording mode → Reload extension → Check if setting persists
- [ ] Toggle "Use element ID" → Reload extension → Check if setting persists
- [ ] Toggle "Use CSS selectors" → Reload extension → Check if setting persists
- [ ] Test SET !CLIPBOARD command in macro
- [ ] Test clipboard read/write operations
