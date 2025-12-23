# LOOP Command Syntax Guide

## Overview

The LOOP command in iMacros allows you to repeat a block of commands multiple times. This implementation supports:
- Single and nested loops (up to 10 levels)
- LOOP BREAK to exit a loop early
- LOOP CONTINUE to skip to the next iteration
- Backward compatibility with traditional `!LOOP` variable usage

## Basic Syntax

### Simple Loop

```iim
LOOP NEST <count>
    ' Commands to repeat
LOOP
```

Example:
```iim
LOOP NEST 3
    PROMPT Iteration:_{{!LOOP}}
LOOP
```

This will show prompts: "Iteration: 1", "Iteration: 2", "Iteration: 3"

### Loop Variables

- First level loop: `{{!LOOP}}` or `{{!LOOP1}}`
- Second level loop: `{{!LOOP2}}`
- Third level loop: `{{!LOOP3}}`
- ...up to `{{!LOOP10}}`

## Nested Loops

You can nest loops up to 10 levels deep:

```iim
LOOP NEST 2
    LOOP NEST 3
        PROMPT Outer:_{{!LOOP1}}_Inner:_{{!LOOP2}}
    LOOP
LOOP
```

Output:
```text
Outer: 1 Inner: 1
Outer: 1 Inner: 2
Outer: 1 Inner: 3
Outer: 2 Inner: 1
Outer: 2 Inner: 2
Outer: 2 Inner: 3
```

## LOOP BREAK

Exit the current loop immediately:

```iim
LOOP NEST 5
    SET !EVAL {{!EVAL("{{!LOOP}} == 3")}}
    IF EVAL({{!EVAL}})
        LOOP BREAK
    ENDIF
    PROMPT Iteration:_{{!LOOP}}
LOOP
```

Output: "Iteration: 1", "Iteration: 2" (stops at 3)

## LOOP CONTINUE

Skip to the next iteration of the current loop:

```iim
LOOP NEST 4
    SET !EVAL {{!EVAL("{{!LOOP}} == 2")}}
    IF EVAL({{!EVAL}})
        LOOP CONTINUE
    ENDIF
    PROMPT Iteration:_{{!LOOP}}
LOOP
```

Output: "Iteration: 1", "Iteration: 3", "Iteration: 4" (skips 2)

## LOOP NEXT

Synonym for LOOP CONTINUE:

```iim
LOOP NEST 3
    SET !EVAL {{!EVAL("{{!LOOP}} == 2")}}
    IF EVAL({{!EVAL}})
        LOOP NEXT
    ENDIF
    PROMPT Iteration:_{{!LOOP}}
LOOP
```

## Complex Example

```iim
LOOP NEST 3
    ' Skip iteration 2
    SET !EVAL {{!EVAL("{{!LOOP1}} == 2")}}
    IF EVAL({{!EVAL}})
        LOOP CONTINUE
    ENDIF

    LOOP NEST 5
        ' Skip inner iteration 3
        SET !EVAL {{!EVAL("{{!LOOP2}} == 3")}}
        IF EVAL({{!EVAL}})
            LOOP CONTINUE
        ENDIF

        ' Break inner loop at iteration 4
        SET !EVAL {{!EVAL("{{!LOOP2}} == 4")}}
        IF EVAL({{!EVAL}})
            LOOP BREAK
        ENDIF

        PROMPT [{{!LOOP1}},{{!LOOP2}}]
    LOOP
LOOP
```

Output: [1,1][1,2][1,4][3,1][3,2][3,4]

## Traditional !LOOP Variable

The traditional `SET !LOOP` command is still supported for macro-level looping:

```iim
SET !LOOP 2
SET !DATASOURCE_LINE {{!LOOP}}
```

This sets the starting value for macro-wide loop iterations, which is different from `LOOP NEST`.

## Important Notes

1. **Loop End Marker Required**: Every `LOOP NEST n` must have a corresponding `LOOP` end marker
2. **Maximum Nesting**: 10 levels maximum
3. **Scope**: BREAK and CONTINUE only affect the innermost loop
4. **Variable Reset**: Loop variables are reset to 0 after the loop completes

## Error Messages

- `"LOOP BREAK without active loop"` - BREAK used outside a loop
- `"LOOP CONTINUE without active loop"` - CONTINUE used outside a loop
- `"LOOP end marker without matching LOOP NEST"` - Missing LOOP NEST
- `"Maximum loop nesting level (10) exceeded"` - Too many nested loops

## Testing

See comprehensive test examples in:
- `/tests/loop_comprehensive_test.iim`
- `/iMacrosData/Macros/LoopTest.iim`
