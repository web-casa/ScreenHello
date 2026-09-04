import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import View from './View';
import Zoom from './Zoom';
import BottomToolbar from './BottomToolbar';
import Icon from '@components/Icon';
import { cn } from '@utils/utils';
import useStores from '@stores/useStores';
import useImageDrop from '@hooks/useImageDrop';

export default observer(function Editor() {
    const stores = useStores();
    const [target, setTarget] = useState(null);
    const handleDropFile = async (file) => {
        if (!stores.workspace.enabled) {
            await stores.commands.replaceAllImage(file);
            return;
        }
        const command = stores.commands.get('file.replaceActiveImage');
        if (!command.enabled) {
            stores.editor.message?.info?.(command.disabledReason);
            return;
        }
        await command.execute({ file });
    };
    const showImageError = () => stores.editor.message?.error?.('图片加载失败，请选择有效图片');
    const { isDragging, dragProps } = useImageDrop(handleDropFile, showImageError);

    return (
        <div
            className={cn('shoteasy-editor-canvas overflow-hidden select-none relative shoteasy-drop-surface', isDragging && 'is-dragging')}
            {...dragProps}
        >
            {isDragging && (
                <div className="shoteasy-drop-overlay" aria-hidden="true">
                    <Icon.ImagePlus size={30} />
                    <span>释放以更换图片</span>
                </div>
            )}
            <div className="w-full h-full relative z-0" ref={
                (node) => setTarget(node)
            }>
                {target && <View target={target} />}
            </div>
            <Zoom />
            {stores.commands.annotationToolsVisible && <BottomToolbar />}
        </div>
    );
});
