import { lazy, Suspense, useState } from 'react';
import { observer } from 'mobx-react-lite';
import Icon from '@components/Icon';
import { Button, Tooltip } from 'antd';
import useStores from '@stores/useStores';

const CropperDialog = lazy(() => import('./CropperDialog'));

export default observer(function CropperImage() {
    const stores = useStores();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const handleCrop = () => {
        setIsModalOpen(true);
    };
    return (
        <>
            <Tooltip title='裁剪图片'>
                <Button
                type='text'
                shape='circle'
                    aria-label='裁剪图片'
                    icon={<Icon.Crop size={18} />}
                    disabled={!stores.editor.img?.src}
                    onClick={handleCrop}
                ></Button>
            </Tooltip>
            {isModalOpen && (
                <Suspense fallback={<span role="status" className="text-xs">正在加载裁剪器…</span>}>
                    <CropperDialog onClose={() => setIsModalOpen(false)} />
                </Suspense>
            )}
        </>
    );
});
