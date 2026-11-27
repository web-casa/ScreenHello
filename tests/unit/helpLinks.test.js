import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { EXTERNAL_HELP, openHelpLink } from '../../src/utils/helpLinks.js';

describe('help destinations', () => {
    it('keeps native destinations equal to browser destinations', () => {
        const native = readFileSync(new URL('../../src-tauri/src/desktop_help.rs', import.meta.url), 'utf8');
        const urls = [...native.matchAll(/=>\s*(?:\{\s*)?"(https:\/\/[^"\s]+)"/g)].map((match) => match[1]);
        expect(urls.sort()).toEqual(Object.values(EXTERNAL_HELP).sort());
    });
    it.each(['__proto__', 'constructor', 'file:///etc/passwd', 'https://evil.example', 'help.github?x=1'])(
        'rejects %s without invoking the host', async (topic) => {
            const open = vi.fn();
            expect(await openHelpLink({ kind: 'desktop', help: { open } }, topic)).toBe(false);
            expect(open).not.toHaveBeenCalled();
        },
    );
    it('uses native help and does not silently fall back to WebView navigation', async () => {
        const open = vi.fn().mockResolvedValue(undefined);
        const documentApi = { createElement: vi.fn() };
        expect(await openHelpLink({ kind: 'desktop', help: { open } }, 'help.github', documentApi)).toBe(true);
        expect(open).toHaveBeenCalledWith('help.github');
        open.mockRejectedValue(new Error('private OS error'));
        expect(await openHelpLink({ kind: 'desktop', help: { open } }, 'help.github', documentApi)).toBe(false);
        expect(await openHelpLink({ kind: 'desktop' }, 'help.github', documentApi)).toBe(false);
        expect(documentApi.createElement).not.toHaveBeenCalled();
    });
    it('cleans up browser anchors even when opening fails', async () => {
        const anchor = { style: {}, click: vi.fn().mockImplementation(() => { throw new Error('blocked'); }), remove: vi.fn() };
        const documentApi = { body: { appendChild: vi.fn() }, createElement: () => anchor };
        expect(await openHelpLink({}, 'help.github', documentApi)).toBe(false);
        expect(anchor.rel).toBe('noopener noreferrer');
        expect(anchor.target).toBe('_blank');
        expect(anchor.href).toBe(EXTERNAL_HELP['help.github']);
        expect(anchor.remove).toHaveBeenCalledOnce();
    });
});
