/**
 * Promise ユーティリティ
 * 
 * 非同期処理のエラーハンドリングを一貫化するためのヘルパー関数群
 */

/**
 * Promise を安全に実行し、エラーをロギングする
 * @param {Promise} promise - 実行する Promise
 * @param {string} operationName - 操作名（ログ用）
 * @param {*} [defaultValue=null] - エラー時に返すデフォルト値
 * @returns {Promise} - エラー時は defaultValue を resolve する Promise
 */
function safePromise(promise, operationName, defaultValue = null) {
    return promise.catch(err => {
        console.error(`[iMacros] ${operationName} failed:`, err);
        if (typeof logError === 'function') {
            logError(`${operationName} failed: ${err.message || err}`);
        }
        return defaultValue;
    });
}

/**
 * 複数の Promise を安全に並列実行
 * @param {Array<Promise>} promises - Promise の配列
 * @param {string} operationName - 操作名（ログ用）
 * @returns {Promise<Array>} - 各 Promise の結果（エラーは null）
 */
function safePromiseAll(promises, operationName) {
    return Promise.all(
        promises.map((p, i) =>
            safePromise(p, `${operationName}[${i}]`, null)
        )
    );
}

/**
 * リトライ付き Promise 実行
 * @param {Function} promiseFactory - Promise を返す関数
 * @param {number} maxRetries - 最大リトライ回数
 * @param {number} delayMs - リトライ間隔（ミリ秒）
 * @param {string} operationName - 操作名（ログ用）
 * @returns {Promise}
 */
async function retryPromise(promiseFactory, maxRetries = 3, delayMs = 1000, operationName = 'operation') {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await promiseFactory();
        } catch (err) {
            lastError = err;
            console.warn(`[iMacros] ${operationName} attempt ${attempt}/${maxRetries} failed:`, err);

            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }

    throw new Error(`${operationName} failed after ${maxRetries} attempts: ${lastError.message || lastError}`);
}

/**
 * タイムアウト付き Promise 実行
 * @param {Promise} promise - 実行する Promise
 * @param {number} timeoutMs - タイムアウト（ミリ秒）
 * @param {string} operationName - 操作名（ログ用）
 * @returns {Promise}
 */
function withTimeout(promise, timeoutMs, operationName = 'operation') {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        promise
            .then(result => {
                clearTimeout(timeoutId);
                resolve(result);
            })
            .catch(err => {
                clearTimeout(timeoutId);
                reject(err);
            });
    });
}

/**
 * コールバックスタイルの関数を Promise 化
 * @param {Function} fn - コールバックを受け取る関数
 * @param {...*} args - 関数に渡す引数（最後にコールバックが追加される）
 * @returns {Promise}
 */
function promisify(fn, ...args) {
    return new Promise((resolve, reject) => {
        fn(...args, (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });
}

/**
 * Chrome API 用の Promise ラッパー
 * chrome.runtime.lastError を自動チェック
 *
 * NOTE:
 * MV3 の offscreen ドキュメントでは bg_common.js で同名の `chromeAsync`
 * ヘルパーが定義される。ここで const で同じ名前を宣言すると後続の
 * スクリプト読み込み時に "Identifier 'chromeAsync' has already been declared"
 * となり、bg_common.js が実行されず openPanel などの共有ハンドラ登録が
 * 失敗する。その結果、バッジクリックからパネル（list.html 相当）が
 * 開けなくなるため、既存の定義を尊重して再宣言を避ける。
 */
const chromeAsyncWrapper = {
    /**
     * chrome.tabs.query を Promise 化
     */
    tabsQuery(queryInfo) {
        return promisify(chrome.tabs.query.bind(chrome.tabs), queryInfo);
    },

    /**
     * chrome.tabs.get を Promise 化
     */
    tabsGet(tabId) {
        return promisify(chrome.tabs.get.bind(chrome.tabs), tabId);
    },

    /**
     * chrome.tabs.sendMessage を Promise 化
     */
    tabsSendMessage(tabId, message) {
        return promisify(chrome.tabs.sendMessage.bind(chrome.tabs), tabId, message);
    },

    /**
     * chrome.windows.get を Promise 化
     */
    windowsGet(windowId, getInfo = {}) {
        return promisify(chrome.windows.get.bind(chrome.windows), windowId, getInfo);
    },

    /**
     * chrome.storage.local.get を Promise 化
     */
    storageLocalGet(keys) {
        return promisify(chrome.storage.local.get.bind(chrome.storage.local), keys);
    },

    /**
     * chrome.storage.local.set を Promise 化
     */
    storageLocalSet(items) {
        return promisify(chrome.storage.local.set.bind(chrome.storage.local), items);
    }
};

// グローバルにエクスポート（MV3 環境用）
if (typeof globalThis !== 'undefined') {
    globalThis.safePromise = safePromise;
    globalThis.safePromiseAll = safePromiseAll;
    globalThis.retryPromise = retryPromise;
    globalThis.withTimeout = withTimeout;
    globalThis.promisify = promisify;
    if (typeof globalThis.chromeAsync === 'undefined') {
        globalThis.chromeAsync = chromeAsyncWrapper;
    }
}

// window オブジェクトが存在する場合もエクスポート
if (typeof window !== 'undefined') {
    window.safePromise = safePromise;
    window.safePromiseAll = safePromiseAll;
    window.retryPromise = retryPromise;
    window.withTimeout = withTimeout;
    window.promisify = promisify;
    if (typeof window.chromeAsync === 'undefined') {
        window.chromeAsync = chromeAsyncWrapper;
    }
}
