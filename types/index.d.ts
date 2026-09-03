import type { ComponentType, ReactNode } from 'react';

export interface ScreenHelloPersistenceOptions {
    key: string;
    autoRestore?: boolean;
}

export interface ImageBeautifierProps {
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
