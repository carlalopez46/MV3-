# RUN コマンド ガイド

iMacros MV3 での RUN コマンドの完全ガイドです。

## 目次

1. [基本的な使い方](#基本的な使い方)
2. [変数スコープ](#変数スコープ)
3. [ネストの制限](#ネストの制限)
4. [パス解決](#パス解決)
5. [マクロチェーンの例](#マクロチェーンの例)
6. [エラーハンドリング](#エラーハンドリング)
7. [ベストプラクティス](#ベストプラクティス)

---

## 基本的な使い方

### 構文

```iim
RUN <マクロ名>
```

### 例

```iim
' メインマクロ
VERSION BUILD=10.1.1
RUN login.iim
RUN process_data.iim
RUN logout.iim
```

### パラメータ

| パラメータ | 説明 | 例 |
|-----------|------|-----|
| マクロ名 | 実行するマクロファイルのパス | `subfolder/macro.iim` |

---

## 変数スコープ

### グローバル変数（!VAR0 〜 !VAR9）

`!VAR0` から `!VAR9` は**グローバルスコープ**を持ち、RUNで呼び出されたマクロ間で値が共有されます。

```iim
' parent.iim
SET !VAR1 "Hello"
RUN child.iim
' !VAR1 は child.iim で変更された値を保持

' child.iim
SET !VAR1 "World"
' 親マクロに戻ると !VAR1 = "World"
```

### ローカル変数（ユーザー定義変数）

`SET` コマンドで定義したユーザー変数は、デフォルトでは**呼び出し元のスコープに制限**されます。

```iim
' parent.iim
SET myVar "Parent Value"
RUN child.iim
' myVar は child.iim の変更の影響を受けない可能性あり
' (実装により異なる)
```

### 変数のスコープ図

```
┌─────────────────────────────────────────┐
│           グローバルスコープ              │
│  !VAR0, !VAR1, ... !VAR9                │
│  !EXTRACT, !FILETYPE, !TIMEOUT など     │
│  !LOOP (ループカウンター)                │
├─────────────────────────────────────────┤
│           マクロスコープ                 │
│  RUN によって分離されるローカル変数       │
│  (VariableManager による管理)            │
└─────────────────────────────────────────┘
```

---

## ネストの制限

### 最大ネストレベル

RUN コマンドによるマクロの入れ子呼び出しには**最大深度制限**があります：

| 設定 | 値 |
|------|-----|
| 最大ネストレベル | 100 |
| 設定場所 | `mplayer.js` |

### エラーメッセージ

ネスト深度を超えた場合：
```
Error: Maximum macro nesting level (100) exceeded
```

### 例：過剰なネスト

```iim
' a.iim
RUN b.iim

' b.iim  
RUN c.iim

' c.iim
RUN d.iim
' ... 100回を超えるとエラー
```

---

## パス解決

### 相対パス

RUN コマンドでは**相対パス**を使用できます。パスは現在のマクロファイルの場所を基準に解決されます。

```iim
' Macros/main.iim から実行
RUN subfolder/helper.iim    ' → Macros/subfolder/helper.iim
RUN ../other/macro.iim      ' → other/macro.iim
```

### 絶対パス

Windows 絶対パスも使用できます（File System Access API 経由）：

```iim
RUN C:\Users\User\Documents\iMacros\Macros\test.iim
```

### パス解決の優先順位

1. **相対パス** → 現在のマクロからの相対位置
2. **Macros フォルダ** → 設定された Macros ディレクトリ
3. **絶対パス** → そのまま使用

---

## マクロチェーンの例

### 例1: ログイン → 処理 → ログアウト

```iim
' main.iim - メインオーケストレーター
VERSION BUILD=10.1.1

' 共通変数を設定
SET !VAR1 "username"
SET !VAR2 "password"

' ログイン処理
RUN modules/login.iim

' データ処理（複数ページ）
SET !LOOP 1
SET !LOOP_MAX 10
LOOP_START:
RUN modules/process_page.iim
SET !LOOP {{!LOOP}}+1
GOTO LOOP_START IF {{!LOOP}} <= {{!LOOP_MAX}}

' ログアウト
RUN modules/logout.iim
```

```iim
' modules/login.iim
URL GOTO=https://example.com/login
TAG POS=1 TYPE=INPUT:TEXT ATTR=NAME:username CONTENT={{!VAR1}}
TAG POS=1 TYPE=INPUT:PASSWORD ATTR=NAME:password CONTENT={{!VAR2}}
TAG POS=1 TYPE=BUTTON ATTR=TYPE:submit
WAIT SECONDS=2
```

### 例2: エラーハンドリング付きチェーン

```iim
' robust_main.iim
VERSION BUILD=10.1.1
SET !ERRORIGNORE YES
SET !TIMEOUT_STEP 30

RUN step1.iim
SET result1 {{!EXTRACT}}

' step1 の結果をチェック
PROMPT "Step 1 result: {{result1}}"

RUN step2.iim  
SET result2 {{!EXTRACT}}

RUN step3.iim
```

### 例3: 条件分岐付きチェーン

```iim
' conditional_main.iim
VERSION BUILD=10.1.1

' 初期チェック
RUN check_login_status.iim
SET loginStatus {{!EXTRACT}}

' 条件によって異なるマクロを実行
' (SET + EVAL を使用)
SET !VAR1 EVAL("'{{loginStatus}}' === 'logged_in' ? 'dashboard.iim' : 'login.iim'")
RUN {{!VAR1}}
```

---

## エラーハンドリング

### RUN 実行時のエラー

| エラーコード | 説明 | 対処法 |
|-------------|------|--------|
| 720 | マクロファイルが見つからない | パスを確認 |
| 721 | 読み取りエラー | ファイル権限を確認 |
| 730 | ネスト深度超過 | マクロ構造を見直す |
| 740 | 構文エラー | 呼び出し先マクロを確認 |

### エラー無視設定

```iim
' エラーを無視して続行
SET !ERRORIGNORE YES
RUN possibly_failing_macro.iim
SET !ERRORIGNORE NO
```

---

## ベストプラクティス

### 1. モジュール化

```
Macros/
├── main.iim              # エントリーポイント
├── config.iim            # 共通設定
├── modules/
│   ├── login.iim
│   ├── logout.iim
│   ├── navigation.iim
│   └── data_entry.iim
└── utilities/
    ├── wait_for_element.iim
    └── error_handler.iim
```

### 2. 変数の命名規則

```iim
' グローバル変数には明確なプレフィックスを使用
SET !VAR1 "{{G_USERNAME}}"      ' G_ = グローバル
SET !VAR2 "{{G_PASSWORD}}"

' ローカル変数には用途を明示
SET localCounter 0
SET pageTitle ""
```

### 3. コメントによるドキュメント

```iim
' ========================================
' マクロ名: process_order.iim
' 目的: 注文処理の自動化
' 依存: login.iim が事前に実行されていること
' 入力: !VAR1 = 注文ID
' 出力: !EXTRACT = 処理結果
' ========================================
```

### 4. エラー時の回復

```iim
SET !ERRORIGNORE YES
RUN risky_operation.iim
SET errorOccurred {{!ERRORCODE}}
SET !ERRORIGNORE NO

' エラーチェック
SET shouldRecover EVAL("{{errorOccurred}} !== 0")
' 必要に応じて回復処理
```

---

## 関連リソース

- [LOOP NEST 構文](./LOOP_SYNTAX.md)
- [Windows パスマッピング](./WINDOWS_PATH_MAPPING.md)
- [File System Access API](./FILE_SYSTEM_ACCESS_API.md)

---

**最終更新**: 2025-12-08
