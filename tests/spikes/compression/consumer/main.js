import { CompressionProbe } from '@compression-probe/library';

globalThis.__compressionLibrary = async (pngBytes) => {
    const instance = new CompressionProbe();
    const second = new CompressionProbe();
    try {
        const optimised = await instance.encode({ mode: 'png-lossless', width: 64, height: 48,
            png: new Uint8Array(pngBytes).buffer });
        const pair = await Promise.all([instance.encode({ mode: 'png-lossy', width: 2, height: 1,
            colors: 64, pixels: new Uint8Array([120, 30, 210, 255, 0, 0, 0, 0]).buffer }),
        second.encode({ mode: 'webp-lossless', width: 2, height: 1,
            pixels: new Uint8Array([120, 30, 210, 255, 255, 255, 255, 255]).buffer })]);
        return { bytes: [...new Uint8Array(await optimised.blob.arrayBuffer())],
            tinyPng: [...new Uint8Array(await pair[0].blob.arrayBuffer())],
            pair: pair.map(x => ({ bytes: x.blob.size, type: x.blob.type })) };
    } finally { instance.dispose(); second.dispose(); }
};
