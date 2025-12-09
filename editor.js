/**
 * editor.js (Final Version)
 */
var Editor = (function() {
    'use strict';
    let currPath = null;
    const area = $('#macro-editor-area');
    const status = $('#editor-status');

    function init() {
        $('#editor-save-btn').on('click', save);
        $('#editor-close-btn').on('click', () => $('#editor-container').hide());
        $('#editor-saveas-btn').on('click', saveAs);
    }

    async function open(path) {
        currPath = path;
        status.text('Loading...');
        try {
            const content = await AsyncFileIO.readTextFile(path);
            area.val(content);
            $('#editor-filename').text(Utils.getFileName(path));
            status.text('');
        } catch(e) { alert(e.message); $('#editor-container').hide(); }
    }

    async function save() {
        if (!currPath) return saveAs();
        status.text('Saving...');
        try {
            await AsyncFileIO.writeTextFile(currPath, area.val());
            status.text('Saved');
            setTimeout(()=>status.text(''), 2000);
        } catch(e) { status.text('Error'); alert(e.message); }
    }

    async function saveAs() {
        const name = prompt("Filename (.iim):", "New.iim");
        if (name) {
            currPath = "Macros/" + name;
            await save();
            $('#editor-filename').text(name);
            MacroView.refresh();
        }
    }

    return { init, open };
})();
$(document).ready(Editor.init);