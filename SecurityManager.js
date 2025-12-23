/**
 * SecurityManager.js
 * Wrapper for Rijndael encryption with improved security and error handling.
 */
var SecurityManager = (function () {
    'use strict';

    let _masterKey = null;

    /**
     * Internal: Generates a 256-bit key from a secret and salt.
     * @param {string} secret 
     * @param {string} salt 
     * @returns {string} Hex encoded 256-bit key
     */
    function deriveKey(secret, salt) {
        if (typeof Rijndael === 'undefined' || typeof Rijndael.SHA256 !== 'function') {
            throw new Error("Encryption library (Rijndael SHA256) not loaded.");
        }
        // Use SHA256 twice or with salt to simulate a simple KDF
        return Rijndael.SHA256(secret + ":" + salt);
    }

    return {
        /**
         * Initializes the manager by loading or generating a secret.
         * This should be called by the background script during startup.
         */
        init: async function () {
            return new Promise((resolve, reject) => {
                const extensionId = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id)
                    ? chrome.runtime.id : null;

                if (!extensionId) {
                    const err = new Error("SecurityManager: chrome.runtime.id is unavailable.");
                    console.error("[SecurityManager] Initialization failed: No runtime ID.");
                    reject(err);
                    return;
                }

                chrome.storage.local.get(['master_secret'], function (items) {
                    if (chrome.runtime.lastError) {
                        console.error("[SecurityManager] Storage access failed.");
                        reject(new Error("Storage access failed during initialization."));
                        return;
                    }
                    let secret = items.master_secret;
                    if (!secret) {
                        // Generate a cryptographically secure random secret
                        const array = new Uint8Array(32);
                        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
                            crypto.getRandomValues(array);
                            secret = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
                        } else {
                            // Fallback for extremely rare environments where Web Crypto is unavailable but PRNG is needed
                            console.warn("[SecurityManager] Web Crypto unavailable, using Math.random for secret.");
                            secret = Math.random().toString(36).substring(2) + Date.now().toString(36);
                        }
                        chrome.storage.local.set({ 'master_secret': secret });
                        console.info("[SecurityManager] Generated new secure master secret.");
                    }
                    _masterKey = deriveKey(secret, extensionId);
                    resolve(_masterKey);
                });
            });
        },

        /**
         * Sets the master key directly (for non-async contexts if already known).
         */
        setKey: function (key) {
            _masterKey = key;
        },

        /**
         * Encrypts text using the master key.
         */
        encrypt: function (text) {
            if (!_masterKey) {
                throw new Error("SecurityManager not initialized. Call init() first.");
            }
            if (typeof Rijndael === 'undefined' || typeof Rijndael.encryptString !== 'function') {
                throw new Error("Encryption library (Rijndael.encryptString) not loaded.");
            }
            try {
                // Rijndael.encryptString uses the provided string as a 'password' 
                // and derives a byte array key using SHA256 internally.
                return Rijndael.encryptString(text, _masterKey);
            } catch (e) {
                console.error("[SecurityManager] Encryption failed.");
                throw new Error("Failed to encrypt data.");
            }
        },

        /**
         * Decrypts ciphertext using the master key.
         */
        decrypt: function (cipherText) {
            if (!_masterKey) {
                throw new Error("SecurityManager not initialized. Call init() first.");
            }
            if (typeof Rijndael === 'undefined' || typeof Rijndael.decryptString !== 'function') {
                throw new Error("Encryption library (Rijndael.decryptString) not loaded.");
            }
            try {
                if (!cipherText) return "";
                return Rijndael.decryptString(cipherText, _masterKey);
            } catch (e) {
                console.error("[SecurityManager] Decryption failed.");
                throw new Error("Failed to decrypt data.");
            }
        }
    };
})();

if (typeof window !== 'undefined') window.SecurityManager = SecurityManager;
if (typeof self !== 'undefined') self.SecurityManager = SecurityManager;
if (typeof globalThis !== 'undefined') globalThis.SecurityManager = SecurityManager;