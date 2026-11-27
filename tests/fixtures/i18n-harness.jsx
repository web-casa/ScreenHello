import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App.jsx';
import useStores from '../../src/stores/useStores.js';

export function mountI18nHarness(container, Editor = App) {
    const runtimes = {};
    function Probe({ name }) {
        const runtime = useStores();
        runtimes[name] = runtime;
        return createElement('span', { 'data-testid': `locale-runtime-${name}` }, runtime.id);
    }
    function Harness() {
        const [locale, setLocale] = useState('en-US');
        return createElement('div', null,
            createElement('button', { onClick: () => setLocale(undefined) }, 'Change first locale'),
            createElement('section', { 'data-testid': 'locale-first' }, createElement(Editor, {
                locale, workspace: true, headLeft: createElement(Probe, { name: 'first' }),
            })),
            createElement('section', { 'data-testid': 'locale-second' }, createElement(Editor, {
                locale: 'zh-CN', workspace: true, headLeft: createElement(Probe, { name: 'second' }),
            })),
        );
    }
    const root = createRoot(container);
    root.render(createElement(Harness));
    return { runtimes, unmount: () => root.unmount() };
}
