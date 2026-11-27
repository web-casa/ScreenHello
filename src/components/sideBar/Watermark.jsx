import useI18n from '../../i18n/useI18n';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Icon from '@components/Icon';
import { Button, Input, Radio, Segmented, Select, Slider, Switch } from 'antd';
import ColorPicker from '@components/ColorPicker';
import useStores from '@stores/useStores';
import { supportImg } from '@utils/utils';

const POSITION_OPTIONS = [
    { value: 'bottom-right', label: '右下' },
    { value: 'bottom-left', label: '左下' },
    { value: 'top-right', label: '右上' },
    { value: 'top-left', label: '左上' },
    { value: 'center', label: '居中' },
    { value: 'top', label: '顶部居中' },
    { value: 'bottom', label: '底部居中' },
    { value: 'left', label: '左侧居中' },
    { value: 'right', label: '右侧居中' },
    { value: 'tile', label: '全画布平铺' },
];

export default observer(function WatermarkPanel() {
    const t = useI18n();
    const stores = useStores();
    const baseId = useId();
    const logoInputRef = useRef(null);
    const uploadTokenRef = useRef(0);
    const [uploadingLogo, setUploadingLogo] = useState(false);

    const wm = stores.option.watermark;
    const isEnabled = Boolean(wm?.enabled || stores.option.waterImg);
    const mode = wm?.mode === 'image' ? 'image' : 'text';
    const baselineRevision = stores.imageStore.baselineRevision;

    useEffect(() => {
        uploadTokenRef.current += 1;
        setUploadingLogo(false);
    }, [baselineRevision, isEnabled, mode]);

    useEffect(() => () => {
        uploadTokenRef.current += 1;
    }, []);

    const modeOptions = useMemo(() => ([
        { value: 'text', label: t("文字平铺") },
        { value: 'image', label: t("图片 Logo") },
    ]), [t]);

    const positionOptions = useMemo(() => (
        POSITION_OPTIONS.map((item) => ({ value: item.value, label: t(item.label) }))
    ), [t]);

    const handleToggleWatermark = (checked) => {
        stores.option.setWatermark({ enabled: checked });
    };

    const handleColorChange = (color) => {
        const nextColor = typeof color === 'string' ? color : color.toRgbString();
        stores.option.setWatermark({ color: nextColor });
    };

    const handleLogoUpload = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        const token = uploadTokenRef.current + 1;
        uploadTokenRef.current = token;
        const startBaseline = stores.imageStore.baselineRevision;
        setUploadingLogo(true);
        try {
            const { compressWatermarkImageFile } = await import('@utils/watermarkImage');
            const compressed = await compressWatermarkImageFile(file);
            if (
                uploadTokenRef.current !== token
                || stores.isDisposed
                || stores.imageStore.baselineRevision !== startBaseline
            ) {
                return;
            }
            stores.option.setWatermark({
                enabled: true,
                mode: 'image',
                imageDataUrl: compressed.dataUrl,
                imageWidth: compressed.width,
                imageHeight: compressed.height,
            });
        } catch {
            if (uploadTokenRef.current === token && !stores.isDisposed) {
                stores.editor.message?.error?.(t("水印图片处理失败，请选择有效图片"));
            }
        } finally {
            if (uploadTokenRef.current === token) setUploadingLogo(false);
        }
    };

    const positionSelectId = `${baseId}-wm-pos`;

    return (
        <>
            <div className="shoteasy-watermark-row [&_label]:font-semibold [&_label]:text-sm flex gap-4 items-center justify-between">
                <label>{t("水印")}</label>
                <Switch
                    checked={isEnabled}
                    onChange={handleToggleWatermark}
                    size="small"
                    className="bg-slate-200"
                    aria-label={t("启用水印")}
                    data-testid="watermark-enable-switch"
                />
            </div>
            {isEnabled && (
                <div className="shoteasy-watermark-options [&_label]:font-semibold [&_label]:text-xs grid gap-3 pl-2 pt-2">
                    <Segmented
                        size="small"
                        block
                        value={mode}
                        options={modeOptions}
                        onChange={(nextMode) => stores.option.setWatermark({ enabled: true, mode: nextMode })}
                        aria-label={t("水印类型")}
                    />

                    {mode === 'text' ? (
                        <>
                            <Input
                                value={wm.text}
                                maxLength={80}
                                placeholder={t("水印内容")}
                                onChange={(e) => stores.option.setWatermark({ text: e.target.value })}
                                aria-label={t("水印内容")}
                                data-testid="watermark-text-input"
                            />
                            <div className="flex items-center justify-between">
                                <label>{t("颜色")}</label>
                                <ColorPicker value={wm.color} onChange={handleColorChange} size="small" aria-label={t("水印颜色")} />
                            </div>
                            <div className="flex items-center justify-between">
                                <label>{t("方向")}</label>
                                <div>
                                    <Radio.Group
                                        value={wm.angle}
                                        onChange={(e) => stores.option.setWatermark({ angle: e.target.value })}
                                        size="small"
                                        aria-label={t("水印方向")}
                                    >
                                        <Radio.Button value={-45} aria-label={t("左上到右下")}><Icon.ArrowUpRight size={16} className="mt-[3px]" /></Radio.Button>
                                        <Radio.Button value={45} aria-label={t("右上到左下")}><Icon.ArrowDownRight size={16} className="mt-[3px]" /></Radio.Button>
                                    </Radio.Group>
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="flex items-center gap-2 flex-wrap">
                                <input
                                    ref={logoInputRef}
                                    type="file"
                                    hidden
                                    accept={supportImg.join(',')}
                                    onChange={(event) => { void handleLogoUpload(event); }}
                                    data-testid="watermark-image-input"
                                />
                                <Button
                                    size="small"
                                    loading={uploadingLogo}
                                    icon={<Icon.Upload size={13} />}
                                    onClick={() => logoInputRef.current?.click()}
                                    data-testid="watermark-image-upload"
                                >
                                    {wm.imageDataUrl ? t("更换 Logo") : t("上传 Logo")}
                                </Button>
                                {wm.imageDataUrl && (
                                    <Button
                                        size="small"
                                        onClick={() => stores.option.setWatermark({ imageDataUrl: null, imageWidth: 0, imageHeight: 0 })}
                                        data-testid="watermark-image-clear"
                                    >
                                        {t("清除")}
                                    </Button>
                                )}
                            </div>
                            {wm.imageDataUrl && (
                                <div className="shoteasy-watermark-logo-preview">
                                    <img src={wm.imageDataUrl} alt={t("水印 Logo 预览")} />
                                    <span>{wm.imageWidth} × {wm.imageHeight} px</span>
                                </div>
                            )}
                            <div className="flex items-center justify-between gap-2">
                                <label htmlFor={positionSelectId}>{t("位置")}</label>
                                <Select
                                    id={positionSelectId}
                                    size="small"
                                    value={wm.position}
                                    options={positionOptions}
                                    onChange={(position) => stores.option.setWatermark({ position })}
                                    style={{ width: 132 }}
                                    aria-label={t("水印位置")}
                                    data-testid="watermark-position-select"
                                />
                            </div>
                            <div>
                                <div className="flex items-center justify-between">
                                    <label>{t("大小")}</label>
                                    <span className="text-xs opacity-75">{wm.scale}%</span>
                                </div>
                                <Slider
                                    min={5}
                                    max={40}
                                    value={wm.scale}
                                    onChange={(scale) => stores.option.setWatermark({ scale })}
                                    aria-label={t("水印大小")}
                                />
                            </div>
                            <div>
                                <div className="flex items-center justify-between">
                                    <label>{t("不透明度")}</label>
                                    <span className="text-xs opacity-75">{wm.opacity}%</span>
                                </div>
                                <Slider
                                    min={10}
                                    max={100}
                                    value={wm.opacity}
                                    onChange={(opacity) => stores.option.setWatermark({ opacity })}
                                    aria-label={t("水印不透明度")}
                                />
                            </div>
                        </>
                    )}

                    <div className="flex items-center justify-between">
                        <label>{t("仅背景")}</label>
                        <Switch
                            size="small"
                            checked={stores.option.waterIndex < 0}
                            onChange={(checked) => stores.option.setWaterIndex(checked ? -1 : 1)}
                            className="bg-slate-200"
                            aria-label={t("水印仅背景")}
                        />
                    </div>
                </div>
            )}
            <div className="[&_label]:font-semibold [&_label]:text-sm flex gap-4 items-center justify-between pt-4">
                <label>HDR</label>
                <Switch checked={stores.option.hdrEnabled} onChange={(checked) => stores.option.setHdrEnabled(checked)} size="small" className="bg-slate-200" aria-label={t("启用 HDR")} />
            </div>
        </>
    );
});
