import { fitRect } from './deviceProjection';

const failure = () => Object.assign(new Error('device-render-failed'), { code: 'device-render-failed' });
const cancelled = () => new DOMException('Cancelled', 'AbortError');
const check = signal => { if (signal?.aborted) throw cancelled(); };
const surface = (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
};
const context = canvas => {
    const result = canvas.getContext('2d');
    if (!result) throw failure();
    return result;
};

function loadImage(url, signal) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        // Match the existing defaultImg loader: CORS-approved remote inputs must
        // remain origin-clean when decoded again for device compositing.
        if (!url.startsWith('data:')) image.crossOrigin = 'anonymous';
        let timer;
        const cleanup = () => { clearTimeout(timer); image.onload = image.onerror = null; signal?.removeEventListener('abort', abort); };
        const fail = error => { cleanup(); image.src = ''; reject(error); };
        const abort = () => fail(cancelled());
        image.onload = () => { cleanup(); resolve(image); };
        image.onerror = () => fail(failure());
        timer = setTimeout(() => fail(failure()), 10_000);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort(); else image.src = url;
    });
}

function runPixelTask(data, signal) {
    check(signal);
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../workers/deviceProjection.worker.js', import.meta.url), { type: 'module' });
        let settled = false;
        const finish = (error, pixels) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer); signal?.removeEventListener('abort', abort);
            worker.onmessage = worker.onerror = null; worker.terminate();
            if (error) reject(error); else resolve(pixels);
        };
        const abort = () => finish(cancelled());
        const timer = setTimeout(() => finish(failure()), 10_000);
        worker.onmessage = ({ data: result }) => finish(result.error ? failure() : null, result);
        worker.onerror = () => finish(failure());
        signal?.addEventListener('abort', abort, { once: true });
        try { worker.postMessage(data, [data.pixels.buffer]); } catch { finish(failure()); }
    });
}

// All allocations and URLs belong to one invocation/image instance. Heavy pixel
// work is bounded and off-thread; callers own the returned Blob URL and revoke it.
export async function renderRasterDevice(device, source, options = {}, signal) {
    check(signal);
    if (!device?.available || !source) throw failure();
    const canvases = [];
    const images = [];
    const make = (width, height) => { const result = surface(width, height); canvases.push(result); return result; };
    try {
        const urls = device.maskFromAlpha ? [device.image, source] : [device.image, source, device.mask];
        const loaded = await Promise.allSettled(urls.map(url => loadImage(url, signal)));
        for (const result of loaded) if (result.status === 'fulfilled') images.push(result.value);
        check(signal);
        if (loaded.some(result => result.status === 'rejected')) throw failure();
        const [frame, content, suppliedMask] = images;
        if (frame.naturalWidth !== (device.sourceWidth || device.width)
            || frame.naturalHeight !== (device.sourceHeight || device.height)) throw failure();
        let mask = suppliedMask, corners = device.corners, screenAspect = device.screenAspect;
        if (device.maskFromAlpha) {
            const body = make(device.width, device.height);
            const bodyContext = context(body);
            bodyContext.drawImage(frame, 0, 0, device.width, device.height);
            const framePixels = bodyContext.getImageData(0, 0, device.width, device.height).data;
            body.width = body.height = 0;
            const result = await runPixelTask({ operation: 'screen-mask', width: device.width, height: device.height,
                pixels: framePixels }, signal);
            check(signal);
            mask = make(device.width, device.height);
            context(mask).putImageData(new ImageData(result.pixels, device.width, device.height), 0, 0);
            const { x, y, width, height } = result.bounds;
            corners = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
            screenAspect = width / height;
        } else if (!mask || mask.naturalWidth !== device.width || mask.naturalHeight !== device.height) throw failure();
        const screenWidth = Math.round(Math.min(1440, 1440 * screenAspect));
        const screen = make(screenWidth, Math.round(screenWidth / screenAspect));
        const optionScale = screenWidth / 1440;
        const ctx = context(screen);
        ctx.fillStyle = options.paddingBg || '#000000'; ctx.fillRect(0, 0, screen.width, screen.height);
        const padding = Math.max(0, Math.min(screen.width / 2, (options.padding || 0) * optionScale));
        const availableWidth = Math.max(1, screen.width - padding);
        const availableHeight = screen.height * availableWidth / screen.width;
        const bounds = options.mode === 'stretch'
            ? { x: 0, y: 0, width: availableWidth, height: availableHeight }
            : fitRect(content.naturalWidth, content.naturalHeight, availableWidth, availableHeight, options.mode === 'fit' ? 'contain' : 'cover');
        ctx.save();
        ctx.translate(screen.width / 2, screen.height / 2);
        ctx.scale(options.flipX ? -1 : 1, options.flipY ? -1 : 1);
        ctx.beginPath();
        ctx.roundRect(-availableWidth / 2, -availableHeight / 2, availableWidth, availableHeight,
            Math.max(0, Math.min((options.round || 0) * optionScale, availableWidth / 2, availableHeight / 2)));
        ctx.clip();
        ctx.drawImage(content, bounds.x - availableWidth / 2, bounds.y - availableHeight / 2, bounds.width, bounds.height);
        ctx.restore();
        if (options.border?.visible) {
            const thickness = Math.max(0, Math.min(screen.width / 2, (options.border.width || 0) * optionScale));
            ctx.strokeStyle = options.border.color; ctx.lineWidth = thickness;
            ctx.strokeRect(thickness / 2, thickness / 2, screen.width - thickness, screen.height - thickness);
        }
        const pixels = ctx.getImageData(0, 0, screen.width, screen.height).data;
        const projected = await runPixelTask({ pixels, width: screen.width, height: screen.height,
            outputWidth: device.width, outputHeight: device.height, corners }, signal);
        check(signal);
        const warped = make(device.width, device.height);
        const warpedContext = context(warped);
        warpedContext.putImageData(new ImageData(projected.pixels, device.width, device.height), 0, 0);
        warpedContext.globalCompositeOperation = 'destination-in'; warpedContext.drawImage(mask, 0, 0);
        const output = make(device.width, device.height);
        const outputContext = context(output);
        if (device.maskFromAlpha) {
            outputContext.drawImage(warped, 0, 0);
            outputContext.drawImage(frame, 0, 0, device.width, device.height);
        } else {
            outputContext.drawImage(frame, 0, 0); outputContext.drawImage(warped, 0, 0);
        }
        // No caption, attribution plate, background, or lab padding in product pixels.
        const blob = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(failure()), 10_000);
            output.toBlob(result => { clearTimeout(timer); if (result?.size) resolve(result); else reject(failure()); }, 'image/png');
        });
        check(signal);
        return URL.createObjectURL(blob);
    } finally {
        images.forEach(image => { image.src = ''; });
        canvases.forEach(canvas => { canvas.width = canvas.height = 0; });
    }
}
