// Serialized into the WebView; keep this function independent of module scope.
export function installDesktopMessageObserver() {
    const { document, MutationObserver } = globalThis;
    globalThis.__screenhelloDesktopMessages = [];
    globalThis.__screenhelloDesktopMessageObserver?.disconnect();
    const recordMessages = () => {
        // Ant Design 6 uses notice title/wrapper nodes, not notice-content.
        // Read textContent so the enter animation cannot hide a result from us.
        for (const element of document.querySelectorAll('.ant-message-notice')) {
            const text = element.textContent || '';
            if (text && !globalThis.__screenhelloDesktopMessages.includes(text)) {
                globalThis.__screenhelloDesktopMessages.push(text);
            }
        }
    };
    globalThis.__screenhelloDesktopMessageObserver = new MutationObserver(recordMessages);
    globalThis.__screenhelloDesktopMessageObserver.observe(document.body, {
        childList: true, subtree: true, characterData: true,
    });
    recordMessages();
}
