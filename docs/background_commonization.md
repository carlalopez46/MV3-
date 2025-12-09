# Background Script Commonization Review

## Current Sharing Boundary
- `bg_common.js` exposes shared helpers (`save`, `playMacro`, `dockPanel`, `openPanel`, `_openPanelWindow`) through `registerSharedBackgroundHandlers`, allowing both the service worker (`bg.js`) and the offscreen document (`offscreen_bg.js`) to consume a single implementation for saving macros, launching playback, and creating/docking panels.
- The shared helpers wrap Chrome callbacks with `chromeAsync`, reuse the cached AFIO install check, and centralize bookmark/file save decisions to keep behavior aligned between contexts.

## Service Worker-Specific Logic (`bg.js`)
- Handles the browser action click flow, including recorder stop/save behavior, panel window lifecycle tracking, and state checks for paused/playing macros.
- Provides a stubbed `updatePanels` that intentionally avoids DOM access in MV3 service workers, logging instead of manipulating panel DOM.
- Registers shared handlers defensively (`importScripts` fallback plus availability checks) to mirror MV2 robustness without breaking when `bg_common.js` fails to load.

## Offscreen-Specific Logic (`offscreen_bg.js`)
- Hosts panel refresh and UI-facing callbacks that depend on DOM availability (e.g., updating the tree view), which cannot run inside the service worker.
- Shares the same handler registration pattern as the service worker but keeps editor launch and panel refresh behavior localized to the DOM-capable offscreen context.

## Feasibility of Further Commonization
- Core side-effectful operations (save/play/dock/open) are already unified in `bg_common.js`; remaining divergence stems from context capabilities:
  - Service worker lacks DOM/window access, so panel refresh and dialog flows must stay in DOM contexts.
  - Action icon behavior and recorder lifecycle belong to the service worker because they interact with browser events and context bookkeeping.
- Additional commonization would likely focus on extracting pure utility pieces (e.g., panel window positioning math) into `bg_common.js` while keeping DOM-dependent invocations in `bg.js`/`offscreen_bg.js`.

## Recommendations
- Keep context-specific entry points in `bg.js` and `offscreen_bg.js`, but ensure any shared math or Chrome API flows continue to live in `bg_common.js` to minimize drift.
- When porting MV2 features, map them to the appropriate context capability (service worker vs. offscreen) rather than duplicating DOM-dependent logic in both files.
