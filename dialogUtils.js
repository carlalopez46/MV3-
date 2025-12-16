
const RETRY_DELAY_MS = 200;
const MAX_RETRY_ATTEMPTS = 30;

function getDialogArgs(windowId, callback, attemptsLeft = MAX_RETRY_ATTEMPTS) {
    chrome.runtime.sendMessage({
        type: 'GET_DIALOG_ARGS',
        windowId: windowId
    }, function (result) {
        if (chrome.runtime.lastError || !result || !result.success) {
            const error = chrome.runtime.lastError ? chrome.runtime.lastError.message : (result ? result.error : 'Unknown error');
            console.warn(`[iMacros] Failed to get dialog args: ${error}`);
            if (attemptsLeft > 0) {
                const attemptNumber = MAX_RETRY_ATTEMPTS - attemptsLeft + 1;
                console.log(`[iMacros] Retrying getDialogArgs (${attemptNumber}/${MAX_RETRY_ATTEMPTS})...`);
                setTimeout(() => getDialogArgs(windowId, callback, attemptsLeft - 1), RETRY_DELAY_MS);
            } else {
                console.error('[iMacros] Max retries reached for getDialogArgs. Aborting.');
                callback(null);
            }
            return;
        }
        callback(result.args);
    });
}
