import { Button, Drawer, Segmented, Slider } from 'antd';
import { useId } from 'react';
import { observer } from 'mobx-react-lite';
import Icon from '@components/Icon';
import ColorPicker from '@components/ColorPicker';
import useStores from '@stores/useStores';
import colorSvg from '@assets/color.svg?no-inline';
import UploadBackground from './UploadBackground';
import { BackgroundSelect } from './BackgroundSelect';
import { getBackgroundDefinition } from '@utils/backgroundConfig';

const BACKGROUND_POSITIONS = [
    ['top-left', '左上'], ['top', '上'], ['top-right', '右上'],
    ['left', '左'], ['center', '居中'], ['right', '右'],
    ['bottom-left', '左下'], ['bottom', '下'], ['bottom-right', '右下'],
];

export default observer(function DrawerBar({ showMore, onChange }) {
    const stores = useStores();
    const gradientAngleId = useId();
    const onMoreClose = () => {
        onChange(false);
    }
    const handleCustom = (e) => {
        const color = e.toHexString();
        stores.option.setCustomSolidBackground(color);
    }
    const onSelectChange = (key) => {
        stores.option.applyBackground(key).catch(() => {
            stores.editor.message.error('背景加载失败，请重试');
        });
    }
    const backgroundDefinition = getBackgroundDefinition(stores.option.background);
    const isImageBackground = backgroundDefinition?.type === 'upload-image';
    return (
        <Drawer
            title=""
            placement="right"
            closable={false}
            mask={false}
            onClose={onMoreClose}
            open={showMore}
            getContainer={false}
            size="100%"
            className="[&_.ant-drawer-body]:p-0"
        >
            <div className="shoteasy-background-drawer flex flex-col gap-2 h-full overflow-hidden">
                <div className="shrink-0 pt-4 px-4">
                    <Button
                        type="text"
                        size="small"
                        className="text-xs flex items-center opacity-80 m-0"
                        icon={<Icon.ChevronRight size={16} />}
                        iconPlacement="end"
                        onClick={() => onChange(false)}
                    >返回</Button>
                </div>
                <div className="h-0 flex-1 overflow-y-auto px-4 py-4">
                    <h4 className="text-sm font-medium py-4">上传图片</h4>
                    <div className="pb-2">
                        <UploadBackground />
                    </div>
                    {isImageBackground && (
                        <div className="border-y border-slate-200/10 py-6">
                            <h4 className="text-sm font-medium py-4">图片背景</h4>
                            <Segmented
                                block
                                size="small"
                                value={stores.option.backgroundMode}
                                onChange={(value) => stores.option.setBackgroundMode(value)}
                                options={[
                                    { label: '覆盖', value: 'cover' },
                                    { label: '包含', value: 'fit' },
                                    { label: '拉伸', value: 'stretch' },
                                ]}
                            />
                            <div className="grid grid-cols-3 gap-1 pt-2" aria-label="背景位置">
                                {BACKGROUND_POSITIONS.map(([value, label]) => (
                                    <Button
                                        key={value}
                                        type={stores.option.backgroundAlign === value ? 'primary' : 'default'}
                                        size="small"
                                        className="h-7 px-1 text-xs"
                                        aria-pressed={stores.option.backgroundAlign === value}
                                        onClick={() => stores.option.setBackgroundAlign(value)}
                                    >{label}</Button>
                                ))}
                            </div>
                        </div>
                    )}
                    <h4 className="text-sm font-medium py-4">背景效果</h4>
                    <div className="pb-3">
                        <div className="flex items-center justify-between">
                            <label>模糊</label>
                            <span className="text-xs text-gray-500">{Math.round(stores.option.backgroundBlur)}px</span>
                        </div>
                        <Slider min={0} max={30} value={stores.option.backgroundBlur} onChange={(v) => stores.option.setBackgroundBlur(v)} ariaLabelForHandle="背景模糊" />
                    </div>
                    <div className="pb-3">
                        <div className="flex items-center justify-between">
                            <label>遮罩</label>
                            <ColorPicker value={stores.option.backgroundMaskColor} onChange={(e) => stores.option.setBackgroundMaskColor(e.toHexString())} size="small" aria-label="背景遮罩颜色" />
                        </div>
                        <Slider min={0} max={1} step={0.05} value={stores.option.backgroundMaskOpacity} onChange={(v) => stores.option.setBackgroundMaskOpacity(v)} ariaLabelForHandle="背景遮罩不透明度" />
                    </div>
                    <div className="pb-3">
                        <div className="flex items-center justify-between">
                            <label>噪点</label>
                            <span className="text-xs text-gray-500">{Math.round(stores.option.backgroundNoise * 100)}%</span>
                        </div>
                        <Slider min={0} max={1} step={0.05} value={stores.option.backgroundNoise} onChange={(v) => stores.option.setBackgroundNoise(v)} ariaLabelForHandle="背景噪点强度" />
                    </div>
                    <h4 className="text-sm font-medium py-4">无背景</h4>
                    <BackgroundSelect type="none" onChange={onSelectChange} value={stores.option.background} />
                    <h4 className="text-sm font-medium py-4">纯色</h4>
                    <div className="flex items-center justify-between py-1">
                        <span className="text-xs text-gray-500">自定义颜色</span>
                        <ColorPicker onChange={handleCustom}>
                            <Button type="default" size="small" shape="circle" aria-label="自定义纯色背景" icon={<img src={colorSvg} width={18} alt="" />} />
                        </ColorPicker>
                    </div>
                    <BackgroundSelect type="solid" onChange={onSelectChange} value={stores.option.background} />
                    <h4 className="text-sm font-medium py-4">渐变</h4>
                    <BackgroundSelect type="gradient" onChange={onSelectChange} value={stores.option.background} />
                    {backgroundDefinition?.type === 'gradient' && (
                        <div className="pb-3 pt-2">
                            <div className="flex items-center justify-between text-xs">
                                <label htmlFor={gradientAngleId}>渐变角度</label>
                                <span className="text-gray-500">{stores.option.backgroundGradientAngle}°</span>
                            </div>
                            <Slider
                                id={gradientAngleId}
                                min={0}
                                max={360}
                                step={1}
                                value={stores.option.backgroundGradientAngle}
                                onChange={(value) => stores.option.setBackgroundGradientAngle(value, { commit: false })}
                                onChangeComplete={(value) => stores.option.setBackgroundGradientAngle(value)}
                                ariaLabelForHandle="渐变角度"
                            />
                        </div>
                    )}
                </div>
            </div>
        </Drawer>
    )
});
