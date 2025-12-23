# iMacros MV3 - マクロ記録機能失敗の根本原因分析

**作成日**: 2025-11-23  
**問題**: マクロ記録でアクション（クリック、入力）が記録されない  
**重大度**: CRITICAL

---

## 🔍 問題の詳細

### 報告されたシンポトム
```
FILESタブで Recording を開始
→ クリックや文字入力などのアクションは記録されない
→ #Current.iim が生成されない
→ URL GOTO コマンドのみが記録される
```

出力される内容:
```
VERSION BUILD=1011 RECORDER=CR
URL GOTO=https://jules.google.com/...
URL GOTO=https://www.amazon.co.jp/...
```

期待される内容:
```
VERSION BUILD=1011 RECORDER=CR
URL GOTO=https://example.com
CLICK TA="..." T="..."
TYPE TEXT="..."
...その他のアクション...
```

---

## 📊 マクロ記録システムのアーキテクチャ

### コンポーネント構成

```
User clicks "Recording" button in FILESタブ
                ↓
        panel.js (panel.html)
                ↓
    background script (bg.js)
        context[win_id].recorder.start()
                ↓
        mrecorder.js (Recorder class)
            ├─ addListeners() - Chrome events
            ├─ recordAction() - action を保存
            └─ communicator.registerHandler("record-action", ...)
                ↓
    Content script (content_scripts/recorder.js)
        ├─ CSRecorder class
        ├─ addEventListener() - クリック、入力
        ├─ saveAction() - アクション記録
        └─ connector.postMessage("record-action", {action: ...})
                ↓
    Communicator.handleMessage()
        ├─ msg.topic が "record-action" か確認
        ├─ registered handler を探す
        └─ handler を呼び出す
```

---

## 🐛 検出された問題

### 問題 1: 🔴 Content Script が読み込まれていない可能性

**症状**: イベントリスナーが全く機能していない

**確認方法**:
```javascript
// content_scripts/recorder.js の最後に
var recorder = new CSRecorder();
```

Content script が読み込まれていることを確認してください。

**manifest.json での確認**:
```json
"content_scripts": [
    {
        "matches": ["<all_urls>"],
        "js": ["content_scripts/connector.js", "content_scripts/recorder.js", ...]
    }
]
```

**チェックリスト**:
- [ ] manifest.json に content_scripts セクションがあるか？
- [ ] connector.js が recorder.js より前に読み込まれているか？
- [ ] recorder.js の最後に `var recorder = new CSRecorder();` があるか？

---

### 問題 2: 🔴 イベントリスナーの登録失敗

**場所**: `content_scripts/recorder.js` line 38-71

**コード**:
```javascript
CSRecorder.prototype.addDOMEventsListeners = function(win) {
    if (!win) {
        logWarning("CSRecorder.addDOMEventsListeners: No window provided");
        return;
    }
    
    if (this.recordMode == "event") {
        win.addEventListener("mousedown", this.onMouseDownEvent, true);
        win.addEventListener("mouseup", this.onMouseUpEvent, true);
        // ... その他のイベント
    } else if (this.recordMode == "conventional") {
        win.addEventListener("click", this.onClickEvent, true);
        // ... その他のイベント
    }
};
```

**潜在的な問題**:
1. `this.recordMode` が undefined の可能性
2. `win` が正しく渡されていない
3. addEventListener が失敗している

**デバッグ方法**:
```javascript
// content_scripts/recorder.js を修正
CSRecorder.prototype.addDOMEventsListeners = function(win) {
    if (!win) {
        console.error('[CRITICAL] No window provided to addDOMEventsListeners');
        logError('CSRecorder.addDOMEventsListeners: No window provided');
        return;
    }
    
    console.log(`[DEBUG] recordMode: ${this.recordMode}`);
    console.log(`[DEBUG] win is: `, win);
    
    if (this.recordMode == "event") {
        console.log('[DEBUG] Attempting to add "event mode" listeners');
        // ...
    }
};
```

---

### 問題 3: 🔴 start-recording メッセージが受け取られていない

**フロー**:
```
mrecorder.js: communicator.broadcastMessage("start-recording", ...)
                                    ↓
                        communicator.js: broadcastMessage()
                                    ↓
                    content_scripts/connector.js: handleMessage()
                                    ↓
            content_scripts/recorder.js: onStartRecording()
                                    ↓
                        this.start(data.args)
```

**問題の可能性**:
- `start-recording` メッセージが content script に到達していない
- `onStartRecording` が呼ばれていない
- `data.args` が空 (undefined)

**ログを確認**:
```javascript
// Console で実行してメッセージが到達しているか確認
ErrorLogger.generateReport()

// メッセージの流れをチェック
ErrorLogger.getErrorsByFilename('connector.js')
ErrorLogger.getErrorsByFilename('recorder.js')
```

---

### 問題 4: 🔴 postMessage のコールバックがない

**場所**: `content_scripts/recorder.js` line 152-154

**コード**:
```javascript
connector.postMessage(
    "record-action", {action: str, extra: extra || null}
);
```

**問題**: コールバックなし - postMessage が失敗してもキャッチされていない

**修正**:
```javascript
connector.postMessage(
    "record-action",
    {action: str, extra: extra || null},
    function(response) {
        if (!response) {
            logError('Failed to post record-action: no response', {action: str});
        }
    }
);
```

---

### 問題 5: 🔴 mrecorder.js onRecordAction が完全に実装されていない

**場所**: `mrecorder.js` line 272-300

確認してください:
```bash
grep -A 20 "Recorder.prototype.onRecordAction" ./mrecorder.js
```

**期待される処理**:
1. アクション文字列を受け取る
2. 記録中フラグを確認
3. アクションを `this.actions` 配列に追加
4. パネルに表示
5. #Current.iim ファイルに書き込み

---

### 問題 6: 🔴 #Current.iim ファイルが生成されていない

**場所**: `mrecorder.js` - recordAction メソッド

**処理フロー**:
```
recordAction(str)
    ↓
this.actions.push(str)
    ↓
afio.writeTextFile(node, content)  // #Current.iim に書き込み
```

**ファイル保存の問題**:
- afio (AsyncFileIO.js) が機能していない
- ファイルシステムアクセスが失敗している
- フォルダが存在していない

---

## 🔧 修正方法

### Step 1: Manifest.json を確認

```bash
grep -A 10 "content_scripts" /Users/sam/Downloads/iMacrosMV3-main/manifest.json
```

**確認項目**:
- [ ] content_scripts セクションが存在するか
- [ ] connector.js が最初に読み込まれるか
- [ ] recorder.js が含まれているか

---

### Step 2: Content Script の読み込みをデバッグ

`content_scripts/recorder.js` の最後に以下を追加:
```javascript
console.log('[iMacros] CSRecorder instance created:', recorder);
console.log('[iMacros] Recording capability available: ', typeof recorder.start === 'function');
```

**Console で実行** (ウェブページでF12):
```javascript
// recorder がグローバルに存在するか確認
typeof recorder  // 'function' であれば OK

// イベントリスナーが正しくバインドされているか確認
recorder.onClickEvent  // function であれば OK
```

---

### Step 3: メッセージフローをデバッグ

**mrecorder.js に詳細ログを追加**:
```javascript
Recorder.prototype.start = function() {
    logInfo("[RECORDER_START] Starting recorder for win_id: " + this.win_id);
    // ...
    communicator.broadcastMessage("start-recording", {
        args: {...}
    }, recorder.win_id);
    logInfo("[RECORDER_START] Broadcast message sent");
};
```

**content_scripts/recorder.js に詳細ログを追加**:
```javascript
CSRecorder.prototype.onStartRecording = function(data, callback) {
    console.log('[CSRecorder] onStartRecording called', data);
    logInfo("[CS_RECORDER_START] onStartRecording called", {data: data});
    
    if (!data || !data.args) {
        console.error('[CSRecorder] ERROR: data.args is missing!', data);
        logError('[CSRecorder] onStartRecording: Missing data.args');
        return;
    }
    
    this.start(data.args);
    console.log('[CSRecorder] Recording started');
};
```

**Console で確認**:
```javascript
ErrorLogger.generateReport()  // エラーをすべて表示
```

---

### Step 4: イベントリスナーの確認

**修正済みのコード**:
```javascript
CSRecorder.prototype.addDOMEventsListeners = function(win) {
    if (!win) {
        const msg = "CSRecorder.addDOMEventsListeners: No window provided";
        console.error(`[CRITICAL] ${msg}`);
        logError(msg);
        return false;
    }
    
    if (!this.recordMode) {
        const msg = "CSRecorder.addDOMEventsListeners: recordMode is not set";
        console.error(`[CRITICAL] ${msg}`);
        logError(msg);
        return false;
    }
    
    console.log(`[DEBUG] Adding DOM event listeners in ${this.recordMode} mode`);
    logInfo("CSRecorder.addDOMEventsListeners: Adding listeners", {
        recordMode: this.recordMode,
        windowAvailable: !!win
    });
    
    try {
        if (this.recordMode == "event") {
            win.addEventListener("mousedown", this.onMouseDownEvent, true);
            win.addEventListener("mouseup", this.onMouseUpEvent, true);
            win.addEventListener("click", this.onMouseClickEvent, true);
            // ... other listeners
            console.log('[DEBUG] Event mode listeners added successfully');
        } else if (this.recordMode == "conventional") {
            win.addEventListener("click", this.onClickEvent, true);
            win.addEventListener("change", this.onChangeEvent, true);
            win.addEventListener("keydown", this.onKeyDownEvent, true);
            win.addEventListener("keypress", this.onKeyPressEvent, true);
            win.addEventListener("focus", this.onFocusInEvent, true);
            console.log('[DEBUG] Conventional mode listeners added successfully');
        }
        
        // pagehide listener
        var self = this;
        win.addEventListener("pagehide", function listener() {
            console.log('[DEBUG] Page hide event, removing listeners');
            self.removeDOMEventsListeners(win);
            win.removeEventListener("pagehide", listener);
        });
        
        return true;
    } catch (err) {
        console.error('[CRITICAL] Failed to add event listeners:', err);
        logError('CSRecorder.addDOMEventsListeners: Failed to add listeners', {
            error: err.message,
            recordMode: this.recordMode
        });
        return false;
    }
};
```

---

### Step 5: ファイル保存のデバッグ

**mrecorder.js の recordAction メソッド**:
```javascript
Recorder.prototype.recordAction = function(str) {
    logInfo("Recorder.recordAction: Recording action", {
        action: str,
        win_id: this.win_id,
        recording: this.recording
    });
    
    if (!this.recording) {
        console.warn('[WARNING] recordAction called but not recording');
        return;
    }
    
    this.actions.push(str);
    
    // #Current.iim に書き込み（非同期）
    if (this.node) {
        const content = this.actions.join("\n");
        
        afio.writeTextFile(this.node, content).then(function() {
            logInfo("Recorder.recordAction: File written successfully", {
                actionCount: this.actions.length
            });
        }).catch(function(err) {
            logError("Recorder.recordAction: Failed to write file: " + err.message, {
                action: str,
                error: err.toString()
            });
        });
    }
};
```

---

## 📋 チェックリスト

実装すべき修正:

- [ ] **manifest.json** - content_scripts セクションの確認
- [ ] **content_scripts/recorder.js** - ログ出力の追加
- [ ] **mrecorder.js** - onRecordAction の完全実装確認
- [ ] **connector.js** - メッセージハンドリングの確認
- [ ] **postMessage コールバック** - エラーハンドリング追加
- [ ] **afio.writeTextFile** - ファイル書き込みエラーハンドリング

---

## 🧪 テスト方法

1. **Extension を再読み込み** (Ctrl+Shift+J)
2. **FILESタブを開く**
3. **Recording ボタンをクリック**
4. **Console を開く** (F12)
5. **以下を実行**:
```javascript
// 1. recorder が存在するか確認
typeof recorder  // → 'object'

// 2. メッセージログを確認
ErrorLogger.generateReport()

// 3. エラーを確認
ErrorLogger.getErrorsByFilename('recorder.js')
ErrorLogger.getErrorsByFilename('communicator.js')
ErrorLogger.getErrorsByFilename('connector.js')
```

6. **ウェブページでアクションを実行**
   - クリック
   - テキスト入力

7. **ログを確認**:
```javascript
// コンソール に "[CSRecorder]" ログが出ているか
// ErrorLogger に "record-action" メッセージが記録されているか
ErrorLogger.getAllErrors().filter(e => e.message.includes('record-action'))
```

---

## 📊 最終的な根本原因の可能性

| # | 原因 | 可能性 | 修正難易度 |
|----|-----|--------|----------|
| 1 | manifest.json に content_scripts がない | **HIGH** | ⭐ 簡単 |
| 2 | content script が読み込まれていない | **HIGH** | ⭐⭐ 中程度 |
| 3 | start-recording メッセージが届いていない | **MEDIUM** | ⭐⭐⭐ 中程度 |
| 4 | this.recordMode が未初期化 | **MEDIUM** | ⭐ 簡単 |
| 5 | イベントリスナー登録に失敗 | **MEDIUM** | ⭐⭐ 中程度 |
| 6 | postMessage コールバックエラー | **LOW** | ⭐ 簡単 |
| 7 | ファイル保存エラー | **LOW** | ⭐⭐ 中程度 |

---

**次のアクション**: manifest.json を確認し、content_scripts セクションの有無を報告してください。
