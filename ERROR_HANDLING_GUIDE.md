# iMacros Chrome Extension - エラーハンドリングとトラブルシューティングガイド

## 目次
1. [エラーロギングシステムの概要](#エラーロギングシステムの概要)
2. [エラーログの確認方法](#エラーログの確認方法)
3. [エラーレベルの説明](#エラーレベルの説明)
4. [よくあるエラーとその対処方法](#よくあるエラーとその対処方法)
5. [開発者向け: エラーロギングAPI](#開発者向け-エラーロギングapi)
6. [トラブルシューティング手順](#トラブルシューティング手順)

---

## エラーロギングシステムの概要

iMacros Chrome拡張機能は、包括的なエラーロギングシステムを実装しています。このシステムは、すべてのエラーを自動的にキャプチャし、LocalStorageに永続化します。

### 主な機能

- **自動エラーキャプチャ**: すべての未処理エラーとPromise拒否を自動的にログに記録
- **永続化**: エラーログはLocalStorageに保存され、セッション間で保持
- **詳細なコンテキスト情報**: ファイル名、行番号、スタックトレース、タイムスタンプなどを記録
- **4つのエラーレベル**: ERROR、WARNING、INFO、CRITICAL
- **ブラウザコンソール統合**: エラーはコンソールにも出力され、開発者ツールで確認可能

---

## エラーログの確認方法

### 方法1: ブラウザの開発者ツール

1. Chrome拡張機能のバックグラウンドページを開く
   - `chrome://extensions/` にアクセス
   - 「開発者モード」を有効化
   - iMacros拡張機能の「バックグラウンドページ」または「サービスワーカー」をクリック

2. コンソールタブでエラーを確認
   - すべてのエラーは `[iMacros ERROR]` などの接頭辞付きで表示されます
   - スタックトレースも自動的に表示されます

### 方法2: JavaScriptコンソールから直接確認

バックグラウンページまたはパネルページのコンソールで以下を実行:

```javascript
// すべてのエラーログを取得
ErrorLogger.getAllErrors()

// エラー統計を取得
ErrorLogger.getStats()

// エラーレポートを生成
console.log(ErrorLogger.generateReport())

// エラーログをJSON形式でエクスポート
console.log(ErrorLogger.exportAsJSON())

// 特定のレベルのエラーを取得
ErrorLogger.getErrorsByLevel(ErrorLevel.ERROR)
ErrorLogger.getErrorsByLevel(ErrorLevel.CRITICAL)

// 特定のファイルのエラーを取得
ErrorLogger.getErrorsByFilename("mplayer.js")

// エラーログをクリア
ErrorLogger.clearLogs()
```

### 方法3: エラーログのエクスポート

```javascript
// JSON形式でエクスポートして保存
var json = ErrorLogger.exportAsJSON();
var blob = new Blob([json], {type: "application/json"});
var url = URL.createObjectURL(blob);
var a = document.createElement("a");
a.href = url;
a.download = "imacros_error_log.json";
a.click();
```

---

## エラーレベルの説明

### ERROR (エラー)
- **説明**: 通常のエラー。機能の一部が失敗したが、拡張機能全体は動作可能
- **例**: ファイルの読み込み失敗、ネットワークエラー、無効なマクロ構文
- **対応**: エラーメッセージを確認し、問題を修正

### WARNING (警告)
- **説明**: 潜在的な問題。動作は継続されるが、注意が必要
- **例**: コンテキストが見つからない、タブが既に閉じられている
- **対応**: 無視しても良いが、頻繁に発生する場合は調査が必要

### INFO (情報)
- **説明**: 情報メッセージ。エラーではなく、重要なイベントの記録
- **例**: マクロの実行開始、ファイルの保存成功
- **対応**: 不要（デバッグ時のみ確認）

### CRITICAL (クリティカル)
- **説明**: 重大なエラー。拡張機能の動作に深刻な影響を与える
- **例**: 初期化失敗、メモリ不足、重要なAPIの呼び出し失敗
- **対応**: 即座に対処が必要。拡張機能の再起動や再インストールを検討

---

## よくあるエラーとその対処方法

### 1. Chrome API Error: "Could not establish connection. Receiving end does not exist."

**原因**: メッセージの送信先タブまたはフレームが既に閉じられている

**対処方法**:
- 通常は無害。タブが閉じられた直後にメッセージが送信されたため
- 頻繁に発生する場合は、タブの状態を確認してからメッセージを送信

### 2. Chrome API Error: "Tabs cannot be edited right now (user may be dragging a tab)."

**原因**: ユーザーがタブをドラッグ中または、他の操作中

**対処方法**:
- 少し待ってから再試行
- タブ操作前に短い遅延を入れる

### 3. Unhandled Promise Rejection: "Failed to get limits or play macro"

**原因**: ネイティブファイルI/O (afio.exe) が利用できない

**対処方法**:
1. afio.exeがインストールされているか確認
2. `chrome://extensions/` で拡張機能の詳細を確認し、「ネイティブメッセージング」が有効か確認
3. afio.exeを再インストール

### 4. "No context for window"

**原因**: ウィンドウのコンテキストが初期化されていない、または既に削除されている

**対処方法**:
- 通常は拡張機能の起動直後または、ウィンドウを閉じた直後に発生
- 拡張機能を再読み込み
- 問題が継続する場合は、ブラウザを再起動

### 5. "Failed to parse JSON for key..."

**原因**: LocalStorageに保存されたデータが破損している

**対処方法**:
```javascript
// LocalStorageをクリア
localStorage.clear();
// 拡張機能を再読み込み
```

---

## 開発者向け: エラーロギングAPI

### 基本的な使用方法

```javascript
// エラーをログに記録
logError("エラーメッセージ", {contextKey: "contextValue"});

// 警告をログに記録
logWarning("警告メッセージ", {contextKey: "contextValue"});

// 情報をログに記録
logInfo("情報メッセージ", {contextKey: "contextValue"});

// クリティカルエラーをログに記録
logCritical("クリティカルエラー", {contextKey: "contextValue"});
```

### Chrome API エラーチェック

```javascript
// chrome.runtime.lastErrorを自動的にチェック
chrome.tabs.get(tabId, function(tab) {
    if (checkChromeError("chrome.tabs.get", {tabId: tabId})) {
        return; // エラーが発生した場合は処理を中断
    }
    // 正常な処理
});

// コールバックをラップして自動的にエラーチェック
chrome.tabs.get(tabId, wrapChromeCallback(function(tab) {
    // エラーチェックは自動的に行われる
    // 正常な処理
}, "chrome.tabs.get"));
```

### Promise のエラーハンドリング

```javascript
// Promiseをラップしてエラーログを自動記録
var wrappedFunction = wrapPromise(function() {
    return someAsyncOperation();
}, "someAsyncOperation");

wrappedFunction()
    .then(result => {
        // 正常な処理
    });
// .catch()は不要（wrapPromiseが自動的にログを記録）
```

### 安全なStorageアクセス

```javascript
// chrome.storageのPromiseベース安全なラッパー
safeStorage.local.get(["key1", "key2"])
    .then(result => {
        console.log(result);
    })
    .catch(err => {
        // エラーは自動的にログに記録される
    });

safeStorage.local.set({key: "value"})
    .then(() => {
        console.log("保存成功");
    });
```

---

## トラブルシューティング手順

### ステップ1: エラーログを確認

```javascript
// 最新のエラーを確認
ErrorLogger.getAllErrors().slice(-10)

// クリティカルエラーを確認
ErrorLogger.getErrorsByLevel(ErrorLevel.CRITICAL)
```

### ステップ2: エラーの頻度を確認

```javascript
// 統計情報を確認
ErrorLogger.getStats()
```

### ステップ3: 特定のファイルのエラーを確認

```javascript
// 例: mplayer.jsのエラーを確認
ErrorLogger.getErrorsByFilename("mplayer.js")
```

### ステップ4: エラーレポートを生成

```javascript
// 詳細なレポートを生成
console.log(ErrorLogger.generateReport())
```

### ステップ5: 問題が解決しない場合

1. エラーログをエクスポート
2. 拡張機能を再読み込み
3. ブラウザを再起動
4. 拡張機能を再インストール
5. それでも問題が解決しない場合は、エラーログを添えてサポートに問い合わせ

---

## デバッグモードの有効化

デバッグモードを有効にすると、より詳細なログが記録されます。

```javascript
// デバッグモードを有効化
Storage.setBool("debug", true);

// デバッグモードを無効化
Storage.setBool("debug", false);

// 現在の設定を確認
Storage.getBool("debug")
```

デバッグモードが有効な場合:
- すべてのマクロコマンドの実行ログが記録される
- タブやウィンドウの変更が詳細に記録される
- タイミング情報が記録される

---

## エラーコード一覧

| コード | 説明 | 対処方法 |
|--------|------|----------|
| ChromeAPIError | Chrome API呼び出しエラー | chrome.runtime.lastErrorの内容を確認 |
| PromiseRejection | Promise拒否 | スタックトレースを確認し、原因を特定 |
| UncaughtError | 未処理エラー | スタックトレースを確認 |
| UnhandledPromiseRejection | 未処理Promise拒否 | .catch()を追加 |
| ConsoleError | console.error()による出力 | エラーメッセージを確認 |
| AsyncCaughtError | 非同期関数でキャッチされたエラー | try-catchブロックで処理 |
| RuntimeError | マクロ実行時エラー | マクロの構文を確認 |

---

## パフォーマンスのモニタリング

```javascript
// エラーログのサイズを確認
ErrorLogger.getAllErrors().length

// エラーログが大きくなりすぎた場合はクリア
if (ErrorLogger.getAllErrors().length > 500) {
    // 古いエラーをエクスポートしてから
    var json = ErrorLogger.exportAsJSON();
    // クリア
    ErrorLogger.clearLogs();
}
```

---

## 注意事項

1. **エラーログのサイズ**: エラーログは最大1000件まで保存されます。それ以上は古いものから自動的に削除されます。

2. **LocalStorageの容量**: エラーログが大きくなりすぎるとLocalStorageの容量を圧迫する可能性があります。定期的にクリアすることをお勧めします。

3. **個人情報**: エラーログにはマクロの内容やURLなどが含まれる可能性があります。エラーログを共有する際は、個人情報が含まれていないか確認してください。

4. **パフォーマンス**: デバッグモードを有効にすると、大量のログが記録されるため、パフォーマンスに影響を与える可能性があります。通常は無効にしておくことをお勧めします。

---

## まとめ

iMacros Chrome拡張機能のエラーロギングシステムは、問題の診断と解決を支援する強力なツールです。このガイドを参考にして、効果的にエラーを追跡し、トラブルシューティングを行ってください。

問題が解決しない場合は、エラーログを添えてサポートに問い合わせることで、より迅速な解決が可能になります。
