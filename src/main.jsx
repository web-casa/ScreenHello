import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppContent } from './App.jsx';
import EditorErrorBoundary from './components/EditorErrorBoundary.jsx';
import StoreProvider from './stores/StoreProvider.jsx';
import PwaController from './pwa/PwaController.jsx';
import StandaloneLocale from './i18n/StandaloneLocale.jsx';
import { browserPlatform } from './platform/browserPlatform.js';
import { entryLocale } from './utils/publicSite.js';

const initialLocale = entryLocale(window.location.search, browserPlatform.storage.getPreference('SCREENHELLO_LOCALE'));

const exposeRuntime = import.meta.env.DEV
    ? (runtime) => {
        if (runtime) {
            window.__shoteasyStores = runtime;
            window.__shoteasyBaseSnapshot = runtime.baseSnapshot;
            window.__shoteasyDraftService = runtime.draftService;
            window.__shoteasyDraftStore = runtime.draftStore;
            window.__shoteasyAssetStore = runtime.assetStore;
            return;
        }
        delete window.__shoteasyStores;
        delete window.__shoteasyBaseSnapshot;
        delete window.__shoteasyDraftService;
        delete window.__shoteasyDraftStore;
        delete window.__shoteasyAssetStore;
    }
    : undefined;

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <EditorErrorBoundary getLocale={() => browserPlatform.storage.getPreference('SCREENHELLO_LOCALE')}>
            <StoreProvider onRuntime={exposeRuntime} runtimeOptions={{ locale: initialLocale, webExportSafety: true }}>
                <StandaloneLocale />
                {import.meta.env.PROD
                    && globalThis.isSecureContext
                    && 'serviceWorker' in navigator
                    ? <PwaController />
                    : null}
                {/* 独立站启用草稿恢复、应用菜单与本地资料库；library 两项默认均关闭。 */}
                <AppContent persistence={{ key: 'shoteasy-default', autoRestore: true }} workspace />
            </StoreProvider>
        </EditorErrorBoundary>
    </React.StrictMode>
);
