import { useId } from 'react';
import { observer } from 'mobx-react-lite';
import useStores from '@stores/useStores';
import useI18n from '../../i18n/useI18n';
import { PRESET_BACKGROUNDS, QUICK_PRESET_BACKGROUNDS } from '@utils/presetBackgrounds';

export default observer(function PresetBackgroundPicker({ compact = false, onShowMore }) {
    const { option } = useStores();
    const t = useI18n();
    const titleId = useId();
    const entries = compact ? QUICK_PRESET_BACKGROUNDS : PRESET_BACKGROUNDS;
    const select = (key) => { option.applyBackground(key).catch(() => {}); };
    return (
        <section className="se-background-preset-section" aria-labelledby={titleId}>
            <div className="se-background-preset-heading">
                <h4 id={titleId}>{t('图片背景')}</h4>
                {onShowMore && <button type="button" onClick={onShowMore}>{t('全部图片（{0}）', [PRESET_BACKGROUNDS.length])}</button>}
            </div>
            {!compact && <p className="se-background-preset-hint">{t('自然风景与抽象纹理，点击应用；图片按需加载。')}</p>}
            <div className="se-background-preset-grid">
                {entries.map(entry => (
                    <button
                        key={entry.key}
                        type="button"
                        className="se-background-preset"
                        data-background-key={entry.key}
                        aria-label={t(entry.label)}
                        aria-pressed={option.background === entry.key}
                        aria-busy={option.backgroundLoadingKey === entry.key}
                        onClick={() => select(entry.key)}
                    >
                        <img src={entry.thumbnailUrl} alt="" width="240" height="160" loading="lazy" decoding="async" />
                        <span>{t(entry.label)}</span>
                    </button>
                ))}
            </div>
            {option.backgroundLoadingKey && <div className="se-background-preset-status" role="status">
                <span>{t('正在加载背景…')}</span>
                <button type="button" onClick={() => option.cancelBackgroundSelection()}>{t('取消')}</button>
            </div>}
            {option.backgroundError && <p className="se-background-preset-hint" role="alert">{t('背景加载失败，已保留原背景。请检查连接后重新选择。')}</p>}
        </section>
    );
});
