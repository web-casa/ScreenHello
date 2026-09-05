import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, InputNumber, Modal, Radio, Segmented, Spin } from 'antd';
import { observer } from 'mobx-react-lite';
import { NO_CSS_TRANSITION_NAME } from '../components/overlayMotion';
import useStores from '../stores/useStores';
import { DESKTOP_MAX_CAPTURE_PIXELS } from '../platform/desktopPlatform';
import { subscribeDesktopSystemEvents } from './desktopBridge';

const EMPTY_REGION = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

const initialRegion = (source) => {
    if (!source) return EMPTY_REGION;
    const width = Math.min(source.width, 7680);
    const height = Math.min(source.height, Math.max(1, Math.floor(DESKTOP_MAX_CAPTURE_PIXELS / width)));
    return { x: 0, y: 0, width, height };
};

const captureErrorMessage = (error) => {
    if (error?.code === 'desktop-capture-no-display') return '没有检测到可截取的显示器';
    if (error?.code === 'desktop-capture-source-unavailable') return '所选来源已关闭，请刷新后重试';
    if (error?.code === 'desktop-capture-region-invalid') return '截取区域超出显示器范围';
    if (error?.code === 'desktop-capture-busy') return '上一项截图任务尚未完成，请稍后重试';
    if (error?.code === 'desktop-capture-too-large') return '截图超过 8K 或 48 MiB 安全上限，请改用区域截图';
    if (error?.code === 'desktop-capture-window-restore-failed') return '截图已完成，但 ScreenHello 窗口未能恢复';
    return '无法读取系统屏幕，请检查操作系统的屏幕录制权限';
};

export default observer(function DesktopCaptureController() {
    const stores = useStores();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [capturing, setCapturing] = useState(false);
    const [sources, setSources] = useState([]);
    const [sourceKind, setSourceKind] = useState('monitor');
    const [selectedToken, setSelectedToken] = useState('');
    const [captureMode, setCaptureMode] = useState('full');
    const [region, setRegion] = useState(EMPTY_REGION);
    const [error, setError] = useState('');
    const requestSequence = useRef(0);
    const interactionBlocked = useRef(false);
    interactionBlocked.current = open || loading || capturing;

    const selectedSource = useMemo(
        () => sources.find((source) => source.token === selectedToken) || null,
        [selectedToken, sources],
    );
    const visibleSources = useMemo(
        () => sources.filter((source) => source.kind === sourceKind),
        [sourceKind, sources],
    );
    const hasWindows = sources.some((source) => source.kind === 'window');

    const selectSource = useCallback((source) => {
        setSelectedToken(source?.token || '');
        const nextRegion = initialRegion(source);
        setRegion(nextRegion);
        setCaptureMode(source && source.width * source.height > DESKTOP_MAX_CAPTURE_PIXELS ? 'region' : 'full');
        setError('');
    }, []);

    const loadSources = useCallback(async () => {
        const sequence = ++requestSequence.current;
        setLoading(true);
        setError('');
        try {
            const nextSources = await stores.platform.capture.listSources();
            if (sequence !== requestSequence.current) return;
            setSources(nextSources);
            const nextSource = nextSources.find((source) => source.kind === 'monitor' && source.primary)
                || nextSources.find((source) => source.kind === 'monitor')
                || nextSources[0];
            setSourceKind(nextSource.kind);
            selectSource(nextSource);
        } catch (nextError) {
            if (sequence !== requestSequence.current) return;
            setSources([]);
            setSelectedToken('');
            setError(captureErrorMessage(nextError));
        } finally {
            if (sequence === requestSequence.current) setLoading(false);
        }
    }, [selectSource, stores]);

    const openCapture = useCallback(() => {
        setOpen(true);
        void loadSources();
        return true;
    }, [loadSources]);

    const closeCapture = useCallback(() => {
        requestSequence.current += 1;
        setOpen(false);
        setLoading(false);
        setCapturing(false);
        setSources([]);
        setSelectedToken('');
        setError('');
        void stores.platform.capture.releaseSources().catch(() => {});
    }, [stores]);

    useLayoutEffect(
        () => stores.commands.registerUiAction('file.openCapture', openCapture),
        [openCapture, stores],
    );

    useEffect(() => {
        let active = true;
        let unsubscribe = null;
        subscribeDesktopSystemEvents((event) => {
            if (!active || event.action !== 'capture-primary') return;
            if (interactionBlocked.current) {
                stores.editor.message?.info?.('请先完成或取消当前截图选择');
                return;
            }
            void stores.commands.execute('file.captureScreen', { mode: 'primary' }).then((handled) => {
                if (active && !handled) stores.editor.message?.info?.('当前任务完成后再截取屏幕');
            });
        }).then((cleanup) => {
            if (active) unsubscribe = cleanup;
            else void cleanup();
        }).catch(() => {
            if (active) stores.editor.message?.warning?.('系统快捷键与托盘截图入口暂时不可用；仍可使用文件菜单');
        });
        return () => {
            active = false;
            if (unsubscribe) void unsubscribe();
        };
    }, [stores]);

    useEffect(() => () => {
        requestSequence.current += 1;
        void stores.platform.capture.releaseSources().catch(() => {});
    }, [stores]);

    const selectKind = (kind) => {
        setSourceKind(kind);
        selectSource(sources.find((source) => source.kind === kind));
    };

    const updateRegion = (key, value) => {
        setRegion((current) => ({ ...current, [key]: Number(value ?? 0) }));
        setError('');
    };

    const regionValid = Boolean(selectedSource && captureMode === 'region'
        && Number.isSafeInteger(region.x) && Number.isSafeInteger(region.y)
        && Number.isSafeInteger(region.width) && Number.isSafeInteger(region.height)
        && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0
        && region.x + region.width <= selectedSource.width
        && region.y + region.height <= selectedSource.height
        && region.width * region.height <= DESKTOP_MAX_CAPTURE_PIXELS);
    const captureEnabled = Boolean(selectedSource && !loading && !capturing
        && (captureMode === 'full' || regionValid)
        && (captureMode === 'region' || selectedSource.width * selectedSource.height <= DESKTOP_MAX_CAPTURE_PIXELS));

    const submitCapture = async () => {
        if (!captureEnabled || !selectedSource) return;
        setCapturing(true);
        setError('');
        try {
            const file = await stores.platform.capture.captureSource(selectedSource, {
                region: captureMode === 'region' ? region : null,
            });
            const installed = await stores.commands.execute('file.captureScreen', { file });
            if (!installed) {
                setSources([]);
                setSelectedToken('');
                setError('截图已生成，但未能添加到当前项目');
                return;
            }
            closeCapture();
        } catch (nextError) {
            setSources([]);
            setSelectedToken('');
            setError(captureErrorMessage(nextError));
        } finally {
            setCapturing(false);
        }
    };

    if (!open) return null;

    return (
        <Modal
            rootClassName="shoteasy-capture-dialog"
            zIndex={1100}
            title="截取屏幕"
            open
            width={720}
            closable={!capturing}
            keyboard={!capturing}
            mask={{ closable: false }}
            transitionName={NO_CSS_TRANSITION_NAME}
            maskTransitionName={NO_CSS_TRANSITION_NAME}
            onCancel={closeCapture}
            footer={[
                <Button key="cancel" disabled={capturing} onClick={closeCapture}>取消</Button>,
                <Button key="refresh" disabled={capturing || loading} onClick={() => { void loadSources(); }}>刷新来源</Button>,
                <Button key="capture" type="primary" loading={capturing} disabled={!captureEnabled} onClick={() => { void submitCapture(); }}>截取并添加</Button>,
            ]}
        >
            <p className="shoteasy-capture-dialog__intro">选择显示器、应用窗口或显示器内区域。截图只在本机处理。</p>
            {hasWindows && (
                <Segmented
                    block
                    aria-label="截图来源类型"
                    value={sourceKind}
                    options={[{ label: '显示器', value: 'monitor' }, { label: '窗口', value: 'window' }]}
                    onChange={selectKind}
                />
            )}
            <div className="shoteasy-capture-dialog__sources" aria-busy={loading}>
                {loading ? <Spin tip="正在读取本机屏幕来源"><div className="shoteasy-capture-dialog__loading" /></Spin> : null}
                {!loading && visibleSources.length ? (
                    <Radio.Group
                        aria-label="可用截图来源"
                        value={selectedToken}
                        onChange={(event) => selectSource(sources.find((source) => source.token === event.target.value))}
                    >
                        {visibleSources.map((source) => (
                            <Radio key={source.token} value={source.token}>
                                <span className="shoteasy-capture-source__copy">
                                    <strong>{source.name}</strong>
                                    <small>
                                        {source.primary ? '主显示器 · ' : ''}{source.width} × {source.height}
                                        {source.kind === 'monitor' ? ` · 坐标 ${source.x}, ${source.y} · ${source.scaleFactor}×` : ''}
                                    </small>
                                </span>
                            </Radio>
                        ))}
                    </Radio.Group>
                ) : null}
                {!loading && !visibleSources.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有可用来源" /> : null}
            </div>
            {selectedSource?.kind === 'monitor' && (
                <div className="shoteasy-capture-dialog__region">
                    <Segmented
                        aria-label="截图范围"
                        value={captureMode}
                        options={[{ label: '整个显示器', value: 'full' }, { label: '指定区域', value: 'region' }]}
                        onChange={(value) => { setCaptureMode(value); setError(''); }}
                    />
                    {captureMode === 'region' && (
                        <div className="shoteasy-capture-dialog__region-fields">
                            <InputNumber min={0} max={Math.max(0, selectedSource.width - 1)} value={region.x} prefix="X" aria-label="区域 X 坐标" onChange={(value) => updateRegion('x', value)} />
                            <InputNumber min={0} max={Math.max(0, selectedSource.height - 1)} value={region.y} prefix="Y" aria-label="区域 Y 坐标" onChange={(value) => updateRegion('y', value)} />
                            <InputNumber min={1} max={Math.max(1, selectedSource.width - region.x)} value={region.width} prefix="W" aria-label="区域宽度" onChange={(value) => updateRegion('width', value)} />
                            <InputNumber min={1} max={Math.max(1, selectedSource.height - region.y)} value={region.height} prefix="H" aria-label="区域高度" onChange={(value) => updateRegion('height', value)} />
                        </div>
                    )}
                </div>
            )}
            {error ? <Alert type="error" showIcon message={error} /> : null}
        </Modal>
    );
});
