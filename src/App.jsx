import { useCallback, useEffect, useRef } from 'react';
import { Alert, message } from 'antd';
import { observer } from 'mobx-react-lite';
import TopBar from '@components/header/TopBar';
import Editor from '@components/editor/Editor';
import LeftRail from '@components/sideBar/LeftRail';
import RightInspector from '@components/sideBar/RightInspector';
import EditorErrorBoundary from '@components/EditorErrorBoundary';
import { ConfigProvider, theme } from 'antd';
import { antdLocales } from './i18n/antdLocales';
import { StyleProvider } from '@ant-design/cssinjs';
import Init from '@components/init/Init';
import StoreProvider from '@stores/StoreProvider';
import useStores from '@stores/useStores';
import { useSafeRecovery } from '@stores/recoveryContext';
import useSetImg from '@hooks/useSetImg';
import useKeyboardShortcuts from '@hooks/useKeyboardShortcuts';
import WorkspaceGuardDialog from '@components/workspace/WorkspaceGuardDialog';
import DeviceLicenseDialog from '@components/sideBar/DeviceLicenseDialog';
import { cn } from '@utils/utils';
import '@style/main.css';

const readPreferredTheme = (isDark, platform) => {
  if (isDark != null) return isDark ? 'dark' : 'light';
  return platform.storage.getPreference('SHOTEASY_BEAUTIFIER_THEME') === 'light' ? 'light' : 'dark';
};

export const AppContent = observer(function AppContent({ defaultImg, headLeft, headRight, isDark, boxClassName = '', onClear, persistence = false, workspace = false, locale, messages }) {
  const stores = useStores();
  const safeRecovery = useSafeRecovery();
  const t = stores.i18n.t;
  useEffect(() => {
    if (locale !== undefined || messages !== undefined) stores.i18n.setOptions(locale ?? stores.i18n.locale, messages);
  }, [locale, messages, stores]);
  const initialDefaultImg = useRef(defaultImg);
  const getFile = useSetImg(stores);
  const isEditing = !!stores.editor.img?.src;
  const workplace = isEditing ? <Editor /> : <Init />;
  const [messageApi, contextHolder] = message.useMessage();
  const shouldBlockUnload = Boolean(workspace && stores.workspace.isDirty);

  useKeyboardShortcuts(stores);

  useEffect(() => {
    stores.editor.setMessage(messageApi);
    return () => stores.editor.setMessage(null);
  }, [messageApi, stores]);

  useEffect(() => {
    stores.editor.setClearFun(onClear);
    return () => stores.editor.setClearFun(null);
  }, [onClear, stores]);

  useEffect(() => {
    stores.editor.setTheme(readPreferredTheme(isDark, stores.platform));
  }, [isDark, stores]);

  useEffect(() => {
    if (!defaultImg || safeRecovery) return;
    getFile(defaultImg, 'dataURL').catch(() => {
      stores.editor.message?.error?.(t('默认图片加载失败，请选择有效图片'));
    });
  }, [defaultImg, getFile, safeRecovery, stores, t]);

  const persistenceKey = !safeRecovery && persistence && typeof persistence === 'object' ? persistence.key : null;
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
    if (!shouldBlockUnload) return undefined;
    const handleBeforeUnload = (event) => {
      if (stores.commands.consumePageUnloadApproval()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [shouldBlockUnload, stores]);

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
        locale={antdLocales[stores.i18n.locale]}
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
            Dropdown: { colorPrimary: stores.editor.isDark ? '#78aaff' : '#1d4ed8' },
          },
        }}
      >
        {contextHolder}
        <WorkspaceGuardDialog />
        <DeviceLicenseDialog />
        <div
          className={cn('polka shoteasy-app flex flex-col overflow-hidden antialiased w-full', boxClassName)}
          data-mode={stores.editor.isDark ? 'dark' : 'light'}
          data-screenhello-instance={stores.id}
          lang={stores.i18n.locale}
          onPointerDownCapture={() => stores.activate()}
          onFocusCapture={() => stores.activate()}
        >
          <TopBar headLeft={headLeft} headRight={headRight} />
          {(safeRecovery || stores.draftService.recoveryBlocked) && (
            <Alert
              type="warning"
              showIcon
              title={t('原草稿已保留，本次会话已暂停自动保存')}
              description={t('可以继续编辑和导出，请通过文件菜单保存项目文件。重新打开页面后可再次尝试恢复原草稿。')}
            />
          )}
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
  const latestRuntime = useRef(null);
  const rememberRuntime = useCallback((runtime) => {
    // Keep the last locale snapshot accessible after a failed provider unmounts.
    if (runtime) latestRuntime.current = runtime;
  }, []);
  return (
    <EditorErrorBoundary
      locale={props.locale}
      messages={props.messages}
      getLocale={() => latestRuntime.current?.i18n.locale}
      getMessages={() => latestRuntime.current?.i18n.messages}
    >
      <StoreProvider onRuntime={rememberRuntime} runtimeOptions={{ locale: props.locale, messages: props.messages }}>
        <AppContent {...props} locale={props.locale ?? 'zh-CN'} />
      </StoreProvider>
    </EditorErrorBoundary>
  );
}
