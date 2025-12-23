# iMacros MV3 - マクロ記録機能修正の実装計画

**作成日**: 2025-11-23  
**優先度**: CRITICAL  
**推定修正時間**: 2-4 時間

---

## 📋 概要

マクロ記録機能がアクション（クリック、入力）を記録していません。

**現象**:
- URL GOTO コマンドのみが記録される
- クリック、テキスト入力などのイベントが記録されない
- #Current.iim ファイルが生成されない

**根本原因**: Content script と background script 間のメッセージ通信が機能していない可能性

---

## 🔍 診断のための実装ステップ

### Step 1: Console ログの追加（診断用）

#### 1-1: mrecorder.js

ファイル: `/Users/sam/Downloads/iMacrosMV3-main/mrecorder.js`

**行 64 の Recorder.prototype.start 関数を修正**:
```javascript
Recorder.prototype.start = function() {
    console.log('[MRECORDER_DEBUG] start() called', {
        win_id: this.win_id,
        timestamp: new Date().toISOString()
    });
    
    logInfo("Recorder.start: Starting recorder", {
        win_id: this.win_id,
        timestamp: new Date().toISOString()
    });
    
    // ... 既存コード ...
    
    // line 120 付近でブロードキャスト前に:
    console.log('[MRECORDER_DEBUG] About to broadcast start-recording', {
        win_id: this.win_id,
        recordMode: recordMode,
        tabCount: tabs ? tabs.length : 0
    });
    
    communicator.broadcastMessage("start-recording", {
        args: {favorId: Storage.getBool("recording-prefer-id"),
               cssSelectors: Storage.getBool("recording-prefer-css-selectors"),
               recordMode: recordMode}
    }, recorder.win_id);
    
    console.log('[MRECORDER_DEBUG] start-recording broadcast sent');
};
```

#### 1-2: content_scripts/recorder.js

ファイル: `/Users/sam/Downloads/iMacrosMV3-main/content_scripts/recorder.js`

**行 105 の onStartRecording 関数を修正**:
```javascript
CSRecorder.prototype.onStartRecording = function(data, callback) {
    console.log('[CS_RECORDER_DEBUG] onStartRecording called', {
        hasData: !!data,
        url: window.location.href
    });
    
    logInfo("[CS_RECORDER] onStartRecording called", {
        url: window.location.href
    });
    
    if (callback) callback();
    
    if (!data || !data.args) {
        console.error('[CS_RECORDER_DEBUG] ERROR: Missing data.args');
        return;
    }
    
    console.log('[CS_RECORDER_DEBUG] Calling this.start()', {
        recordMode: data.args.recordMode
    });
    
    this.start(data.args);
};
```

**行 122 の start 関数を修正**:
```javascript
CSRecorder.prototype.start = function(args) {
    console.log('[CS_RECORDER_DEBUG] start() called', {
        recordMode: args.recordMode,
        url: window.location.href
    });
    
    logInfo("CSRecorder.start: Starting recorder", {
        recordMode: args.recordMode,
        url: window.location.href
    });
    
    this.recording = true;
    this.submitter = null;
    this.favorIds = args.favorId;
    this.cssSelectors = args.cssSelectors;
    this.recordMode = args.recordMode;
    
    console.log('[CS_RECORDER_DEBUG] Adding DOM event listeners', {
        recordMode: this.recordMode
    });
    
    this.addDOMEventsListeners(window);
    
    console.log('[CS_RECORDER_DEBUG] DOM event listeners added');
    
    logInfo("CSRecorder.start: Event listeners added successfully", {
        recordMode: this.recordMode
    });
};
```

**行 38 の addDOMEventsListeners 関数を修正**:
```javascript
CSRecorder.prototype.addDOMEventsListeners = function(win) {
    if (!win) {
        console.error('[CS_RECORDER_DEBUG] ERROR: No window provided');
        logWarning("CSRecorder.addDOMEventsListeners: No window provided");
        return;
    }
    
    console.log('[CS_RECORDER_DEBUG] addDOMEventsListeners', {
        recordMode: this.recordMode,
        hasWindow: !!win
    });
    
    logInfo("CSRecorder.addDOMEventsListeners: Adding event listeners", {
        recordMode: this.recordMode,
        url: win.location.href
    });
    
    if (this.recordMode == "event") {
        console.log('[CS_RECORDER_DEBUG] Adding event mode listeners');
        win.addEventListener("mousedown", this.onMouseDownEvent, true);
        win.addEventListener("mouseup", this.onMouseUpEvent, true);
        win.addEventListener("click", this.onMouseClickEvent, true);
        // ... other listeners ...
        console.log('[CS_RECORDER_DEBUG] Event mode listeners added');
    } else if (this.recordMode == "conventional") {
        console.log('[CS_RECORDER_DEBUG] Adding conventional mode listeners');
        win.addEventListener("click", this.onClickEvent, true);
        win.addEventListener("change", this.onChangeEvent, true);
        win.addEventListener("keydown", this.onKeyDownEvent, true);
        win.addEventListener("keypress", this.onKeyPressEvent, true);
        win.addEventListener("focus", this.onFocusInEvent, true);
        console.log('[CS_RECORDER_DEBUG] Conventional mode listeners added');
    } else {
        console.error('[CS_RECORDER_DEBUG] ERROR: Unknown recordMode:', this.recordMode);
    }
    
    // ... pagehide listener ...
};
```

**行 147 の saveAction 関数を修正**:
```javascript
CSRecorder.prototype.saveAction = function(str, extra) {
    console.log('[CS_RECORDER_DEBUG] saveAction', {
        action: str.substring(0, 50)  // 最初の50文字のみ
    });
    
    logInfo("CSRecorder.saveAction: Saving action", {
        action: str,
        hasExtra: !!extra
    });
    
    connector.postMessage(
        "record-action", 
        {action: str, extra: extra || null},
        function(response) {
            console.log('[CS_RECORDER_DEBUG] postMessage response:', !!response);
        }
    );
};
```

**クリックイベントハンドラーを修正 (行 ~300)**:
```javascript
CSRecorder.prototype.onClick = function(e) {
    console.log('[CS_RECORDER_DEBUG] Click event', {
        tagName: e.target.tagName,
        id: e.target.id
    });
    
    // 既存ロジック
};
```

---

### Step 2: 動作確認

1. **Extension 再読み込み**
```
Chrome → 拡張機能 → iMacros → 再読み込みボタン
```

2. **FILESタブを開く**
```
iMacros パネル → FILESタブ
```

3. **Console を開く**
```
ウェブページで F12 → Console
```

4. **Recording をクリック**
```
パネルの Recording ボタンをクリック
Console で "[MRECORDER_DEBUG]" が出力されるか確認
Console で "[CS_RECORDER_DEBUG]" が出力されるか確認
```

5. **ウェブページでアクション実行**
```
パネルがあるウェブページで要素をクリック
Console で "[CS_RECORDER_DEBUG] Click event" が出力されるか確認
```

---

## 🎯 診断結果に基づく修正

### パターン A: "[MRECORDER_DEBUG] start() called" が出ない
**原因**: Recording ボタンのハンドラーがない または context.recorder がない  
**修正**:
```javascript
// panel.js または fileView.js の Recording ボタンハンドラーに:
if (!context || !context[this.win_id]) {
    console.error('[ERROR] context not available');
    return;
}
if (!context[this.win_id].recorder) {
    console.error('[ERROR] recorder not available');
    return;
}
console.log('[DEBUG] Calling recorder.start()');
context[this.win_id].recorder.start();
```

### パターン B: "[MRECORDER_DEBUG] start() called" は出るが "[CS_RECORDER_DEBUG] onStartRecording" が出ない
**原因**: メッセージが content script に届いていない  
**修正**:
```javascript
// communicator.js の broadcastMessage にログを追加
Communicator.prototype.broadcastMessage = function(topic, data, win_id) {
    console.log('[COMMUNICATOR_DEBUG] broadcastMessage', {
        topic: topic,
        win_id: win_id,
        hasData: !!data
    });
    
    // ... 既存コード ...
    
    tabs.forEach( function(tab) {
        console.log('[COMMUNICATOR_DEBUG] Sending to tab', {
            topic: topic,
            tab_id: tab.id
        });
        
        chrome.tabs.sendMessage(tab.id, {topic: topic, data: data}, ...);
    });
};
```

### パターン C: "[CS_RECORDER_DEBUG] onStartRecording" は出るが "[CS_RECORDER_DEBUG] start()" が出ない
**原因**: onStartRecording が start() を呼んでいない または data.args がない  
**修正**: 上記の 1-2 に記載のコードを確認

### パターン D: "[CS_RECORDER_DEBUG] Adding DOM event listeners" は出るが "[CS_RECORDER_DEBUG] Click event" が出ない
**原因**: イベントリスナーが登録されていない または click イベントが発火していない  
**修正**:
```javascript
CSRecorder.prototype.onClick = function(e) {
    console.log('[CS_RECORDER_DEBUG] onClick called!', e);
    // この行がコンソールに出なければ、リスナーが機能していない
};
```

### パターン E: すべてのログが出ている が "#Current.iim" ファイルが生成されない
**原因**: recordAction が afio に書き込まれていない  
**修正**:
```javascript
Recorder.prototype.recordAction = function(str) {
    if (!this.recording) return;
    this.actions.push(str);
    
    console.log('[MRECORDER_DEBUG] recordAction', {
        action: str.substring(0, 50),
        totalActions: this.actions.length
    });
    
    // ファイル書き込みロジック
    if (this.node && afio) {
        var content = this.actions.join("\n");
        afio.writeTextFile(this.node, content)
            .then(function() {
                console.log('[MRECORDER_DEBUG] File written successfully');
            })
            .catch(function(err) {
                console.error('[MRECORDER_DEBUG] File write failed:', err);
                logError("File write failed: " + err.message);
            });
    } else {
        console.warn('[MRECORDER_DEBUG] node or afio not available');
    }
};
```

---

## ✅ 実装チェックリスト

- [ ] mrecorder.js に console.log を追加
- [ ] content_scripts/recorder.js に console.log を追加
- [ ] Extension を再読み込み
- [ ] FILESタブを開く
- [ ] Recording をクリック
- [ ] Console でログを確認
- [ ] どのパターンかを特定
- [ ] 該当する修正を適用
- [ ] 再度テスト

---

## 📌 重要なポイント

1. **Console ログはデバッグ用** - 修正後は削除またはログレベルで制御
2. **ErrorLogger も同時に使用** - `ErrorLogger.generateReport()` で詳細確認
3. **各ステップは独立** - 1つのステップの失敗は次を実行しない
4. **メッセージフロー全体を理解** - どこでブロックされているか特定が鍵

---

## 🔧 最終修正手順

診断が完了したら:

1. 根本原因に対応する修正コードを適用
2. Console ログを削除 (または logInfo に統一)
3. Extension を再読み込み
4. 完全なマクロ記録サイクルをテスト
5. #Current.iim が正しく生成されることを確認

---

**次のステップ**: 上記の Step 1 のログ出力コードを実装して、Console で診断結果を報告してください。
