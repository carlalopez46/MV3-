# 変数スコープ ガイド

iMacros MV3 における変数のスコープ（有効範囲）と管理について説明します。

## 目次

1. [変数の種類](#変数の種類)
2. [スコープのルール](#スコープのルール)
3. [RUN コマンドと変数スコープ](#run-コマンドと変数スコープ)
4. [LOOP と変数](#loop-と変数)
5. [データソース変数](#データソース変数)
6. [ベストプラクティス](#ベストプラクティス)

---

## 変数の種類

### 1. システム変数（ビルトイン）

iMacros が自動的に管理する変数です。

| 変数 | スコープ | 説明 |
|------|---------|------|
| `!LOOP` | グローバル | 現在のループカウンター |
| `!LOOP1` 〜 `!LOOP10` | グローバル | ネストループカウンター |
| `!EXTRACT` | グローバル | 抽出されたデータ |
| `!ERRORCODE` | グローバル | 最後のエラーコード |
| `!TIMEOUT` | グローバル | ページ読み込みタイムアウト |
| `!TIMEOUT_STEP` | グローバル | ステップタイムアウト |
| `!FILESTOPWATCH` | グローバル | ストップウォッチファイル |

### 2. グローバル変数（!VAR0 〜 !VAR9）

マクロ間で値を共有できる変数です。

```iim
SET !VAR1 "共有される値"
RUN other_macro.iim
' other_macro.iim で !VAR1 の値を参照・変更可能
```

### 3. ユーザー定義変数

`SET` コマンドで定義する任意の変数です。

```iim
SET myVariable "ローカル値"
SET counter 0
SET userName "John"
```

### 4. データソース変数（!COL1 〜 !COLn）

CSV ファイルから読み込まれる列データです。

```iim
SET !DATASOURCE data.csv
SET !DATASOURCE_LINE 1
' !COL1, !COL2, ... で各列にアクセス
```

---

## スコープのルール

### グローバルスコープ

以下の変数は**常にグローバル**です：

- `!VAR0` 〜 `!VAR9`
- `!LOOP` 系変数
- `!EXTRACT`
- `!ERROR*` 系変数
- データソース変数（`!COL*`）

```
┌─────────────────────────────────────────────────────────────┐
│                     グローバルスコープ                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ !VAR0, !VAR1, ..., !VAR9                            │   │
│  │ !EXTRACT, !LOOP, !LOOP1...!LOOP10                   │   │
│  │ !ERRORCODE, !ERRORIGNORE                            │   │
│  │ !COL1, !COL2, ..., !COLn                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↑ ↓                               │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │   main.iim      │──│  sub.iim        │                  │
│  │   (RUN sub.iim) │  │  (変数を共有)    │                  │
│  └─────────────────┘  └─────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

### ローカルスコープ

ユーザー定義変数は、定義されたマクロ内でのみ有効です（実装による）。

```iim
' main.iim
SET localVar "親マクロの値"
RUN child.iim
PROMPT "localVar = {{localVar}}"  ' "親マクロの値" のまま

' child.iim  
SET localVar "子マクロの値"
' このスコープ内でのみ有効
```

---

## RUN コマンドと変数スコープ

### 値の受け渡しパターン

#### パターン1: グローバル変数を使用（推奨）

```iim
' caller.iim
SET !VAR1 "入力パラメータ"
SET !VAR2 "もう一つのパラメータ"
RUN callee.iim
SET result {{!VAR3}}  ' callee.iim が設定した結果を取得

' callee.iim
PROMPT "受け取った値: {{!VAR1}}"
' 処理を実行
SET !VAR3 "処理結果"
```

#### パターン2: EXTRACT を使用

```iim
' caller.iim
RUN extractor.iim
SET extractedValue {{!EXTRACT}}

' extractor.iim
TAG POS=1 TYPE=DIV ATTR=ID:result EXTRACT=TXT
' !EXTRACT に値が設定される
```

#### パターン3: データソースを使用

```iim
' main.iim
SET !DATASOURCE config.csv
SET !DATASOURCE_LINE 1
RUN process.iim

' process.iim
' !COL1, !COL2 などでデータにアクセス
TAG POS=1 TYPE=INPUT ATTR=NAME:field1 CONTENT={{!COL1}}
```

### 変数の隔離が必要な場合

```iim
' 変数を保存
SET savedVar1 {{!VAR1}}
SET savedVar2 {{!VAR2}}

' 子マクロを実行（!VAR1, !VAR2 を変更する可能性あり）
RUN potentially_modifying_macro.iim

' 変数を復元
SET !VAR1 {{savedVar1}}
SET !VAR2 {{savedVar2}}
```

---

## LOOP と変数

### 単純ループ

```iim
SET !LOOP 1
SET !LOOP_MAX 5

:LOOP_START
PROMPT "ループ回数: {{!LOOP}}"
SET !LOOP {{!LOOP}}+1
SET continueLoop EVAL("{{!LOOP}} <= {{!LOOP_MAX}}")
GOTO LOOP_START IF {{continueLoop}} == true
```

### ネストループ（LOOP NEST）

```iim
LOOP NEST 3
    ' 外側ループ: !LOOP1 = 1, 2, 3
    LOOP NEST 2
        ' 内側ループ: !LOOP2 = 1, 2
        PROMPT "外側={{!LOOP1}}, 内側={{!LOOP2}}"
    LOOP
LOOP
```

### ループ変数の参照

| 変数 | 説明 |
|------|------|
| `!LOOP` | 現在の最も内側のループカウンター |
| `!LOOP1` | 最初の（最外側の）ネストループ |
| `!LOOP2` | 2番目のネストループ |
| ... | ... |
| `!LOOP10` | 最大10レベルまで |

---

## データソース変数

### 基本的な使用法

```iim
' data.csv の内容:
' name,email,phone
' John,john@example.com,123-456-7890
' Jane,jane@example.com,098-765-4321

SET !DATASOURCE data.csv
SET !DATASOURCE_LINE 1      ' ヘッダーをスキップ

:NEXT_ROW
SET !DATASOURCE_LINE {{!DATASOURCE_LINE}}+1

' 各列にアクセス
TAG POS=1 TYPE=INPUT ATTR=NAME:name CONTENT={{!COL1}}
TAG POS=1 TYPE=INPUT ATTR=NAME:email CONTENT={{!COL2}}
TAG POS=1 TYPE=INPUT ATTR=NAME:phone CONTENT={{!COL3}}

' 次の行へ
GOTO NEXT_ROW
```

### データソース変数一覧

| 変数 | 説明 |
|------|------|
| `!DATASOURCE` | CSV ファイルパス |
| `!DATASOURCE_LINE` | 現在の行番号（1始まり） |
| `!DATASOURCE_COLUMNS` | 列数 |
| `!COL1` 〜 `!COLn` | 各列の値 |

### RUN とデータソース

```iim
' 親マクロでデータソースを設定
SET !DATASOURCE master_data.csv
SET !DATASOURCE_LINE 5

' 子マクロでも同じデータソースにアクセス可能
RUN process_row.iim
' process_row.iim 内で !COL1 などを使用可能
```

---

## ベストプラクティス

### 1. 明確な命名規則

```iim
' グローバル入力パラメータ
SET !VAR1 "{{INPUT_USERNAME}}"
SET !VAR2 "{{INPUT_PASSWORD}}"

' グローバル出力
SET !VAR9 ""  ' 結果格納用

' ローカル変数
SET local_counter 0
SET local_tempValue ""
```

### 2. 変数の初期化

```iim
' マクロの先頭で変数を初期化
SET !VAR1 ""
SET !VAR2 ""
SET !EXTRACT ""
SET counter 0
SET errorFlag NO
```

### 3. 入出力の文書化

```iim
' ========================================
' マクロ名: process_order.iim
' 
' 入力 (グローバル):
'   !VAR1 = 注文ID
'   !VAR2 = 顧客ID  
'
' 出力 (グローバル):
'   !VAR3 = 処理結果 ("SUCCESS" or "FAILURE")
'   !EXTRACT = 詳細メッセージ
' ========================================
```

### 4. エラー時の変数クリーンアップ

```iim
SET !ERRORIGNORE YES
TAG POS=1 TYPE=* ATTR=ID:result EXTRACT=TXT
SET !ERRORIGNORE NO

' エラーチェック
SET hadError EVAL("{{!ERRORCODE}} !== 0")
' エラー時は変数をクリア
SET !EXTRACT EVAL("{{hadError}} ? '#ERROR#' : '{{!EXTRACT}}'")
```

### 5. デバッグ用の変数ダンプ

```iim
' デバッグモード
SET debugMode YES

' 変数の値を確認
PROMPT "!VAR1={{!VAR1}}, !VAR2={{!VAR2}}, counter={{counter}}" IF {{debugMode}} == YES
```

---

## トラブルシューティング

### 問題: 変数が期待通りに更新されない

**原因**: 変数名のスペルミス、または異なるスコープ

**対処**:
```iim
' 変数名を確認
PROMPT "変数値: {{variableName}}"

' 正確な名前を使用しているか確認
' variableName ≠ VariableName ≠ variable_name
```

### 問題: RUN 後に変数がリセットされる

**原因**: ユーザー定義変数のスコープ隔離

**対処**:
```iim
' グローバル変数 (!VAR0-!VAR9) を使用
SET !VAR1 "共有したい値"
RUN child.iim
' !VAR1 は子マクロの変更を保持
```

### 問題: データソース変数が空

**原因**: 行が範囲外、またはファイルパスが不正

**対処**:
```iim
' ファイルパスを確認
SET !DATASOURCE C:\full\path\to\file.csv

' 行番号を確認
PROMPT "現在行: {{!DATASOURCE_LINE}}"
PROMPT "COL1: {{!COL1}}"
```

---

**最終更新**: 2025-12-08
