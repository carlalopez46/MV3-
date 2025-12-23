/**
 * キーマッピング共通定義
 * 
 * このファイルは、記録側(recorder.js)と再生側(utils.js, player.js)で
 * 使用するキーコードとキー名のマッピングを一元管理します。
 * 
 * これにより、フォーマットの一貫性を保証します。
 */

// ==========================================
// 特殊キーのマッピング
// ==========================================

const SPECIAL_KEY_MAPPINGS = {
    // Navigation keys
    13: 'KEY_ENTER',
    14: 'KEY_ENTER',  // Some keyboards
    8: 'KEY_BACKSPACE',
    46: 'KEY_DELETE',
    38: 'KEY_UP',
    40: 'KEY_DOWN',
    37: 'KEY_LEFT',
    39: 'KEY_RIGHT',
    9: 'KEY_TAB',
    27: 'KEY_ESC',
    36: 'KEY_HOME',
    35: 'KEY_END',
    33: 'KEY_PAGEUP',
    34: 'KEY_PAGEDOWN',
    45: 'KEY_INSERT',
    32: 'KEY_SPACE',

    // Function keys
    112: 'KEY_F1',
    113: 'KEY_F2',
    114: 'KEY_F3',
    115: 'KEY_F4',
    116: 'KEY_F5',
    117: 'KEY_F6',
    118: 'KEY_F7',
    119: 'KEY_F8',
    120: 'KEY_F9',
    121: 'KEY_F10',
    122: 'KEY_F11',
    123: 'KEY_F12',

    // Modifier keys (for reference, usually not used alone)
    16: 'KEY_SHIFT',
    17: 'KEY_CTRL',
    18: 'KEY_ALT',
    91: 'KEY_META'  // Command/Windows key
};

// ==========================================
// 逆マッピング（キー名 → キーコード）
// ==========================================

const KEY_NAME_TO_CODE = {};
for (const [code, name] of Object.entries(SPECIAL_KEY_MAPPINGS)) {
    KEY_NAME_TO_CODE[name] = parseInt(code, 10);
}

// 短縮形もサポート
KEY_NAME_TO_CODE['ENTER'] = 13;
KEY_NAME_TO_CODE['ESC'] = 27;
KEY_NAME_TO_CODE['ESCAPE'] = 27;
KEY_NAME_TO_CODE['CTRL'] = 17;
KEY_NAME_TO_CODE['SHIFT'] = 16;
KEY_NAME_TO_CODE['ALT'] = 18;
KEY_NAME_TO_CODE['META'] = 91;
KEY_NAME_TO_CODE['CMD'] = 91;
KEY_NAME_TO_CODE['WIN'] = 91;

// ==========================================
// フォーマット定義
// ==========================================

const KEY_NOTATION_FORMAT = {
    // 修飾キーの順序（記録時もパース時もこの順序を使用）
    MODIFIER_ORDER: ['KEY_CTRL', 'KEY_META', 'KEY_SHIFT', 'KEY_ALT'],

    // 区切り文字
    SEPARATOR: '+',

    // 包含文字
    WRAPPER: {
        START: '${',
        END: '}'
    },

    // 正規表現パターン
    PATTERNS: {
        // ${KEY_CTRL+A} のようなパターンにマッチ
        FULL: /\$\{([^}]+)\}/g,

        // KEY_CTRL+A のようなパターンを検証
        NOTATION: /^(?:KEY_(?:CTRL|META|SHIFT|ALT)\+)*(?:KEY_\w+|[A-Z0-9])$/,

        // 修飾キーを抽出
        MODIFIERS: /(KEY_CTRL|KEY_META|KEY_SHIFT|KEY_ALT)/g
    }
};

// ==========================================
// ユーティリティ関数
// ==========================================

/**
 * キーコードから特殊キー名を取得
 * @param {number} keyCode - キーコード
 * @returns {string|null} - 特殊キー名、または null
 */
function getSpecialKeyName(keyCode) {
    return SPECIAL_KEY_MAPPINGS[keyCode] || null;
}

/**
 * キー名からキーコードを取得
 * @param {string} keyName - キー名 (例: 'KEY_ENTER', 'ENTER')
 * @returns {number|null} - キーコード、または null
 */
function getKeyCode(keyName) {
    return KEY_NAME_TO_CODE[keyName.toUpperCase()] || null;
}

/**
 * キー表記が正しいフォーマットかチェック
 * @param {string} notation - キー表記 (例: 'KEY_CTRL+A')
 * @returns {boolean} - 正しい場合 true
 */
function isValidKeyNotation(notation) {
    return KEY_NOTATION_FORMAT.PATTERNS.NOTATION.test(notation);
}

/**
 * キー表記をラップ (例: 'KEY_CTRL+A' → '${KEY_CTRL+A}')
 * @param {string} notation - キー表記
 * @returns {string} - ラップされた表記
 */
function wrapKeyNotation(notation) {
    return KEY_NOTATION_FORMAT.WRAPPER.START + notation + KEY_NOTATION_FORMAT.WRAPPER.END;
}

/**
 * キー表記から修飾キーを抽出
 * @param {string} notation - キー表記 (例: 'KEY_CTRL+KEY_SHIFT+A')
 * @returns {Object} - {ctrl: boolean, meta: boolean, shift: boolean, alt: boolean}
 */
function extractModifiers(notation) {
    const modifiers = {
        ctrl: false,
        meta: false,
        shift: false,
        alt: false
    };

    if (notation.includes('KEY_CTRL') || notation.includes('CTRL+')) {
        modifiers.ctrl = true;
    }
    if (notation.includes('KEY_META') || notation.includes('META+') ||
        notation.includes('CMD+') || notation.includes('WIN+')) {
        modifiers.meta = true;
    }
    if (notation.includes('KEY_SHIFT') || notation.includes('SHIFT+')) {
        modifiers.shift = true;
    }
    if (notation.includes('KEY_ALT') || notation.includes('ALT+')) {
        modifiers.alt = true;
    }

    return modifiers;
}

/**
 * KeyboardEventから修飾キーの状態を取得
 * @param {KeyboardEvent} event - キーボードイベント
 * @returns {Object} - {ctrl: boolean, meta: boolean, shift: boolean, alt: boolean}
 */
function getModifiersFromEvent(event) {
    return {
        ctrl: event.ctrlKey || false,
        meta: event.metaKey || false,
        shift: event.shiftKey || false,
        alt: event.altKey || false
    };
}

/**
 * KeyboardEventからキー表記を構築（recorder.jsで使用）
 * @param {KeyboardEvent} event - キーボードイベント
 * @param {string|null} specialKeyName - 特殊キー名（既にわかっている場合）
 * @returns {string} - キー表記 (例: 'KEY_CTRL+A')
 */
function buildKeyNotationFromEvent(event, specialKeyName = null) {
    const parts = [];

    // 修飾キーを規定の順序で追加
    if (event.ctrlKey) parts.push('KEY_CTRL');
    if (event.metaKey) parts.push('KEY_META');
    if (event.shiftKey) parts.push('KEY_SHIFT');
    if (event.altKey) parts.push('KEY_ALT');

    // メインキーを追加
    if (specialKeyName) {
        parts.push(specialKeyName);
    } else if (event.key && event.key.length === 1) {
        parts.push(event.key.toUpperCase());
    } else if (event.keyCode >= 65 && event.keyCode <= 90) {
        // A-Z
        parts.push(String.fromCharCode(event.keyCode));
    } else if (event.keyCode >= 48 && event.keyCode <= 57) {
        // 0-9
        parts.push(String.fromCharCode(event.keyCode));
    }

    return parts.join(KEY_NOTATION_FORMAT.SEPARATOR);
}

/**
 * キー表記をパース（utils.jsで使用）
 * @param {string} notation - キー表記 (例: 'KEY_CTRL+A' または 'CTRL+A')
 * @returns {Object|null} - {type, key, keyCode, modifiers} または null
 */
function parseKeyNotation(notation) {
    const parts = notation.split(KEY_NOTATION_FORMAT.SEPARATOR);
    const modifiers = {
        ctrl: false,
        meta: false,
        shift: false,
        alt: false
    };
    let mainKey = null;

    for (const part of parts) {
        const upperPart = part.trim().toUpperCase();

        if (upperPart === 'KEY_CTRL' || upperPart === 'CTRL') {
            modifiers.ctrl = true;
        } else if (upperPart === 'KEY_META' || upperPart === 'META' ||
            upperPart === 'KEY_CMD' || upperPart === 'CMD' ||
            upperPart === 'KEY_WIN' || upperPart === 'WIN') {
            modifiers.meta = true;
        } else if (upperPart === 'KEY_SHIFT' || upperPart === 'SHIFT') {
            modifiers.shift = true;
        } else if (upperPart === 'KEY_ALT' || upperPart === 'ALT') {
            modifiers.alt = true;
        } else {
            // メインキー
            mainKey = upperPart.startsWith('KEY_') ? upperPart : upperPart;
        }
    }

    if (!mainKey) {
        return null;  // 修飾キーのみは無効
    }

    // キーコードを取得
    let keyCode = getKeyCode(mainKey);
    if (!keyCode && mainKey.length === 1) {
        // 単一文字の場合、charCodeを使用
        keyCode = mainKey.charCodeAt(0);
    }

    const hasModifiers = modifiers.ctrl || modifiers.meta || modifiers.shift || modifiers.alt;

    return {
        type: hasModifiers ? 'combo' : 'key',
        key: mainKey,
        keyCode: keyCode,
        modifiers: modifiers,
        char: mainKey.length === 1 ? mainKey : null
    };
}

// ==========================================
// 整合性チェック
// ==========================================

/**
 * 記録→パース→再生のサイクルをテスト
 * @param {Object} eventMock - KeyboardEventのモック
 * @returns {Object} - {success: boolean, details: Object}
 */
function testRoundTrip(eventMock) {
    // 1. 記録
    const specialKeyName = getSpecialKeyName(eventMock.keyCode);
    const notation = buildKeyNotationFromEvent(eventMock, specialKeyName);

    // 2. パース
    const parsed = parseKeyNotation(notation);

    // 3. 検証
    const success = parsed &&
        parsed.keyCode === eventMock.keyCode &&
        parsed.modifiers.ctrl === eventMock.ctrlKey &&
        parsed.modifiers.shift === eventMock.shiftKey &&
        parsed.modifiers.alt === eventMock.altKey &&
        parsed.modifiers.meta === eventMock.metaKey;

    return {
        success: success,
        details: {
            input: eventMock,
            notation: notation,
            parsed: parsed,
            wrapped: wrapKeyNotation(notation),
            isValid: isValidKeyNotation(notation)
        }
    };
}

// ==========================================
// エクスポート
// ==========================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        // データ
        SPECIAL_KEY_MAPPINGS,
        KEY_NAME_TO_CODE,
        KEY_NOTATION_FORMAT,

        // 関数
        getSpecialKeyName,
        getKeyCode,
        isValidKeyNotation,
        wrapKeyNotation,
        extractModifiers,
        getModifiersFromEvent,
        buildKeyNotationFromEvent,
        parseKeyNotation,
        testRoundTrip
    };
}

// ==========================================
// セルフテスト（デバッグ用）
// ==========================================

if (typeof console !== 'undefined' && console.log) {
    console.log('[KeyMappings] Loaded');
    console.log('[KeyMappings] Special keys:', Object.keys(SPECIAL_KEY_MAPPINGS).length);
    console.log('[KeyMappings] Key names:', Object.keys(KEY_NAME_TO_CODE).length);

    // サンプルテスト
    const testCases = [
        { keyCode: 65, key: 'a', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false },
        { keyCode: 13, key: 'Enter', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false },
        { keyCode: 65, key: 'A', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }
    ];

    console.log('[KeyMappings] Running self-tests...');
    testCases.forEach((testCase, index) => {
        const result = testRoundTrip(testCase);
        console.log(`Test ${index + 1}:`, result.success ? '✓ PASS' : '✗ FAIL', result.details.notation);
    });
}
