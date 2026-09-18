// 桌面外壳与独立站共用同一批 Radix 控件，必须同样引入主题变量、组件样式与桥接层：
// 缺了它们，顶栏的复制/导出按钮和检查器里的 Radix 控件会退化成没有按钮外观的裸图标
// 与文字，`display: contents`、深色 token 对齐和 44px 触控目标也会一并丢失。
// 顺序与 src/main.jsx 一致：tokens → components → 桥接覆盖。
import '@radix-ui/themes/tokens.css';
import '@radix-ui/themes/components.css';
import '../style/radix-bridge.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppContent } from '../App.jsx';
import EditorErrorBoundary from '../components/EditorErrorBoundary.jsx';
import StoreProvider from '../stores/StoreProvider.jsx';
import DesktopRuntimeStatus from './DesktopRuntimeStatus.jsx';
import DesktopCaptureController from './DesktopCaptureController.jsx';
import DesktopExitController from './DesktopExitController.jsx';
import { createDesktopPlatform } from '../platform/desktopPlatform.js';
import './desktop.css';
import StandaloneLocale from '../i18n/StandaloneLocale.jsx';

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
        <EditorErrorBoundary getLocale={() => desktopPlatform.storage.getPreference('SCREENHELLO_LOCALE')}>
            <StoreProvider onRuntime={exposeRuntime} runtimeOptions={{ platform: desktopPlatform, locale: desktopPlatform.storage.getPreference('SCREENHELLO_LOCALE') }}>
                <StandaloneLocale updateTitle={false} />
                <AppContent
                    boxClassName="shoteasy-desktop-app"
                    persistence={{ key: 'screenhello-desktop-default', autoRestore: true }}
                    workspace
                    headRight={(
                        <>
                            <DesktopRuntimeStatus />
                            <DesktopCaptureController />
                            <DesktopExitController />
                        </>
                    )}
                />
            </StoreProvider>
        </EditorErrorBoundary>
    </React.StrictMode>
);
