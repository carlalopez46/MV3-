/**
 * SecurityManager.js (Final Version)
 * * Wrapper for Rijndael encryption
 */
var SecurityManager = (function() {
    'use strict';
    const DEFAULT_MASTER_KEY = "iMacros"; 

    return {
        encrypt: function(text) {
            if (typeof Rijndael === 'undefined') return text; 
            try { return Rijndael.encrypt(text, DEFAULT_MASTER_KEY); } 
            catch (e) { return text; }
        },
        decrypt: function(cipherText) {
            if (typeof Rijndael === 'undefined') return cipherText;
            try { 
                if (!cipherText || cipherText.length < 10) return cipherText; 
                return Rijndael.decrypt(cipherText, DEFAULT_MASTER_KEY); 
            } catch (e) { return cipherText; }
        }
    };
})();
if (typeof window !== 'undefined') window.SecurityManager = SecurityManager;
if (typeof self !== 'undefined') self.SecurityManager = SecurityManager;