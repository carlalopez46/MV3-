# Macro Engine Quick Reference

This guide summarizes the behaviors that often trip up new contributors when working near `mplayer.js` and `variable-manager.js`.

## RUN command chaining
- **Resolution order:** `RUN` resolves relative macro names against `macrosFolder` first and falls back to the default `savepath` directory provided by AFIO.
- **State isolation:** Each `RUN` pushes a frame containing the caller's loop stack, local variable context, and current nesting depth. On completion, `_popFrame()` restores these values so the parent macro resumes with its original control flow and counters intact.
- **Nesting guardrails:** Calls are limited to 10 levels deep. Exceeding this limit throws a `RuntimeError (780)` before the child macro loads.

## Variable scoping
- **Global vs. local:** `VariableManager` stores global variables in `globalVars` and per-macro locals in `localContext`. Built-in locals such as `LOOP`, `LINE`, and `TABNUMBER` are always read from `localContext`.
- **Snapshots:** `snapshotLocalContext()` deep copies the local context so RUN frames can safely restore caller state even if child macros mutate nested objects. `restoreLocalContext()` always clones the snapshot to avoid sharing references.
- **Resetting between macros:** `resetVariableStateForNewMacro()` clears both legacy `vars` arrays and `VariableManager` locals, ensuring replayed macros start with predictable values.

## Error handling highlights
- **Missing macros:** If a resolved macro path does not exist, RUN throws `RuntimeError (781)` with the fully resolved path to aid debugging.
- **Load failures:** Errors thrown while reading or parsing a child macro cause the RUN frame to unwind, restoring loop stacks and local variables before the error propagates to the caller.
- **Timeout-sensitive flows:** Long-running actions inside a child macro respect the parent's timeout configuration because timing settings live in shared globals rather than the RUN frame.
