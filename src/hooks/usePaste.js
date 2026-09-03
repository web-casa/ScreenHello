import { useEffect, useRef } from 'react';
import { supportImg } from '@utils/utils';

export default (toPaste, runtime) => {
    const paste = useRef(toPaste);

    useEffect(() => {
        paste.current = toPaste;
    }, [toPaste]);

    useEffect(() => {
        const getPaste = async (e) => {
            if (!runtime.isActive) return;
            const data = e.clipboardData;
            if (!data || !data.items) return;
            const items = Array.from(data.items).filter((e) =>
                supportImg.includes(e.type)
            );
            if (!items.length) return;
            const file = items[0].getAsFile();
            if (file) paste.current?.(file);
        };
        document.addEventListener('paste', getPaste, false);
        return () => {
            document.removeEventListener('paste', getPaste);
        };
    }, [runtime]);
}
