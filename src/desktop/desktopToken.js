export const DESKTOP_TOKEN_PATTERN = /^[a-f0-9]{48}$/u;

export const createDesktopToken = () => {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.getRandomValues !== 'function') {
        throw Object.assign(new Error('desktop-random-unavailable'), { code: 'desktop-random-unavailable' });
    }
    const bytes = cryptoApi.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
};

export const isDesktopToken = (value) => (
    typeof value === 'string' && DESKTOP_TOKEN_PATTERN.test(value)
);
