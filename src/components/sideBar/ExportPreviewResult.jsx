import { useEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import useI18n from '../../i18n/useI18n';
import useStores from '@stores/useStores';
import { formatExportBytes, loadExportPreview } from '@utils/exportPreview';

export default function ExportPreviewResult({ prepared, disabled, onFailure }) {
    const t = useI18n();
    const { i18n } = useStores();
    const { result, settings } = prepared;
    const [side, setSide] = useState('output');
    const [zoom, setZoom] = useState(false);
    const [dark, setDark] = useState(false);
    const [displayedBlob, setDisplayedBlob] = useState(null);
    const viewport = useRef(null);
    const scroll = useRef({ left: 0, top: 0 });
    const failureRef = useRef(onFailure);
    useEffect(() => { failureRef.current = onFailure; }, [onFailure]);
    const blob = side === 'output' ? result.blob : result.referenceBlob;
    const loading = displayedBlob !== blob;
    useEffect(() => {
        const controller = new AbortController();
        let lease;
        setDisplayedBlob(null);
        void loadExportPreview(blob, { width: result.width, height: result.height, signal: controller.signal }).then(next => {
            if (controller.signal.aborted) { next.release(); return; }
            lease = next;
            next.image.setAttribute('aria-hidden', 'true');
            viewport.current?.append(next.image);
            viewport.current?.scrollTo(scroll.current.left, scroll.current.top);
            setDisplayedBlob(blob);
        }).catch(error => {
            if (!controller.signal.aborted) failureRef.current(error);
        });
        const element = viewport.current;
        return () => {
            if (element) scroll.current = { left: element.scrollLeft, top: element.scrollTop };
            controller.abort(); lease?.release();
        };
    }, [blob, result.width, result.height]);
    const bytes = value => formatExportBytes(value, i18n.locale);
    const summary = result.summary;

    return (
        <section className="shoteasy-compression-preview" aria-label={t('压缩预览')} data-testid="compression-result">
            <div className="shoteasy-preview-tabs" role="group" aria-label={t('画质对比')}>
                <Button disabled={disabled} aria-pressed={side === 'reference'} onClick={() => setSide('reference')} data-testid="preview-reference">{t('标准参照')}</Button>
                <Button disabled={disabled} aria-pressed={side === 'output'} onClick={() => setSide('output')} data-testid="preview-output">{t('导出结果')}</Button>
            </div>
            <div className="shoteasy-preview-surface" data-dark={dark} data-zoom={zoom}>
                <div ref={viewport} className="shoteasy-preview-viewport" tabIndex={0} role="region"
                    aria-label={`${side === 'output' ? t('导出结果') : t('标准参照')} · ${zoom ? '100%' : t('适应预览')}`}
                    aria-busy={loading} data-testid="preview-viewport" />
                {loading ? <span className="shoteasy-preview-loading" role="status">{t('正在解码预览…')}</span> : null}
            </div>
            <div className="shoteasy-preview-tools">
                <Button disabled={disabled} aria-pressed={zoom} onClick={() => setZoom(value => !value)} data-testid="preview-zoom">{zoom ? t('适应预览') : t('100% 查看')}</Button>
                <Button disabled={disabled} aria-pressed={dark} onClick={() => setDark(value => !value)} data-testid="preview-background">{dark ? t('浅色预览底') : t('深色预览底')}</Button>
            </div>
            <p className="shoteasy-export-note">{t('预览底色不写入文件；100% 下可滚动查看细节。')}</p>
            <dl className="shoteasy-preview-bytes">
                <div><dt>{t('标准参照')}</dt><dd title={`${summary.referenceBytes} B`}>{bytes(summary.referenceBytes)}</dd></div>
                <div><dt>{t('导出结果')}</dt><dd title={`${summary.outputBytes} B`} data-testid="preview-bytes">{bytes(summary.outputBytes)}</dd></div>
            </dl>
            <p className="shoteasy-export-note">{t('对比基于同一画面、同一尺寸的标准导出，不是导入原图。')}</p>
            {settings.format === 'png' && settings.compression ? (
                <p className="shoteasy-preview-saving" role="status">
                    {summary.noGain && settings.compression === 'lossless'
                        ? t('本次无进一步缩小，保留标准 PNG。')
                        : summary.savedBytes > 0
                            ? t('减少 {0}（{1}%）', { 0: bytes(summary.savedBytes), 1: new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 1 }).format(summary.savingsPercent) })
                            : summary.savedBytes < 0
                                ? t('结果增大 {0}；可切回标准导出或无损优化。', { 0: bytes(-summary.savedBytes) })
                                : t('文件大小未变。')}
                </p>
            ) : null}
            {summary.warnings.length ? <p className="shoteasy-export-warning" role="status">{t('部分增强效果不可用，本次按画面中的回退效果导出。')}</p> : null}
        </section>
    );
}
