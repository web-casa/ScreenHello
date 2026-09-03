import { useEffect } from "react"
import { tinykeys } from "tinykeys"
import { observer } from 'mobx-react-lite';
import useStores from '@stores/useStores';
import { isEditableTarget } from '@utils/domEvents';

export default observer(function HotKeys() {
    const stores = useStores();
    useEffect(() => {
        const deleteItem = () => {
            const editorTarget = stores.editor.app?.editor;
            const list = editorTarget?.list;
            if (list?.length) {
                const imageIds = list.map((item) => item.__screenhelloImageId).filter(Boolean);
                if (imageIds.length) {
                    stores.imageStore.select(imageIds);
                    stores.imageStore.removeSelected({ commit: false });
                }
                let removedShape = false;
                for (let item of list) {
                    if (item.__screenhelloImageId) continue;
                    item.remove();
                    stores.editor.removeShape(item);
                    removedShape = true;
                }
                editorTarget?.cancel();
                if (imageIds.length || removedShape) stores.history.commit();
            }
        };
        const handleZoom = type => {
            if (type === 'fit') {
                stores.editor.app?.tree.zoom(type, 100);
            } else {
                stores.editor.app?.tree.zoom(type);
            }
            stores.editor.setScale(stores.editor.app.tree.scale);
        }
        const unsubscribe = tinykeys(window, {
            'Backspace': event => {
                if (!stores.isActive || isEditableTarget(event.target)) return;
                deleteItem();
            },
            'Delete': event => {
                if (!stores.isActive || isEditableTarget(event.target)) return;
                deleteItem();
            },
            '$mod+KeyZ': event => {
                if (!stores.isActive || isEditableTarget(event.target)) return;
                event.preventDefault();
                stores.history.undo();
            },
            '$mod+Shift+KeyZ': event => {
                if (!stores.isActive || isEditableTarget(event.target)) return;
                event.preventDefault();
                stores.history.redo();
            },
            '$mod+Minus': event => {
                if (!stores.isActive || isEditableTarget(event.target)) return;
                event.preventDefault();
                handleZoom('out');
            },
            '$mod+Equal': event => {
                if (!stores.isActive || isEditableTarget(event.target)) return;
                event.preventDefault();
                handleZoom('in');
            },
            '$mod+Digit0': event => {
                if (!stores.isActive || isEditableTarget(event.target)) return;
                event.preventDefault();
                handleZoom('fit');
            }
        });
        return () => {
            unsubscribe();
        }
    }, [stores]);
    return null;
});
