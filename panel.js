/* panel.js - MV3対応版 */
/* global getRedirectURL, getRedirFromString */

// 選択中のマクロ情報を保持する変数
let selectedMacro = null;

// パネルの状態をキャッシュ
let panelState = {
    isRecording: false,
    isPlaying: false,
    currentMacro: null
};

function generateExecutionId() {
    return (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
const isTopFrame = window.top === window;

// 情報パネルに表示した内容を保持（ヘルプ/編集ボタン用）
let lastInfoArgs = null;

function normalizeMacro(macro) {
    if (!macro) return null;
    const normalized = { ...macro };
    // Prefer explicit identifiers and paths; avoid falling back to display names for IDs
    normalized.id = macro.id || macro.file_id || null;
    normalized.path = macro.path || (typeof macro.id === "string" ? macro.id : null);
    normalized.name = macro.text || macro.name || "";
    normalized.text = normalized.name || macro.text;
    normalized.type = macro.type || normalized.type;
    return normalized;
}

function getMacroPathAndName(macro) {
    const normalized = normalizeMacro(macro);
    return {
        macro: normalized,
        filePath: normalized ? (normalized.path || normalized.id) : null,
        macroName: normalized ? (normalized.name || normalized.text || "") : ""
    };
}

// パネルのウィンドウIDを保持
let currentWindowId = null;

// ウィンドウIDを取得
function initWindowId() {
    return new Promise((resolve) => {
        // Check URL parameters first (passed from openPanel in background.js)
        const urlParams = new URLSearchParams(window.location.search);
        const winIdParam = urlParams.get('win_id');

        if (winIdParam) {
            // 安全のため基数10を指定 (Main側の記述を採用)
            currentWindowId = parseInt(winIdParam, 10);
            console.log("[Panel] Current window ID from URL:", currentWindowId);
            resolve(currentWindowId);
            return;
        }

        // Fallback to getCurrent if no URL param (e.g. sidebar or direct open)
        chrome.windows.getCurrent((win) => {
            if (chrome.runtime.lastError) {
                console.error("[Panel] Failed to get current window:", chrome.runtime.lastError);
                resolve(null);
            } else {
                currentWindowId = win.id;
                console.log("[Panel] Current window ID from API:", currentWindowId);
                resolve(win.id);
            }
        });
    });
}

let windowIdReadyPromise = null;

// 通信機能: バックグラウンドへメッセージを送る
function ensureWindowId() {
    if (currentWindowId !== null) {
        return Promise.resolve(currentWindowId);
    }
    if (!windowIdReadyPromise) {
        windowIdReadyPromise = initWindowId();
    }
    return windowIdReadyPromise;
}

function handleMissingWindowId(context) {
    const el = ensureStatusLineElement();
    el.textContent = context || "Unable to determine window context.";
    el.style.color = "#b00020";
}

function sendCommand(command, payload = {}) {
    return ensureWindowId().then(() => {
        if (currentWindowId === null) {
            console.warn(`[Panel] Skipping command ${command}: window ID unavailable`);
            handleMissingWindowId("Unable to determine window context. Command not sent.");
            return undefined;
        }
        // 自動的にウィンドウIDを追加
        const message = {
            ...payload,
            command: command,
            target: 'offscreen',
            win_id: payload.win_id || currentWindowId
        };
        console.log(`[Panel] Sending command: ${command}`, message);
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("[Panel] Message error:", chrome.runtime.lastError);
                        // 通信エラーは無視してよい場合が多い
                        resolve();
                    } else {
                        console.log(`[Panel] Command ${command} response:`, response);
                        resolve(response);
                    }
                });
            } catch (e) {
                console.error("[Panel] Failed to send message:", e);
                resolve();
            }
        });
    });
}

function requestStateUpdate() {
    return ensureWindowId().then(() => {
        if (currentWindowId === null) {
            console.warn("[Panel] Skipping state update: window ID unavailable");
            handleMissingWindowId("Unable to determine window context. State unavailable.");
            return undefined;
        }
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                type: 'QUERY_STATE',
                target: 'background',
                win_id: currentWindowId
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('[Panel] QUERY_STATE failed:', chrome.runtime.lastError.message);
                    return resolve();
                }
                if (response && response.state) {
                    updatePanelState(response.state);
                }
                resolve();
            });
        });
    });
}

// --- ボタンアクション ---

function play() {
    console.log("[Panel] Play button clicked");

    // Guard against double execution - ignore if already playing
    if (panelState.isPlaying) {
        console.log("[Panel] Ignoring play request - already playing");
        return;
    }

    if (!selectedMacro || selectedMacro.type !== "macro") {
        alert("Please select a macro first.");
        return;
    }

    const { filePath, macroName, macro } = getMacroPathAndName(selectedMacro);
    if (!filePath) {
        alert("Unable to play: no macro path found.");
        return;
    }

    // UIを即時更新してストップボタンを有効化
    updatePanelState({ isPlaying: true, isRecording: false, currentMacro: macro });

    const executionId = generateExecutionId();
    console.log(`[Panel] Sending playMacro with ID: ${executionId}`);

    // パネル側ではファイルを読まず、パスだけを送る
    sendCommand("playMacro", {
        file_path: filePath, // ファイルパスまたはID
        macro_name: macroName,
        loop: 1,  // ★修正: playボタンは常に1回のみ実行(繰り返しなし)
        executionId: executionId
    })
        .then((response) => {
            handlePlayStartResponse(
                response,
                "Failed to start playback.",
                "Playback did not return a response",
                "Playback failed to start"
            );
        });
}

function record() {
    console.log("[Panel] Record button clicked");

    // Guard against double execution - ignore if already recording or playing
    if (panelState.isRecording) {
        console.log("[Panel] Ignoring record request - already recording");
        return;
    }
    if (panelState.isPlaying) {
        console.log("[Panel] Ignoring record request - currently playing");
        return;
    }

    if (!selectedMacro || selectedMacro.type !== "macro") {
        alert("Please select a macro first.");
        return;
    }
    // UIを即時更新してストップボタンを有効化
    updatePanelState({ isRecording: true, isPlaying: false, currentMacro: selectedMacro });
    sendCommand("startRecording");
}

function stop() {
    console.log("[Panel] Stop button clicked");
    sendCommand("stop")
        .then(() => {
            updatePanelState("idle");
        })
        .catch(() => {
            // Even if stop fails, reset the UI so the user can retry
            updatePanelState("idle");
        });
}

function pause() {
    console.log("[Panel] Pause button clicked");
    sendCommand("pause");
}

function playLoop() {
    console.log("[Panel] Loop button clicked");

    // Guard against double execution - ignore if already playing or recording
    if (panelState.isPlaying) {
        console.log("[Panel] Ignoring playLoop request - already playing");
        return;
    }
    if (panelState.isRecording) {
        console.log("[Panel] Ignoring playLoop request - currently recording");
        return;
    }

    if (!selectedMacro || selectedMacro.type !== "macro") {
        alert("Please select a macro first.");
        return;
    }
    const loopInput = document.getElementById("max-loop");
    const max = loopInput ? parseInt(loopInput.value, 10) : NaN;
    if (!Number.isInteger(max) || max < 1) {
        alert("Please enter a valid loop count (positive integer).");
        return;
    }

    const { filePath, macroName, macro } = getMacroPathAndName(selectedMacro);
    if (!filePath) {
        alert("Unable to play: no macro path found.");
        return;
    }

    // UIを即時更新してストップボタンを有効化
    updatePanelState({ isPlaying: true, isRecording: false, currentMacro: macro });

    const executionId = generateExecutionId();
    console.log(`[Panel] Sending playMacro(loop) with ID: ${executionId}`);

    sendCommand("playMacro", {
        file_path: filePath,
        macro_name: macroName,
        loop: max,
        executionId: executionId
    })
        .then((response) => {
            handlePlayStartResponse(
                response,
                "Failed to start loop playback.",
                "Loop playback did not return a response",
                "Loop playback failed to start"
            );
        });
}

function handlePlayStartResponse(response, failureMessage, noResponseLog, failureLog) {
    if (!response) {
        console.warn(`[Panel] ${noResponseLog}`);
        updatePanelState("idle");
        return;
    }
    if (response.success === false) {
        console.warn(`[Panel] ${failureLog}`, response);
        const el = ensureStatusLineElement();
        el.textContent = response.error || failureMessage;
        el.style.color = "#b00020";
        updatePanelState("idle");
    }
}

function openSettings() {
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        window.open("options.html");
    }
}

function openRedirectLink(resolverFn, label, fallbackMessage) {
    const statusEl = ensureStatusLineElement();
    try {
        if (typeof resolverFn !== 'function') {
            throw new Error(`${label} resolver is unavailable`);
        }
        const url = resolverFn();
        if (!url) {
            throw new Error(`${label} URL is empty`);
        }
        window.open(url);
    } catch (e) {
        console.error(`[Panel] Failed to open ${label}`, e);
        if (statusEl) {
            statusEl.textContent = fallbackMessage;
            statusEl.style.color = "#b00020";
        }
    }
}

function edit() {
    if (!selectedMacro) return;
    const { filePath, macroName } = getMacroPathAndName(selectedMacro);
    if (!filePath) {
        console.error("[Panel] Cannot edit macro: no valid path found", selectedMacro);
        alert("Unable to open macro for editing.");
        return;
    }
    sendCommand("editMacro", {
        file_path: filePath,
        macro_name: macroName
    });
}

function openHelp() {
    // 旧版と同様にリダイレクトURLを利用
    openRedirectLink(() => getRedirectURL('iMacros_for_Chrome'), 'help link', "Unable to open help page.");
}

function openErrorHelp() {
    openRedirectLink(() => getRedirFromString("error"), 'error help', "Unable to open error help page.");
}

function openInfoEdit() {
    if (!lastInfoArgs || !lastInfoArgs.macro) return;
    const { macro, filePath, macroName } = getMacroPathAndName(lastInfoArgs.macro);
    if (!filePath) {
        console.error("[Panel] Cannot edit macro: no valid path found", macro);
        alert("Unable to open macro for editing.");
        return;
    }
    sendCommand("editMacro", {
        file_path: filePath,
        macro_name: macroName
    });
}

// --- Tree View Switching ---

function refreshTreeView() {
    const iframe = document.getElementById("tree-iframe");
    if (!iframe) return;

    const viewWindow = iframe.contentWindow;
    try {
        if (viewWindow && viewWindow.TreeView && typeof viewWindow.TreeView.refresh === "function") {
            viewWindow.TreeView.refresh();
            return;
        }
    } catch (e) {
        console.warn("[Panel] TreeView.refresh failed, falling back to iframe reload", e);
    }

    // Fallback: reload iframe
    const src = iframe.getAttribute("src");
    iframe.setAttribute("src", "");
    iframe.setAttribute("src", src);
}

function applyTreeSelection(type, options = {}) {
    const { persist = true, forceReload = false } = options;
    let actualType = type;
    if (actualType !== "files" && actualType !== "bookmarks") {
        console.warn("[Panel] Unknown tree type, falling back to bookmarks:", type);
        actualType = "bookmarks";
    }

    const iframe = document.getElementById("tree-iframe");
    if (!iframe) {
        console.error("[Panel] tree-iframe not found");
        return;
    }

    const targetSrc = actualType === "files" ? "fileView.html" : "treeView.html";
    if (forceReload || iframe.getAttribute("src") !== targetSrc) {
        iframe.setAttribute("src", targetSrc);
    }

    const filesRadio = document.getElementById("radio-files-tree");
    const bookmarksRadio = document.getElementById("radio-bookmarks-tree");
    if (filesRadio) filesRadio.checked = actualType === "files";
    if (bookmarksRadio) bookmarksRadio.checked = actualType === "bookmarks";

    if (persist) {
        Storage.setChar("tree-type", actualType);
    }
}

async function selectInitialTree() {
    let storedType = Storage.isSet("tree-type") ? Storage.getChar("tree-type") : "files";

    try {
        const installed = await afio.isInstalled();

        // Automatically fall back to bookmarks tab if file access is unavailable
        if (storedType !== "files" && storedType !== "bookmarks") {
            storedType = installed ? "files" : "bookmarks";
        } else if (storedType === "files" && !installed) {
            console.warn("[Panel] File access unavailable, switching tree view to bookmarks");
            storedType = "bookmarks";
        }

        applyTreeSelection(storedType, { persist: true, forceReload: true });
    } catch (e) {
        console.error("[Panel] Failed to determine initial tree type, defaulting to bookmarks", e);
        applyTreeSelection("bookmarks", { persist: true, forceReload: true });
    }
}

// --- UI更新 ---

function onSelectionChanged(node) {
    console.log("[Panel] Selection changed:", node);
    selectedMacro = normalizeMacro(node);

    const disable = (ids) => ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.setAttribute("disabled", "true");
    });
    const enable = (ids) => ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.removeAttribute("disabled");
    });

    if (selectedMacro && selectedMacro.type === 'macro') {
        enable(["play-button", "loop-button", "edit-button"]);
    } else {
        disable(["play-button", "loop-button", "edit-button"]);
    }
}

function updatePanelState(state) {
    console.log("[Panel] Update state:", state);
    let stateName = state;
    if (state && typeof state === 'object') {
        panelState = state;
        stateName = state.isRecording ? 'recording' : state.isPlaying ? 'playing' : 'idle';
    } else if (state === 'idle' || state === 'playing' || state === 'recording') {
        // When called with a string, also update panelState to keep it in sync
        panelState = {
            isPlaying: state === 'playing',
            isRecording: state === 'recording',
            currentMacro: state === 'idle' ? null : panelState.currentMacro
        };
    }
    const setCollapsed = (id, collapsed) => {
        const el = document.getElementById(id);
        if (el) el.setAttribute("collapsed", collapsed ? "true" : "false");
    };
    const setDisabled = (id, disabled) => {
        const el = document.getElementById(id);
        if (el) disabled ? el.setAttribute("disabled", "true") : el.removeAttribute("disabled");
    };

    if (stateName === "playing") {
        setCollapsed("play-button", true);
        setCollapsed("pause-button", false);
        setDisabled("stop-replaying-button", false);
        setDisabled("record-button", true);
    } else if (stateName === "recording") {
        setDisabled("stop-recording-button", false);
        setDisabled("play-button", true);
    } else { // idle
        setCollapsed("play-button", false);
        setCollapsed("pause-button", true);
        setDisabled("stop-replaying-button", true);
        setDisabled("stop-recording-button", true);
        setDisabled("record-button", false);

        // 選択状態に応じてボタン復帰
        if (selectedMacro && selectedMacro.type === 'macro') {
            setDisabled("play-button", false);
            setDisabled("edit-button", false);
        }
    }
}

function toggleInfoVisibility(showInfo) {
    const logo = document.getElementById("logo-and-links");
    const infoDiv = document.getElementById("info-div");
    if (logo) {
        logo.hidden = !!showInfo;
        logo.setAttribute("aria-hidden", showInfo ? "true" : "false");
    }
    if (infoDiv) {
        infoDiv.hidden = !showInfo;
        infoDiv.setAttribute("aria-hidden", showInfo ? "false" : "true");
    }
}

function handlePanelShowInfo(args) {
    if (!args) return;
    const infoDiv = document.getElementById("info-div");
    const infoArea = document.getElementById("info-area");
    if (!infoDiv || !infoArea) return;

    lastInfoArgs = args.macro ? { ...args, macro: normalizeMacro(args.macro) } : args;

    const lines = [];
    if (args.message) lines.push(args.message);
    if (typeof args.errorCode !== "undefined") lines.push("Error code: " + args.errorCode);
    if (lastInfoArgs.macro && lastInfoArgs.macro.name) lines.push("Macro: " + lastInfoArgs.macro.name);

    infoArea.value = lines.join("\n");
    infoArea.scrollTop = infoArea.scrollHeight;

    // エラー詳細時のみ編集/ヘルプボタンを表示
    const infoEditBtn = document.getElementById("info-edit-button");
    const infoHelpBtn = document.getElementById("info-help-button");
    const showActionButtons = !!lastInfoArgs.macro;
    if (infoEditBtn) infoEditBtn.hidden = !showActionButtons;
    if (infoHelpBtn) infoHelpBtn.hidden = !showActionButtons;

    toggleInfoVisibility(true);
}

function closeInfoPanel() {
    lastInfoArgs = null;
    const infoArea = document.getElementById("info-area");
    if (infoArea) {
        infoArea.value = "";
        infoArea.removeAttribute("type");
    }
    toggleInfoVisibility(false);
}

function ensureStatusLineElement() {
    let el = document.getElementById("panel-status-container");
    if (!el) {
        el = document.createElement("div");
        el.id = "panel-status-container";
        el.style.fontSize = "11px";
        el.style.padding = "2px 4px";
        el.style.borderBottom = "1px solid #ddd";
        el.style.whiteSpace = "pre-wrap";
        const container = document.getElementById("panel-content") || document.body;
        container.insertBefore(el, container.firstChild);
    }
    return el;
}

function handlePanelSetStatLine(data) {
    if (!data) return;
    const el = ensureStatusLineElement();
    el.textContent = data.text || "";
    if (data.level === "error") {
        el.style.color = "#b00020";
    } else if (data.level === "warning") {
        el.style.color = "#ff6a00";
    } else {
        el.style.color = "#222";
    }
}

function handlePanelShowLines(data) {
    const source = (data && data.source) || "";
    const macroName = (data && data.currentMacro && typeof data.currentMacro === "string")
        ? data.currentMacro
        : "";
    if (!source && !macroName) {
        const container = document.getElementById("panel-macro-container");
        if (container) container.remove();
        return;
    }

    let container = document.getElementById("panel-macro-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "panel-macro-container";
        container.style.flex = "1";
        container.style.overflow = "auto";
        container.style.fontFamily = "monospace";
        container.style.fontSize = "11px";
        container.style.borderTop = "1px solid #ddd";
        const parent = document.getElementById("panel-content") || document.body;
        parent.appendChild(container);
    }

    let titleEl = document.getElementById("panel-macro-title");
    if (!titleEl) {
        titleEl = document.createElement("div");
        titleEl.id = "panel-macro-title";
        titleEl.style.fontWeight = "bold";
        titleEl.style.padding = "2px 4px";
        container.appendChild(titleEl);
    }
    titleEl.textContent = macroName ? `Macro: ${macroName}` : "Macro source";

    let pre = document.getElementById("panel-macro-lines");
    if (!pre) {
        pre = document.createElement("pre");
        pre.id = "panel-macro-lines";
        pre.style.margin = "0";
        pre.style.padding = "4px";
        pre.style.whiteSpace = "pre";
        pre.style.tabSize = "4";
        container.appendChild(pre);
    }
    pre.textContent = source;
}

function handlePanelSetLoopValue(data) {
    if (!data) return;
    const input = document.getElementById("max-loop");
    if (input && typeof data.value !== "undefined") {
        input.value = data.value;
    }
}

function handlePanelHighlightLine(data) {
    if (!data || typeof data.line === "undefined") return;
    const el = ensureStatusLineElement();
    const base = (el.textContent || "")
        // remove any previously appended line suffixes before adding the latest
        .replace(/ \(Line \d+\)/g, "")
        .trim();
    const suffix = ` (Line ${data.line})`;
    if (base.indexOf(suffix) === -1) {
        el.textContent = `${base || ""}${base ? " " : ""}${suffix}`.trim();
    }
}

// --- 初期化とイベントリスナー ---

if (isTopFrame) {
    window.addEventListener("message", (event) => {
    // fileView.js (iframe) からの通知を受け取る
    const treeFrame = document.getElementById("tree-iframe");
    const allowedSource = treeFrame ? treeFrame.contentWindow : null;
    if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") {
        return;
    }
    // Reject if iframe not found or source doesn't match
    if (!allowedSource) {
        console.warn("[Panel] tree-iframe not ready yet, ignoring message from", event.origin);
        return;
    }
    if (event.source !== allowedSource) {
        console.warn("[Panel] Message from unexpected source");
        return;
    }
    if (event.data.type === "iMacrosSelectionChanged") {
        onSelectionChanged(event.data.node);
    }
    if (event.data.type === "playMacro") {
        play();
    }
    });

// --- Extension Reload Detection ---
// Establish a long-lived connection to detect when the extension context is invalidated (reloaded/updated)
// --- Extension Reload/Lifecycle Detection ---
// Maintain a connection to keep SW alive and detect when extension is reloaded.
let lifeCyclePort = null;

function connectToLifecycle() {
    try {
        lifeCyclePort = chrome.runtime.connect({ name: "panel-lifecycle" });
        lifeCyclePort.onDisconnect.addListener(() => {
            console.log("[Panel] Lifecycle port disconnected. Checking extension status...");
            lifeCyclePort = null;

            if (chrome.runtime.lastError) {
                console.warn("[Panel] Port disconnected due to error:", chrome.runtime.lastError.message);
            }

            // Attempt to ping the runtime to see if it's still valid
            try {
                chrome.runtime.sendMessage({ keepAlive: true }, (response) => {
                    if (chrome.runtime.lastError) {
                        // Runtime error -> Extension likely reloaded or context invalidated
                        console.log("[Panel] Extension context appears invalid (ping failed). Reloading panel...");
                        // Short delay to ensure the new context is ready
                        setTimeout(() => window.location.reload(), 500);
                    } else {
                        // Response received -> SW just terminated, extension is still alive
                        console.log("[Panel] Service Worker terminated (idle), reconnecting...");
                        connectToLifecycle();
                    }
                });
            } catch (e) {
                // accessing chrome.runtime might throw if context is completely gone
                console.log("[Panel] Extension context invalidated (exception). Reloading panel...");
                setTimeout(() => window.location.reload(), 500);
            }
        });
    } catch (e) {
        console.error("[Panel] Failed to connect to background:", e);
    }
}

    connectToLifecycle();

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'panel' && message.type === 'PANEL_STATE_UPDATE') {
        if (message.state) updatePanelState(message.state);
    }
    if (message.type === "updatePanel") {
        updatePanelState(message.state);
    }
    if (message.type === "macroStopped") {
        updatePanelState("idle");
    }
    if (message.type === "UPDATE_PANEL_VIEWS") {
        refreshTreeView();
        sendResponse({ success: true });
        return true;
    }

    if (message.type === "PANEL_SHOW_INFO") {
        handlePanelShowInfo(message.data && message.data.args);
        sendResponse && sendResponse({ success: true });
        return true;
    }

    if (message.type === "PANEL_SHOW_LINES") {
        handlePanelShowLines(message.data);
        sendResponse && sendResponse({ success: true });
        return true;
    }

    if (message.type === "PANEL_SET_STAT_LINE") {
        handlePanelSetStatLine(message.data);
        sendResponse && sendResponse({ success: true });
        return true;
    }

    if (message.type === "PANEL_SET_LOOP_VALUE") {
        handlePanelSetLoopValue(message.data);
        sendResponse && sendResponse({ success: true });
        return true;
    }

    if (message.type === "PANEL_HIGHLIGHT_LINE") {
        handlePanelHighlightLine(message.data);
        sendResponse && sendResponse({ success: true });
        return true;
    }
    });

    document.addEventListener("DOMContentLoaded", () => {
    console.log("[Panel] DOMContentLoaded");

    // ウィンドウIDを初期化
    windowIdReadyPromise = initWindowId();

    // イベントリスナーの登録
    const addListener = (id, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("click", handler);
    };

    addListener("play-button", play);
    addListener("record-button", record);
    addListener("stop-replaying-button", stop);
    addListener("stop-recording-button", stop);
    addListener("pause-button", pause);
    addListener("loop-button", playLoop);
    addListener("settings-button", openSettings);
    addListener("edit-button", edit);
    addListener("help-button", openHelp);
    addListener("info-help-button", openErrorHelp);
    addListener("info-edit-button", openInfoEdit);
    addListener("info-close-button", closeInfoPanel);

    requestStateUpdate();

    const filesRadio = document.getElementById("radio-files-tree");
    const bookmarksRadio = document.getElementById("radio-bookmarks-tree");

    if (filesRadio) {
        filesRadio.addEventListener("change", async () => {
            if (!filesRadio.checked) return;
            try {
                const installed = await afio.isInstalled();
                if (!installed) {
                    alert("File access module is not installed. Switching to Bookmarks view.");
                    applyTreeSelection("bookmarks", { persist: true, forceReload: true });
                    return;
                }
                applyTreeSelection("files", { persist: true });
            } catch (e) {
                console.error("[Panel] Failed to switch to files tree", e);
                applyTreeSelection("bookmarks", { persist: true, forceReload: true });
            }
        });
    }

    if (bookmarksRadio) {
        bookmarksRadio.addEventListener("change", () => {
            if (!bookmarksRadio.checked) return;
            applyTreeSelection("bookmarks", { persist: true });
        });
    }

    // 右クリック無効化
    document.body.oncontextmenu = (e) => { e.preventDefault(); return false; };

    if (filesRadio) filesRadio.disabled = true;
    if (bookmarksRadio) bookmarksRadio.disabled = true;

    selectInitialTree()
        .catch((error) => {
            console.error("[Panel] Initialization failed", error);
        })
        .finally(() => {
            if (filesRadio) filesRadio.disabled = false;
            if (bookmarksRadio) bookmarksRadio.disabled = false;
        });

    // 広告などの読み込み
    if (typeof setAdDetails === "function") setAdDetails();
    });
} else {
    console.info("[Panel] iframe context detected; skipping panel initialization:", window.location.href);
}
