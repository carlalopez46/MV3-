# Macro playback and clipboard notes

## Preventing double execution
- Launch macros from the iMacros panel when possible. Bookmark URLs such as `imacros://run/?m=...` can trigger the service worker and offscreen document in quick succession on some Chrome builds.
- Recent background/offscreen changes route `playMacro` only through the service worker, but for legacy bookmarks add a guard at the top of user macros:
  ```text
  "" Guard against double execution when launched twice within 1 second
  SET run_guard EVAL("(function(){var now=Date.now();var last=window._imacrosLastRun||0;window._imacrosLastRun=now;return (now-last)<1000?'STOP':'OK';})();")
  SET !ERRORIGNORE YES
  SET check_guard {{run_guard}}
  SET !ERRORIGNORE NO
  URL GOTO=javascript:if("{{check_guard}}"==="STOP"){throw new Error('Duplicate run blocked');}
  ```
  The guard uses a per-tab timestamp to ignore the second invocation while keeping the first run intact.

## Clipboard newlines
- iMacros does not expand HTML `<BR>` tags when copying strings to the clipboard. Use `{{!NEWLINE}}` (or `\n` inside an `EVAL`) to create line breaks.
- Example used in `(ys)10percent税分離.iim`:
  ```text
  SET result_text 税込価格:{{inprice}}円{{!NEWLINE}}税抜価格:{{price_without_tax}}円{{!NEWLINE}}消費税:{{tax_amount}}円
  SET !CLIPBOARD {{result_text}}
  ```
- Run macros from the panel or another user-gesture context to ensure clipboard permissions (`clipboardRead`/`clipboardWrite`) are honored.
