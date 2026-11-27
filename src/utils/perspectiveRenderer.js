import { warpPerspectiveImage } from './deviceProjection';
import { computePerspectiveGeometry, normalizePerspective } from './perspectiveSchema';
import { getBrowserHeaderHeight, getFrameDefinition } from './frameConfig';

const PREVIEW_MAX_EDGE = 1440;
const PREVIEW_MAX_PIXELS = 2_073_600;
const EXPORT_MAX_EDGE = 2048;
const EXPORT_MAX_PIXELS = 4_194_304;

const cancelled = () => new DOMException('Cancelled', 'AbortError');
const failed = (code = 'perspective-render-failed') => Object.assign(new Error(code), { code });
const checkSignal = (signal) => { if (signal?.aborted) throw cancelled(); };

const createCanvas = (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
};

const loadImage = (url, signal) => new Promise((resolve, reject) => {
    const img = new Image();
    if (!url.startsWith('data:')) img.crossOrigin = 'anonymous';
    let timer;
    const cleanup = () => {
        clearTimeout(timer);
        img.onload = img.onerror = null;
        signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); img.src = ''; reject(cancelled()); };
    img.onload = () => { cleanup(); resolve(img); };
    img.onerror = () => { cleanup(); img.src = ''; reject(failed()); };
    timer = setTimeout(() => { cleanup(); img.src = ''; reject(failed()); }, 10_000);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else img.src = url;
});

const runPerspectiveWarp = (payload, signal) => {
    checkSignal(signal);
    if (typeof Worker === 'undefined') {
        return Promise.resolve({ pixels: warpPerspectiveImage(payload) });
    }
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../workers/deviceProjection.worker.js', import.meta.url), { type: 'module' });
        let settled = false;
        const finish = (err, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            worker.onmessage = worker.onerror = null;
            worker.terminate();
            if (err) reject(err);
            else resolve(result);
        };
        const onAbort = () => finish(cancelled());
        const timer = setTimeout(() => finish(failed()), 12_000);
        worker.onmessage = ({ data }) => finish(data?.error ? failed() : null, data);
        worker.onerror = () => finish(failed());
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            worker.postMessage({ operation: 'perspective-warp', ...payload }, [payload.pixels.buffer]);
        } catch {
            finish(failed());
        }
    });
};

const traceRoundedRect = (ctx, x, y, w, h, r) => {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
};

const drawBrowserChrome = (ctx, width, headerHeight, definition, browserUrl, scale) => {
    const isDark = definition.theme === 'dark';
    const isArc = definition.kind === 'arc';
    ctx.fillStyle = isDark ? '#20242c' : (isArc ? 'rgba(246, 248, 252, 0.96)' : '#f3f4f6');
    ctx.fillRect(0, 0, width, headerHeight);

    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
    ctx.fillRect(0, headerHeight - Math.max(1, scale), width, Math.max(1, scale));

    const dotRadius = Math.max(3, Math.min(7, headerHeight * 0.13));
    const dotGap = dotRadius * 3.1;
    const dotY = headerHeight / 2;
    const startX = Math.max(14 * scale, dotRadius * 2.6);
    ['#ff5f56', '#ffbd2e', '#27c93f'].forEach((color, idx) => {
        ctx.beginPath();
        ctx.arc(startX + idx * dotGap, dotY, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
    });

    const urlText = String(browserUrl || '').trim();
    if (urlText) {
        const pillW = Math.min(width * 0.48, Math.max(140 * scale, width - startX * 3 - dotGap * 3));
        const pillH = Math.max(18 * scale, headerHeight * 0.54);
        const pillX = (width - pillW) / 2;
        const pillY = (headerHeight - pillH) / 2;
        traceRoundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)';
        ctx.fill();
        ctx.fillStyle = isDark ? '#cbd5e1' : '#475569';
        ctx.font = `500 ${Math.max(10, Math.round(headerHeight * 0.25))}px Inter, ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(urlText, width / 2, headerHeight / 2, pillW - 16 * scale);
    }
};

const drawFramedSource = (canvas, img, options, renderScale) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw failed();
    const width = canvas.width;
    const height = canvas.height;
    const definition = getFrameDefinition(options.frame || 'none');
    const isBrowser = definition.kind === 'browser' || definition.kind === 'arc';
    const inset = (!isBrowser && definition.kind !== 'none' && definition.kind !== 'stroke')
        ? Math.round((definition.inset || 0) * renderScale)
        : 0;
    const bottomInset = (!isBrowser && definition.kind !== 'none' && definition.kind !== 'stroke')
        ? Math.round((definition.bottom || definition.inset || 0) * renderScale)
        : 0;
    const headerHeight = isBrowser
        ? Math.round(getBrowserHeaderHeight(options.frame, options.browserHeaderSize || 100) * renderScale)
        : 0;
    const round = Math.max(0, Math.round((options.round ?? 10) * renderScale));

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    traceRoundedRect(ctx, 0, 0, width, height, round);
    ctx.clip();

    // Frame outer backdrop (card / glass / polaroid / browser)
    if (definition.kind === 'card' || definition.kind === 'polaroid') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
    } else if (definition.kind === 'glass') {
        ctx.fillStyle = definition.glass === 'dark' ? 'rgba(18, 22, 30, 0.72)' : 'rgba(255, 255, 255, 0.62)';
        ctx.fillRect(0, 0, width, height);
    } else if (definition.kind === 'stack' || definition.kind === 'stack2') {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.fillRect(0, 0, width, height);
    }

    if (isBrowser && headerHeight > 0) {
        drawBrowserChrome(ctx, width, headerHeight, definition, options.browserUrl, renderScale);
    }

    const boxX = inset;
    const boxY = headerHeight + inset;
    const boxW = Math.max(1, width - inset * 2);
    const boxH = Math.max(1, height - headerHeight - inset - bottomInset);
    const pad = Math.max(0, Math.min(Math.min(boxW, boxH) * 0.45, Math.round((options.padding || 0) * renderScale)));

    if (pad > 0) {
        ctx.fillStyle = options.paddingBg || '#ffffff';
        ctx.fillRect(boxX, boxY, boxW, boxH);
    }

    const imgX = boxX + pad / 2;
    const imgY = boxY + pad / 2;
    const imgW = Math.max(1, boxW - pad);
    const imgH = Math.max(1, boxH - pad);

    ctx.save();
    if (!isBrowser && round > 0 && inset > 0) {
        traceRoundedRect(ctx, imgX, imgY, imgW, imgH, Math.max(0, round - inset * 0.4));
        ctx.clip();
    }
    ctx.translate(imgX + imgW / 2, imgY + imgH / 2);
    ctx.scale(options.flipX ? -1 : 1, options.flipY ? -1 : 1);
    ctx.drawImage(img, -imgW / 2, -imgH / 2, imgW, imgH);
    ctx.restore();

    if (options.innerBorder?.visible && options.innerBorder.width > 0) {
        const bw = Math.max(1, options.innerBorder.width * renderScale);
        ctx.strokeStyle = options.innerBorder.color || 'rgba(255,255,255,0.6)';
        ctx.lineWidth = bw;
        traceRoundedRect(ctx, boxX + bw / 2, boxY + bw / 2, boxW - bw, boxH - bw, isBrowser ? 0 : Math.max(0, round - bw / 2));
        ctx.stroke();
    }

    if (definition.kind === 'stroke') {
        const sw = Math.max(2, 6 * renderScale);
        ctx.strokeStyle = definition.color || 'rgba(255,255,255,0.5)';
        ctx.lineWidth = sw;
        traceRoundedRect(ctx, sw / 2, sw / 2, width - sw, height - sw, Math.max(0, round - sw / 2));
        ctx.stroke();
    } else if (definition.kind === 'glass' || isBrowser) {
        ctx.strokeStyle = definition.theme === 'dark' || definition.glass === 'dark'
            ? 'rgba(255,255,255,0.18)'
            : 'rgba(15,23,42,0.12)';
        ctx.lineWidth = Math.max(1, 1.5 * renderScale);
        traceRoundedRect(ctx, 0.75, 0.75, width - 1.5, height - 1.5, Math.max(0, round - 0.75));
        ctx.stroke();
    }

    ctx.restore();
};

/**
 * 渲染带 3D 透视与定向阴影的离线 PNG Blob URL。
 * quality: 'preview'（画布交互，长边 <= 1440）| 'export'（按目标倍率，长边 <= 2048）。
 */
export async function renderPerspectiveLayer(sourceUrl, logicalWidth, logicalHeight, options = {}, signal) {
    checkSignal(signal);
    if (!sourceUrl) throw failed();
    const perspective = normalizePerspective(options.perspective);
    const geometry = computePerspectiveGeometry(logicalWidth, logicalHeight, perspective, options.shadow);
    const isExport = options.quality === 'export';
    const maxEdge = isExport ? EXPORT_MAX_EDGE : PREVIEW_MAX_EDGE;
    const maxPixels = isExport ? EXPORT_MAX_PIXELS : PREVIEW_MAX_PIXELS;
    const desiredScale = Math.max(1, Math.min(3, Number(options.pixelRatio) || (isExport ? 2 : 1.5)));

    // 计算统一渲染倍率，保证源与输出都严格落在像素/边长预算内。
    const edgeLimitScale = maxEdge / Math.max(logicalWidth, logicalHeight, geometry.totalWidth, geometry.totalHeight, 1);
    const pixelLimitScale = Math.sqrt(maxPixels / Math.max(1, Math.max(logicalWidth * logicalHeight, geometry.totalWidth * geometry.totalHeight)));
    const renderScale = Math.max(0.25, Math.min(desiredScale, edgeLimitScale, pixelLimitScale));

    const srcW = Math.max(1, Math.min(maxEdge, Math.round(logicalWidth * renderScale)));
    const srcH = Math.max(1, Math.min(maxEdge, Math.round(logicalHeight * renderScale)));
    const outW = Math.max(1, Math.min(maxEdge, Math.round(geometry.totalWidth * renderScale)));
    const outH = Math.max(1, Math.min(maxEdge, Math.round(geometry.totalHeight * renderScale)));
    const scaledCorners = geometry.corners.map(([x, y]) => [x * renderScale, y * renderScale]);

    const canvases = [];
    const trackCanvas = (w, h) => { const c = createCanvas(w, h); canvases.push(c); return c; };

    try {
        const img = await loadImage(sourceUrl, signal);
        checkSignal(signal);

        const sourceCanvas = trackCanvas(srcW, srcH);
        drawFramedSource(sourceCanvas, img, options, renderScale);
        const sourceCtx = sourceCanvas.getContext('2d');
        const srcPixels = sourceCtx.getImageData(0, 0, srcW, srcH).data;
        sourceCanvas.width = sourceCanvas.height = 0;

        const warped = await runPerspectiveWarp({
            pixels: srcPixels,
            width: srcW,
            height: srcH,
            outputWidth: outW,
            outputHeight: outH,
            corners: scaledCorners,
        }, signal);
        checkSignal(signal);

        const warpCanvas = trackCanvas(outW, outH);
        warpCanvas.getContext('2d').putImageData(new ImageData(warped.pixels, outW, outH), 0, 0);

        const finalCanvas = trackCanvas(outW, outH);
        const finalCtx = finalCanvas.getContext('2d');
        finalCtx.clearRect(0, 0, outW, outH);

        // 先绘制定向立体阴影，再叠加投影后的清晰主体。
        const shadow = options.shadow;
        if (shadow?.visible !== false) {
            finalCtx.save();
            finalCtx.shadowColor = shadow?.color || 'rgba(0, 0, 0, 0.32)';
            finalCtx.shadowBlur = Math.max(0, (geometry.shadowBlur || 18) * renderScale);
            finalCtx.shadowOffsetX = (geometry.shadowOffsetX || 0) * renderScale;
            finalCtx.shadowOffsetY = (geometry.shadowOffsetY || 14) * renderScale;
            finalCtx.drawImage(warpCanvas, 0, 0);
            finalCtx.restore();
        }
        finalCtx.drawImage(warpCanvas, 0, 0);

        // 轻量 1px 立体玻璃高光描边，提升暗/亮背景下的轮廓立体感。
        finalCtx.save();
        finalCtx.beginPath();
        scaledCorners.forEach(([x, y], idx) => (idx === 0 ? finalCtx.moveTo(x, y) : finalCtx.lineTo(x, y)));
        finalCtx.closePath();
        finalCtx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        finalCtx.lineWidth = Math.max(1, renderScale);
        finalCtx.stroke();
        finalCtx.restore();

        const blob = await new Promise((resolve, reject) => {
            finalCanvas.toBlob((result) => (result ? resolve(result) : reject(failed())), 'image/png');
        });
        checkSignal(signal);
        return {
            url: URL.createObjectURL(blob),
            geometry,
            pixelWidth: outW,
            pixelHeight: outH,
        };
    } finally {
        canvases.forEach((c) => { c.width = 0; c.height = 0; });
    }
}
