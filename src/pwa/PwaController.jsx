import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useRegisterSW } from 'virtual:pwa-register/react';
import useStores from '@stores/useStores';
import './pwa.css';
import {
    getInstallMode,
    getUpdateBlockReason,
    isStandaloneDisplay,
    waitForActiveServiceWorker,
} from './pwaSupport';

const currentInstallDetails = (hasPrompt) => ({
    hasPrompt,
    standalone: isStandaloneDisplay(),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
});

export default observer(function PwaController() {
    const stores = useStores();
    const mounted = useRef(false);
    const [installPrompt, setInstallPrompt] = useState(null);
    const [installDismissed, setInstallDismissed] = useState(false);
    const [showIosSteps, setShowIosSteps] = useState(false);
    const [offlineReady, setOfflineReady] = useState(false);
    const [offlineDismissed, setOfflineDismissed] = useState(false);
    const [updating, setUpdating] = useState(false);
    const [statusError, setStatusError] = useState(null);

    const confirmOfflineReady = useCallback(async (registration) => {
        try {
            const readyRegistration = registration?.active
                ? registration
                : await navigator.serviceWorker.ready;
            const active = await waitForActiveServiceWorker(readyRegistration);
            if (mounted.current && active) setOfflineReady(true);
        } catch {
            if (mounted.current) setStatusError('离线模式暂未启用，在线编辑不受影响。');
        }
    }, []);

    const {
        needRefresh: [needRefresh, setNeedRefresh],
        offlineReady: [, setPluginOfflineReady],
        updateServiceWorker,
    } = useRegisterSW({
        immediate: true,
        onNeedReload: () => {
            stores.commands.runApprovedPageUnload(() => window.location.reload());
        },
        onOfflineReady: () => { void confirmOfflineReady(); },
        onRegisteredSW: (_scriptUrl, registration) => { void confirmOfflineReady(registration); },
        onRegisterError: () => setStatusError('离线模式暂未启用，在线编辑不受影响。'),
    });

    useEffect(() => {
        mounted.current = true;
        const handleInstallPrompt = (event) => {
            event.preventDefault();
            setInstallPrompt(event);
            setInstallDismissed(false);
            setShowIosSteps(false);
        };
        const handleInstalled = () => {
            setInstallPrompt(null);
            setInstallDismissed(true);
            setShowIosSteps(false);
        };
        window.addEventListener('beforeinstallprompt', handleInstallPrompt);
        window.addEventListener('appinstalled', handleInstalled);
        return () => {
            mounted.current = false;
            window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
            window.removeEventListener('appinstalled', handleInstalled);
        };
    }, []);

    const installMode = getInstallMode(currentInstallDetails(Boolean(installPrompt)));
    const updateBlockReason = getUpdateBlockReason(stores);
    const showOfflineStatus = offlineReady && !offlineDismissed;
    const showInstall = !installDismissed && (installMode === 'prompt' || installMode === 'ios-manual');
    const mode = stores.editor.isDark ? 'dark' : 'light';

    const updateMessage = useMemo(() => {
        if (updateBlockReason === 'busy') return '正在处理本地任务，完成后再更新。';
        if (updateBlockReason === 'dirty') return '新版本已下载，当前项目还有未保存更改。';
        return '新版本已下载，可以安全刷新。';
    }, [updateBlockReason]);

    const dismissOffline = () => {
        setOfflineDismissed(true);
        setPluginOfflineReady(false);
    };

    const dismissUpdate = () => {
        setNeedRefresh(false);
        setStatusError(null);
    };

    const applyUpdate = async () => {
        const currentBlock = getUpdateBlockReason(stores);
        if (currentBlock === 'busy') {
            setStatusError('本地任务仍在处理中，请完成或取消任务后再更新。');
            return;
        }
        const activateUpdate = async () => {
            setUpdating(true);
            setStatusError(null);
            try {
                await updateServiceWorker();
                return true;
            } catch {
                if (mounted.current) {
                    setUpdating(false);
                    setStatusError('新版本激活失败，请稍后重试。');
                }
                return false;
            }
        };
        if (currentBlock === 'dirty') {
            await stores.commands.requestWorkspaceReplacement(activateUpdate, { label: '载入新版本' });
        } else {
            await activateUpdate();
        }
    };

    const requestInstall = async () => {
        if (!installPrompt) return;
        setStatusError(null);
        try {
            await installPrompt.prompt();
            await installPrompt.userChoice;
            if (mounted.current) setInstallPrompt(null);
        } catch {
            if (mounted.current) setStatusError('浏览器安装提示未能打开，请使用地址栏中的安装入口。');
        }
    };

    if (!needRefresh && !showOfflineStatus && !showInstall && !statusError) return null;

    return (
        <aside className="shoteasy-pwa-tray" data-mode={mode} aria-label="ScreenHello 应用状态">
            {needRefresh && (
                <section className="shoteasy-pwa-card" role="alert" aria-live="assertive">
                    <div className="shoteasy-pwa-card__marker" aria-hidden="true">UP</div>
                    <div className="shoteasy-pwa-card__body">
                        <strong>ScreenHello 有新版本</strong>
                        <p>{updateMessage}</p>
                        <div className="shoteasy-pwa-card__actions">
                            {updateBlockReason !== 'busy' && (
                                <button
                                    type="button"
                                    className="shoteasy-pwa-action shoteasy-pwa-action--primary"
                                    disabled={updating}
                                    onClick={() => { void applyUpdate(); }}
                                >
                                    {updating
                                        ? '正在更新…'
                                        : (updateBlockReason === 'dirty' ? '处理更改并更新' : '立即更新')}
                                </button>
                            )}
                            <button type="button" className="shoteasy-pwa-action" onClick={dismissUpdate}>稍后</button>
                        </div>
                    </div>
                </section>
            )}

            {showOfflineStatus && !needRefresh && (
                <section className="shoteasy-pwa-card" role="status" aria-live="polite">
                    <div className="shoteasy-pwa-card__marker is-ready" aria-hidden="true">OK</div>
                    <div className="shoteasy-pwa-card__body">
                        <strong>离线已就绪</strong>
                        <p>核心编辑器已缓存；AVIF 等重功能需先在线成功使用一次。</p>
                    </div>
                    <button type="button" className="shoteasy-pwa-card__close" aria-label="关闭离线就绪提示" onClick={dismissOffline}>×</button>
                </section>
            )}

            {showInstall && !needRefresh && (
                <section className="shoteasy-pwa-card shoteasy-pwa-card--install" role="status">
                    <div className="shoteasy-pwa-card__marker" aria-hidden="true">APP</div>
                    <div className="shoteasy-pwa-card__body">
                        <strong>{installMode === 'prompt' ? '安装 ScreenHello' : '添加到主屏幕'}</strong>
                        {installMode === 'prompt' ? (
                            <p>安装后可以从桌面直接打开，图片仍只在本机处理。</p>
                        ) : (
                            <p>{showIosSteps
                                ? '打开浏览器分享菜单，选择“添加到主屏幕”，再启用“作为 Web App 打开”。'
                                : 'iPhone / iPad 使用系统分享菜单手动安装。'}</p>
                        )}
                        <div className="shoteasy-pwa-card__actions">
                            {installMode === 'prompt' ? (
                                <button type="button" className="shoteasy-pwa-action shoteasy-pwa-action--primary" onClick={() => { void requestInstall(); }}>安装</button>
                            ) : (
                                <button type="button" className="shoteasy-pwa-action" onClick={() => setShowIosSteps((value) => !value)}>
                                    {showIosSteps ? '收起步骤' : '查看步骤'}
                                </button>
                            )}
                        </div>
                    </div>
                    <button
                        type="button"
                        className="shoteasy-pwa-card__close"
                        aria-label="关闭安装提示"
                        onClick={() => setInstallDismissed(true)}
                    >×</button>
                </section>
            )}

            {statusError && (
                <section className="shoteasy-pwa-card shoteasy-pwa-card--error" role="status" aria-live="polite">
                    <div className="shoteasy-pwa-card__marker" aria-hidden="true">!</div>
                    <div className="shoteasy-pwa-card__body"><p>{statusError}</p></div>
                    <button type="button" className="shoteasy-pwa-card__close" aria-label="关闭应用状态提示" onClick={() => setStatusError(null)}>×</button>
                </section>
            )}
        </aside>
    );
});
