/**
 * SecurityManager.js
 * Wrapper for Rijndael encryption with improved error handling.
 */
var SecurityManager = (function () {
    'use strict';

    // NOTE: Master key should be unique per installation and not hardcoded in plain text.
    // For MV3, we should ideally use a key stored in secure storage.
    const DEFAULT_MASTER_KEY = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id)
        ? "iMacros_" + chrome.runtime.id
        : (function () { throw new Error("Security Error: Unable to determine a unique installation key for encryption."); })();

    return {
        /**
         * Encrypts text using the master key.
         * @param {string} text Plaintext to encrypt
         * @returns {string} Ciphertext or throws error on failure
         */
        encrypt: function (text) {
            if (typeof Rijndael === 'undefined') {
                throw new Error("Encryption library (Rijndael) not loaded.");
            }
            try {
                const result = Rijndael.encrypt(text, DEFAULT_MASTER_KEY);
                if (!result) throw new Error("Encryption returned empty result.");
                return result;
            } catch (e) {
                console.error("Encryption failed:", e);
                throw new Error("Failed to encrypt data: " + e.message);
            }
        },

        /**
         * Decrypts ciphertext using the master key.
         * @param {string} cipherText Ciphertext to decrypt
         * @returns {string} Decrypted text or throws error on failure
         */
        decrypt: function (cipherText) {
            if (typeof Rijndael === 'undefined') {
                throw new Error("Encryption library (Rijndael) not loaded.");
            }
            try {
                if (!cipherText) return "";
                // iMacros usually prefixes encrypted strings with __ENCRYPTED__
                // or just stores them as hex strings.
                const result = Rijndael.decrypt(cipherText, DEFAULT_MASTER_KEY);
                if (result === null || result === undefined) {
                    throw new Error("Decryption failed (invalid key or corrupted data).");
                }
                return result;
            } catch (e) {
                console.error("Decryption failed:", e);
                throw new Error("Failed to decrypt data: " + e.message);
            }
        }
    };
})();

if (typeof window !== 'undefined') window.SecurityManager = SecurityManager;
if (typeof self !== 'undefined') self.SecurityManager = SecurityManager;
if (typeof globalThis !== 'undefined') globalThis.SecurityManager = SecurityManager;