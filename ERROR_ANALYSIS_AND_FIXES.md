# iMacros MV3 - 総合エラー分析と修正計画

**作成日**: 2025-11-23  
**状態**: 詳細分析完了

---

## 🚨 検出されたエラー概要

**合計エラー数**: 15+カテゴリー  
**重大度**: HIGH (5) / MEDIUM (7) / LOW (3)  
**影響範囲**: コア機能（記録、再生、保存、ファイル管理）

---

## 📋 エラー詳細リスト

### ❌ 1. UNDEFINED GLOBAL VARIABLES (最高優先度)

#### 1.1 `imns` 未定義
- **影響ファイル**: 
  - `content_scripts/player.js` (line 194)
  - `content_scripts/bookmarks_handler.js` (line 37)
  - `content_scripts/connector.js`
  
- **エラーメッセージ**: `ReferenceError: imns is not defined`
- **問題内容**:
  ```javascript
  imns.escapeTextContent(node.textContent)  // Line 194 in player.js
  imns.escapeLine(macro_name)               // Line 37 in bookmarks_handler.js
  ```

- **原因**: `imns` namespace は background で定義されているが、content scripts から見えない
- **修正方法**:
  1. `imns` オブジェクトをglobalにエクスポート
  2. または content scripts 内で再定義
  3. または communicator 経由で呼び出す

#### 1.2 `Storage` 未定義
- **影響ファイル**:
  - `utils.js` (core storage object)
  - `bg.js` (全所で使用)
  - `context.js`
  - `NewSaveSystem.js`
  - `panel_modern.js`

- **エラーメッセージ**: `ReferenceError: Storage is not defined`
- **問題内容**:
  ```javascript
  Storage.getChar("tree-type")    // NewSaveSystem.js:51
  Storage.setBool(...)            // Multiple files
  ```

- **原因**: `utils.js` で定義されているが、スクリプト読み込み順序が不正
- **修正方法**: HTML ファイルで `utils.js` を他より前に読み込む

#### 1.3 `newSaveSystem` 未定義
- **影響ファイル**:
  - `panel_modern.js` (line 32)
  - `fileView.js` (line 41)
  - `folderView_modern.js` (line 14)
  - `editor/saveAsDialog_modern.js`

- **エラーメッセージ**: `ReferenceError: newSaveSystem is not defined`
- **問題内容**:
  ```javascript
  newSaveSystem.readFile(fileName)      // panel_modern.js:32
  window.newSaveSystem.isAvailable()    // fileView.js:41
  ```

- **原因**: 
  - HTML で script 読み込みが間違った順序
  - または NewSaveSystem.js が読み込まれていない
  - グローバルスコープに保存されていない

#### 1.4 `context` オブジェクト
- **影響ファイル**: bg.js, mplayer.js, mrecorder.js, context.js
- **問題内容**: `context` が完全に初期化される前に使用される場合がある
- **修正方法**: context.init() の呼び出しを必須にする

#### 1.5 `args` グローバル変数
- **影響ファイル**: `panel_modern.js` (line 13, 308)
- **問題内容**: runtime 初期化前にアクセスされる可能性
- **修正方法**: lazy initialization か guards を追加

---

### ❌ 2. MISSING HTML SCRIPT IMPORTS (高優先度)

#### 2.1 editor/editor.html
**現在の状態:**
```html
<script src="../ModernFileSystem.js"></script>
<!-- NewSaveSystem.js が欠落! -->
<!-- ModernFileAPI.js が欠落! -->
```

**修正が必要:**
```html
<script src="../utils.js"></script>
<script src="../ModernFileSystem.js"></script>
<script src="../ModernFileAPI.js"></script>
<script src="../NewSaveSystem.js"></script>
<script src="editor.js"></script>
```

#### 2.2 fileView.html
**現在の状態:** スクリプト順序が不正
```html
<script src="fileView.js"></script>      <!-- これが最初だと utils がまだ見えない -->
<script src="../utils.js"></script>
<script src="../AsyncFileIO.js"></script>  <!-- 非推奨 -->
```

**修正が必要:**
```html
<script src="../utils.js"></script>
<script src="../ModernFileSystem.js"></script>
<script src="../ModernFileAPI.js"></script>
<script src="../NewSaveSystem.js"></script>
<script src="fileView.js"></script>
```

#### 2.3 folderView.html
**同様の問題**

#### 2.4 editor/saveAsDialog.html
**現在の状態:**
```html
<script src="../AsyncFileIO.js"></script>  <!-- 廃止されたAPI -->
```

**修正が必要:**
```html
<script src="../utils.js"></script>
<script src="../ModernFileSystem.js"></script>
<script src="../ModernFileAPI.js"></script>
<script src="../NewSaveSystem.js"></script>
```

---

### ❌ 3. CHROME API DEPRECATION (高優先度)

#### 3.1 `chrome.extension.getBackgroundPage()` (deprecated)
- **影響ファイル**: 
  - `panel_modern.js`
  - `fileView.js`
  - `content_scripts/connector.js`

- **代替方法**: 
  ```javascript
  // 旧い
  chrome.extension.getBackgroundPage().getLimits()
  
  // 新しい (MV3)
  chrome.runtime.sendMessage({type: 'CALL_BG_FUNCTION', functionName: 'getLimits'})
  ```

#### 3.2 `chrome.extension.onRequest` (removed in MV3)
- **影響ファイル**: Content scripts
- **代替方法**: `chrome.runtime.onMessage`

---

### ❌ 4. DEPENDENCY & LOADING ORDER ISSUES

#### 4.1 AsyncFileIO.js は廃止
- **問題**: 古い API が残存
- **修正**: ModernFileAPI.js に統一

#### 4.2 context 初期化順序
- **location**: bg.js line 701-732
- **問題**: context が完全に初期化される前にアクセスされる可能性
- **修正**: context initialization promise を確認

---

### ❌ 5. MISSING FUNCTION IMPLEMENTATIONS

#### 5.1 `onQueryCssSelector` スタブ関数
- **location**: `content_scripts/player.js` line 1117-1119
- **問題**: スタブ実装のみ、実装がない
- **修正**: 完全な実装を追加

#### 5.2 `getRedirFromString()` / `getRedirectURL()`
- **location**: `panel_modern.js` line 342, 494
- **問題**: 定義されていない
- **修正**: utils.js に追加するか、communicator 経由で呼び出す

---

## ✅ 修正計画

### フェーズ 1: グローバル変数の修正 (1時間)

#### Step 1.1: utils.js の強化
- [ ] `imns` namespace を定義して export
- [ ] `getRedirFromString()` function を追加
- [ ] 既存の `Storage` object を確認・修正

#### Step 1.2: HTML ファイルのスクリプト順序修正
- [ ] editor/editor.html を修正
- [ ] fileView.html を修正  
- [ ] folderView.html を修正
- [ ] editor/saveAsDialog.html を修正
- [ ] panel.html を修正

#### Step 1.3: Content script の修正
- [ ] content_scripts/player.js で imns チェックを追加
- [ ] content_scripts/bookmarks_handler.js で imns チェックを追加
- [ ] communicator 経由での呼び出しに対応

### フェーズ 2: Chrome API の更新 (2時間)

#### Step 2.1: getBackgroundPage() の置き換え
```javascript
// 新しいユーティリティ関数を作成
async function callBackgroundFunction(functionName, args) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { type: 'CALL_BG_FUNCTION', functionName, args },
            response => {
                if (!response) {
                    reject(new Error('No response from background'));
                } else if (!response.success) {
                    reject(new Error(response.error));
                } else {
                    resolve(response.result);
                }
            }
        );
    });
}
```

#### Step 2.2: onRequest の置き換え
```javascript
// 旧い
chrome.extension.onRequest.addListener(...)

// 新しい
chrome.runtime.onMessage.addListener(...)
```

### フェーズ 3: AsyncFileIO の廃止 (1時間)

#### Step 3.1: AsyncFileIO.js の削除
- [ ] 全ての参照を ModernFileAPI.js に変更
- [ ] 互換性レイヤーを確認

#### Step 3.2: NewSaveSystem の統一
- [ ] 全ての saveAs 呼び出しを統一

### フェーズ 4: エラーハンドリングの強化 (1.5時間)

#### Step 4.1: グローバル初期化チェック
```javascript
// 各ファイルの開始で
if (typeof Storage === 'undefined') {
    console.error('Storage object not initialized');
    // 適切に処理
}

if (typeof context === 'undefined' || !context) {
    // context initialization promise を待つ
}
```

#### Step 4.2: Promise-based initialization
```javascript
// bg.js で
async function initializeExtension() {
    // Step 1: localStorage 初期化を待つ
    if (globalThis.localStorageInitPromise) {
        await globalThis.localStorageInitPromise;
    }
    
    // Step 2: context を初期化
    await context.init();
    
    // Step 3: その他の初期化
}
```

---

## 🔧 修正ファイルリスト

### 優先度 HIGH (すぐに修正)
1. [ ] **utils.js** - imns, getRedirFromString 追加
2. [ ] **editor/editor.html** - script import 順序修正
3. [ ] **fileView.html** - script import 順序修正
4. [ ] **folderView.html** - script import 順序修正
5. [ ] **panel.html** - script import 順序確認
6. [ ] **bg.js** - context initialization を保証
7. [ ] **background.js** - localStorage init promise を使用

### 優先度 MEDIUM
8. [ ] **panel_modern.js** - getBackgroundPage() を削除
9. [ ] **fileView.js** - getBackgroundPage() を削除
10. [ ] **content_scripts/connector.js** - MV3 対応
11. [ ] **editor/saveAsDialog.html** - AsyncFileIO.js の参照を削除
12. [ ] **content_scripts/player.js** - onQueryCssSelector 実装

### 優先度 LOW
13. [ ] **AsyncFileIO.js** - 廃止予定をマーク
14. [ ] **コメント更新** - 廃止 API についてのコメント追加
15. [ ] **テストケース** - MV3 互換性テスト追加

---

## 📊 エラー修正の優先順位

```
優先度 1 (即時修正):
├─ Storage グローバル初期化
├─ utils.js 関数追加
├─ HTML script import 順序
└─ context initialization

優先度 2 (24時間以内):
├─ Chrome API deprecation
├─ getBackgroundPage() 置き換え
└─ onRequest → onMessage

優先度 3 (1週間以内):
├─ AsyncFileIO 廃止
├─ エラーハンドリング強化
└─ テスト追加
```

---

## 🧪 検証方法

### 修正後のテスト
1. Extension を再読み込み
2. Console で errors をチェック
3. ErrorLogger.generateReport() を実行
4. 以下の機能をテスト:
   - [ ] マクロ記録
   - [ ] マクロ再生
   - [ ] ファイル保存
   - [ ] ファイル読み込み
   - [ ] ブックマーク操作

---

## 📝 修正例

### Example 1: utils.js に imns を追加
```javascript
// utils.js の最後に追加
var imns = {
    escapeLine: function(str) {
        // 既存実装
        return str;
    },
    escapeTextContent: function(str) {
        // 既存実装
        return str;
    },
    unwrap: function(str) {
        // 既存実装
        return str;
    }
};

// グローバルにエクスポート
if (typeof window !== 'undefined') {
    window.imns = imns;
}
```

### Example 2: HTML script import 修正
```html
<!-- Before -->
<script src="fileView.js"></script>
<script src="../utils.js"></script>
<script src="../AsyncFileIO.js"></script>

<!-- After -->
<script src="../utils.js"></script>
<script src="../ModernFileSystem.js"></script>
<script src="../ModernFileAPI.js"></script>
<script src="../NewSaveSystem.js"></script>
<script src="fileView.js"></script>
```

### Example 3: getBackgroundPage() 置き換え
```javascript
// Before
chrome.extension.getBackgroundPage().getLimits()

// After
chrome.runtime.sendMessage(
    { type: 'CALL_BG_FUNCTION', functionName: 'getLimits', args: [] },
    response => {
        if (response.success) {
            handleLimits(response.result);
        } else {
            console.error('Failed to get limits:', response.error);
        }
    }
);
```

---

## 🎯 最終チェックリスト

修正完了時に確認すること:

- [ ] すべての HTML ファイルで script import 順序が正しい
- [ ] すべてのグローバル変数が定義されている
- [ ] Chrome API が MV3 仕様に準拠
- [ ] ErrorLogger に全ての errors が記録されている
- [ ] Console に deprecation warning がない
- [ ] 全機能が正常に動作する

---

**次のステップ**: Phase 1 の修正を開始してください。
