# iMacros MV3 - 重大エラー修正の実装ガイド

**最終更新**: 2025-11-23  
**優先度**: CRITICAL

---

## 📊 修正すべき問題の優先順位

### ✅ 検証済み - 実装済みの問題

#### ✓ 1. `imns` グローバル変数
**状態**: ✅ 実装済み
- **場所**: `utils.js` line 49-190
- `imns` namespace は完全に定義されている
- `imns.escapeLine()`, `imns.escapeTextContent()` など全ての必要なメソッドが存在
- Content scripts から見えない問題は、以下で修正:
  ```javascript
  // content_scripts/player.js で guard を追加
  if (typeof imns === 'undefined') {
      window.imns = { /* polyfill */ }
  }
  ```

#### ✓ 2. `getRedirFromString()` / `getRedirectURL()`
**状態**: ✅ 実装済み
- **場所**: `utils.js` line 479-492
- 両方の関数が定義されている
- 正常に機能している

#### ✓ 3. HTML script import 順序
**状態**: ✅ 正しい
- **fileView.html**: utils.js が正しく読み込まれている
- **folderView.html**: utils.js が正しく読み込まれている
- **editor/editor.html**: utils.js が読み込まれている

#### ✓ 4. `onQueryCssSelector` 関数
**状態**: ✅ 実装済み
- **場所**: `content_scripts/player.js` line 1122-1127
- スタブ実装がある (現在は NOP)
- コメントに注釈がある

---

## 🔴 修正が必要な実際の問題

### 問題 1: localStorage ポリフィルの初期化順序

**ファイル**: `background.js` + `bg.js`

**現在の状況**:
```javascript
// background.js
const localStorageInitPromise = (async () => {
    // 非同期で初期化
})();

// bg.js
(async function() {
    if (globalThis.localStorageInitPromise) {
        await globalThis.localStorageInitPromise;
    }
    // ここで Storage を使用
})();
```

**潜在的な問題**:
- Promise が解決される前に Storage の読み込みが発生する可能性がある
- bg.js が完全に初期化されないまま使用される可能性

**修正方法**:
```javascript
// bg.js の最後に以下を追加
(async function runInitializationChecks() {
    // localStorage 初期化を待つ
    if (globalThis.localStorageInitPromise) {
        try {
            await globalThis.localStorageInitPromise;
            console.log('[iMacros] localStorage initialization complete');
        } catch (err) {
            console.error('[iMacros] localStorage initialization failed:', err);
        }
    }
    
    // 現在の初期化ロジック
    if (!Storage.getBool("already-installed")) {
        // ... install logic
    }
})();
```

---

### 問題 2: context グローバル オブジェクトが未初期化

**ファイル**: `bg.js`, `mplayer.js`, `context.js`

**現在の状況**:
```javascript
// bg.js line 478-489
contextPromise = context[w_id] && context[w_id]._initialized
    ? Promise.resolve(context[w_id])
    : context.init(w_id);
```

**問題**:
- `context` グローバルが定義されているか不明
- context.init() が呼び出される場所が多く、保証されていない

**修正方法**:
```javascript
// bg.js の開始に以下を追加
if (typeof context === 'undefined') {
    console.error('[iMacros] CRITICAL: context object not defined');
    // context.js が読み込まれているか確認
    throw new Error('context object must be initialized before bg.js');
}

// bg.js で context 初期化を強制
(async function ensureContextInitialized() {
    // context が存在し、最小限の初期化がされているか確認
    if (!context || typeof context.init !== 'function') {
        console.error('[iMacros] context.init not available');
        return;
    }
})();
```

---

### 問題 3: Rijndael, badge, nm_connector グローバル

**ファイル**: `bg.js`, `content_scripts/player.js`

**現在の状況**:
```javascript
// bg.js で以下が使用されている
Rijndael.tempPassword = ...  // line 728
badge.clearText(win.id)      // line 614
nm_connector.startServer()   // line 791
```

**問題**:
- これらが全て定義されているかが不明
- グローバルスコープに存在する保証がない

**修正方法**:
```javascript
// manifest.json のスクリプト順序を確認
// background.js で以下をチェック
const REQUIRED_GLOBALS = ['Rijndael', 'badge', 'nm_connector'];
REQUIRED_GLOBALS.forEach(name => {
    if (typeof globalThis[name] === 'undefined') {
        console.warn(`[iMacros] ${name} not available`);
    }
});
```

---

### 問題 4: async/await 互換性

**ファイル**: `background.js` + `bg.js`

**現在の状況**:
```javascript
// background.js line 415-416
const localStorageInitPromise = (async () => { ... })();

// bg.js line 736-740
(async function() {
    if (globalThis.localStorageInitPromise) {
        await globalThis.localStorageInitPromise;
    }
})();
```

**問題**:
- Service Workers が async IIFE をサポートしているか確認が必要
- Chrome 89+ では top-level await をサポート

**修正方法**:
```javascript
// top-level await に変更可能 (Chrome 89+)
if (typeof localStorage === 'undefined') {
    // ... 初期化コード
    globalThis.localStorageInitPromise = 
        chrome.storage.local.get(null).then(result => {
            // ... キャッシュ populate
        });
    
    // bg.js で
    if (globalThis.localStorageInitPromise) {
        await globalThis.localStorageInitPromise;
    }
}
```

---

### 問題 5: Chrome API エラーハンドリングの不一貫性

**ファイル**: `bg.js` (複数箇所)

**現在の状況**:
```javascript
// bg.js line 695-698
chrome.tabs.get(tab_id, function(t) {
    if (chrome.runtime.lastError) {
        logError("Failed to get tab...");  // ✅ 正しい
        return;
    }
});
```

**問題**:
- エラーハンドリング後に `return` せずに続行する場合がある
- 一貫性がない

**修正方法**:
```javascript
// 常にエラーチェック後に早期リターン
if (chrome.runtime.lastError) {
    logError(...);
    return;  // 必須
}
```

---

## ✅ 実装済みの良好な部分

### 1. errorLogger.js
- 包括的なエラーロギング
- チェック機能が充実
- Chrome API エラーハンドリング関数あり

### 2. Promise エラーハンドリング
- ほぼすべての Promise に `.catch()` がある
- エラーログが記録されている

### 3. context.init() 

- Race condition 対策がある
- Promise-based initialization
- 重複初期化防止

---

## 🔧 修正実装リスト

### Step 1: 検証スクリプト作成 (30分)

作成ファイル: `_validate_globals.js`
```javascript
// 全てのグローバル変数が定義されているか確認
const REQUIRED_GLOBALS = {
    'Storage': 'object',
    'context': 'object',
    'imns': 'object',
    'afio': 'object',
    'communicator': 'object',
    'badge': 'object',
    'nm_connector': 'object',
    'Rijndael': 'function',
    'ErrorLogger': 'object'
};

console.log('=== Global Variable Validation ===');
Object.entries(REQUIRED_GLOBALS).forEach(([name, expectedType]) => {
    const actual = typeof globalThis[name];
    const status = actual === expectedType ? '✅' : '❌';
    console.log(`${status} ${name}: expected ${expectedType}, got ${actual}`);
});
```

### Step 2: background.js 修正 (15分)

**修正内容**:
1. localStorage 初期化ロジックの最適化
2. エラーハンドリングの強化
3. グローバル変数の存在確認追加

### Step 3: bg.js 修正 (15分)

**修正内容**:
1. context 初期化の確認ロジック追加
2. Promise 初期化の強化
3. グローバル変数チェックの追加

### Step 4: テスト & 検証 (30分)

- Extension 再読み込み
- ErrorLogger.generateReport() 実行
- 各機能テスト

---

## 📋 チェックリスト

実装前に以下を確認:

- [ ] manifest.json のスクリプト読み込み順序が正しいか
- [ ] 全てのスクリプトが `<script>` タグで読み込まれているか
- [ ] background.js で localStorage ポリフィルが正しく初期化されているか
- [ ] bg.js が localStorage 初期化を待つようになっているか
- [ ] errorLogger.js が全ての entry points で読み込まれているか
- [ ] Chrome API エラーハンドリングが一貫しているか

実装後に以下を確認:

- [ ] Console にエラーメッセージがないか
- [ ] ErrorLogger が初期化されているか
- [ ] すべてのグローバル変数が定義されているか
- [ ] マクロ記録が動作するか
- [ ] マクロ再生が動作するか
- [ ] ファイル保存が動作するか

---

## 📌 重要なポイント

1. **時間順序の問題が最優先**: localStorage 初期化待機の確認
2. **グローバル変数の存在確認**: guard clause を追加
3. **エラーログの確認**: ErrorLogger でエラー履歴を確認
4. **段階的な修正**: 1つずつテストしながら進める

---

**次のアクション**: 上記 4 つの Step を順番に実装してください。
