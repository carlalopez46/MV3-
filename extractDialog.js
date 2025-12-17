/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

function ok() {
    window.close();
}

// ★FIX: MV3 完全対応 - メッセージベースのダイアログ通信
window.addEventListener("load", function(evt) {
    // 1. Service Worker 経由で引数を取得
    chrome.runtime.sendMessage({
        type: 'GET_DIALOG_ARGS',
        windowId: chrome.windows ? chrome.windows.WINDOW_ID_CURRENT : undefined
    }, function(response) {
        if (chrome.runtime.lastError) {
            console.error("[extractDialog] Failed to get args:", chrome.runtime.lastError);
            return;
        }

        if (!response || !response.success || !response.args) {
            console.error("[extractDialog] No args returned:", response);
            return;
        }

        var args = response.args;

        // データを表示
        var field = document.getElementById("data-field");
        if (field && args.data) {
            field.value = args.data;
            field.focus();
        }

        // ウィンドウIDを保持（クローズ時の通知用）
        if (args && typeof args.win_id !== 'undefined' && args.win_id !== null) {
            window._callerWinId = args.win_id;
        }

        // UI セットアップ
        var okButton = document.getElementById("ok-button");
        if (okButton) {
            okButton.addEventListener("click", ok);
            okButton.focus();
            okButton.addEventListener("keydown", function(e) {
                if ((e.keyCode === 13) || (e.keyCode === 32)) {
                    ok();
                    e.preventDefault();
                }
            });
        }

        // リサイズ
        var container = document.getElementById('container');
        if (container && typeof resizeToContent === 'function') {
            resizeToContent(window, container);
        }
    });
});

window.addEventListener("beforeunload", function() {
    // 2. Offscreen に通知してマクロを再開
    if (window._callerWinId && chrome.runtime) {
        chrome.runtime.sendMessage({
            target: 'offscreen',
            command: 'EXTRACT_DIALOG_CLOSED',
            win_id: window._callerWinId
        }, function(response) {
            if (chrome.runtime.lastError) {
                console.warn("[extractDialog] Failed to notify close:", chrome.runtime.lastError);
            }
        });
    }
    return null;
});
