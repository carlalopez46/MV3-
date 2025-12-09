/**
 * CsvParser.js (Final Version)
 * * CSV/TSV Parser with Auto-Detection
 */
var CsvParser = (function() {
    'use strict';
    return {
        parse: function(text, delimiter) {
            const cleanText = text
                .replace(/^\uFEFF/, '') // drop UTF-8/UTF-16 BOM
                .replace(/\r\n/g, '\n')
                .replace(/\r/g, '\n');
            const sep = delimiter || this._guessDelimiter(cleanText);
            const rows = [];
            let currentRow = [], currentVal = '', insideQuote = false;
            
            for (let i = 0; i < cleanText.length; i++) {
                const char = cleanText[i], next = cleanText[i+1];
                if (char === '"') {
                    if (insideQuote && next === '"') { currentVal += '"'; i++; }
                    else insideQuote = !insideQuote;
                } else if (char === sep && !insideQuote) {
                    currentRow.push(currentVal); currentVal = '';
                } else if (char === '\n' && !insideQuote) {
                    currentRow.push(currentVal); rows.push(currentRow); currentRow = []; currentVal = '';
                } else currentVal += char;
            }
            if (currentVal || currentRow.length > 0) { currentRow.push(currentVal); rows.push(currentRow); }
            return rows;
        },
        _guessDelimiter: function(text) {
            const firstLine = text.split('\n')[0];
            const c = (firstLine.match(/,/g)||[]).length, t = (firstLine.match(/\t/g)||[]).length, s = (firstLine.match(/;/g)||[]).length;
            if (t > c && t > s) return '\t';
            if (s > c && s > t) return ';';
            return ',';
        }
    };
})();
if (typeof window !== 'undefined') window.CsvParser = CsvParser;
if (typeof self !== 'undefined') self.CsvParser = CsvParser;