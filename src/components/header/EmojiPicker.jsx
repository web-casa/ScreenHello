import { useEffect, useRef } from 'react';
import data from '@emoji-mart/data';
import { Picker } from 'emoji-mart';

export default function EmojiPicker({ locale, onEmojiSelect, theme }) {
    const hostRef = useRef(null);
    const pickerRef = useRef(null);
    const options = { data, locale, onEmojiSelect, previewPosition: 'none', theme };
    const optionsRef = useRef(options);
    optionsRef.current = options;

    useEffect(() => {
        const picker = new Picker(optionsRef.current);
        pickerRef.current = picker;
        hostRef.current?.append(picker);
        return () => {
            picker.remove();
            pickerRef.current = null;
        };
    }, []); // Picker owns its shadow DOM; later prop changes use its public update API.

    useEffect(() => {
        pickerRef.current?.update(optionsRef.current);
    }, [locale, onEmojiSelect, theme]);

    return <div ref={hostRef} />;
}
