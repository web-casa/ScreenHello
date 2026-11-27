import { useEffect, useState } from 'react';

const idle = Object.freeze({ mod: false, v: false });

/** Mirrors the physical paste chord so the on-screen keycaps can echo it. */
export default function usePressedKeys() {
    const [pressed, setPressed] = useState(idle);
    useEffect(() => {
        const read = (event, down) => {
            const key = event.key === 'Control' || event.key === 'Meta' ? 'mod' : (event.key?.toLowerCase() === 'v' ? 'v' : null);
            if (key) setPressed((state) => (state[key] === down ? state : { ...state, [key]: down }));
        };
        const onDown = (event) => read(event, true);
        const onUp = (event) => {
            // macOS swallows keyup for letters while ⌘ is held; releasing ⌘ clears both.
            if (event.key === 'Meta') setPressed(idle);
            else read(event, false);
        };
        const reset = () => setPressed(idle);
        window.addEventListener('keydown', onDown);
        window.addEventListener('keyup', onUp);
        window.addEventListener('blur', reset);
        return () => {
            window.removeEventListener('keydown', onDown);
            window.removeEventListener('keyup', onUp);
            window.removeEventListener('blur', reset);
        };
    }, []);
    return pressed;
}
