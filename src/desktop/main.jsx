import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppContent } from '../App.jsx';
import EditorErrorBoundary from '../components/EditorErrorBoundary.jsx';
import StoreProvider from '../stores/StoreProvider.jsx';
import DesktopRuntimeStatus from './DesktopRuntimeStatus.jsx';
import DesktopCaptureController from './DesktopCaptureController.jsx';
import { createDesktopPlatform } from '../platform/desktopPlatform.js';
import './desktop.css';

const desktopPlatform = createDesktopPlatform();

const exposeRuntime = import.meta.env.DEV
    ? (runtime) => {
        if (runtime) {
            window.__shoteasyStores = runtime;
            return;
        }
        delete window.__shoteasyStores;
    }
    : undefined;

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <EditorErrorBoundary>
            <StoreProvider onRuntime={exposeRuntime} runtimeOptions={{ platform: desktopPlatform }}>
                <AppContent
                    persistence={{ key: 'screenhello-desktop-default', autoRestore: true }}
                    workspace
                    headRight={(
                        <>
                            <DesktopRuntimeStatus />
                            <DesktopCaptureController />
                        </>
                    )}
                />
            </StoreProvider>
        </EditorErrorBoundary>
    </React.StrictMode>
);
