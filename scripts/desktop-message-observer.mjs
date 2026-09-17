// Serialized into the WebView; keep this function independent of module scope.
export function installDesktopMessageObserver() {
    const { document, MutationObserver } = globalThis;
    globalThis.__screenhelloDesktopMessages = [];
    globalThis.__screenhelloDesktopMessageResults = [];
    globalThis.__screenhelloDesktopMessageObserver?.disconnect();
    const recordMessages = () => {
        // Ant Design 6 uses notice title/wrapper nodes, not notice-content.
        // Read textContent so the enter animation cannot hide a result from us.
        for (const element of document.querySelectorAll('.ant-message-notice')) {
            const text = element.textContent || '';
            if (text && !globalThis.__screenhelloDesktopMessages.includes(text)) {
                globalThis.__screenhelloDesktopMessages.push(text);
            }
            const type = element.classList.contains('ant-message-notice-error') ? 'error'
                : element.classList.contains('ant-message-notice-success') ? 'success' : null;
            if (type && text && !globalThis.__screenhelloDesktopMessageResults.some(item => item.type === type && item.text === text)) {
                globalThis.__screenhelloDesktopMessageResults.push({ type, text });
            }
        }
    };
    globalThis.__screenhelloDesktopMessageObserver = new MutationObserver(recordMessages);
    globalThis.__screenhelloDesktopMessageObserver.observe(document.body, {
        childList: true, subtree: true, characterData: true,
    });
    recordMessages();
}

// Read-only runner diagnostics. Never serialize store values, URLs, or image data.
export function readDesktopRenderState() {
    const node = globalThis.document.querySelector('.shoteasy-editor-canvas');
    const key = node && Object.keys(node).find(value => value.startsWith('__reactFiber$'));
    let fiber = key && node[key];
    while (fiber) {
        const root = fiber.memoizedProps?.value;
        if (root?.renderTaskTracker && root?.editor) {
            const tracker = root.renderTaskTracker;
            const tree = root.editor.app?.tree;
            return {
                sampledAt: Date.now(),
                pendingTasks: tracker.size, paintVersion: tracker.paintVersion,
                appRunning: root.editor.app?.running,
                rendererRunning: root.editor.app?.renderer?.running,
                rendererRequestTime: root.editor.app?.renderer?.requestTime,
                rendererFrameTime: root.editor.app?.renderer?.frameTime,
                rendererFps: root.editor.app?.renderer?.FPS,
                snapshotPending: !!root.baseSnapshot?.timer,
                running: tree?.running, viewReady: tree?.viewReady,
                viewCompleted: tree?.viewCompleted, imageReady: tree?.imageReady,
                renderWaiters: tree?.__nextRenderWait?.length,
                exportStage: root.exportService?.stage,
                visibility: globalThis.document.visibilityState,
                focused: globalThis.document.hasFocus(),
            };
        }
        fiber = fiber.return;
    }
    return null;
}
