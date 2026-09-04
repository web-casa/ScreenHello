import Icon from '@components/Icon';
import useStores from '@stores/useStores';

/**
 * 本地图片上传为背景的共享入口。
 * 默认渲染抽屉里的大虚线卡片；compact 渲染检查器「图片」行的图标按钮。
 */
export default function UploadBackground({ compact = false }) {
    const stores = useStores();
    const handleUpload = (event) => {
        const file = event.target.files?.[0];
        if (file?.type?.startsWith('image/')) {
            const asset = stores.assetStore.add(file);
            if (asset) stores.option.setUploadedBackground(asset);
        }
        // 允许连续选择同一张图重新触发 change
        event.target.value = '';
    };
    if (compact) {
        return (
            <label className="shoteasy-bg-upload-compact" title="上传本地图片">
                <Icon.Upload size={16} />
                <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    aria-label="上传本地图片"
                    onChange={handleUpload}
                />
            </label>
        );
    }
    return (
        <label className="shoteasy-bg-upload-tile">
            <Icon.ImagePlus size={18} />
            <span>选择本地图片</span>
            <input type="file" accept="image/*" className="sr-only" onChange={handleUpload} />
        </label>
    );
}
