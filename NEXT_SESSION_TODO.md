# Next Session TODO - Critical Issue Identified

## 🚨 P1 Issue from ChatGPT Codex (Just Received)

**Issue**: localStorage cache initialization race condition in bg.js startup logic

### Problem Description

The localStorage polyfill initializes asynchronously, but `importScripts()` immediately loads `bg.js` which runs startup checks while the cache is still empty. This causes:

1. `Storage.getBool("already-installed")` reads from empty cache → returns `false`
2. Install/welcome flow runs on **every service worker activation**
3. Welcome page opens repeatedly for existing users
4. Stored settings get overwritten

### Affected Code

**background.js:550-552**
```javascript
const initPromiseHandle = initializeLocalStorage().catch(err => {
    console.error('[iMacros MV3] localStorage initialization failed:', err);
});
// ⬇️ Problem: importScripts() runs immediately, cache not populated yet
importScripts(...);
```

**bg.js (around lines 1049-1071)**
```javascript
// This runs during service worker startup
Storage.getBool("already-installed")  // ← Returns false when cache is empty!
// Welcome page opens, settings reset, etc.
```

### Impact

- **User Experience**: Welcome page opens on every browser restart
- **Data Integrity**: User settings may be overwritten
- **Severity**: P1 - High impact on existing users

### Proposed Solution Options

#### Option 1: Synchronous Initialization (Best UX)
Make `chrome.storage.local.get()` synchronous at service worker startup:
```javascript
// Use top-level await (Chrome 89+, but we require 109+)
if (typeof localStorage === 'undefined') {
    const cache = {};
    const result = await chrome.storage.local.get(null);
    // Populate cache synchronously...
    globalThis.localStorage = createPolyfill(cache);
}

importScripts(...); // Now safe - cache is populated
```

#### Option 2: Defer bg.js Startup Logic
Modify bg.js to await localStorage initialization:
```javascript
// bg.js startup
(async function() {
    if (globalThis.localStorageInitPromise) {
        await globalThis.localStorageInitPromise;
    }

    // Now safe to read Storage.getBool("already-installed")
    const alreadyInstalled = Storage.getBool("already-installed");
    // ...
})();
```

#### Option 3: Store Critical Flags in chrome.storage Directly
For critical flags like "already-installed", bypass localStorage polyfill:
```javascript
// bg.js startup
const result = await chrome.storage.local.get('localStorage_already-installed');
const alreadyInstalled = result['localStorage_already-installed'] === 'true';
```

### Recommended Approach

**Option 1** is cleanest - use top-level await in background.js to ensure cache is populated before importScripts().

```javascript
// background.js (before importScripts)
if (typeof localStorage === 'undefined') {
    console.log('[iMacros MV3] Creating localStorage polyfill...');

    const localStorageCache = {};
    const STORAGE_PREFIX = 'localStorage_';

    // Synchronously load cache using top-level await
    try {
        const result = await chrome.storage.local.get(null);
        for (const key in result) {
            if (key.startsWith(STORAGE_PREFIX)) {
                localStorageCache[key.substring(STORAGE_PREFIX.length)] = result[key];
            }
        }
        console.log(`[iMacros MV3] Cache loaded: ${Object.keys(localStorageCache).length} items`);
    } catch (err) {
        console.error('[iMacros MV3] Cache load failed:', err);
    }

    // Create polyfill with pre-populated cache
    globalThis.localStorage = createPolyfill(localStorageCache);
}

// NOW import scripts - cache is ready
importScripts(...);
```

### Testing Plan

1. Install extension fresh → should see welcome page (already-installed = false)
2. Restart Chrome → should NOT see welcome page (already-installed = true)
3. Check console: "[iMacros MV3] Cache loaded: X items" appears before any bg.js logs

### Files to Modify

- `background.js` (lines 382-559): Refactor to use top-level await
- `bg.js` (optional): Add defensive check for localStorageInitPromise

### Reference

- ChatGPT Codex feedback: background.js lines 548-552
- Related to: bg.js lines 1049-1071 (startup checks)
- Chrome API: Top-level await supported in service workers (Chrome 89+)

---

## ✅ RESOLVED (Commit 9abd261)

**Status**: ✅ **FIXED** - Implemented top-level await solution (Option 1)
**Priority**: P1 - Critical fix completed
**Branch**: claude/fix-localstorage-error-01DNBTPrg9BtHYupc8aVeGrm
**Commit**: 9abd261 "Fix P1: Use top-level await to load localStorage cache before importScripts"

### Implementation Summary

- ✅ Used top-level await to load cache synchronously before importScripts()
- ✅ Added race condition protection (don't overwrite existing cache keys)
- ✅ Simplified errorLogger.js (removed async wait logic)
- ✅ Code reduction: -70 lines, cleaner implementation

### Expected Behavior After Fix

1. **First install**: Welcome page opens (already-installed = false)
2. **Subsequent starts**: Welcome page does NOT open (already-installed = true)
3. **Console output**: "cache loaded synchronously: X items" appears before bg.js logs

### Testing Checklist

- [ ] Install extension fresh → verify welcome page appears
- [ ] Restart Chrome → verify welcome page does NOT appear
- [ ] Check console for synchronous cache loading message
- [ ] Verify user settings persist across restarts
