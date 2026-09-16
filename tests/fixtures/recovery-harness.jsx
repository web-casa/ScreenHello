import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App.jsx';
import useStores from '../../src/stores/useStores.js';
import { useSafeRecovery } from '../../src/stores/recoveryContext.js';

export const mountRecoveryHarness = (container) => {
    const instances = [];
    function Fault({ broken }) {
        const runtime = useStores();
        if (!instances.includes(runtime)) instances.push(runtime);
        const safe = useSafeRecovery();
        if (broken && !safe) throw new Error('recovery-harness-expected-error');
        return createElement('span', { 'data-testid': 'recovery-runtime', 'data-id': runtime.id }, 'Recovery fixture');
    }
    function Harness() {
        const [broken, setBroken] = useState(false);
        return createElement('section', null,
            createElement('button', { onClick: () => setBroken(true) }, 'Trigger expected failure'),
            createElement(App, {
                persistence: { key: 'recovery-test-original', autoRestore: true },
                workspace: true,
                headLeft: createElement(Fault, { broken }),
            }),
        );
    }
    const root = createRoot(container);
    root.render(createElement(Harness));
    return { instances, unmount: () => root.unmount() };
};
