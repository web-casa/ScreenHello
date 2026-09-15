import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ImageBeautifier } from 'rico-screenshot';
import 'rico-screenshot/style.css';

const containers = {
    a: document.getElementById('consumer-a'),
    b: document.getElementById('consumer-b'),
};
const roots = { a: null, b: null };
const workspace = new URLSearchParams(window.location.search).get('workspace') === 'true';
const mixedLocales = new URLSearchParams(window.location.search).get('locales') === 'mixed';

const mount = (key) => {
    if (roots[key]) return;
    roots[key] = createRoot(containers[key]);
    roots[key].render(
        <StrictMode>
            <ImageBeautifier
                persistence={{ key: `consumer-${key}`, autoRestore: false }}
                boxClassName="h-[720px]"
                workspace={workspace}
                locale={mixedLocales && key === 'a' ? 'en-US' : 'zh-CN'}
            />
        </StrictMode>
    );
};

const unmount = (key) => {
    roots[key]?.unmount();
    roots[key] = null;
};

mount('a');
mount('b');

window.__screenhelloConsumer = {
    mountA: () => mount('a'),
    unmountA: () => unmount('a'),
    unmount: () => {
        unmount('a');
        unmount('b');
    },
};
