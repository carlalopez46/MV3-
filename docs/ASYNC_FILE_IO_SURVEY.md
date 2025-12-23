# AsyncFileIO replacement blueprint

This document supersedes the earlier dependency survey and now focuses on the
plan for replacing the obsolete native messaging host (`afio.exe`).  The intent
is to introduce a modern, maintainable JavaScript implementation that delivers
as much of the legacy `AsyncFileIO` surface area as possible without requiring a
binary installer.

## Goals

1. Preserve macro authors' workflows (saving/reading `.iim` files, handling CSV
   datasources, exporting screenshots/logs, etc.).
2. Avoid OS-specific installers—everything should ship with the extension or be
   downloadable as plain data.
3. Provide transparent fallbacks so existing modules (player, editor, dialogs)
   continue to call the familiar `afio` API.
4. Offer visibility into which backend (native vs. fallback) handled each
   request so support and telemetry can monitor the migration.

## Architectural overview

The new stack is built out of three cooperating layers:

1. **`AsyncFileIO.js` orchestrator**
   - Exposes the historical `afio` API.
   - Delegates to either the legacy native host (if available) or the new
     JavaScript backend.
   - Normalizes results so callers remain untouched.

2. **In-browser filesystem service**
   - Implemented as a module named `VirtualFileService` (lives beside
     `AsyncFileIO.js`).
   - Persists data into `chrome.storage.local` using chunked blobs to stay below
     quota limits.
   - Mirrors the `NodeObject` shape (`{_path, _is_dir_int}`) to preserve
     compatibility with `TreeView`, dialogs, and `mplayer` logic.

3. **Background synchronizer**
   - Added to `bg.js` and `panel.js` as a shared helper called `FileSyncBridge`.
   - Periodically exports/imports the virtual tree to a JSON bundle so power
     users can keep offline backups.
   - Publishes events (via `communicator.js`) when writes occur, allowing the UI
     to refresh folder listings without polling.

## Key modules that remain consumers

The following files continue to `import`/`include` `AsyncFileIO.js`.  They do not
require refactors beyond reacting to new telemetry or events:

| Scope | Files |
| --- | --- |
| Macro player and recorder | `panel.html`, `panel.js`, `mplayer.js`, `mrecorder.js` |
| File/directory views | `fileView.html`, `fileView.js`, `folderView.html`, `folderView.js` |
| Background and options UI | `bg.html`, `bg.js`, `options.js` |
| Editor dialogs | `editor/saveAsDialog.html`, `editor/saveAsDialog.js` |
| Native messaging bridge | `nm_connector.js` |

## Backend selection flow

1. When `AsyncFileIO.js` loads it calls `detectNativeHost()`.
2. If the native bridge responds, `Storage.setBool("afio-installed")` remains
   `true` and all file commands are proxied to the host.
3. If detection fails, the module instantiates `VirtualFileService` and flips the
   installation flag to `true` only after the fallback finishes its async
   initialization routine (building the directory tree, loading quota metadata,
   etc.).
4. Each operation goes through `callFileIO(method, payload)` which:
   - Attempts `chrome.runtime.sendNativeMessage`.
   - Checks `chrome.runtime.lastError` and response metadata.
   - Falls back to `VirtualFileService[method]` when needed.
   - Emits a single console warning the first time the fallback is used in a
     given session.
5. Failure handling:
   - When `VirtualFileService` fails to initialize, the flag remains `false`, an
     error is logged via `errorLogger.js`, and the UI keeps showing the "file
     access not installed" notice so users understand that SAVEAS and related
     commands are disabled.
   - `detectNativeHost()` timeouts ( >3 s) trigger a retry with an exponential
     backoff capped at 15 s.  Partial responses are treated as failures and push
     the request into the fallback path while logging the exact status code.
   - The one-time warning includes a stack trace and is emitted both to the
     console and `errorLogger.logWarning` so support tooling and the Options
     page banner display the same messaging.

## VirtualFileService capabilities

| Operation | Status | Notes |
| --- | --- | --- |
| `openNode`, `getNodesInDir`, `node.exists`, `node.isDir`, `makeDirectory` | ✅ | Implemented on top of a normalized tree structure. |
| `readTextFile`, `writeTextFile`, `appendTextFile` | ✅ | Stored as UTF-8 strings; size caps enforced per file. |
| `writeImageToFile` | ✅ | Accepts base64 blobs, compresses large payloads with `CompressionStream` when available. |
| `copyTo`, `moveTo`, `deleteNode` | ✅ | Maintain referential integrity for child paths. |
| `getDefaultDir`, `getLogicalDrives` | ✅ | Seeded with synthetic entries (e.g., `/VirtualMacros/` plus user-configured folders). |
| `queryLimits` | ✅ | Reports storage quota, per-file cap, and warning thresholds. |
| `watchPath` | 🚧 | Optional enhancement; would hook into the background synchronizer to push changes. |

## Storage and performance considerations

- Data is chunked into 1 MB segments because Chrome enforces ~8 MB maximum per
  `chrome.storage.local` write (per `MAX_WRITE_OPERATIONS`) and throttles writes
  above that threshold.  Keeping chunks ≤1 MB ensures multi-part commits never
  exceed the limit while minimizing wasted overhead during LRU cleanup.
- The LRU eviction policy walks child nodes from newest to oldest and deletes
  the oldest chunk set for each file, rebalancing directories once the total
  size drops below 70% of quota.  Evicted files move into a "Recently Deleted"
  list for 24 hours so users can restore them unless the profile is wiped.
- The background synchronizer keeps a rolling estimate of storage utilization and
  raises warnings in `options.js` when 80% of the quota is used; hitting 90%
  triggers a modal that blocks new writes until the user exports or deletes
  data.
- Bulk directory scans (`TreeView` refreshes) operate on an in-memory index that
  is rebuilt when the stored JSON digest changes, when more than 1 000 nodes are
  modified within 2 s, or 500 ms after any write completes (debounced) to catch
  rapid recorder sessions.

## Migration strategy

1. Ship the new `AsyncFileIO.js` with both backends but default to the native
   host when present.
2. Log telemetry events (`fileio.backend = native|virtual`) for each session.
3. Provide an “Export Virtual Filesystem” button in `options.html` that calls the
   synchronizer and downloads the JSON bundle via `saveAs`.  This doubles as a
   diagnostic artifact for support.
4. Once adoption stabilizes, document how to uninstall the legacy host while
   keeping data inside the virtual storage.

## Testing checklist

- **Unit tests**: add coverage for each `VirtualFileService` method using the
  existing Jasmine harness in `sandbox.html`.
- **Integration tests**: run macro playback, recording, SAVEAS, SCREENSHOT, and
  datasource commands with the native host disabled to ensure the fallback
  handles all workflows.
- **Performance tests**: profile `TreeView` render times with 5k virtual files
  and ensure load stays under 500 ms on mid-tier hardware.
- **Error-path tests**:
  - Attempt file writes after the 80% warning to confirm the UI blocks at 90%
    and recovers once space is freed.
  - Corrupt the stored JSON digest and verify the TreeView rehydrates from the
    chunk map instead of crashing.
  - Import macros created on the legacy host, including malformed entries, and
    confirm the fallback either upgrades them or surfaces actionable errors.
  - Exercise offline mode by disabling network access for `bg.js` to ensure the
    synchronizer batches exports and retries once connectivity returns.

## Automated integrity verification

Run the comprehensive `tests/afio_integrity_check.js` script to audit all 89
`afio` call sites across the repository and capture any failures with the
originating script name, file path, and line number. The checker chains the
dependency analyzer and usage verifier, writing detailed JSON summaries to the
`tests/` directory for rapid debugging:

```
node tests/afio_integrity_check.js /path/to/iMacrosMV3
```

If any step fails, the script records the stack trace and marks the exit code
so CI can flag regressions immediately.

By centralizing the replacement logic inside `AsyncFileIO.js`, every consumer
continues to work without invasive rewrites while gaining a fully supported,
maintainable file backend.
