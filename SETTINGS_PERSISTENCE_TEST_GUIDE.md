# Settings Persistence Test Guide

## Overview
This guide helps you test the fixes for settings persistence issues in iMacros MV3.

## Issues Fixed

### 1. Path Settings Persistence ✓
**Problem**: Macro directory, datasource, and download paths were lost after extension reload.
**Fix**: Added `ensureStorageReady()` function to load settings from `chrome.storage.local` before reading them.

### 2. Recorder Settings Persistence ✓
**Problem**: Recording mode, "Use element ID", and "Use CSS selectors" settings were not persisting.
**Fix**: Same as above - settings are now properly loaded before the UI initializes.

### 3. Clipboard Error Handling ✓
**Problem**: Clipboard errors were silently caught, making debugging difficult.
**Fix**: Added better error logging and warnings while still allowing macros to continue execution.

## Test Procedures

### Test 1: Path Settings Persistence

1. **Open Options Page**
   - Click the iMacros extension icon
   - Click "Options" or navigate to `chrome-extension://[extension-id]/options.html`

2. **Set Paths**
   - Click "Browse" button for "マクロのディレクトリパス" (Macro directory path)
   - Select a folder (e.g., create a folder called "iMacrosData" on your Desktop)
   - The extension should automatically create and set:
     - Macros: `iMacrosData/Macros`
     - Datasources: `iMacrosData/Datasources`
     - Downloads: `iMacrosData/Downloads`

3. **Verify Immediate Persistence**
   - Note the paths shown in the options page
   - Open browser DevTools (F12)
   - Go to Console tab
   - Type: `chrome.storage.local.get(null, (items) => console.log(items))`
   - Verify you see entries like:
     ```
     localStorage_defsavepath: "iMacrosData/Macros"
     localStorage_defdatapath: "iMacrosData/Datasources"
     localStorage_defdownpath: "iMacrosData/Downloads"
     ```

4. **Test After Extension Reload**
   - Go to `chrome://extensions/`
   - Find "iMacros for Chrome"
   - Click the reload button (circular arrow icon)
   - Go back to the options page
   - **Expected**: All paths should still be displayed correctly
   - **Previous Behavior**: Paths would be empty

### Test 2: Recorder Settings Persistence

1. **Set Recorder Options**
   - On the options page, under "レコーダーの設定" (Recorder Settings):
     - Select "イベント記録モード" (Event recording mode)
     - Uncheck "可能な限り要素 ID を使用する" (Use element ID when possible)
     - Check "CSSセレクターを使用する" (Use CSS selectors)

2. **Verify in Console**
   ```javascript
   chrome.storage.local.get(null, (items) => {
       console.log('record-mode:', items.localStorage_record-mode);
       console.log('recording-prefer-id:', items['localStorage_recording-prefer-id']);
       console.log('recording-prefer-css-selectors:', items['localStorage_recording-prefer-css-selectors']);
   });
   ```

3. **Reload Extension**
   - Go to `chrome://extensions/`
   - Reload the extension
   - Return to options page
   - **Expected**: All recorder settings should be preserved
   - **Previous Behavior**: Settings would reset to defaults

### Test 3: Clipboard Operations

1. **Create Test Macro**
   Create a file `ClipboardTest.iim`:
   ```
   VERSION BUILD=10.1.1
   TAB T=1
   SET !CLIPBOARD "Hello from iMacros!"
   PROMPT {{!CLIPBOARD}}
   ```

2. **Run the Macro**
   - Open iMacros panel
   - Play the macro
   - **Expected**: 
     - Prompt should show "Hello from iMacros!"
     - System clipboard should contain "Hello from iMacros!"
     - No errors in console

3. **Check Console for Warnings**
   - If clipboard write fails, you should see:
     ```
     [iMacros] Clipboard write failed - value stored in memory only
     ```
   - The macro should still continue execution

4. **Test Clipboard Read**
   Create `ClipboardReadTest.iim`:
   ```
   VERSION BUILD=10.1.1
   TAB T=1
   ' First, copy some text manually (Ctrl+C)
   ' Then run this macro
   PROMPT {{!CLIPBOARD}}
   ```

### Test 4: General Settings Persistence

1. **Test All Settings**
   - Set "ブックマークの編集ダイアログを表示" (Show before play dialog)
   - Set "iMacros パネルをブラウザ ウィンドウにドッキングする" (Dock panel)
   - Set "プロファイルマクロのパフォーマンス" (Enable profiler)
   - Set replay speed to "Slow"

2. **Reload Extension**
   - All settings should persist

3. **Check Storage**
   ```javascript
   chrome.storage.local.get(null, (items) => {
       for (let key in items) {
           if (key.startsWith('localStorage_')) {
               console.log(key, '=', items[key]);
           }
       }
   });
   ```

## Debugging Tips

### If Settings Still Don't Persist

1. **Check Console Logs**
   - Open options page with DevTools open
   - Look for:
     ```
     [iMacros Options] Loading settings from chrome.storage.local...
     [iMacros Options] Loaded X settings from persistent storage
     ```

2. **Verify Storage API**
   ```javascript
   // Check if chrome.storage.local is accessible
   chrome.storage.local.get(null, (items) => {
       console.log('Total items in storage:', Object.keys(items).length);
       console.log('localStorage items:', 
           Object.keys(items).filter(k => k.startsWith('localStorage_')).length
       );
   });
   ```

3. **Check for Errors**
   - Look for any errors in the console
   - Common issues:
     - Storage quota exceeded
     - Permission denied
     - Service worker not running

### If Clipboard Doesn't Work

1. **Check Permissions**
   - Go to `chrome://extensions/`
   - Find iMacros
   - Check that "Clipboard" permissions are granted

2. **Check Offscreen Document**
   - In Service Worker context, clipboard requires offscreen document
   - Look for console messages about offscreen document creation

3. **Manual Test**
   ```javascript
   // In browser console (not service worker)
   navigator.clipboard.writeText('test').then(
       () => console.log('Clipboard write OK'),
       (err) => console.error('Clipboard write failed:', err)
   );
   ```

## Success Criteria

✅ All path settings persist after extension reload
✅ All recorder settings persist after extension reload
✅ All general settings persist after extension reload
✅ Clipboard operations work or show clear error messages
✅ No console errors during normal operation
✅ Settings load quickly (< 100ms)

## Known Limitations

1. **Clipboard in Service Worker**: Requires offscreen document, which may have slight delay
2. **File System Access**: Requires user interaction to grant permissions
3. **Storage Quota**: Chrome has limits on storage size (check with `navigator.storage.estimate()`)

## Reporting Issues

If you encounter issues, please provide:
1. Chrome version
2. Extension version
3. Console logs from options page
4. Output of `chrome.storage.local.get(null, console.log)`
5. Steps to reproduce
