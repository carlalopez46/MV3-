/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/
/* global resizeToContent */

function getRequiredElement(id) {
    if (typeof id !== 'string') {
        console.error('[iMacros] getRequiredElement requires a non-empty string id');
        return null;
    }

    const trimmedId = id.trim();
    if (!trimmedId) {
        console.error('[iMacros] getRequiredElement requires a non-empty string id');
        return null;
    }

    const element = document.getElementById(trimmedId);
    if (!element) {
        console.error(`[iMacros] Required element "${trimmedId}" was not found`);
    }
    return element;
}

function safeResizeDialog(containerElement, contextLabel = 'dialog') {
    if (typeof resizeToContent !== 'function') {
        console.error(`[iMacros] resizeToContent is not available; cannot size ${contextLabel}`);
        return false;
    }

    if (!containerElement) {
        console.error(`[iMacros] ${contextLabel} container element missing; cannot resize`);
        return false;
    }

    resizeToContent(window, containerElement);
    return true;
}
