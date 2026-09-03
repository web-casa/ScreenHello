import { useEffect, useRef } from "react"
import { tinykeys } from "tinykeys"
import { isEditableTarget } from '@utils/domEvents';

export default function useKeyboardShortcuts(toSave, toCopy, runtime) {
    const save = useRef(toSave);
    const copy = useRef(toCopy);

    useEffect(() => {
        save.current = toSave;
        copy.current = toCopy;
    });

    useEffect(() => {
        const unsubscribe = tinykeys(window, {
            "$mod+KeyS": event => {
                if (!runtime.isActive || isEditableTarget(event.target)) return;
                event.preventDefault()
                save.current && save.current();
            },
            "$mod+KeyC": event => {
                if (!runtime.isActive || isEditableTarget(event.target)) return;
                event.preventDefault()
                copy.current && copy.current();
            }
        })
        return () => {
            unsubscribe();
        }
    }, [runtime]);
}
