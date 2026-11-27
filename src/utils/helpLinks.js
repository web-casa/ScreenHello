// Only fixed public documentation destinations; never accept a user supplied URL.
export const EXTERNAL_HELP = Object.freeze({
    'help.documentation': 'https://github.com/web-casa/ScreenHello/tree/main/DOCS',
    'help.reportIssue': 'https://github.com/web-casa/ScreenHello/issues',
    'help.github': 'https://github.com/web-casa/ScreenHello',
    'help.runtimePrivacy': 'https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/data-privacy',
});

export async function openHelpLink(platform, topic, documentApi = globalThis.document) {
    if (!Object.hasOwn(EXTERNAL_HELP, topic)) return false;
    try {
        if (platform?.kind === 'desktop') {
            if (typeof platform.help?.open !== 'function') return false;
            await platform.help.open(topic);
            return true;
        }
        if (!documentApi?.body) return false;
        const anchor = documentApi.createElement('a');
        anchor.href = EXTERNAL_HELP[topic];
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.style.display = 'none';
        try {
            documentApi.body.appendChild(anchor);
            anchor.click();
        } finally {
            anchor.remove();
        }
        return true;
    } catch {
        return false;
    }
}
