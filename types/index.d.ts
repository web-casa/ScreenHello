import type { ComponentType, ReactNode } from 'react';

export interface ScreenHelloPersistenceOptions {
    key: string;
    autoRestore?: boolean;
}

export interface ImageBeautifierProps {
    /** Instance-local UI language. Defaults to simplified Chinese. */
    locale?: 'zh-CN' | 'en-US' | 'zh-TW' | 'de-DE' | 'ko-KR' | 'es-ES' | 'pt-PT';
    /** Plain-text overrides keyed by source-language UI messages. */
    messages?: Readonly<Record<string, string>>;
    defaultImg?: string;
    headLeft?: ReactNode;
    headRight?: ReactNode;
    isDark?: boolean;
    boxClassName?: string;
    onClear?: () => void;
    persistence?: false | ScreenHelloPersistenceOptions;
    /** Enables the standalone local workspace UI. Disabled by default for library consumers. */
    workspace?: boolean;
}

export const ImageBeautifier: ComponentType<ImageBeautifierProps>;
