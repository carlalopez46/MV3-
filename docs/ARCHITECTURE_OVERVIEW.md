# iMacros MV3 Architecture Overview

## Major Components
- **Manifest Configuration (`manifest.json`)**: Declares MV3 service worker (`background.js`), content scripts, extension pages, sandbox pages, permissions, and commands.
- **Background Layer (`background.js`, `bg.js`, `offscreen_bg.js`, `bg_common.js`)**: Service worker entry that shims DOM/localStorage, initializes context, imports legacy background logic, and coordinates offscreen documents.
- **Macro Engine (`mplayer.js`, `variable-manager.js`, `mrecorder.js`)**: Executes and records macros, implements RUN command chaining, variable scoping, and playback controls.
- **Content Scripts (`content_scripts/*.js`)**: Bridge between web pages and background; handles recording, playback injection, bookmarks listener, and event routing.
- **UI/Extension Pages (`panel.html/js`, `options.html/js`, `editor/*`, `treeView.html/js`, `fileView.html/js`, dialogs)**: User-facing controls for running/recording macros, editing scripts, and managing files.
- **File & Storage Services (`AsyncFileIO.js`, `FileSystemAccessService.js`, `VirtualFileService.js`, `WindowsPathMappingService.js`, `FileSyncBridge.js`)**: Abstract file access, path resolution, and persistence across native/virtual file systems.
- **Messaging & Utilities (`communicator.js`, `context.js`, `utils.js`, `badge.js`, `nm_connector.js`, `GlobalErrorLogger.js`, `promise-utils.js`)**: Shared helpers for runtime messaging, context management, error logging, badge updates, native messaging, and async utilities.
- **Sandbox (`sandbox.html`, `sandbox/eval_executor.html`)**: Isolated execution environment for evaluation tasks launched from background logic.

## Dependency Flow
```
manifest.json
 ├─ background.service_worker → background.js
 │    ├─ Imports bg_common.js, bg.js (core logic), utilities, macro engine, messaging, badge, nm_connector
 │    ├─ Spawns offscreen.html → offscreen_bg.js (imports shared bg_common.js/bg.js logic)
 │    └─ Communicates with content scripts & UI pages via chrome.runtime messaging
 ├─ content_scripts
 │    ├─ bookmarks_handler.js, si_listener.js (document_start)
 │    └─ utils.js, errorLogger.js, connector.js, recorder.js, player.js (document_idle, all_frames)
 ├─ extension pages (panel/options/editor/treeView/fileView/dialogs)
 │    └─ Use communicator.js/context.js to talk to background for macro operations and persistence
 └─ sandbox pages (sandbox.html, sandbox/eval_executor.html)
      └─ Invoked by background for isolated evaluation
```

## Low-Risk Improvement Opportunities
- **Deduplicate background logic**: Extract common routines shared by `bg.js` and `offscreen_bg.js` into `bg_common.js` or ES modules to reduce drift between service worker and offscreen contexts.
- **Document macro engine behaviors**: Add concise guides for RUN command chaining, variable scoping, and error cases near `mplayer.js`/`variable-manager.js` to ease onboarding.
- **Unify async patterns**: Convert remaining callback-style Chrome API usage to `async/await` with centralized error handling helpers to improve readability.
- **Add focused tests**: Cover RUN command nesting, variable snapshot/restore, and file path resolution to prevent regressions during further MV3 refactors.
