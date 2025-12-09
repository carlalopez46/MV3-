# iMacros MV3 - FILESタブ機能テスト手順

## 前提条件
- Chrome 86以降のブラウザ
- iMacros MV3拡張機能がインストール済み

## テスト手順

### 1. File System Access APIの有効化

1. Chrome拡張機能のアイコンをクリックしてiMacrosパネルを開く
2. 上部の「Files」タブが選択されていることを確認
3. 青いバナーに「📁 Using virtual storage (8MB limit). Access your local filesystem instead」というメッセージが表示される
4. 「**Access your local filesystem instead**」リンクをクリック
5. ブラウザのディレクトリ選択ダイアログが表示される
6. テスト用のローカルフォルダを選択（例：`C:\iMacrosTest`または`~/iMacrosTest`）
7. 「フォルダーの表示」または「Select」ボタンをクリックして許可

**期待結果**:
- 青いバナーが消える
- TreeViewに選択したフォルダの内容が表示される（空の場合は何も表示されない）

### 2. #Current.iimへの記録テスト

1. パネル上部の「Record」タブをクリック
2. 「Record Macro」ボタンをクリック
3. ブラウザで簡単な操作を実行（例：リンクをクリック、テキストを入力）
4. 「Stop」ボタンをクリックして記録を停止

**期待結果**:
- エディタが開き、記録されたマクロが表示される
- ファイル名が「#Current.iim」になっている
- ファイルが選択したローカルフォルダに保存される

### 3. TreeViewでのファイル表示テスト

1. エディタを閉じる
2. iMacrosパネルの「Files」タブを確認
3. TreeViewに「#Current.iim」が表示されることを確認

**期待結果**:
- #Current.iimがTreeViewのトップに表示される（#は他の文字より優先される）
- ファイルをクリックして選択できる

### 4. 追加の.iimファイル配置テスト

1. ローカルフォルダに手動でいくつかの.iimファイルを作成
   - 例：Test1.iim, Test2.iim, Subfolder/Test3.iim
2. 各ファイルに簡単なマクロコードを記述：
   ```
   VERSION BUILD=12.0.0
   TAB T=1
   URL GOTO=https://www.example.com
   ```
3. iMacrosパネルを再度開く、またはTreeViewを更新

**期待結果**:
- すべての.iimファイルがTreeViewに表示される
- サブフォルダがある場合、フォルダ階層が正しく表示される
- ファイルがアルファベット順にソートされている（#が最初）

### 5. マクロ再生テスト

1. TreeViewから任意の.iimファイルを選択
2. 「Play」タブをクリック
3. 「Play Macro」ボタンをクリック

**期待結果**:
- マクロが正常に実行される
- エラーが発生しない

### 6. 編集機能テスト

1. TreeViewから任意の.iimファイルを選択
2. 「Manage」タブをクリック
3. 「Edit Macro」ボタンをクリック
4. エディタでマクロコードを編集
5. 保存して閉じる
6. 再度同じファイルを開いて変更が保存されていることを確認

**期待結果**:
- エディタでファイルが正しく読み込まれる
- 編集内容が正常に保存される
- 保存後、ローカルファイルシステムのファイルも更新されている

## トラブルシューティング

### ディレクトリ選択後もTreeViewが空のまま
- ブラウザコンソール（F12）を開いてエラーを確認
- ディレクトリの読み取り/書き込み権限があるか確認

### #Current.iimが表示されない
- ブラウザコンソールでエラーログを確認
- FileSystemAccessService.jsが正しくロードされているか確認

### マクロ再生が失敗する
- .iimファイルの構文が正しいか確認
- ブラウザコンソールでエラーログを確認

## デバッグ情報の確認

ブラウザコンソール（F12）で以下のコマンドを実行して現在の状態を確認：

```javascript
// バックエンドタイプの確認
afio.getBackendType()
// 'native', 'filesystem-access', 'virtual', 'unknown' のいずれか

// File System Access APIのサポート確認
afio.isFileSystemAccessSupported()

// インストール状態の確認
afio.isInstalled()
```

## 成功基準

以下すべてが正常に動作すること：
- ✅ File System Access APIでローカルディレクトリを選択できる
- ✅ #Current.iimがローカルフォルダに記録される
- ✅ TreeViewにすべての.iimファイルが表示される
- ✅ .iimファイルの再生が成功する
- ✅ .iimファイルの編集と保存が成功する
