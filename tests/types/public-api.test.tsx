import { ImageBeautifier, type ImageBeautifierProps } from '../../types';

const props: ImageBeautifierProps = {
    defaultImg: 'data:image/png;base64,',
    isDark: true,
    boxClassName: 'host-editor',
    onClear: () => undefined,
    persistence: { key: 'typecheck-fixture', autoRestore: false },
    workspace: false,
    locale: 'ko-KR',
};

export const PublicApiFixture = () => <ImageBeautifier {...props} />;

const locales: NonNullable<ImageBeautifierProps['locale']>[] = ['en-US', 'zh-CN', 'zh-TW', 'de-DE', 'ko-KR', 'es-ES', 'pt-PT'];
export const LocaleApiFixture = () => locales.map((locale) => <ImageBeautifier key={locale} locale={locale} />);

// @ts-expect-error 未提供法语内置词典。
export const UnsupportedLocale = () => <ImageBeautifier locale="fr-FR" />;

// @ts-expect-error persistence 开启时必须提供稳定的 string key。
export const MissingPersistenceKey = () => <ImageBeautifier persistence={{ autoRestore: true }} />;

// @ts-expect-error isDark 是显式 boolean 控制，不接受字符串主题名。
export const InvalidTheme = () => <ImageBeautifier isDark="dark" />;
