# AsyncFileIO.js - New Implementation with Virtual Filesystem Fallback

## Overview

The new `AsyncFileIO.js` implementation provides a seamless fallback to a virtual filesystem when the native messaging host (`afio.exe`) is unavailable. This ensures that iMacros continues to function even without the native file access component.

- `VirtualFileService.js` houses the storage, quota, and watcher logic.
- `FileSyncBridge.js` keeps the background page and UI contexts synchronized and periodically exports JSON snapshots.

## Architecture

### 1. Three-Layer Architecture

```
┌─────────────────────────────────────┐
│   afio API (Public Interface)      │
│   - openNode, readTextFile, etc.   │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│   callFileIO (Routing Layer)       │
│   - Try native messaging first     │
│   - Fall back to VFS on failure    │
└─────────────────────────────────────┘
              ↓
    ┌─────────┴─────────┐
    ↓                   ↓
┌─────────┐      ┌──────────────┐
│ Native  │      │ VirtualFile  │
│ Host    │      │ System (VFS) │
└─────────┘      └──────────────┘
```

### 2. VirtualFileSystem Class

Defined in `VirtualFileService.js`, the `VirtualFileSystem` class manages a virtual filesystem stored in `chrome.storage.local` (with `localStorage` fallback).

#### Storage Structure

```javascript
{
  "vfs_data": {
    "/VirtualMacros/": { type: "dir", modified: 1234567890 },
    "/VirtualMacros/test.iim": {
      type: "file",
      content: "TAB T=1\nWAIT SECONDS=1",
      size: 25,
      modified: 1234567890
    }
  },
  "vfs_config": {
    "defsavepath": "/VirtualMacros/",
    "defdatapath": "/VirtualMacros/Datasources/",
    "defdownpath": "/VirtualMacros/Downloads/",
    "deflogpath": "/VirtualMacros/Logs/"
  },
  "vfs_stats": {
    "totalSize": 1234,
    "lastAccess": {
      "/VirtualMacros/test.iim": 1234567890
    }
  }
}
```

#### Default Directory Structure

When initialized, the VFS creates:
- `/VirtualMacros/` - Main macro storage
- `/VirtualMacros/Datasources/` - CSV and data files
- `/VirtualMacros/Downloads/` - Downloaded files
- `/VirtualMacros/Logs/` - Log files and profiling data

### 3. callFileIO Wrapper

The `callFileIO` function is the central routing mechanism:

1. **First attempt**: Try native messaging via `chrome.runtime.sendNativeMessage`
2. **On failure**: Automatically switch to VFS fallback
3. **Subsequent calls**: Use VFS directly (cached decision)
4. **Logging**: One-time warning when fallback activates

Background contexts also wrap `afio.isInstalled()` with a small cache. Successful detections are kept, while negative or failed
checks are cached for one minute to avoid repeatedly hammering initialization paths on hot macro routes. After the TTL expires,
the call is retried so permission recovery flows still work.

```javascript
async function callFileIO(method, payload) {
  if (!useFallback) {
    try {
      // Try native messaging
      return await nativeMessage(payload);
    } catch (nativeError) {
      console.warn("Switching to virtual filesystem fallback");
      useFallback = true;
    }
  }

  // Use fallback
  return await afioFallback[method](...args);
}
```

## FileSyncBridge helper

`FileSyncBridge.js` links the background context and the panel UI:

- Listens for `VirtualFileService` change events and broadcasts `vfs-change` messages via `communicator.js`.
- Periodically saves JSON backups to `chrome.storage.local` so Options can offer “Export Virtual Filesystem”.
- UI contexts subscribe to the same topic and trigger immediate TreeView refreshes without polling.
- Responds to `vfs-request-export` messages, returning the latest bundle for diagnostics.

## Features

### Storage Quota Management

- **Maximum storage**: 8 MB total
- **Maximum file size**: 2 MB per file
- **Automatic cleanup**: LRU eviction when quota exceeded
- **User warnings**: Console warnings before cleanup

### Path Normalization

The VFS normalizes all paths:
- Windows backslashes (`\`) → forward slashes (`/`)
- Trailing slashes removed (except root)
- Consistent internal representation

### Supported Operations

All original `afio` operations are supported:

#### NodeObject Methods
- `exists()` - Check if path exists
- `isDir()` - Check if path is directory
- `isWritable()` - Check write permissions
- `isReadable()` - Check read permissions
- `copyTo(dest)` - Copy file/directory
- `moveTo(dest)` - Move file/directory
- `remove()` - Delete file/directory

#### afio API Methods
- `isInstalled()` - Always returns `true` (fallback available). When a saved File System Access handle exists but needs permission, the virtual filesystem is primed without switching backends so permission recovery remains possible.
- `queryLimits()` - Returns storage limits and usage
- `openNode(path)` - Create NodeObject from path
- `readTextFile(node)` - Read file content
- `writeTextFile(node, data)` - Write file content
- `appendTextFile(node, data)` - Append to file
- `getNodesInDir(node, filter)` - List directory contents
- `getLogicalDrives()` - Get root drives/directories
- `getDefaultDir(name)` - Get default directory paths
- `makeDirectory(node)` - Create directory
- `writeImageToFile(node, imageData)` - Save screenshot/image

## Usage

### For Application Code

No changes required! The new implementation is a drop-in replacement. All existing code using `afio` will continue to work:

```javascript
// This code works exactly as before
var node = afio.openNode("/VirtualMacros/test.iim");
afio.writeTextFile(node, "TAB T=1").then(() => {
  console.log("File saved");
});
```

### Debugging

Check if fallback is active:

```javascript
if (afio._useFallback()) {
  console.log("Using virtual filesystem");
} else {
  console.log("Using native file access");
}
```

Inspect VFS contents:

```javascript
// Access internal VFS for debugging
afio._vfs.init().then(() => {
  console.log("VFS data:", afio._vfs.data);
  console.log("VFS stats:", afio._vfs.stats);
});
```

## Migration Path

### From Native Host to VFS

When native host is not available:
1. First `afio` call attempts native messaging
2. Failure triggers automatic fallback activation
3. Warning logged to console
4. All subsequent operations use VFS
5. Data stored in `chrome.storage.local`

### Importing Existing Macros

To import macros from the old system:

```javascript
// Read macro from bookmark/legacy storage
var macroContent = "..."; // Get from legacy source
var macroName = "test.iim";

// Write to VFS
var node = afio.openNode("/VirtualMacros/" + macroName);
afio.writeTextFile(node, macroContent).then(() => {
  console.log("Macro imported to VFS");
});
```

## Limitations

### VFS Limitations vs Native Host

1. **Storage size**: Limited to ~8 MB vs unlimited disk space
2. **Performance**: Slightly slower for large operations
3. **Persistence**: Data lost if browser profile cleared
4. **File system integration**: No real filesystem access

### Recommended Practices

1. **Keep macros small**: Stay within file size limits
2. **Regular exports**: Backup important macros
3. **Monitor storage**: Check `queryLimits()` periodically
4. **Clean old files**: Remove unused macros/logs

## Error Handling

### Common Errors

1. **Storage quota exceeded**
   ```
   Error: Storage quota exceeded. Please delete some files.
   ```
   Solution: Delete old files or export data

2. **File size too large**
   ```
   Error: File size exceeds limit: 3000000 bytes
   ```
   Solution: Reduce file size or split into smaller files

3. **Path not found**
   ```
   Error: File does not exist: /VirtualMacros/missing.iim
   ```
   Solution: Check path spelling and existence

## Technical Details

### Storage Backend

Priority order:
1. `chrome.storage.local` (preferred, if available)
2. `localStorage` (fallback)

### Async/Await Pattern

All operations are asynchronous and return Promises:

```javascript
// Using async/await
async function saveMacro() {
  try {
    var node = afio.openNode("/VirtualMacros/test.iim");
    await afio.writeTextFile(node, "TAB T=1");
    console.log("Success");
  } catch (e) {
    console.error("Error:", e);
  }
}

// Using .then()
afio.writeTextFile(node, "TAB T=1")
  .then(() => console.log("Success"))
  .catch(e => console.error("Error:", e));
```

### LRU Cleanup Algorithm

When storage quota is exceeded:
1. Sort files by last access time (oldest first)
2. Delete files until 20% of storage is freed
3. Update size statistics
4. Save changes

## Testing

### Manual Testing

```javascript
// Test basic operations
async function testVFS() {
  // Create directory
  var dir = afio.openNode("/VirtualMacros/Test/");
  await afio.makeDirectory(dir);

  // Write file
  var file = afio.openNode("/VirtualMacros/Test/test.iim");
  await afio.writeTextFile(file, "TAB T=1\nWAIT SECONDS=1");

  // Read file
  var content = await afio.readTextFile(file);
  console.log("Content:", content);

  // List directory
  var nodes = await afio.getNodesInDir(dir);
  console.log("Files:", nodes.map(n => n.path));

  // Check limits
  var limits = await afio.queryLimits();
  console.log("Storage:", limits);
}

testVFS().catch(console.error);
```

### Automated coverage check

Run the usage verifier after modifying any afio consumer to ensure every detected method remains covered by the browser test suite and that the canonical 89 call sites are accounted for:

```bash
node tests/afio_usage_verifier.js /path/to/iMacrosMV3
```

## Compatibility

### Browser Support

- Chrome/Chromium: Full support
- Edge: Full support
- Firefox: Requires MV3 compatibility (storage API)

### iMacros Version

- Compatible with all existing iMacros code
- No API changes required
- Drop-in replacement for old AsyncFileIO.js

## Future Enhancements

Potential improvements:

1. **Import/Export**: Bulk import/export of VFS data
2. **Compression**: Compress stored data to save space
3. **Sync**: Optional cloud sync via Chrome Sync Storage
4. **Search**: Full-text search across macros
5. **Versioning**: Keep file history/versions

## Support

For issues or questions:
- Check console for warning/error messages
- Verify storage quota with `queryLimits()`
- Test with simple operations first
- Report bugs with console logs

## Changelog

### Version 2.0 (2025)
- Added VirtualFileSystem fallback
- Implemented LRU cleanup
- Added storage quota management
- Transparent fallback activation
- Full backward compatibility maintained
