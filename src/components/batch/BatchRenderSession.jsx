/* eslint-disable react-refresh/only-export-components -- 隐藏 React scene 与其 session 工厂必须共用同一动态 chunk。 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { observer } from 'mobx-react-lite';
import { App } from 'leafer-ui';
import StoreContext from '@stores/storeContext';
import { createScreenHelloRuntime } from '@stores/index';
import useStores from '@stores/useStores';
import { RenderTaskTracker } from '@stores/renderTaskTracker';
import { prepareWorkspaceImage } from '@utils/imageValidation';
import { getDefaultFrameSize } from '@utils/utils';
import { browserPlatform } from '../../platform/browserPlatform';
import FrameBox from '@components/editor/layers/FrameBox';
import Screenshot from '@components/editor/layers/Screenshot';
import Watermark from '@components/editor/layers/Watermark';
import { batchError } from '@utils/batchContract';

const nextFrame = (signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
        reject(batchError('batch-cancelled'));
        return;
    }
    const schedule = globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0));
    const cancel = globalThis.cancelAnimationFrame || clearTimeout;
    let frame = 0;
    const abort = () => {
        cancel(frame);
        reject(batchError('batch-cancelled'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    frame = schedule(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
    });
});

const waitViewCompleted = (tree, signal) => new Promise((resolve, reject) => {
    if (!tree?.waitViewCompleted) {
        reject(batchError('batch-render-unavailable'));
        return;
    }
    if (signal?.aborted) {
        reject(batchError('batch-cancelled'));
        return;
    }
    let settled = false;
    const abort = () => {
        if (settled) return;
        settled = true;
        reject(batchError('batch-cancelled'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    tree.waitViewCompleted(() => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        resolve();
    });
});

const BatchScene = observer(function BatchScene({ target, onReady }) {
    const stores = useStores();
    const [app, setApp] = useState(null);
    useEffect(() => {
        const width = Math.max(1, Number(target.dataset.width) || 1);
        const height = Math.max(1, Number(target.dataset.height) || 1);
        const app = new App({
            view: target,
            width,
            height,
            tree: { type: 'design', usePartRender: false, width, height },
            sky: { type: 'draw', usePartRender: false, width, height },
        });
        stores.editor.setApp(app);
        setApp(app);
        onReady(app);
        return () => {
            if (stores.editor.app === app) stores.editor.setApp(null);
            app.destroy(true);
        };
    }, [onReady, stores, target]);

    if (!app?.tree) return null;
    return (
        <FrameBox parent={app.tree} cursor="auto" {...stores.option.frameConf}>
            {stores.imageStore.list.map((layer) => (
                <Screenshot key={`${layer.id}:${layer.zIndex}`} layer={layer} />
            ))}
            {stores.option.waterImg && <Watermark />}
        </FrameBox>
    );
});

class BatchRenderSession {
    constructor({ runtime, reactRoot, container, app, baseOption, tracker }) {
        this.runtime = runtime;
        this.reactRoot = reactRoot;
        this.container = container;
        this.app = app;
        this.baseOption = baseOption;
        this.tracker = tracker;
        this.disposed = false;
    }

    get target() {
        return this.app?.tree;
    }

    get size() {
        return {
            width: this.runtime.option.frameConf.width,
            height: this.runtime.option.frameConf.height,
        };
    }

    _assert(signal) {
        if (this.disposed || signal?.aborted) throw batchError('batch-cancelled');
    }

    async prepare(file, { signal } = {}) {
        this._assert(signal);
        await this.clear();
        this._assert(signal);
        this.runtime.option.restoreFromDocument(this.baseOption);
        const prepared = await prepareWorkspaceImage(file, { retainObjectUrl: true, role: 'batch-image' });
        if (signal?.aborted || this.disposed) {
            browserPlatform.file.revokeObjectURL(prepared.url);
            throw batchError('batch-cancelled');
        }
        if (this.runtime.option.size.type === 'auto') {
            const frame = getDefaultFrameSize(prepared.width, prepared.height);
            this.runtime.option.setFrameSize(frame.width, frame.height);
        }
        const { width, height } = this.runtime.option.frameConf;
        this.container.dataset.width = String(width);
        this.container.dataset.height = String(height);
        this.container.style.width = `${width}px`;
        this.container.style.height = `${height}px`;
        this.app.resize({ width, height, pixelRatio: 1 });
        try {
            this.runtime.imageStore.replaceAll({
                src: prepared.url,
                width: prepared.width,
                height: prepared.height,
                type: file.type,
                name: file.name,
                blob: file,
                _ownsObjectUrl: true,
            });
        } catch (error) {
            browserPlatform.file.revokeObjectURL(prepared.url);
            throw error;
        }
    }

    async waitUntilReady({ signal } = {}) {
        this._assert(signal);
        await nextFrame(signal);
        await this.tracker.waitForIdle(signal);
        await nextFrame(signal);
        await this.tracker.waitForIdle(signal);
        await waitViewCompleted(this.app.tree, signal);
        this._assert(signal);
    }

    async clear() {
        this.runtime.imageStore.clearAll({ release: true, incrementBaseline: false });
        await this.tracker.waitForIdle();
    }

    async dispose() {
        if (this.disposed) return;
        this.disposed = true;
        let cleanupError = null;
        try {
            await this.clear();
        } catch (error) {
            cleanupError = error;
        }
        try {
            this.reactRoot.unmount();
        } catch (error) {
            if (!cleanupError) cleanupError = error;
        }
        try {
            this.runtime.dispose();
        } catch (error) {
            if (!cleanupError) cleanupError = error;
        }
        this.container.remove();
        if (cleanupError) throw batchError('batch-render-release-failed', cleanupError);
    }
}

export async function createBatchRenderSession({ style, signal }) {
    if (!globalThis.document?.body) throw batchError('batch-render-unavailable');
    if (signal?.aborted) throw batchError('batch-cancelled');
    const tracker = new RenderTaskTracker();
    const runtime = createScreenHelloRuntime({ renderTaskTracker: tracker, batchEnabled: false });
    let container = null;
    let reactRoot = null;
    try {
        const option = structuredClone(style.option);
        if (style.backgroundBlob) {
            await prepareWorkspaceImage(style.backgroundBlob, { role: 'batch-background-image' });
            if (signal?.aborted) throw batchError('batch-cancelled');
            const asset = runtime.assetStore.add(style.backgroundBlob);
            if (!asset) throw batchError('batch-background-unavailable');
            option.backgroundAssetId = asset.id;
            option.frameConf.background = {
                ...(option.frameConf.background || {}),
                type: 'image',
                url: asset.url,
                mode: option.backgroundMode,
                align: option.backgroundAlign,
            };
        }
        runtime.option.restoreFromDocument(option);
        const baseOption = runtime.option.toDocument();
        // Preserve the isolated AssetStore reference removed by toDocument().
        baseOption.backgroundAssetId = runtime.option.backgroundAssetId;
        if (runtime.option.frameConf.background?.type === 'image') {
            baseOption.frameConf.background = { ...runtime.option.frameConf.background };
        }

        container = document.createElement('div');
        const { width, height } = runtime.option.frameConf;
        container.dataset.width = String(width);
        container.dataset.height = String(height);
        container.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;overflow:hidden;pointer-events:none;visibility:hidden;`;
        container.setAttribute('aria-hidden', 'true');
        document.body.appendChild(container);
        reactRoot = createRoot(container);
        let resolveApp;
        let rejectApp;
        const appReady = new Promise((resolve, reject) => {
            resolveApp = resolve;
            rejectApp = reject;
        });
        const timeout = setTimeout(() => rejectApp(batchError('batch-render-timeout')), 10_000);
        const abortReady = () => rejectApp(batchError('batch-cancelled'));
        signal?.addEventListener('abort', abortReady, { once: true });
        if (signal?.aborted) abortReady();
        const onReady = (app) => resolveApp(app);
        reactRoot.render(
            <StoreContext.Provider value={runtime}>
                <BatchScene target={container} onReady={onReady} />
            </StoreContext.Provider>
        );
        const app = await appReady.finally(() => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', abortReady);
        });
        return new BatchRenderSession({ runtime, reactRoot, container, app, baseOption, tracker });
    } catch (error) {
        try {
            reactRoot?.unmount();
        } catch {
            // 仍继续释放 runtime 与 DOM。
        }
        try {
            runtime.dispose();
        } catch {
            // 原始创建错误优先，其他 owned 资源继续释放。
        }
        container?.remove();
        throw error;
    }
}
