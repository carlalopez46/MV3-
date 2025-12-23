# Chrome 永続的ファイルアクセス権限機能との互換性

**作成日**: 2025年11月23日
**対象**: Chrome 120+ (フラグ有効), Chrome 122+ (デフォルト)

---

## 📋 概要

Chrome 122 以降で、File System Access API に新しい永続的権限機能が導入されます。これにより、ユーザーは以下のいずれかを選択できるようになります:

- **One-time permission (一時的権限)**: セッション終了後に権限が失効し、再度プロンプトが必要
- **Persistent permission (永続的権限)**: ユーザーが明示的に取り消すまで権限が保持される

### Chrome フラグによる早期テスト

Chrome 120 以降では、以下のフラグを有効にすることで新機能を早期にテストできます:

```text
chrome://flags/#file-system-access-persistent-permission
chrome://flags/#one-time-permission
```

両方のフラグを **Enabled** に設定してください。

---

## ✅ 互換性分析結果

### 現在の iMacros MV3 実装は互換性があります

**理由:**

1. **既存のハンドル保存メカニズム**
   - `FileSystemAccessService.js` は既に IndexedDB を使用してディレクトリハンドルを保存しています
   - ファイル: `FileSystemAccessService.js:140-151, 341`

2. **適切な権限確認ロジック**
   - `queryPermission()` を使用して権限状態を確認
   - ファイル: `FileSystemAccessService.js:190`

3. **スムーズな権限復元フロー**
   - 保存されたハンドルを読み込み時に自動的に確認
   - ファイル: `FileSystemAccessService.js:265-299`

### 動作フロー (Chrome 122+)

#### シナリオ 1: ユーザーが永続的権限を付与した場合

```text
1. ユーザーがディレクトリを選択 (showDirectoryPicker)
   ↓
2. Chrome が権限プロンプトを表示
   - [One-time] または [Persistent] を選択
   ↓
3. ユーザーが "Persistent" を選択
   ↓
4. ハンドルが IndexedDB に保存される (既存の実装)
   ↓
5. 次回起動時:
   - savedHandle を IndexedDB から読み込み
   - queryPermission(savedHandle) → 'granted' (自動的に!)
   - ユーザーに再プロンプト不要 ✅
```

#### シナリオ 2: ユーザーが一時的権限を選択した場合

```text
1. ユーザーがディレクトリを選択
   ↓
2. Chrome が権限プロンプトを表示
   - ユーザーが "One-time" を選択
   ↓
3. ハンドルが IndexedDB に保存される
   ↓
4. 次回起動時:
   - savedHandle を IndexedDB から読み込み
   - queryPermission(savedHandle) → 'prompt'
   - requestPermission() を呼び出し → ユーザーに再プロンプト
```

---

## 🔧 推奨される改善点

### 優先度: 低 (機能的には問題なし、UX向上のため)

### 1. ドキュメントの更新

**ファイル**: `docs/FILE_SYSTEM_ACCESS_API.md`

現在の記述:
```markdown
File System Access API で選択したディレクトリハンドルは、IndexedDB に永続化されます。
これにより、次回起動時に再度ディレクトリを選択する必要がなくなります。
```

推奨される追記:
```markdown
**Chrome 122+ の永続的権限機能:**

Chrome 122 以降では、ユーザーがディレクトリを選択する際に、永続的アクセス権限を
付与するオプションが表示されます。永続的権限を選択すると、拡張機能を再起動しても
権限プロンプトが表示されなくなり、よりスムーズな体験が得られます。

- **Persistent (永続的)**: 権限が保持され、再プロンプト不要
- **One-time (一時的)**: セッション終了後に権限が失効

早期テスト (Chrome 120+):
- chrome://flags/#file-system-access-persistent-permission を有効化
- chrome://flags/#one-time-permission を有効化
```

### 2. UI メッセージの改善 (任意)

**ファイル**: `fileView.html:37-39`

現在:
```html
Your browser will ask for permission to access the selected directory.
```

改善案:
```html
Your browser will ask for permission to access the selected directory.
<br>
<small style="color: #666;">
  💡 Tip: In Chrome 122+, you can select "Persistent" permission to avoid
  being prompted again on future visits.
</small>
```

### 3. Chrome バージョン検出 (任意)

より高度な UX のために、Chrome バージョンを検出して適切なメッセージを表示できます:

```javascript
// FileSystemAccessService.js または fileView.js に追加可能
function detectChromePersistentPermissionSupport() {
    const match = navigator.userAgent.match(/Chrome\/(\d+)/);
    if (match) {
        const version = parseInt(match[1]);
        return version >= 120; // フラグ有効化可能なバージョン
    }
    return false;
}
```

---

## 🧪 テスト手順

### Chrome 120-121 でのテスト (フラグ使用)

1. **フラグを有効化**
   ```text
   chrome://flags/#file-system-access-persistent-permission → Enabled
   chrome://flags/#one-time-permission → Enabled
   ```

2. **Chrome を再起動**

3. **拡張機能をテスト**
   - File System Access を選択
   - 権限プロンプトで "Persistent" または "One-time" オプションが表示されることを確認

4. **永続的権限のテスト**
   - "Persistent" を選択
   - 拡張機能を再読み込み
   - 権限プロンプトが表示されないことを確認

5. **一時的権限のテスト**
   - chrome://settings/content/fileSystem でサイトの権限をクリア
   - 再度選択時に "One-time" を選択
   - 拡張機能を再読み込み
   - 権限プロンプトが再表示されることを確認

### Chrome 122+ でのテスト (デフォルト)

フラグ設定は不要。上記の手順 3-5 を実行。

---

## 📊 コード影響分析

### 変更不要なファイル

以下のファイルは現在のままで新機能に対応します:

- ✅ `FileSystemAccessService.js` - queryPermission/requestPermission ロジックが適切
- ✅ `WindowsPathMappingService.js` - 同様の権限ロジックを使用
- ✅ `AsyncFileIO.js` - 統合レイヤーは影響なし
- ✅ `fileView.js` - 動作フローは変わらない

### 推奨される変更 (任意)

- 📝 `docs/FILE_SYSTEM_ACCESS_API.md` - ドキュメント更新
- 📝 `fileView.html` - UI メッセージ改善 (UX向上)

---

## 🔍 関連コード箇所

### 権限確認ロジック

**FileSystemAccessService.js:183-226**
```javascript
async _verifyPermission(handle, mode = 'read', options = {}) {
    const permOptions = {};
    if (mode === 'readwrite') {
        permOptions.mode = 'readwrite';
    }

    // 既に許可があるかチェック
    const permissionState = await handle.queryPermission(permOptions);
    if (permissionState === 'granted') {
        return true; // ← 永続的権限の場合、ここで true が返される
    }

    // skipRequest が true の場合は要求しない
    if (options.skipRequest === true) {
        return false;
    }

    // ユーザーに許可を要求
    try {
        const result = await handle.requestPermission(permOptions);
        return result === 'granted';
    } catch (err) {
        return false;
    }
}
```

### 初期化時の権限復元

**FileSystemAccessService.js:265-299**
```javascript
// 保存されたルートディレクトリハンドルを読み込み
const savedHandle = await this._loadDirectoryHandle('rootDirectory');

if (savedHandle) {
    try {
        // 許可を確認
        const hasPermission = await this._verifyPermission(
            savedHandle,
            'readwrite',
            { skipRequest: !this.options.autoPrompt }
        );

        if (hasPermission) {
            // ← 永続的権限の場合、queryPermission が 'granted' を返すため
            //   ここに到達し、再プロンプトなしで復元される
            this.rootHandle = savedHandle;
            this.ready = true;
            return true;
        }
    } catch (err) {
        // エラー処理
    }
}
```

---

## 📈 ユーザー体験の改善

### Chrome 121 以前 (現在の動作)

**既に IndexedDB によるハンドル永続化が実装されています:**

```text
[初回: 拡張機能起動]
  ↓
[ディレクトリ選択プロンプト]
  ↓
[ハンドルを IndexedDB に保存]
  ↓
[ファイルアクセス可能]

[2回目以降: 拡張機能起動]
  ↓
[保存されたハンドルを読み込み]
  ↓
[queryPermission() で権限確認]
  ↓
├─ 権限が保持されている場合 → [プロンプトなしでアクセス復元] ✅
└─ 権限が失効している場合 → [再プロンプト]
```

**注意:** Chrome 121 以前では、権限の永続性は Chrome の内部ヒューリスティクスに依存します。
通常は保持されますが、以下の場合に失効する可能性があります:
- サイトデータのクリア
- 長期間の未使用
- ブラウザのセキュリティポリシー変更

### Chrome 122+ (新機能: 明示的な権限選択)

**ユーザーが権限の持続期間を明示的に選択できます:**

#### シナリオ A: ユーザーが「Persistent (永続的)」を選択

```text
[初回: 拡張機能起動]
  ↓
[ディレクトリ選択プロンプト]
  ↓
[権限ダイアログ: "Persistent" を選択] ← NEW!
  ↓
[ハンドルを IndexedDB に保存]
  ↓
[ファイルアクセス可能]

[2回目以降: 拡張機能起動]
  ↓
[保存されたハンドルを読み込み]
  ↓
[queryPermission() → 'granted'] ← 確実に成功! NEW!
  ↓
[プロンプトなしでアクセス復元] ✅
```

**改善点:** 権限が確実に保持され、予測可能な動作になります。

#### シナリオ B: ユーザーが「One-time (一時的)」を選択

```text
[初回: 拡張機能起動]
  ↓
[ディレクトリ選択プロンプト]
  ↓
[権限ダイアログ: "One-time" を選択] ← NEW!
  ↓
[ハンドルを IndexedDB に保存]
  ↓
[ファイルアクセス可能]

[セッション終了後: 拡張機能起動]
  ↓
[保存されたハンドルを読み込み]
  ↓
[queryPermission() → 'prompt'] ← 権限失効
  ↓
[requestPermission() を呼び出し]
  ↓
[ディレクトリ選択プロンプト再表示]
```

**改善点:** ユーザーが権限の持続期間を明示的にコントロールできます。

### 主な違いのまとめ

| 項目 | Chrome 121 以前 | Chrome 122+ (Persistent) | Chrome 122+ (One-time) |
|------|----------------|-------------------------|------------------------|
| ハンドル保存 | ✅ IndexedDB | ✅ IndexedDB | ✅ IndexedDB |
| 初回プロンプト | ✅ 必要 | ✅ 必要 | ✅ 必要 |
| 権限の永続性 | ⚠️ Chrome が暗黙的に決定 | ✅ ユーザーが取り消すまで保持 | ❌ セッション終了で失効 |
| 2回目以降のプロンプト | ⚠️ 状況により表示される可能性 | ✅ 不要 | ⚠️ セッション毎に必要 |
| ユーザーの選択 | ❌ なし | ✅ 明示的に選択可能 | ✅ 明示的に選択可能 |

---

## 🎯 結論

**現在の iMacros MV3 実装は Chrome の新しい永続的権限機能と完全に互換性があります。**

- ✅ コード変更は不要
- ✅ 既存の queryPermission/requestPermission ロジックが適切に動作
- ✅ IndexedDB によるハンドル保存が機能している
- 📝 ドキュメントとUI改善は任意 (UX向上のため推奨)

ユーザーが永続的権限を選択すれば、より優れたユーザー体験が自動的に提供されます。

---

## 📚 参考資料

- [File System Access API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- [Permissions API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Permissions_API)
- Chrome Release Notes (Chrome 122+での変更点)

---

**最終更新**: 2025年11月23日
