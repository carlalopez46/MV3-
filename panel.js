/* panel.js - MV3対応版 */

// 選択中のマクロ情報を保持する変数
var selectedMacro = null;

// パネルの状態をキャッシュ
var panelState = {
    isRecording: false,
    isPlaying: false,
    currentMacro: null
};

// パネルのウィンドウIDを保持
var currentWindowId = null;

// ウィンドウIDを取得
function initWindowId() {
    return new Promise((resolve) => {
        // Check URL parameters first (passed from openPanel in background.js)
        const urlParams = new URLSearchParams(window.location.search);
        const winIdParam = urlParams.get('win_id');

        if (winIdParam) {
            currentWindowId = parseInt(winIdParam);
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

function sendCommand(command, payload = {}) {
    return ensureWindowId().then(() => {
        // 自動的にウィンドウIDを追加
        const message = {
            ...payload,
            command: command,
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
    if (!selectedMacro) {
        alert("Please select a macro first.");
        return;
    }

    // パネル側ではファイルを読まず、パスだけを送る
    sendCommand("playMacro", {
        file_path: selectedMacro.id, // ファイルパスまたはID
        macro_name: selectedMacro.text
    });
}

function record() {
    console.log("[Panel] Record button clicked");
    sendCommand("startRecording");
}

function stop() {
    console.log("[Panel] Stop button clicked");
    sendCommand("stop");
}

function pause() {
    console.log("[Panel] Pause button clicked");
    sendCommand("pause");
}

function playLoop() {
    console.log("[Panel] Loop button clicked");
    if (!selectedMacro) {
        alert("Please select a macro first.");
        return;
    }
    const max = document.getElementById("max-loop").value;

    sendCommand("playMacro", {
        file_path: selectedMacro.id,
        macro_name: selectedMacro.text,
        loop: max
    });
}

function openSettings() {
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        window.open("options.html");
    }
}

function edit() {
    if (!selectedMacro) return;
    sendCommand("editMacro", {
        file_path: selectedMacro.id,
        macro_name: selectedMacro.text
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
    selectedMacro = node;

    const disable = (ids) => ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.setAttribute("disabled", "true");
    });
    const enable = (ids) => ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.removeAttribute("disabled");
    });

    if (node && node.type === 'macro') {
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
    if (logo) logo.hidden = !!showInfo;
    if (infoDiv) infoDiv.hidden = !showInfo;
}

function handlePanelShowInfo(args) {
    if (!args) return;
    const infoDiv = document.getElementById("info-div");
    const infoArea = document.getElementById("info-area");
    if (!infoDiv || !infoArea) return;

    const lines = [];
    if (args.message) lines.push(args.message);
    if (typeof args.errorCode !== "undefined") lines.push("Error code: " + args.errorCode);
    if (args.macro && args.macro.name) lines.push("Macro: " + args.macro.name);

    infoArea.value = lines.join("\n");
    infoArea.scrollTop = infoArea.scrollHeight;
    toggleInfoVisibility(true);
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
    const macroName = data && data.currentMacro ? data.currentMacro : "";
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

window.addEventListener("message", (event) => {
    // fileView.js (iframe) からの通知を受け取る
    if (event.data.type === "iMacrosSelectionChanged") {
        onSelectionChanged(event.data.node);
    }
});

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

    addListener("info-close-button", () => toggleInfoVisibility(false));

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
