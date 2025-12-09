/* panel.js - MV3対応版 */

// 選択中のマクロ情報を保持する変数
var selectedMacro = null;

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
    const setCollapsed = (id, collapsed) => {
        const el = document.getElementById(id);
        if (el) el.setAttribute("collapsed", collapsed ? "true" : "false");
    };
    const setDisabled = (id, disabled) => {
        const el = document.getElementById(id);
        if (el) disabled ? el.setAttribute("disabled", "true") : el.removeAttribute("disabled");
    };

    if (state === "playing") {
        setCollapsed("play-button", true);
        setCollapsed("pause-button", false);
        setDisabled("stop-replaying-button", false);
        setDisabled("record-button", true);
    } else if (state === "recording") {
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

// --- 初期化とイベントリスナー ---

window.addEventListener("message", (event) => {
    // fileView.js (iframe) からの通知を受け取る
    if (event.data.type === "iMacrosSelectionChanged") {
        onSelectionChanged(event.data.node);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "updatePanel") {
        updatePanelState(message.state);
    }
    if (message.type === "macroStopped") {
        updatePanelState("idle");
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

    // 右クリック無効化
    document.body.oncontextmenu = (e) => { e.preventDefault(); return false; };

    // 広告などの読み込み
    if (typeof setAdDetails === "function") setAdDetails();
});
