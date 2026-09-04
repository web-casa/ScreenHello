import { useEffect } from "react"
import { tinykeys } from "tinykeys"
import { isEditableTarget } from '@utils/domEvents';

export default function useKeyboardShortcuts(runtime) {
    useEffect(() => {
        const invoke = (id, { workspaceOnly = false } = {}) => (event) => {
            if (!runtime.isActive || isEditableTarget(event.target)) return;
            if (workspaceOnly && !runtime.workspace.enabled) return;
            event.preventDefault();
            void runtime.commands.execute(id);
        };
        const unsubscribe = tinykeys(window, {
            "$mod+KeyS": event => {
                if (!runtime.isActive || isEditableTarget(event.target)) return;
                event.preventDefault();
                if (runtime.workspace.enabled) void runtime.commands.execute('file.saveProject');
                else void runtime.commands.downloadCurrentImage();
            },
            '$mod+Shift+KeyS': invoke('file.saveProjectAs', { workspaceOnly: true }),
            '$mod+KeyO': invoke('file.openProject', { workspaceOnly: true }),
            '$mod+Shift+KeyE': invoke('file.openExport', { workspaceOnly: true }),
            '$mod+KeyC': invoke('file.copyFinalImage'),
            '$mod+KeyZ': invoke('edit.undo'),
            '$mod+Shift+KeyZ': invoke('edit.redo'),
            'Backspace': invoke('edit.deleteSelection'),
            'Delete': invoke('edit.deleteSelection'),
            '$mod+Minus': invoke('view.zoomOut'),
            '$mod+Equal': invoke('view.zoomIn'),
            '$mod+Digit0': invoke('view.fitCanvas'),
        });
        return unsubscribe;
    }, [runtime]);
}
