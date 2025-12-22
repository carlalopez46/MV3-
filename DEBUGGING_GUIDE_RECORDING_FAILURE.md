# iMacros MV3 - マクロ記録失敗のデバッグガイド

**優先度**: CRITICAL  
**目的**: 記録失敗の根本原因を特定して修正する

---

## ✅ 既に確認されたこと

- ✅ manifest.json に content_scripts セクションが存在
- ✅ connector.js → recorder.js の順序が正しい
- ✅ utils.js と errorLogger.js が含まれている
- ✅ run_at: "document_idle" で十分な遅延がある
- ✅ all_frames: true で iframe もサポート

---

## 🔍 デバッグステップ

### **Phase 1**: メッセージフロー全体をトレース

#### Step 1.1: Recording ボタンクリック時の動作確認

ファイル: `panel.js` または `fileView.js`

**修正を加える**:
```javascript
// Recording ボタンのクリックハンドラー内に以下を追加
console.log('[DEBUG] Recording button clicked');
logInfo('[UI] Recording button clicked', {
    win_id: window.win_id || 'unknown',
    timestamp: new Date().toISOString()
});

// context.recorder.start() を呼び出す前に
if (!context || !context[win_id]) {
    console.error('[CRITICAL] context not available for win_id:', win_id);
    logError('Recording: context not available', {win_id: win_id});
    return;
}

if (!context[win_id].recorder) {
    console.error('[CRITICAL] recorder not available');
    logError('Recording: recorder not available', {win_id: win_id});
    return;
}

console.log('[DEBUG] Calling context[' + win_id + '].recorder.start()');
context[win_id].recorder.start();
```

#### Step 1.2: mrecorder.start() の実行確認

ファイル: `mrecorder.js`

**修正を加える**:
```javascript
Recorder.prototype.start = function() {
    console.log('[MRECORDER] start() called');
    console.log('[MRECORDER] win_id:', this.win_id);
    console.log('[MRECORDER] recording flag before:', this.recording);
    
    logInfo("[MRECORDER.START] Starting recorder", {
        win_id: this.win_id,
        timestamp: new Date().toISOString()
    });
    
    this.writeEncryptionType = true;
    this.password = null;
    this.canEncrypt = true;
    context.updateState(this.win_id, "recording");
    
    var panel = context[this.win_id].panelWindow;
    if (panel && !panel.closed) {
        panel.showLines();
        panel.setStatLine("Recording...", "info");
    }
    
    this.actions = new Array();
    var recorder = this;
    
    console.log('[MRECORDER] Querying active tabs...');
    logInfo("[MRECORDER.START] Querying active tabs", {
        win_id: this.win_id
    });
    
    chrome.tabs.query({active: true, windowId: this.win_id}, function (tabs) {
        if (chrome.runtime.lastError) {
            console.error('[MRECORDER] ERROR: Failed to query tabs:', chrome.runtime.lastError);
            logError("[MRECORDER] Failed to query tabs: " + chrome.runtime.lastError.message, {
                win_id: recorder.win_id
            });
            return;
        }
        
        if (!tabs || tabs.length === 0) {
            console.error('[MRECORDER] ERROR: No active tabs found');
            logError("[MRECORDER] No active tabs found", {
                win_id: recorder.win_id
            });
            return;
        }
        
        console.log('[MRECORDER] Active tab found:', tabs[0].url);
        console.log('[MRECORDER] Tab ID:', tabs[0].id);
        
        logInfo("[MRECORDER.START] Active tab found", {
            win_id: recorder.win_id,
            tab_id: tabs[0].id,
            tab_url: tabs[0].url
        });
        
        recorder.recording = true;
        recorder.startTabIndex = tabs[0].index;
        
        console.log('[MRECORDER] Adding listeners...');
        recorder.addListeners();
        recorder.currentFrameNumber = 0;
        
        // ★ CRITICAL: Broadcast message を送信
        var recordMode = Storage.getChar("record-mode");
        console.log('[MRECORDER] Broadcasting start-recording message');
        console.log('[MRECORDER] recordMode:', recordMode);
        console.log('[MRECORDER] win_id:', recorder.win_id);
        
        logInfo("[MRECORDER.START] Broadcasting start-recording", {
            win_id: recorder.win_id,
            recordMode: recordMode,
            favorId: Storage.getBool("recording-prefer-id"),
            cssSelectors: Storage.getBool("recording-prefer-css-selectors")
        });
        
        communicator.broadcastMessage("start-recording", {
            args: {
                favorId: Storage.getBool("recording-prefer-id"),
                cssSelectors: Storage.getBool("recording-prefer-css-selectors"),
                recordMode: recordMode
            }
        }, recorder.win_id);
        
        console.log('[MRECORDER] Broadcast message sent');
        console.log('[MRECORDER] Recording initial commands');
        
        recorder.recordAction("VERSION BUILD=" + Storage.getChar("version").replace(/\./g, "") + " RECORDER=CR");
        if (!/^chrome:\/\//.test(tabs[0].url)) {
            recorder.recordAction("URL GOTO="+tabs[0].url);
        }
        
        console.log('[MRECORDER] Initial commands recorded');
        logInfo("[MRECORDER.START] Recording started successfully", {
            win_id: recorder.win_id,
            initial_actions: recorder.actions.length
        });
    });
};
```

#### Step 1.3: Content Script が start-recording メッセージを受け取ったか確認

ファイル: `content_scripts/recorder.js`

**修正を加える**:
```javascript
CSRecorder.prototype.onStartRecording = function(data, callback) {
    console.log('[CS_RECORDER] onStartRecording called');
    console.log('[CS_RECORDER] data:', data);
    
    logInfo("[CS_RECORDER.START] onStartRecording called", {
        hasData: !!data,
        hasArgs: !!(data && data.args),
        url: window.location.href
    });
    
    if (callback) {
        console.log('[CS_RECORDER] Calling callback');
        callback();
    }
    
    if (!data || !data.args) {
        console.error('[CS_RECORDER] ERROR: Missing data or data.args');
        console.error('[CS_RECORDER] data:', data);
        logError("[CS_RECORDER] onStartRecording: Missing data.args", {
            data: data
        });
        return;
    }
    
    console.log('[CS_RECORDER] Starting with args:', data.args);
    this.start(data.args);
};
```

#### Step 1.4: イベントリスナーが正しく登録されたか確認

ファイル: `content_scripts/recorder.js`

**修正を加える**:
```javascript
CSRecorder.prototype.start = function(args) {
    console.log('[CS_RECORDER] start() called');
    console.log('[CS_RECORDER] args:', args);
    console.log('[CS_RECORDER] recordMode:', args.recordMode);
    
    logInfo("[CS_RECORDER] start() called", {
        recordMode: args.recordMode,
        favorId: args.favorId,
        cssSelectors: args.cssSelectors,
        url: window.location.href
    });
    
    this.recording = true;
    this.submitter = null;
    this.favorIds = args.favorId;
    this.cssSelectors = args.cssSelectors;
    this.recordMode = args.recordMode;
    
    console.log('[CS_RECORDER] Adding DOM event listeners');
    console.log('[CS_RECORDER] recordMode value:', this.recordMode);
    console.log('[CS_RECORDER] window object available:', !!window);
    
    var result = this.addDOMEventsListeners(window);
    
    console.log('[CS_RECORDER] addDOMEventsListeners result:', result);
    
    logInfo("[CS_RECORDER] Event listeners added", {
        recordMode: this.recordMode,
        success: result
    });
};
```

#### Step 1.5: イベントハンドラーが発火しているか確認

ファイル: `content_scripts/recorder.js`

**各イベントハンドラーに修正を加える**:
```javascript
CSRecorder.prototype.onClick = function(e) {
    console.log('[CS_RECORDER_EVENT] Click event fired');
    logInfo("[CS_RECORDER_EVENT] Click event", {
        tagName: e.target.tagName,
        id: e.target.id,
        className: e.target.className,
        type: e.target.type
    });
    
    // 既存のロジック
    // ...
};

CSRecorder.prototype.onChange = function(e) {
    console.log('[CS_RECORDER_EVENT] Change event fired');
    console.log('[CS_RECORDER_EVENT] value:', e.target.value);
    
    logInfo("[CS_RECORDER_EVENT] Change event", {
        tagName: e.target.tagName,
        id: e.target.id,
        type: e.target.type,
        value: e.target.value
    });
    
    // 既存のロジック
    // ...
};

CSRecorder.prototype.onKeyPress = function(e) {
    console.log('[CS_RECORDER_EVENT] KeyPress event fired');
    console.log('[CS_RECORDER_EVENT] key:', e.key, 'keyCode:', e.keyCode);
    
    logInfo("[CS_RECORDER_EVENT] KeyPress event", {
        key: e.key,
        keyCode: e.keyCode
    });
    
    // 既存のロジック
    // ...
};
```

#### Step 1.6: saveAction が呼ばれているか確認

ファイル: `content_scripts/recorder.js`

**修正を加える**:
```javascript
CSRecorder.prototype.saveAction = function(str, extra) {
    console.log('[CS_RECORDER_SAVE] saveAction called');
    console.log('[CS_RECORDER_SAVE] action:', str);
    console.log('[CS_RECORDER_SAVE] extra:', extra);
    
    logInfo("[CS_RECORDER_SAVE] Saving action", {
        action: str,
        hasExtra: !!extra,
        url: window.location.href
    });
    
    console.log('[CS_RECORDER_SAVE] Posting record-action message');
    
    connector.postMessage(
        "record-action",
        {action: str, extra: extra || null},
        function(response) {
            console.log('[CS_RECORDER_SAVE] postMessage callback:', response);
            
            if (!response) {
                console.error('[CS_RECORDER_SAVE] ERROR: postMessage failed - no response');
                logError('[CS_RECORDER_SAVE] postMessage failed: no response', {
                    action: str
                });
            } else {
                console.log('[CS_RECORDER_SAVE] postMessage successful');
                logInfo('[CS_RECORDER_SAVE] postMessage successful', {
                    action: str
                });
            }
        }
    );
};
```

---

### **Phase 2**: コンソール出力確認手順

1. **Extension を再読み込み**
   ```
   Chrome → Ctrl+H → Shift+Delete (キャッシュクリア)
   Chrome → 拡張機能 → iMacros → 再読み込みボタン
   ```

2. **FILESタブを開く**
   ```
   iMacros パネル → FILESタブ
   ```

3. **Console を開く**
   ```
   ウェブページ上で F12 → Console タブ
   ```

4. **Recording ボタンをクリック**
   ```
   [DEBUG] Recording button clicked
   [MRECORDER] start() called
   [MRECORDER] Broadcasting start-recording message
   [CS_RECORDER] onStartRecording called
   [CS_RECORDER] start() called
   [CS_RECORDER] Adding DOM event listeners
   ```
   
   が出力されるはずです。出力されなければ、どこで止まっているか特定できます。

5. **ウェブページでアクション実行**
   ```
   クリック → [CS_RECORDER_EVENT] Click event fired
   テキスト入力 → [CS_RECORDER_EVENT] Change event fired
   キープレス → [CS_RECORDER_EVENT] KeyPress event fired
   ```

6. **ErrorLogger で確認**
   ```javascript
   // Console で実行
   ErrorLogger.generateReport()
   ErrorLogger.getAllErrors().slice(-20)  // 最後の20件
   ```

---

## 🎯 期待される出力フロー

### 正常な記録開始フロー

```
[DEBUG] Recording button clicked
[MRECORDER] start() called
[MRECORDER] win_id: (window ID)
[MRECORDER] Querying active tabs...
[MRECORDER] Active tab found: https://example.com
[MRECORDER] Broadcasting start-recording message
[MRECORDER] Broadcast message sent
[MRECORDER] Initial commands recorded
↓
[CS_RECORDER] onStartRecording called
[CS_RECORDER] data: {args: {recordMode: 'conventional', ...}}
[CS_RECORDER] start() called
[CS_RECORDER] recordMode: conventional
[CS_RECORDER] Adding DOM event listeners
[CS_RECORDER] addDOMEventsListeners result: true
```

### 正常なイベント記録フロー

```
User clicks button
↓
[CS_RECORDER_EVENT] Click event fired
[CS_RECORDER_SAVE] saveAction called
[CS_RECORDER_SAVE] action: CLICK ...
[CS_RECORDER_SAVE] Posting record-action message
[CS_RECORDER_SAVE] postMessage callback: (success)
↓
[MRECORDER] onRecordAction called
[MRECORDER] actions array updated
```

---

## 🔴 よくある問題と対応

### 問題A: "[CS_RECORDER] onStartRecording called" が出ない
**原因**: start-recording メッセージが content script に到達していない  
**対応**:
1. connector.js に問題がないか確認
2. content_scripts セクションが正しいか再確認
3. communicator.broadcastMessage が実行されているか確認

### 問題B: "[CS_RECORDER_EVENT] Click event fired" が出ない
**原因**: addEventListener が失敗している  
**対応**:
```javascript
// content_scripts/recorder.js の addDOMEventsListeners で
console.log('[DEBUG] this.recordMode:', this.recordMode);
console.log('[DEBUG] typeof window:', typeof window);
console.log('[DEBUG] window === window:', window === window);

// addEventListener の周りで try-catch
try {
    win.addEventListener("click", this.onClickEvent, true);
    console.log('[DEBUG] addEventListener succeeded');
} catch (err) {
    console.error('[CRITICAL] addEventListener failed:', err);
}
```

### 問題C: "[MRECORDER] onRecordAction called" が出ない
**原因**: mrecorder.js のハンドラーが登録されていない  
**対応**:
```javascript
// mrecorder.js の constructor で
communicator.registerHandler("record-action",
    this.onRecordAction.bind(this), win_id);

// ハンドラーが登録されたか確認
console.log('[DEBUG] communicator.handlers:', communicator.handlers);
```

---

## 📝 修正実装チェックリスト

すべてのログ出力を追加したら:

- [ ] Panel.js に UI ログを追加
- [ ] mrecorder.js に詳細ログを追加
- [ ] content_scripts/recorder.js に詳細ログを追加
- [ ] connector.js のハンドラー呼び出しをログ出力
- [ ] Extension を再読み込み
- [ ] Console で各ステップのログを確認
- [ ] どのステップで止まっているか特定
- [ ] 該当するコンポーネントを修正

---

**次のアクション**: 上記のログ出力を実装して、どのステップで失敗しているか報告してください。
