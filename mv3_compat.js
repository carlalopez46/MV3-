/*
 * MV3 Compatibility Layer
 * Provides compatibility shims for MV2 APIs that don't work in MV3
 */

// Replacement for chrome.runtime.getBackgroundPage() in MV3
// Since service workers don't have a background page, we use message passing instead
function getBackgroundContext(callback) {
    // In MV3, we can't access the background page directly
    // Instead, we send a message to the background to get the needed context

    // For now, return a proxy object that forwards calls to the background via messages
    // This is a simplified version - you may need to expand this based on usage

    chrome.runtime.sendMessage({ type: 'GET_BACKGROUND_CONTEXT' }, function (response) {
        if (chrome.runtime.lastError) {
            console.error('[iMacros MV3] Failed to get background context:', chrome.runtime.lastError);
            callback(null);
            return;
        }

        // Create a proxy object that represents the background context
        const bgProxy = {
            // Add methods and properties as needed
            context: response ? response.context : null,

            // Helper to send messages to background
            sendMessage: function (message, callback) {
                chrome.runtime.sendMessage(message, callback);
            },

            // Storage and afio might be accessed
            Storage: response ? response.Storage : null,
            afio: response ? response.afio : null
        };

        callback(bgProxy);
    });
}

// Backward compatibility wrapper
if (typeof chrome !== 'undefined' && chrome.runtime) {
    // Store the original getBackgroundPage if it exists
    const originalGetBackgroundPage = chrome.runtime.getBackgroundPage;

    // Override with our compatibility version
    // In MV3, getBackgroundPage won't work, so we provide this alternative
    if (!chrome.runtime._mv3CompatApplied) {
        chrome.runtime._mv3CompatApplied = true;

        // Try to detect if we're in MV3
        const manifest = chrome.runtime.getManifest();
        if (manifest && manifest.manifest_version === 3) {
            console.log('[iMacros MV3] Detected MV3, applying compatibility shims');

            // Note: We can't actually override chrome.runtime.getBackgroundPage
            // So files need to be updated to use getBackgroundContext instead
        }
    }
}

// Export for use in other files
if (typeof window !== 'undefined') {
    window.getBackgroundContext = getBackgroundContext;
}
