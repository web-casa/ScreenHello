import { ImageBeautifier, type ImageBeautifierProps } from '../../types';

const props: ImageBeautifierProps = {
    defaultImg: 'data:image/png;base64,',
    isDark: true,
    boxClassName: 'host-editor',
    onClear: () => undefined,
    persistence: { key: 'typecheck-fixture', autoRestore: false },
    workspace: false,
};

export const PublicApiFixture = () => <ImageBeautifier {...props} />;

// @ts-expect-error persistence 开启时必须提供稳定的 string key。
export const MissingPersistenceKey = () => <ImageBeautifier persistence={{ autoRestore: true }} />;

// @ts-expect-error isDark 是显式 boolean 控制，不接受字符串主题名。
export const InvalidTheme = () => <ImageBeautifier isDark="dark" />;
