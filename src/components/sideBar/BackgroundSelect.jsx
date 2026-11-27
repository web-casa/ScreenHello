import { Radio } from 'antd';
import { getBackgroundEntries } from '@utils/backgroundConfig';
import { cn } from '@utils/utils';
import useI18n from '../../i18n/useI18n';

export const BackgroundSelect = ({ type, layout, options, onChange, value }) => {
    const t = useI18n();
    const labelFor = (item) => {
        const featured = /^精选渐变 (\d+)$/.exec(item.value.label || '');
        return featured ? t('精选渐变 {0}', { 0: featured[1] }) : t(item.value.label || item.key);
    };
    const lists = options?.length
        ? options
        : getBackgroundEntries(type).map((item) => ({ key: item.key, value: item }));
    const isWideLayout = layout === 'featured';
    return (
        <Radio.Group
            onChange={(e) => onChange(e.target.value)}
            value={value}
            rootClassName={cn(
                'shoteasy-background-options grid [&_span]:ps-0',
                isWideLayout ? 'grid-cols-5 gap-y-1.5' : 'grid-cols-7 gap-y-3'
            )}
        >
            {lists.map((item, index) => (
                <Radio
                    key={item.key || index}
                    className='[&_.ant-radio]:hidden [&_span]:p-0 mr-0'
                    value={item.key}
                    aria-label={labelFor(item)}
                >
                    <div
                        className={cn('w-8 h-8 rounded-full overflow-hidden', item.value.class)}
                        style={item.value.previewStyle}
                        title={labelFor(item)}
                    ></div>
                </Radio>
            ))}
        </Radio.Group>
    );
};
