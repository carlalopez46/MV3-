# Chrome Extension Loading Troubleshooting Guide

## 🔍 Pre-flight Checks Completed

### ✅ Syntax Validation
- **background.js**: No syntax errors detected
- **errorLogger.js**: No syntax errors detected
- **manifest.json**: Valid JSON structure
- **JavaScript features**: Proxy, spread operator, async/await all validated

## 📋 How to Get Error Details

### Step 1: Open Chrome Extensions Page
1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **"Load unpacked"**
4. Select folder: `/home/user/iMacrosMV3`

### Step 2: Check for Errors

#### A. Extension Card Errors
Look for red error text directly on the extension card that says something like:
```
Manifest version 3 is not available
Invalid manifest
Failed to load extension
```

#### B. Service Worker Errors
1. Find the "Inspect views" section
2. Click the blue **"service worker"** link
3. DevTools will open - check the **Console** tab for errors

#### C. Errors Button
- If there's an **"Errors"** button on the extension card, click it
- This shows detailed error messages

## 🔧 Most Likely Issues & Quick Fixes

### Issue 1: Chrome Version Too Old
**Symptom**: "Manifest version 3 is not available"

**Solution**: Upgrade Chrome to version 109+
```bash
google-chrome --version
# Should show: 109.0.0.0 or higher
```

### Issue 2: Syntax Error in Our Changes
**Symptom**: "Unexpected token" or "SyntaxError"

**Quick Rollback**:
```bash
cd /home/user/iMacrosMV3
git checkout 9fbf0b9  # Go back to before localStorage changes
```
Then reload extension to confirm it was our changes.

### Issue 3: Chrome Storage API Not Available
**Symptom**: "chrome.storage is undefined" or similar

**Check**: Verify manifest.json has storage permission (should be on line 55)
```bash
grep -n '"storage"' manifest.json
```

### Issue 4: localStorage Polyfill Initialization Error
**Symptom**: Console shows "[iMacros MV3] Failed to initialize localStorage cache"

**This is OK** - The polyfill should still work, it just starts with empty cache.

## 🐛 Known Safe Patterns in Our Code

### background.js localStorage Polyfill (lines 382-559)
```javascript
// This pattern is safe - we check for undefined before accessing
if (typeof localStorage === 'undefined') {
    // Create polyfill...
}
```

### errorLogger.js Constructor (lines 56-72)
```javascript
// This pattern is safe - we check both conditions
if (typeof globalThis !== 'undefined' && globalThis.localStorageInitPromise) {
    // Wait for init...
} else {
    // Standard loading...
}
```

## 📊 What to Report

Please provide **ALL** of the following:

1. **Chrome Version**:
   ```
   Help > About Google Chrome
   ```

2. **Exact Error Message**:
   - Copy the complete error text from extensions page
   - Include file name and line number if shown

3. **Console Output** (from service worker DevTools):
   - Copy all messages, especially those starting with:
     - `[iMacros MV3]`
     - `[iMacros]`
     - `Error:`
     - `Uncaught`

4. **Extension Loading Status**:
   - Does the extension card appear at all?
   - Is there a red error banner?
   - Can you see the "Inspect views" section?

## 🔄 Emergency Rollback

If you need the extension working immediately:

```bash
cd /home/user/iMacrosMV3
git log --oneline -5
# Should show:
# e79ccf0 Preserve startup errors during storage initialization
# c86c072 Fix data loss in errorLogger by deferring localStorage load
# e2e8958 Improve localStorage polyfill initialization handling
# b1e6376 Fix localStorage ReferenceError in MV3 service worker
# 9fbf0b9 Merge pull request #34 (KNOWN WORKING)

# Rollback to known working state:
git checkout 9fbf0b9

# Or create a new branch from working state:
git checkout -b emergency-rollback 9fbf0b9
```

Then reload the extension in Chrome.

## ✨ Expected Working Behavior

If everything loads correctly, you should see in service worker console:

```
[iMacros MV3] Creating localStorage polyfill using chrome.storage.local
[iMacros MV3] Loading localStorage cache from chrome.storage.local
[iMacros MV3] localStorage cache initialized with 0 items in 2ms
[iMacros MV3] localStorage polyfill created successfully
[iMacros MV3] Note: Initialization is async. Await globalThis.localStorageInitPromise if needed.
[iMacros] Error Logger initialized successfully
[iMacros] Use ErrorLogger to access error logs
[iMacros MV3] Background service worker initialized
```

---

**Next Step**: Please try loading the extension and report the specific error message you see.
