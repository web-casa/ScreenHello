import { ImageBeautifier, type ImageBeautifierProps } from 'rico-screenshot';

const props: ImageBeautifierProps = {
    persistence: { key: 'installed-package-typecheck', autoRestore: false },
    boxClassName: 'host-editor',
    locale: 'en-US',
    messages: { 文件: 'My files' },
};

export const InstalledPackageFixture = () => <ImageBeautifier {...props} />;
