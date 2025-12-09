/**
 * crop_tool.js (Final Version)
 * * UI for selecting screen area
 */
(function() {
    if (window.iMacrosCropActive) return;
    window.iMacrosCropActive = true;

    const overlay = document.createElement('div');
    Object.assign(overlay.style, { position:'fixed', top:0, left:0, width:'100vw', height:'100vh', zIndex:999999, cursor:'crosshair', backgroundColor:'rgba(0,0,0,0.3)' });
    
    const sel = document.createElement('div');
    Object.assign(sel.style, { border:'2px dashed red', backgroundColor:'rgba(255,255,255,0.2)', position:'absolute', display:'none' });
    overlay.appendChild(sel);

    const help = document.createElement('div');
    help.innerText = 'Drag to select area. ESC to cancel.';
    Object.assign(help.style, { position:'fixed', top:'10px', left:'50%', transform:'translateX(-50%)', backgroundColor:'rgba(0,0,0,0.7)', color:'white', padding:'5px', pointerEvents:'none' });
    overlay.appendChild(help);
    document.body.appendChild(overlay);

    let startX, startY, isDrag = false;

    function onDown(e) {
        isDrag = true; startX = e.clientX; startY = e.clientY;
        Object.assign(sel.style, { left:startX+'px', top:startY+'px', width:0, height:0, display:'block' });
    }
    function onMove(e) {
        if (!isDrag) return;
        const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
        Object.assign(sel.style, { width:w+'px', height:h+'px', left:Math.min(e.clientX, startX)+'px', top:Math.min(e.clientY, startY)+'px' });
    }
    function onUp() {
        if (!isDrag) return;
        isDrag = false;
        const r = sel.getBoundingClientRect();
        cleanup();
        if (r.width > 5 && r.height > 5) {
            chrome.runtime.sendMessage({
                command: 'crop-area-selected',
                area: { x:r.left, y:r.top, width:r.width, height:r.height, pixelRatio:window.devicePixelRatio }
            });
        }
    }
    function onKey(e) { if(e.key==='Escape') { cleanup(); chrome.runtime.sendMessage({command:'crop-cancelled'}); } }
    function cleanup() { window.iMacrosCropActive=false; overlay.remove(); document.removeEventListener('keydown', onKey); }

    overlay.addEventListener('mousedown', onDown);
    overlay.addEventListener('mousemove', onMove);
    overlay.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey);
})();