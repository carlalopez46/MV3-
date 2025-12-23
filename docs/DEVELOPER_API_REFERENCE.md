# iMacros MV3 開発者 API リファレンス

iMacros MV3 拡張機能の内部 API リファレンスです。

## 目次

1. [アーキテクチャ概要](#アーキテクチャ概要)
2. [コアモジュール](#コアモジュール)
3. [メッセージング API](#メッセージング-api)
4. [ファイルアクセス API](#ファイルアクセス-api)
5. [変数管理](#変数管理)
6. [エラーハンドリング](#エラーハンドリング)
7. [拡張ポイント](#拡張ポイント)

---

## アーキテクチャ概要

### MV3 アーキテクチャ図

```
┌─────────────────────────────────────────────────────────────────┐
│                     SERVICE WORKER (background.js)               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ • localStorage ポリフィル                                 │   │
│  │ • DOM シム (window, document)                            │   │
│  │ • Offscreen Document 管理                                │   │
│  │ • メッセージルーティング                                  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  importScripts() ────────────┴──────────────────────────────    │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │
│  │utils.js│ │context │ │mplayer │ │mrecord │ │ bg.js  │        │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘        │
└─────────────────────────────────────────────────────────────────┘
                              │
                    chrome.runtime.sendMessage
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OFFSCREEN DOCUMENT                            │
│  offscreen.html → offscreen_bg.js                               │
│  • DOM 操作 (Service Worker では不可)                            │
│  • クリップボード操作                                            │
│  • Sandbox eval 実行                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                    chrome.tabs.sendMessage
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CONTENT SCRIPTS                               │
│  connector.js ← → player.js, recorder.js                        │
│  • Web ページとの対話                                            │
│  • DOM 操作 (TAG コマンド)                                       │
│  • イベント記録                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## コアモジュール

### MacroPlayer (mplayer.js)

マクロコマンドの解析と実行を担当します。

#### クラス構造

```javascript
class MacroPlayer {
    constructor(win_id) {
        this.win_id = win_id;
        this.tab_id = null;
        this.state = 'idle';
        this.variables = new VariableManager();
        this.loopStack = [];
        // ...
    }
}
```

#### 主要メソッド

| メソッド | 説明 | パラメータ |
|---------|------|-----------|
| `play(macro, options)` | マクロ実行を開始 | macro: 文字列, options: オブジェクト |
| `stop()` | 実行を中止 | - |
| `pause()` | 一時停止 | - |
| `unpause()` | 再開 | - |
| `executeCommand(cmd)` | 単一コマンド実行 | cmd: パース済みコマンド |

#### イベント

```javascript
// 実行完了イベント
mplayer.onComplete = function(result) {
    console.log('Macro completed:', result);
};

// エラーイベント
mplayer.onError = function(error) {
    console.error('Macro error:', error);
};
```

---

### Recorder (mrecorder.js)

ユーザー操作の記録を担当します。

#### 主要メソッド

| メソッド | 説明 |
|---------|------|
| `start()` | 記録開始 |
| `stop()` | 記録停止 |
| `recordAction(cmd)` | アクションを追記 |
| `terminate()` | リソースクリーンアップ |

#### 記録モード

```javascript
// 従来モード (TAG コマンド生成)
recorder.recordMode = 'conventional';

// イベントモード (EVENT コマンド生成)
recorder.recordMode = 'event';
```

---

### Context (context.js)

ウィンドウごとのコンテキスト（状態）を管理します。

#### 構造

```javascript
var context = {
    _initialized: false,
    _listenersAttached: false,
    _initPromises: {},
    
    // ウィンドウ ID ごとの状態
    [win_id]: {
        mplayer: MacroPlayer,
        mrecorder: Recorder,
        panel: null,
        state: 'idle'
    }
};
```

#### 主要メソッド

| メソッド | 説明 | 戻り値 |
|---------|------|--------|
| `init(win_id)` | コンテキスト初期化 | Promise |
| `updateState(win_id, state)` | 状態更新 | void |
| `attachListeners()` | イベントリスナー登録 | void |
| `detachListeners()` | イベントリスナー解除 | void |

---

### Communicator (communicator.js)

コンポーネント間のメッセージパッシングを担当します。

#### 主要メソッド

```javascript
// タブへメッセージ送信
communicator.postMessage(topic, data, tab_id, callback, frame);

// Promise ベースのメッセージ送信
communicator.sendMessage(topic, data, tab_id, frame)
    .then(response => { /* ... */ })
    .catch(error => { /* ... */ });

// ウィンドウ内全タブへブロードキャスト
communicator.broadcastMessage(topic, data, win_id);

// ハンドラー登録
communicator.registerHandler(topic, handler, win_id);
communicator.unregisterHandler(topic, handler);
```

---

## メッセージング API

### トピック一覧

| トピック | 送信元 | 送信先 | 説明 |
|---------|-------|--------|------|
| `tag-command` | mplayer | content | TAG コマンド実行 |
| `record-action` | content | mrecorder | アクション記録 |
| `start-recording` | background | content | 記録開始 |
| `stop-recording` | background | content | 記録停止 |
| `query-state` | content | background | 状態照会 |
| `error-occurred` | any | background | エラー報告 |

### メッセージ形式

```javascript
// 標準メッセージ形式
{
    topic: 'command-name',
    data: {
        // コマンド固有データ
    },
    _frame: {
        number: 0,    // フレーム番号
        name: ''      // フレーム名
    }
}
```

### Service Worker ↔ Offscreen 通信

```javascript
// Service Worker から Offscreen へ
chrome.runtime.sendMessage({
    target: 'offscreen',
    command: 'commandName',
    data: { /* ... */ }
});

// Offscreen から Service Worker へ
chrome.runtime.sendMessage({
    command: 'SEND_TO_TAB',
    tab_id: tabId,
    message: { /* ... */ }
});
```

---

## ファイルアクセス API

### AsyncFileIO (統合インターフェース)

```javascript
// ファイル読み込み
afio.read(path)
    .then(content => { /* ... */ })
    .catch(error => { /* ... */ });

// ファイル書き込み
afio.write(path, content)
    .then(() => { /* ... */ })
    .catch(error => { /* ... */ });

// ディレクトリ一覧
afio.listDirectory(path)
    .then(entries => { /* ... */ });

// ファイル存在確認
afio.exists(path)
    .then(exists => { /* ... */ });
```

### 優先順位

```javascript
// 自動選択される順序:
// 1. Native File Access (nm_connector 経由)
// 2. File System Access API (Chrome 86+)
// 3. Virtual File Service (IndexedDB)

afio.isInstalled()
    .then(installed => {
        if (installed) {
            // Native module 使用
        } else if (FileSystemAccessService.isSupported()) {
            // File System Access API 使用
        } else {
            // Virtual filesystem 使用
        }
    });
```

---

## 変数管理

### VariableManager

```javascript
class VariableManager {
    constructor() {
        this.variables = new Map();
        this.extractData = [];
    }
    
    // 変数設定
    set(name, value) { /* ... */ }
    
    // 変数取得
    get(name) { /* ... */ }
    
    // 変数展開
    expand(text) { /* ... */ }
    
    // スコープ作成 (RUN コマンド用)
    pushScope() { /* ... */ }
    popScope() { /* ... */ }
}
```

### 組み込み変数

| 変数 | 説明 | 読み書き |
|------|------|---------|
| `!VAR0` 〜 `!VAR9` | グローバル変数 | R/W |
| `!EXTRACT` | 抽出データ | R/W |
| `!LOOP` | ループカウンター | R |
| `!DATASOURCE` | データソースパス | R/W |
| `!DATASOURCE_LINE` | 現在行番号 | R |
| `!COLn` | データソース列 | R |
| `!TIMEOUT_STEP` | ステップタイムアウト | R/W |
| `!ERRORIGNORE` | エラー無視フラグ | R/W |
| `!ERRORCODE` | 最後のエラーコード | R |

### 変数展開

```javascript
// {{変数名}} 形式で展開
const expanded = mplayer.expandVariables(
    "Hello {{!VAR1}}, count is {{counter}}"
);
```

---

## エラーハンドリング

### ErrorLogger

```javascript
// エラーログ記録
ErrorLogger.logError(message, context);

// 警告ログ記録
ErrorLogger.logWarning(message, context);

// Chrome API エラーチェック
ErrorLogger.checkChromeError('operationName');

// レポート生成
const report = ErrorLogger.generateReport();
```

### エラークラス

```javascript
// パラメータエラー
throw new BadParameter("Expected integer", 1);

// ランタイムエラー
throw new RuntimeError("Element not found", 721);

// 未サポートコマンド
throw new UnsupportedCommand("IMAGECLICK");
```

### エラーコード一覧

| コード | 説明 |
|--------|------|
| 700-719 | 構文エラー |
| 720-739 | 要素検索エラー |
| 740-759 | ファイルエラー |
| 760-779 | ネットワークエラー |
| 780-799 | その他のランタイムエラー |

---

## 拡張ポイント

### 新規コマンドの追加

```javascript
// mplayer.js に追加

// 1. 正規表現パターンを定義
MacroPlayer.prototype.RegExpTable["mycommand"] = 
    "^(\\S+)\\s*(.*)$";

// 2. アクションハンドラを定義
MacroPlayer.prototype.ActionTable["mycommand"] = function(cmd) {
    const param1 = cmd[1];
    const param2 = cmd[2];
    
    // コマンドロジック
    console.log('MyCommand executed:', param1, param2);
    
    // 非同期の場合は Promise を返す
    return Promise.resolve();
};
```

### 新規メッセージハンドラの追加

```javascript
// communicator でハンドラ登録
communicator.registerHandler('my-topic', function(data, tab_id, sendResponse) {
    console.log('Received:', data);
    
    // 処理を実行
    const result = processData(data);
    
    // レスポンスを返す
    sendResponse({ success: true, result: result });
}, win_id);
```

### Content Script への機能追加

```javascript
// content_scripts/player.js に追加

CSPlayer.prototype.handleMyCommand = function(args, callback) {
    // DOM 操作
    const element = document.querySelector(args.selector);
    
    // 結果を返す
    callback({
        success: true,
        data: element ? element.textContent : null
    });
};

// ハンドラ登録
connector.registerHandler("my-command", this.handleMyCommand.bind(this));
```

---

## デバッグ

### Service Worker コンソール

1. `chrome://extensions` を開く
2. iMacros の「Service worker」リンクをクリック
3. DevTools が開く

### エラーログの確認

```javascript
// コンソールで実行
ErrorLogger.getAllErrors();
ErrorLogger.generateReport();
```

### 変数の確認

```javascript
// 現在の変数をダンプ
context[win_id].mplayer.variables.dump();
```

---

**最終更新**: 2025-12-08
