import { ImageBeautifier, type ImageBeautifierProps } from 'rico-screenshot';

const props: ImageBeautifierProps = {
    persistence: { key: 'installed-package-typecheck', autoRestore: false },
    boxClassName: 'host-editor',
};

export const InstalledPackageFixture = () => <ImageBeautifier {...props} />;
