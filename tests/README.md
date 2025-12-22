# AsyncFileIO Testing Infrastructure

このディレクトリには、新しいAsyncFileIO.js実装を検証するための包括的なテストシステムが含まれています。

## 概要

AsyncFileIO.jsの新しい実装（仮想ファイルシステムのfallback機能付き）が、既存のコードベース全体で正しく動作することを確認するため、以下のツールを提供します：

1. **依存性分析ツール** - すべてのafio使用箇所を特定
2. **包括的テストスイート** - すべてのafio操作をテスト
3. **エラー追跡システム** - 詳細なエラーログとスタックトレース
4. **ブラウザテストランナー** - インタラクティブなテスト実行

## ファイル構成

```
tests/
├── README.md                      # このファイル
├── analyze_afio_dependencies.js   # 依存性分析ツール（Node.js）
├── afio_test_suite.js            # テストスイート（ブラウザ）
├── afio_usage_verifier.js        # afio使用状況チェック（Node.js）
├── afio_usage_verifier_report.json # 使用状況レポート
├── test_runner.html              # テスト実行UI（ブラウザ）
└── afio_analysis_report.json     # 分析レポート（自動生成）
```

## クイックスタート

### 1. 依存性分析の実行

コードベース全体のafio使用状況を分析します：

```bash
cd /home/user/iMacrosMV3/tests
node analyze_afio_dependencies.js /home/user/iMacrosMV3
```

出力内容：
- 使用されているファイルとメソッドの一覧
- 使用頻度の統計
- 潜在的な問題の警告
- 推奨事項

### 1-b. 使用状況検証スクリプト

依存性分析の結果をもとに、すべてのafioメソッドがテストでカバーされているか確認します：

```bash
cd /home/user/iMacrosMV3/tests
node afio_usage_verifier.js /home/user/iMacrosMV3
```

このスクリプトは以下を検証します：

- afioを使用しているファイル数（現在 8 ファイル）
- afioメソッド呼び出し数（期待値: 89）
- 使用されているすべてのメソッドが`tests/afio_test_suite.js`で呼ばれているか
- レポートは `tests/afio_usage_verifier_report.json` に保存

エラー終了した場合は、テストを追加するか、期待値を更新してください。

### 2. ブラウザでテストを実行

Chromeで以下を開きます：

```
file:///home/user/iMacrosMV3/tests/test_runner.html
```

または、拡張機能としてロードした場合：

```
chrome-extension://[YOUR_EXTENSION_ID]/tests/test_runner.html
```

**「▶ Run All Tests」**ボタンをクリックしてテストを開始します。

### 3. 自動実行モード

URLパラメータを使用して自動的にテストを実行：

```
test_runner.html?autorun=true
```

## 分析レポートの詳細

### 主な発見事項（現在の分析結果）

- **影響を受けるファイル**: 8ファイル
- **使用されているメソッド**: 11種類
- **総メソッド呼び出し**: 89箇所

### メソッド使用頻度（上位）

| メソッド | 使用回数 | 主な使用ファイル |
|---------|---------|----------------|
| `openNode` | 33 | mplayer.js, panel.js, fileView.js |
| `getDefaultDir` | 11 | bg.js, mplayer.js |
| `writeTextFile` | 9 | bg.js, mplayer.js |
| `isInstalled` | 9 | bg.js, panel.js, fileView.js |
| `readTextFile` | 8 | panel.js, mplayer.js |

### 検出されたパターン

1. **localStorage_default_path** (3ファイル)
   - `localStorage["defsavepath"]`などを使用してデフォルトパスを取得
   - 影響ファイル: mplayer.js, nm_connector.js, panel.js

2. **node_clone_append** (3ファイル)
   - ノードをクローンしてパスを追加するパターン
   - 影響ファイル: bg.js, fileView.js, mplayer.js

3. **promise_chain** (7ファイル)
   - `.then()`を使用したプロミスチェーン
   - 影響ファイル: ほぼすべてのafio使用ファイル

### 警告と依存性

#### helper関数の依存性

AsyncFileIO.jsは以下のhelper関数に依存しています（utils.js内で定義）：

- `__is_windows()` - Windowsプラットフォーム判定
- `__psep()` - パス区切り文字取得

**重要**: すべてのHTMLファイルで、`utils.js`が`AsyncFileIO.js`の前にロードされている必要があります。

#### Storage依存性

AsyncFileIO.jsは`Storage.getChar()`を使用しています（utils.js内で定義）。
影響を受けるファイル:
- AsyncFileIO.js
- bg.js
- mplayer.js
- panel.js

## テストスイートの詳細

### テストカテゴリ

1. **基本VFSテスト**
   - VFS初期化
   - `isInstalled()`
   - `queryLimits()`

2. **NodeObjectテスト**
   - `openNode()`
   - `path`, `leafName`, `parent`ゲッター
   - `append()`, `clone()`

3. **ディレクトリテスト**
   - `getLogicalDrives()`
   - `getDefaultDir()`
   - `makeDirectory()`
   - `getNodesInDir()`

4. **ファイル操作テスト**
   - `writeTextFile()`, `readTextFile()`, `appendTextFile()`
   - `exists()`, `isWritable()`, `isReadable()`
   - `copyTo()`, `moveTo()`, `remove()`

5. **画像テスト**
   - `writeImageToFile()`

6. **使用パターンテスト**
   - mplayer.jsパターン
   - bg.jsパターン
   - fileView.jsパターン

7. **エッジケーステスト**
   - 大容量ファイル
   - 特殊文字を含むパス
   - ネストされたディレクトリ
   - 空ファイル

8. **エラーハンドリングテスト**
   - 存在しないファイルの読み取り
   - ディレクトリをファイルとして扱う

### テスト実行結果の見方

テストランナーUIでは以下の情報が表示されます：

- **Passed**: 成功したテスト数
- **Failed**: 失敗したテスト数
- **Skipped**: スキップされたテスト数
- **Progress Bar**: 現在の進行状況

失敗したテストについては：
- エラーメッセージ
- スタックトレース
- コンテキスト情報
- タイムスタンプ

### エラーレポートのエクスポート

「📥 Export Report」ボタンをクリックすると、JSON形式の詳細なエラーレポートがダウンロードされます。

レポート内容：
- すべてのエラーの詳細
- エラーの分類（QUOTA_ERROR, NOT_FOUND, PERMISSION_ERROR, etc.）
- コンテキスト別のエラー集計
- タイムスタンプ付きログ

## エラートラッキングシステム

### エラーカテゴリ

1. **QUOTA_ERROR** - ストレージ容量超過
2. **NOT_FOUND** - ファイル/ディレクトリが見つからない
3. **PERMISSION_ERROR** - アクセス権限エラー
4. **UNSUPPORTED_METHOD** - サポートされていないメソッド
5. **DIRECTORY_ERROR** - ディレクトリ操作エラー
6. **OTHER** - その他のエラー

### エラー情報

各エラーには以下の情報が記録されます：

```javascript
{
  timestamp: "2025-01-XX...",
  context: "テスト名",
  message: "エラーメッセージ",
  stack: "スタックトレース",
  file: "tests/afio_test_suite.js",
  line: 123,
  column: 10,
  details: { /* 追加情報 */ },
  type: "ERROR" | "WARNING"
}
```

`file` / `line` / `column` はスタックトレースから自動的に抽出されるため、どのスクリプトの何行目で失敗したかを即座に特定できます。

## 推奨される使用手順

### 新機能追加時

1. **依存性分析を実行**
   ```bash
   node analyze_afio_dependencies.js /home/user/iMacrosMV3
   ```

2. **影響範囲を確認**
   - `afio_analysis_report.json`を確認
   - 新しいメソッドや使用パターンを特定

3. **テストスイートを実行**
   - `test_runner.html`を開く
   - すべてのテストを実行
   - エラーがないことを確認

4. **必要に応じてテストを追加**
   - `afio_test_suite.js`に新しいテストを追加
   - 新しい使用パターンをカバー

### バグ修正時

1. **エラーを再現するテストを追加**
   - `afio_test_suite.js`に失敗するテストを追加

2. **修正を実施**
   - AsyncFileIO.jsを修正

3. **テストで検証**
   - テストが成功することを確認

4. **回帰テスト**
   - すべてのテストを実行して他の機能が壊れていないことを確認

## トラブルシューティング

### よくある問題

#### 1. "Storage is not defined"

**原因**: utils.jsがロードされていない

**解決策**: HTMLファイルで以下の順序でスクリプトをロード：
```html
<script src="utils.js"></script>
<script src="AsyncFileIO.js"></script>
```

#### 2. "__is_windows is not defined"

**原因**: utils.jsが`AsyncFileIO.js`の前にロードされていない

**解決策**: 上記と同じ

#### 3. "Maximum call stack size exceeded"

**原因**: 無限再帰または循環参照

**解決策**:
- スタックトレースを確認
- 該当するメソッドの実装を確認
- VFSの`_normalizePath`でのパス処理を確認

#### 4. "Storage quota exceeded"

**原因**: VFSストレージが8MBの上限に達した

**解決策**:
```javascript
// ストレージをクリア
chrome.storage.local.remove(['vfs_data', 'vfs_config', 'vfs_stats']);

// または手動でクリーンアップ
afio._vfs.init().then(() => {
  afio._vfs._cleanupOldFiles();
});
```

### デバッグモード

コンソールで詳細なログを確認：

```javascript
// VFSの状態を確認
afio._vfs.init().then(() => {
  console.log('VFS Data:', afio._vfs.data);
  console.log('VFS Stats:', afio._vfs.stats);
  console.log('VFS Config:', afio._vfs.config);
});

// Fallback使用状況を確認
console.log('Using fallback:', afio._useFallback());

// ストレージ使用量を確認
afio.queryLimits().then(limits => {
  console.log('Storage limits:', limits);
});
```

## 継続的インテグレーション（CI）での使用

### 自動化スクリプト例

```bash
#!/bin/bash
# run_tests.sh

echo "Running AsyncFileIO dependency analysis..."
node tests/analyze_afio_dependencies.js /home/user/iMacrosMV3

if [ $? -ne 0 ]; then
  echo "❌ Dependency analysis found warnings"
  exit 1
fi

echo "Opening test runner..."
# Headless Chromeでテストを実行する場合:
# chromium --headless --disable-gpu --screenshot test_runner.html?autorun=true

echo "✅ All checks passed"
```

## 今後の改善案

1. **カバレッジレポート**
   - コードカバレッジの測定
   - 未テストの箇所の特定

2. **パフォーマンステスト**
   - 大量データでの性能測定
   - メモリ使用量の監視

3. **統合テスト**
   - 実際のマクロ実行との統合
   - エンドツーエンドテスト

4. **自動修正サジェスト**
   - エラーパターンに基づく修正案の提示

## 参考資料

- [AsyncFileIO実装ドキュメント](../docs/ASYNC_FILE_IO_IMPLEMENTATION.md)
- [影響範囲調査](../docs/ASYNC_FILE_IO_SURVEY.md)
- [依存関係ドキュメント](../docs/dependencies.md)
- [Fallback考慮事項](../docs/fallback.md)

## サポート

問題が発生した場合：

1. エラーログを確認
2. `afio_analysis_report.json`を確認
3. テストレポートをエクスポート
4. 該当するGitHubイシューを作成（レポート添付）
