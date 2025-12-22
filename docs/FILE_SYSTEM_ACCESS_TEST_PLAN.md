# File System Access API - 包括的テスト・修正計画

## プロジェクト概要

iMacros MV3拡張機能のFile System Access API機能を完全に完成させるための包括的なテスト駆動型の修正計画。

**作成日**: 2025年11月20日
**目標**: すべてのエラーを特定し、体系的に修正し、安定した動作を実現する

---

## 現在の実装状況

### ✅ 完了した作業

1. **エラーロギングシステムの構築**
   - `GlobalErrorLogger.js` を作成
   - すべてのエラーを記録し、ファイル名、行番号、スタックトレースを取得
   - エラーカテゴリ分類と重要度レベルの判定
   - レポートのエクスポート機能

2. **テストスイートの作成**
   - `filesystem_access_test_suite.js` - File System Access API専用テスト
   - `afio_test_suite.js` - AsyncFileIO統合テスト（既存）
   - `integrated_test_runner.html` - 統合テストランナーUI

3. **エラーロギングの統合**
   - `FileSystemAccessService.js` に部分的にエラーロギングを追加
   - 主要な初期化メソッドにtry-catchとロギング

4. **ドキュメント整備**
   - 既存: `FILE_SYSTEM_ACCESS_API.md`
   - 既存: `WINDOWS_PATH_MAPPING.md`
   - 新規: このテスト計画ドキュメント

---

## ファイル構造マップ

### コア実装ファイル (798 + 415 + 855 = 2,068行)

```
📁 /home/user/iMacrosMV3/
├── FileSystemAccessService.js (798行)
│   └── File System Access API の主要実装
├── WindowsPathMappingService.js (415行)
│   └── Windowsパスマッピング機能
├── AsyncFileIO.js (855行)
│   └── 統合レイヤー（Native/FS Access/Virtual）
├── VirtualFileService.js (734行)
│   └── 仮想ファイルシステム（フォールバック）
└── FileSyncBridge.js (208行)
    └── ファイル同期ブリッジ
```

### テスト関連ファイル

```
📁 tests/
├── filesystem_access_test_suite.js (新規作成)
│   └── FS Access API専用テスト（35個のテスト）
├── afio_test_suite.js (既存)
│   └── AsyncFileIO統合テスト（60個以上のテスト）
├── test_windows_path_mapping.html (既存)
│   └── 手動テスト用UI
└── integrated_test_runner.html (新規作成)
    └── 統合テストランナー
```

### ユーティリティ

```
📁 /home/user/iMacrosMV3/
└── GlobalErrorLogger.js (新規作成)
    └── グローバルエラートラッキングシステム
```

---

## 主要機能の依存関係マップ

### 機能1: FileSystemAccessService

**依存関係:**
- Browser API: File System Access API (showDirectoryPicker, etc.)
- IndexedDB: ディレクトリハンドルの永続化
- WindowsPathMappingService: Windowsパス対応

**依存される側:**
- AsyncFileIO (afio)
- mplayer.js (DATASOURCE, SAVEAS)
- editor/saveAsDialog.js

**主要メソッド (25個):**
1. `init()` - 初期化
2. `promptForDirectory()` - ディレクトリ選択
3. `readTextFile(path)` - テキストファイル読み込み
4. `writeTextFile(path, data)` - テキストファイル書き込み
5. `appendTextFile(path, data)` - テキストファイル追記
6. `makeDirectory(path)` - ディレクトリ作成
7. `remove(path)` - 削除
8. `moveTo(src, dst)` - 移動/リネーム
9. `getNodesInDir(path, filter)` - ディレクトリ内容取得
10. `node_exists(path)` - 存在確認
11. `node_isDir(path)` - ディレクトリ判定
12. `_resolvePathAndHandle(path)` - パス解決（重要！）
13. `_getFileHandle(path, create)` - ファイルハンドル取得
14. `_getDirectoryHandle(path, create)` - ディレクトリハンドル取得
15. `_splitPath(path)` - パス分割
16. `_joinPath(base, ...parts)` - パス結合
17. `_isWindowsAbsolutePath(path)` - Windowsパス判定
18. `_verifyPermission(handle, mode)` - 権限確認
19. `_initDB()` - IndexedDB初期化
20. `_saveDirectoryHandle(key, handle)` - ハンドル保存
21. `_loadDirectoryHandle(key)` - ハンドル読み込み
22. `writeImageToFile(path, data)` - 画像ファイル書き込み
23. `getFileInfo(path)` - ファイル情報取得
24. `addWindowsPathMapping(path)` - Windowsパスマッピング追加
25. `getAllWindowsPathMappings()` - マッピング一覧取得

### 機能2: WindowsPathMappingService

**依存関係:**
- Browser API: File System Access API
- IndexedDB: パスマッピングの永続化

**依存される側:**
- FileSystemAccessService

**主要メソッド (11個):**
1. `init()` - 初期化
2. `promptForPath(windowsPath)` - パスマッピング追加
3. `resolveWindowsPath(path)` - パス解決（最重要！）
4. `getMapping(windowsPath)` - マッピング取得
5. `removeMapping(windowsPath)` - マッピング削除
6. `clearAllMappings()` - 全マッピング削除
7. `getAllMappings()` - マッピング一覧取得
8. `_initDB()` - IndexedDB初期化
9. `_loadAllMappings()` - 全マッピング読み込み
10. `_saveMappingToDB(path, mapping)` - マッピング保存
11. `_verifyPermission(handle, mode)` - 権限確認

### 機能3: AsyncFileIO統合

**バックエンド検出フロー:**
```
detectNativeHost()
  ↓ (失敗)
detectFileSystemAccess()
  ↓ (失敗)
ensureFallbackInitialized() → VirtualFileService
```

**callFileIO メソッドのルーティング:**
```
callFileIO(method, payload)
  ↓
backend === NATIVE → callNative()
  ↓ (失敗)
backend === FILESYSTEM_ACCESS → callFsAccess()
  ↓ (失敗)
backend === VIRTUAL → callFallback()
```

※ File System Access のハンドルが検出されているが権限が不足している場合は、バックエンドを保持したまま VirtualFileService を初期化し、後続の権限回復をブロックしないようにする。

---

## テスト計画

### Phase 1: ブラウザサポートテスト（クリティカル）

**目的**: ブラウザの互換性確認

**テスト項目:**
1. ✅ File System Access API サポート検出
2. ✅ WindowsPathMappingService サポート検出
3. ✅ IndexedDB 利用可能性

**期待される結果:**
- Chrome 86+ では全てサポート
- それ以外のブラウザではエラーメッセージ

### Phase 2: 初期化テスト（クリティカル）

**目的**: サービスの正常な初期化

**テスト項目:**
1. ✅ FileSystemAccessService コンストラクタ
2. ✅ WindowsPathMappingService コンストラクタ
3. ✅ IndexedDB 初期化
4. ⚠️  保存されたハンドルの復元
5. ⚠️  権限の検証

**既知の潜在的問題:**
- IndexedDBのブラウザ制限
- 保存されたハンドルの有効期限
- 権限の自動失効

### Phase 3: パス処理テスト（高優先度）

**目的**: パスの正規化と解決の正確性

**テスト項目:**
1. ✅ Windowsパス検出 (`C:\`, `D:\`)
2. ✅ 仮想パス検出 (`/VirtualMacros/`)
3. ✅ パス分割 (`_splitPath`)
4. ✅ パス結合 (`_joinPath`)
5. ⚠️  Windowsパス正規化
6. ⚠️  親パス検出
7. ⚠️  相対パス計算

**既知の潜在的問題:**
- バックスラッシュとスラッシュの混在
- 大文字小文字の処理
- 末尾のスラッシュ処理

### Phase 4: ファイル操作テスト（高優先度）

**目的**: 基本的なファイル操作の動作確認

**テスト項目:**
1. ⚠️  ファイル読み込み (`readTextFile`)
2. ⚠️  ファイル書き込み (`writeTextFile`)
3. ⚠️  ファイル追記 (`appendTextFile`)
4. ⚠️  ファイル削除 (`remove`)
5. ⚠️  ファイル移動 (`moveTo`)
6. ⚠️  ファイル存在確認 (`node_exists`)

**前提条件:**
- ユーザーがディレクトリを選択している必要がある
- 権限が付与されている必要がある

### Phase 5: ディレクトリ操作テスト（中優先度）

**目的**: ディレクトリ操作の動作確認

**テスト項目:**
1. ⚠️  ディレクトリ作成 (`makeDirectory`)
2. ⚠️  ディレクトリ一覧取得 (`getNodesInDir`)
3. ⚠️  ネストされたディレクトリ作成
4. ⚠️  フィルタリング機能

### Phase 6: Windowsパスマッピングテスト（高優先度）

**目的**: Windowsパスマッピングの動作確認

**テスト項目:**
1. ⚠️  パスマッピング追加
2. ⚠️  パスマッピング解決 (`resolveWindowsPath`)
3. ⚠️  親パスの自動解決
4. ⚠️  マッピング永続化
5. ⚠️  マッピング削除
6. ⚠️  複数マッピングの管理

**既知の潜在的問題:**
- マッピングなしでのアクセス試行
- 親パス解決の論理エラー
- 権限の失効

### Phase 7: AsyncFileIO統合テスト（高優先度）

**目的**: AsyncFileIOとの統合動作確認

**テスト項目:**
1. ✅ バックエンド検出
2. ⚠️  バックエンド切り替え
3. ⚠️  フォールバック機能
4. ⚠️  Windowsパスでのafio操作
5. ⚠️  仮想パスでのafio操作

### Phase 8: エラーハンドリングテスト（中優先度）

**目的**: エラー処理の正確性

**テスト項目:**
1. ⚠️  存在しないファイルへのアクセス
2. ⚠️  マッピングなしのWindowsパス
3. ⚠️  権限エラー
4. ⚠️  IndexedDBエラー
5. ⚠️  無効なパス形式

### Phase 9: 実際の使用シナリオテスト（高優先度）

**目的**: 実際のマクロ実行での動作確認

**テスト項目:**
1. ⚠️  DATASOURCE コマンドでのファイル読み込み
2. ⚠️  SAVEAS コマンドでのファイル保存
3. ⚠️  Windowsパスでのマクロ実行
4. ⚠️  仮想パスでのマクロ実行
5. ⚠️  ディレクトリ自動作成

---

## エラーカテゴリと優先順位

### 🔴 クリティカル（システムが動作しない）

1. **ブラウザサポートエラー**
   - File System Access API未サポート
   - IndexedDB未サポート

2. **初期化エラー**
   - IndexedDB初期化失敗
   - WindowsPathMappingService初期化失敗

### 🟠 高優先度（主要機能が動作しない）

1. **パス解決エラー**
   - `_resolvePathAndHandle` での例外
   - Windowsパスマッピング失敗
   - 親パス検出ロジックのバグ

2. **ファイル操作エラー**
   - ファイルハンドル取得失敗
   - 読み書き操作の失敗
   - 権限エラー

3. **統合エラー**
   - AsyncFileIOからの呼び出しエラー
   - バックエンド切り替え失敗

### 🟡 中優先度（一部機能に影響）

1. **ディレクトリ操作エラー**
   - ディレクトリ作成失敗
   - 一覧取得の不具合

2. **エラーメッセージの不明瞭さ**
   - ユーザーフレンドリーでないエラー

3. **エッジケース**
   - 特殊文字を含むパス
   - 非常に長いパス
   - 同時アクセス

### 🟢 低優先度（軽微な問題）

1. **パフォーマンス**
   - 不要な再初期化
   - キャッシュの欠如

2. **ログの不足**
   - デバッグ情報の不足

---

## テスト実行手順

### ステップ1: 環境準備

```bash
# ブラウザで開く
# Chrome/Edge 86以降を使用
# file:// プロトコルではFile System Access APIが動作しない
# http-server などでローカルサーバーを起動するか、
# 拡張機能としてロードする
```

### ステップ2: テストランナーを開く

```
1. tests/integrated_test_runner.html をブラウザで開く
2. 「Run All Tests」ボタンをクリック
3. 必要に応じてディレクトリ選択ダイアログが表示される
4. テスト結果を確認
```

### ステップ3: エラーレポートを確認

```
1. テスト完了後、「Export Error Report」をクリック
2. JSONファイルがダウンロードされる
3. エラーを分析:
   - エラーカテゴリ
   - 発生頻度
   - ファイル・行番号
   - スタックトレース
```

### ステップ4: エラーの優先順位付け

```
1. クリティカルエラーを最初に修正
2. 高優先度エラーを次に修正
3. テストを再実行して確認
4. すべてのテストがパスするまで繰り返す
```

---

## 修正の進め方

### 原則

1. **テスト駆動**: 修正前にテストを実行し、何が壊れているかを正確に把握
2. **小さな変更**: 一度に大きな変更をせず、小さな修正を積み重ねる
3. **影響範囲の確認**: 修正が他の機能に影響しないか確認
4. **テストで検証**: 修正後に必ずテストを再実行

### 修正のテンプレート

```javascript
// 1. try-catchでエラーをキャッチ
try {
    // 既存のコード
} catch (err) {
    // 2. エラーをログに記録
    logError('ModuleName.methodName', err, {
        // 3. コンテキスト情報を追加
        parameter1: value1,
        parameter2: value2,
        severity: 'HIGH' // または 'CRITICAL', 'MEDIUM', 'LOW'
    });

    // 4. 適切なエラー処理
    throw err; // または return null; など
}
```

### エラー修正のチェックリスト

- [ ] エラーの原因を特定したか？
- [ ] 修正がその原因に対処しているか？
- [ ] 修正が他の機能に影響しないか？
- [ ] エラーロギングを追加したか？
- [ ] テストを再実行したか？
- [ ] テストがパスしたか？
- [ ] ドキュメントを更新したか？

---

## 期待される結果

### 最終目標

1. **すべてのテストがパス**
   - 統合テストランナーで100%のテスト成功率
   - エラーレポートにクリティカル・高優先度エラーが0件

2. **実際のマクロ実行で動作**
   - DATASOURCEコマンドが正常に動作
   - SAVEASコマンドが正常に動作
   - Windowsパスと仮想パスの両方で動作

3. **包括的なエラー追跡**
   - すべてのエラーが記録される
   - エラーレポートが詳細な情報を含む

---

## 次のステップ

### 即座に実行すべきこと

1. **テストを実行**
   ```
   tests/integrated_test_runner.html を開いて
   「Run All Tests」をクリック
   ```

2. **エラーレポートを分析**
   - どのテストが失敗したか
   - どのエラーカテゴリが多いか
   - どのファイル・関数でエラーが発生したか

3. **修正計画を立てる**
   - クリティカルエラーから優先的に修正
   - 修正の影響範囲を確認
   - 修正後の検証方法を決定

### 長期的な改善

1. **継続的なテスト**
   - 新機能追加時は必ずテストを追加
   - リグレッションテストの自動化

2. **ドキュメント整備**
   - API仕様書の作成
   - トラブルシューティングガイド

3. **パフォーマンス最適化**
   - キャッシング機構の追加
   - 不要な再初期化の削減

---

## ファイル別の修正必要箇所（予想）

### FileSystemAccessService.js

**高優先度:**
- [ ] `_resolvePathAndHandle()` - Windowsパス解決の例外処理
- [ ] `_getFileHandle()` - NotFoundErrorの適切な処理
- [ ] `readTextFile()` - エラーメッセージの改善
- [ ] `writeTextFile()` - 権限エラーの処理

**中優先度:**
- [ ] `_splitPath()` - エッジケースの処理
- [ ] `_joinPath()` - Windowsパスとの互換性
- [ ] `makeDirectory()` - 親ディレクトリの自動作成

### WindowsPathMappingService.js

**高優先度:**
- [ ] `resolveWindowsPath()` - マッピングなしのエラーメッセージ
- [ ] `getMapping()` - 親パス解決のロジック
- [ ] `_verifyPermission()` - 権限失効時の処理

**中優先度:**
- [ ] `normalizeWindowsPath()` - エッジケースの処理
- [ ] `isParentPath()` - 論理エラーの確認

### AsyncFileIO.js

**高優先度:**
- [ ] `callFsAccess()` - メソッドルーティングの例外処理
- [ ] `ensureFileSystemAccessInitialized()` - 初期化失敗時の処理

**中優先度:**
- [ ] `detectFileSystemAccess()` - 検出ロジックの改善
- [ ] バックエンド切り替え時のエラー処理

---

## まとめ

このテスト駆動型のアプローチにより、以下が達成される予定です：

1. ✅ **完全な可視性**: すべてのエラーが記録され、追跡可能
2. ✅ **体系的な修正**: 優先順位に基づいた効率的な修正
3. ✅ **品質保証**: テストによる継続的な検証
4. ✅ **ドキュメント化**: 問題と解決策の記録

**次のアクション**: テストを実行し、結果に基づいて修正を開始する。
