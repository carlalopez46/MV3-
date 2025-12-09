# Special Keys Support (XType-like functionality)

iMacros MV3 now supports special key notation in TAG commands, similar to UI.Vision RPA's XType command.

## Supported Special Keys

You can use the following special key notation in TAG command CONTENT parameters:

### Navigation Keys
- `${KEY_ENTER}` - Enter key
- `${KEY_BACKSPACE}` - Backspace key
- `${KEY_DELETE}` - Delete key
- `${KEY_TAB}` - Tab key
- `${KEY_ESC}` or `${KEY_ESCAPE}` - Escape key
- `${KEY_UP}` - Up arrow key
- `${KEY_DOWN}` - Down arrow key
- `${KEY_LEFT}` - Left arrow key
- `${KEY_RIGHT}` - Right arrow key
- `${KEY_HOME}` - Home key
- `${KEY_END}` - End key
- `${KEY_PAGEUP}` - Page Up key
- `${KEY_PAGEDOWN}` - Page Down key
- `${KEY_INSERT}` - Insert key
- `${KEY_SPACE}` - Space key

### Function Keys
- `${KEY_F1}` through `${KEY_F12}` - Function keys

### Key Combinations
You can combine keys with modifiers using the `+` operator. Both notations are supported:

**Full notation with KEY_ prefix:**
- `${KEY_CTRL+KEY_A}` - Select all (Ctrl+A)
- `${KEY_CTRL+KEY_C}` - Copy (Ctrl+C)
- `${KEY_CTRL+KEY_V}` - Paste (Ctrl+V)
- `${KEY_CTRL+KEY_X}` - Cut (Ctrl+X)
- `${KEY_CTRL+KEY_Z}` - Undo (Ctrl+Z)
- `${KEY_SHIFT+KEY_TAB}` - Shift+Tab
- `${KEY_CTRL+KEY_ENTER}` - Ctrl+Enter

**Short notation (partial KEY_ prefix omission):**
- `${KEY_CTRL+A}` - Same as ${KEY_CTRL+KEY_A} (main key without KEY_)
- `${KEY_CTRL+C}` - Same as ${KEY_CTRL+KEY_C}
- `${CTRL+A}` - Fully short notation (all KEY_ prefixes omitted)

## Usage Examples

### Example 1: Type text and press Enter
```
TAG POS=1 TYPE=INPUT:TEXT ATTR=ID:searchbox CONTENT="Hello${KEY_ENTER}"
```

### Example 2: Select all text and replace
```
TAG POS=1 TYPE=INPUT:TEXT ATTR=ID:textfield CONTENT="${KEY_CTRL+A}New Text"
```

### Example 3: Navigate form fields
```
TAG POS=1 TYPE=INPUT:TEXT ATTR=ID:field1 CONTENT="Value 1${KEY_TAB}"
TAG POS=1 TYPE=INPUT:TEXT ATTR=ID:field2 CONTENT="Value 2${KEY_ENTER}"
```

### Example 4: Use arrow keys
```
TAG POS=1 TYPE=INPUT:TEXT ATTR=ID:input1 CONTENT="Text${KEY_DOWN}${KEY_DOWN}${KEY_ENTER}"
```

### Example 5: Multiple special keys
```
TAG POS=1 TYPE=TEXTAREA ATTR=ID:editor CONTENT="Line 1${KEY_ENTER}Line 2${KEY_ENTER}Line 3"
```

## Mixing Text and Special Keys

You can freely mix regular text with special keys:

```
TAG POS=1 TYPE=INPUT:TEXT ATTR=ID:field CONTENT="Username${KEY_TAB}Password${KEY_ENTER}"
```

## Consecutive and Navigation Keys

Special keys are fully supported for consecutive use and cursor manipulation:

### Consecutive Special Keys
```
TAG POS=1 TYPE=INPUT:TEXT ATTR=ID:field CONTENT="Hello${KEY_BACKSPACE}${KEY_BACKSPACE}${KEY_BACKSPACE}"
# Result: "He" (deleted 3 characters)

TAG POS=1 TYPE=TEXTAREA ATTR=ID:editor CONTENT="Line 1${KEY_ENTER}Line 2${KEY_ENTER}${KEY_ENTER}Line 3"
# Result: Multi-line text with blank line
```

### Cursor Movement with Navigation Keys
Navigation keys (arrow keys, HOME, END) actually move the cursor during playback:

```
TAG POS=1 TYPE=INPUT:TEXT ATTR=ID:field CONTENT="Hello${KEY_LEFT}${KEY_LEFT}X"
# Result: "HelXlo" (moved cursor left 2 positions, inserted X)

TAG POS=1 TYPE=INPUT:TEXT ATTR=ID:field CONTENT="Text${KEY_HOME}Start: "
# Result: "Start: Text" (moved cursor to beginning, inserted prefix)

TAG POS=1 TYPE=INPUT:TEXT ATTR=ID:field CONTENT="ABC${KEY_BACKSPACE}${KEY_BACKSPACE}${KEY_BACKSPACE}XYZ"
# Result: "XYZ" (deleted all, typed new text)
```

### How It Works
- **Backspace/Delete**: Actually deletes characters, not just sends events
- **Arrow keys**: Moves cursor position (selectionStart/selectionEnd)
- **HOME/END**: Moves cursor to start/end of field
- **Text insertion**: Inserts at current cursor position, not always at end

This allows complex editing scenarios like:
1. Type initial text
2. Move cursor with arrow keys
3. Insert text at specific position
4. Delete with Backspace/Delete from any position

## Notes

1. Special keys are case-insensitive: `${KEY_ENTER}`, `${key_enter}`, and `${Key_Enter}` all work
2. Works with INPUT (text, password, email, search, tel, url), TEXTAREA elements
3. Special keys trigger actual keyboard events, so they work with JavaScript event handlers
4. For complex keyboard interactions, you can still use the EVENT command with KEY parameter

## Recording Special Keys

### Automatic Recording in Conventional Mode

Special keys and key combinations are now automatically recorded in **Conventional recording mode**:

- **Navigation keys** like Enter, Tab, Backspace, Delete, and arrow keys are automatically captured
- **Key combinations** like Ctrl+A, Ctrl+C, Ctrl+V are automatically recorded
- **Function keys** F1-F12 are captured

When you press these keys while recording, they will appear in your macro as `${KEY_ENTER}`, `${KEY_CTRL+A}`, etc.

### Example Recording Session

1. Start recording in Conventional mode
2. Click in a text field and type "Hello"
3. Press Ctrl+A to select all
4. Press Delete
5. Type "World"
6. Press Enter

The recorded macro will look like:
```
TAG POS=1 TYPE=INPUT:TEXT ATTR=ID:field1 CONTENT="Hello${KEY_CTRL+A}${KEY_DELETE}World${KEY_ENTER}"
```

### Event Mode Recording

In **Event mode**, keys are recorded as separate EVENT commands with KEY codes (existing behavior):
```
EVENT TYPE=KEYDOWN SELECTOR="#field" KEY=13
```

This is more verbose but provides finer control over event timing.

## Comparison with EVENT Command

The EVENT command can also dispatch keyboard events, but special keys in TAG commands are more convenient:

**Using TAG with special keys (recommended for simple cases):**
```
TAG POS=1 TYPE=INPUT:TEXT ATTR=ID:field CONTENT="Hello${KEY_ENTER}"
```

**Using EVENT command (for complex scenarios):**
```
TAG POS=1 TYPE=INPUT:TEXT ATTR=ID:field CONTENT="Hello"
EVENT TYPE=KEYDOWN SELECTOR="#field" KEY=13
```

Special keys in TAG commands are easier to read and maintain for most use cases.
