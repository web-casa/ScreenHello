import { useEffect, useRef } from 'react';
import { message } from 'antd';
import { observer } from 'mobx-react-lite';
import TopBar from '@components/header/TopBar';
import Editor from '@components/editor/Editor';
import LeftRail from '@components/sideBar/LeftRail';
import RightInspector from '@components/sideBar/RightInspector';
import EditorErrorBoundary from '@components/EditorErrorBoundary';
import { ConfigProvider, theme } from 'antd';
import { StyleProvider } from '@ant-design/cssinjs';
import Init from '@components/init/Init';
import StoreProvider from '@stores/StoreProvider';
import useStores from '@stores/useStores';
import useSetImg from '@hooks/useSetImg';
import { cn } from '@utils/utils';
import { browserPlatform } from './platform/browserPlatform';
import '@style/main.css';

const readPreferredTheme = (isDark) => {
  if (isDark != null) return isDark ? 'dark' : 'light';
  return browserPlatform.storage.getPreference('SHOTEASY_BEAUTIFIER_THEME') === 'light' ? 'light' : 'dark';
};

export const AppContent = observer(function AppContent({ defaultImg, headLeft, headRight, isDark, boxClassName = '', onClear, persistence = false, workspace = false }) {
  const stores = useStores();
  const initialDefaultImg = useRef(defaultImg);
  const getFile = useSetImg(stores);
  const isEditing = !!stores.editor.img?.src;
  const workplace = isEditing ? <Editor /> : <Init />;
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    stores.editor.setMessage(messageApi);
    return () => stores.editor.setMessage(null);
  }, [messageApi, stores]);

  useEffect(() => {
    stores.editor.setClearFun(onClear);
    return () => stores.editor.setClearFun(null);
  }, [onClear, stores]);

  useEffect(() => {
    stores.editor.setTheme(readPreferredTheme(isDark));
  }, [isDark, stores]);

  useEffect(() => {
    if (!defaultImg) return;
    getFile(defaultImg, 'dataURL').catch(() => {
      stores.editor.message?.error?.('默认图片加载失败，请选择有效图片');
    });
  }, [defaultImg, getFile, stores]);

  const persistenceKey = persistence && typeof persistence === 'object' ? persistence.key : null;
  const persistenceAutoRestore = persistence && typeof persistence === 'object'
    ? persistence.autoRestore !== false
    : false;

  useEffect(() => {
    stores.draftService.setup(persistenceKey ? { key: persistenceKey, autoRestore: persistenceAutoRestore } : false);
    return () => stores.draftService.teardown();
  }, [persistenceKey, persistenceAutoRestore, stores]);

  useEffect(() => {
    stores.workspace.setup(workspace);
    return () => stores.workspace.teardown();
  }, [stores, workspace]);

  useEffect(() => {
    stores.editor.cancelScheduledImageRelease();
    return () => stores.editor.scheduleImageRelease();
  }, [stores]);

  useEffect(() => {
    if (persistenceKey && persistenceAutoRestore && !initialDefaultImg.current) {
      stores.draftService.restore();
    }
  }, [persistenceKey, persistenceAutoRestore, stores]);

  return (
    <StyleProvider layer>
      <ConfigProvider
        theme={{
          algorithm: stores.editor.isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: {
            colorPrimary: stores.editor.isDark ? '#0066ff' : '#2563eb',
            borderRadius: 8,
            controlHeight: 34,
            fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          },
          components: {
            Button: { controlHeight: 34, paddingInline: 14 },
            Segmented: { borderRadius: 8 },
          },
        }}
      >
        {contextHolder}
        <div
          className={cn('polka shoteasy-app flex flex-col overflow-hidden antialiased w-full h-[100vh]', boxClassName)}
          data-mode={stores.editor.isDark ? 'dark' : 'light'}
          data-screenhello-instance={stores.id}
          onPointerDownCapture={() => stores.activate()}
          onFocusCapture={() => stores.activate()}
        >
          <TopBar headLeft={headLeft} headRight={headRight} />
          <div className="flex flex-row flex-1 h-0">
            <LeftRail />
            {workplace}
            <RightInspector />
          </div>
        </div>
      </ConfigProvider>
    </StyleProvider>
  );
});

export default function App(props) {
  return (
    <EditorErrorBoundary>
      <StoreProvider>
        <AppContent {...props} />
      </StoreProvider>
    </EditorErrorBoundary>
  );
}
