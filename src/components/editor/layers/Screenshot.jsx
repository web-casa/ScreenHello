import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Box, Rect } from 'leafer-ui';
import useStores from '@stores/useStores';
import { computedSize, enhanceImageToHdr, getPosition, getRotatedPosition, getMargin } from '@utils/utils';
import { createFrameDecorations, getBrowserHeaderHeight, getFrameDefinition, getFrameMetrics, isDeviceFrame } from '@utils/frameConfig';
import { debounce } from 'lodash';

const addBefore = (parent, node, reference) => {
    const index = parent.children?.indexOf?.(reference);
    parent.add(node, Number.isInteger(index) && index >= 0 ? index : undefined);
};

// 图片层保持在 0～1 之间：按 ProjectDocument zIndex 排序，同时继续位于
// zIndex>=1 的标注/上层水印之下，并让 zIndex=-1 的下层水印保持在图片之后。
const imageLayerZIndex = (zIndex) => Math.max(0, Number(zIndex) || 0) / 100;

export default observer(function Screenshot({ parent, layer }) {
    const stores = useStores();
    const runtimeImage = stores.imageStore.resolve(layer);
    const createSnap = useMemo(() => debounce(() => {
        stores.editor.createSnap('update');
    }, 100), [stores]);
    const hdrTaskRef = useRef(0);
    const [hdrImageUrl, setHdrImageUrl] = useState(null);
    const [image, box, container] = useMemo(() => {
        const image = new Rect({ origin: 'center' });
        const box = new Box({ overflow: 'hide', strokeAlign: 'inside', children: [image] });
        const container = new Box({
            id: `screenhello-image:${layer.id}`,
            overflow: 'hide',
            strokeAlign: 'outside',
            editable: true,
            hittable: true,
            cursor: 'grab',
            zIndex: imageLayerZIndex(layer.zIndex),
            editConfig: {
                moveable: true,
                resizeable: true,
                rotateable: true,
                skewable: false,
                circleDirection: 'top',
                circleMargin: 14,
                middlePoint: false,
                point: {
                    width: 10,
                    height: 10,
                    cornerRadius: 2,
                    fill: '#ffffff',
                    stroke: '#0066ff',
                    strokeWidth: 2,
                    hitFill: 'all',
                    hitStroke: 'all',
                },
            },
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            skewX: 0,
            skewY: 0,
            fill: '#ffffff00',
            children: [box],
        });
        container.__screenhelloImageId = layer.id;
        return [image, box, container];
    }, [layer.id]);

    useEffect(() => () => createSnap.cancel(), [createSnap]);

    useEffect(() => {
        const source = runtimeImage?.src;
        const taskId = hdrTaskRef.current + 1;
        hdrTaskRef.current = taskId;
        if (!stores.option.hdrEnabled || !source) {
            setHdrImageUrl(null);
            return undefined;
        }
        let cancelled = false;
        setHdrImageUrl(null);
        const isCurrent = () => !cancelled
            && hdrTaskRef.current === taskId
            && stores.option.hdrEnabled
            && stores.imageStore.resolve(layer.id)?.src === source;
        const operation = stores.imageStore.enqueueProcessing(() => isCurrent()
            ? enhanceImageToHdr(source, { shouldContinue: isCurrent })
            : null).then((result) => {
            if (!result || !isCurrent()) return;
            setHdrImageUrl(result);
        }).catch(() => {
            if (isCurrent()) setHdrImageUrl(null);
        });
        stores.renderTaskTracker?.track(operation);
        return () => { cancelled = true; };
    }, [layer.id, runtimeImage?.src, stores, stores.option.hdrEnabled]);

    useEffect(() => {
        const displaySrc = stores.option.hdrEnabled && hdrImageUrl ? hdrImageUrl : runtimeImage?.src;
        image.fill = {
            type: 'image',
            url: displaySrc,
            align: stores.option.mode === 'fit' ? 'center' : 'top',
            mode: stores.option.mode,
        };
        createSnap();
    }, [image, hdrImageUrl, runtimeImage?.src, stores.option.mode, stores.option.hdrEnabled]);

    useEffect(() => {
        container.editable = !layer.locked;
        container.cursor = layer.locked ? 'not-allowed' : 'grab';
    }, [container, layer.locked]);

    useEffect(() => {
        container.zIndex = imageLayerZIndex(layer.zIndex);
        createSnap();
    }, [container, createSnap, layer.zIndex]);

    useEffect(() => {
        box.fill = stores.option.padding === 0 && !isDeviceFrame(stores.option.frame)
            ? '#ffffff00'
            : stores.option.paddingBg;
        createSnap();
    }, [box, stores.option.frame, stores.option.paddingBg, stores.option.padding]);

    useEffect(() => {
        const border = stores.option.innerBorder;
        box.stroke = border?.visible ? border.color : null;
        box.strokeWidth = border?.visible ? border.width : 0;
        createSnap();
    }, [box, stores.option.innerBorder, stores.option.innerBorder?.color, stores.option.innerBorder?.visible, stores.option.innerBorder?.width]);

    useEffect(() => {
        const definition = getFrameDefinition(stores.option.frame);
        container.cornerRadius = stores.option.round;
        image.cornerRadius = definition.kind === 'browser' || definition.kind === 'arc' ? null : stores.option.round;
        createSnap();
    }, [container, image, stores.option.frame, stores.option.round]);

    useEffect(() => {
        const shadow = stores.option.shadow;
        if (!shadow?.visible || stores.option.frame === 'macbookpro16' || isDeviceFrame(stores.option.frame)) {
            container.shadow = null;
        } else {
            container.shadow = {
                x: shadow.x,
                y: shadow.y,
                blur: shadow.blur,
                spread: shadow.spread,
                color: shadow.color,
                box: true,
            };
        }
        createSnap();
    }, [container, stores.option.frame, stores.option.shadow, stores.option.shadow?.visible, stores.option.shadow?.x, stores.option.shadow?.y, stores.option.shadow?.blur, stores.option.shadow?.spread, stores.option.shadow?.color]);

    useEffect(() => {
        image.scaleX = stores.option.scaleX ? -1 : 1;
        createSnap();
    }, [image, stores.option.scaleX]);

    useEffect(() => {
        image.scaleY = stores.option.scaleY ? -1 : 1;
        createSnap();
    }, [image, stores.option.scaleY]);

    // 外框、尺寸、对齐和旋转共享一个布局 effect；cleanup 会移除本次创建的全部节点。
    useEffect(() => {
        const {
            align,
            browserHeaderSize,
            browserUrl,
            frame,
            frameConf,
            padding,
        } = stores.option;
        const { x: offsetX, y: offsetY, rotation, scale } = layer.transform;
        const img = runtimeImage || layer;
        const definition = getFrameDefinition(frame);
        const margin = getMargin(frameConf.width, frameConf.height);
        const inset = definition.kind !== 'none' && definition.kind !== 'stroke' && definition.kind !== 'browser' && definition.kind !== 'arc'
            ? (definition.inset || 0)
            : 0;
        const bottomInset = definition.kind !== 'none' && definition.kind !== 'stroke' && definition.kind !== 'browser' && definition.kind !== 'arc'
            ? (definition.bottom || inset)
            : 0;
        const maxWidth = Math.max(1, frameConf.width - margin - inset * 2);
        const browserHeaderHeight = getBrowserHeaderHeight(frame, browserHeaderSize);
        const maxHeight = Math.max(1, frameConf.height - margin - inset - bottomInset - browserHeaderHeight);
        const baseContentSize = computedSize(img.width || 1, img.height || 1, maxWidth, maxHeight);
        const hasIndependentBrowserHeader = definition.kind === 'browser' || definition.kind === 'arc';
        // 浏览器顶部栏由 browserHeaderSize 独立控制。缩放只折算到网页内容区域，
        // 避免拖动四角时地址栏、圆点、图标和 URL 文字被一起放大或缩小。
        const contentSize = hasIndependentBrowserHeader
            ? {
                width: Math.max(1, baseContentSize.width * scale),
                height: Math.max(1, baseContentSize.height * scale),
            }
            : baseContentSize;
        const metrics = getFrameMetrics(frame, contentSize.width, contentSize.height, { headerSize: browserHeaderSize });
        const { totalWidth, totalHeight, headerHeight } = metrics;
        // 平面布局：scale 为二维缩放，rotation（Z 轴）直接作用于 container；
        // 旋转时 origin=center，x/y 是未缩放盒子的左上角（见下方换算）。
        const hasSpatialTransform = rotation !== 0;
        let positionX;
        let positionY;
        if (hasSpatialTransform) {
            // LeaferUI 的 origin 只是变换基点（类似 CSS transform-origin），x/y 仍是未缩放盒子的左上角：
            // 盒中心（即旋转中心）最终落在 (x + totalWidth/2, y + totalHeight/2)。
            // 先按旋转后的外接矩形对齐求出理想中心，再换算回左上角坐标。
            const rad = rotation * Math.PI / 180;
            const rotatedW = Math.abs(totalWidth * Math.cos(rad)) + Math.abs(totalHeight * Math.sin(rad));
            const rotatedH = Math.abs(totalWidth * Math.sin(rad)) + Math.abs(totalHeight * Math.cos(rad));
            ({ x: positionX, y: positionY } = getRotatedPosition(align, rotatedW, rotatedH, frameConf.width, frameConf.height));
            positionX -= totalWidth / 2;
            positionY -= totalHeight / 2;
        } else {
            ({ x: positionX, y: positionY } = getPosition(align, frameConf.width - totalWidth, frameConf.height - totalHeight));
        }
        positionX += offsetX;
        positionY += offsetY;
        const decorationState = createFrameDecorations(frame, metrics, {
            shadow: stores.option.shadow,
            url: browserUrl,
        });
        const decorations = decorationState.nodes || [];
        const overlays = decorationState.overlays || [];

        decorations.forEach((node) => addBefore(container, node, box));
        overlays.forEach((node) => container.add(node));
        container.strokeWidth = decorationState.strokeWidth ?? null;
        container.stroke = decorationState.stroke ?? null;
        container.width = totalWidth;
        container.height = totalHeight;
        container.scaleX = hasIndependentBrowserHeader ? 1 : scale;
        container.scaleY = hasIndependentBrowserHeader ? 1 : scale;
        container.skewX = 0;
        container.skewY = 0;
        container.rotation = rotation;
        container.origin = 'center';
        container.x = positionX;
        container.y = positionY;
        box.width = metrics.boxWidth;
        box.height = metrics.boxHeight;
        box.x = metrics.boxX;
        box.y = metrics.boxY;
        box.cornerRadius = metrics.screenRadius ?? null;
        const effectivePadding = hasIndependentBrowserHeader ? padding * scale : padding;
        const imageWidth = Math.max(1, metrics.boxWidth - effectivePadding);
        const imageHeight = Math.max(1, Math.round(imageWidth * metrics.boxHeight / Math.max(1, metrics.boxWidth)));
        image.width = imageWidth + 2;
        image.height = imageHeight + 2;
        image.x = effectivePadding / 2 - 1;
        image.y = (metrics.boxHeight - imageHeight) / 2 - 1;

        // Leafer 的编辑器会先改变当前图片 container 的外层尺寸，React effect
        // 则要等状态写回后才会重算子节点。拖动期间直接同步子节点，避免
        // 浏览器外框/图片暂时保持旧尺寸而出现裁剪闪烁。
        const previewResize = (targetNode, start) => {
            if (!targetNode || !start || !Number.isFinite(targetNode.width) || !Number.isFinite(targetNode.height)) return;
            const startWidth = Math.max(1, Number(start.width) || totalWidth);
            const startHeight = Math.max(1, Number(start.height) || totalHeight);
            const startScaleX = Number(start.scaleX) || 1;
            const startScaleY = Number(start.scaleY) || 1;
            const currentScaleX = Number(targetNode.scaleX) || 1;
            const currentScaleY = Number(targetNode.scaleY) || 1;
            const visualRatioX = (targetNode.width / startWidth) * (currentScaleX / startScaleX);
            if (!Number.isFinite(visualRatioX) || visualRatioX <= 0) return;
            const currentVisualRatioY = (targetNode.height / startHeight) * (currentScaleY / startScaleY);
            if (Math.abs(visualRatioX - 1) < 0.0001 && Math.abs(currentVisualRatioY - 1) < 0.0001) return;

            const independentHeader = hasIndependentBrowserHeader;
            // 浏览器顶部栏的高度不能参与图片缩放；固定 Y 轴缩放，
            // 仅用 X 轴比例推导网页内容高度，释放时可与最终布局精确衔接。
            if (independentHeader) targetNode.scaleY = startScaleY;
            const liveScaleY = Number(targetNode.scaleY) || 1;
            const desiredVisualHeight = independentHeader
                ? (headerHeight * startScaleY) + (metrics.height * startScaleY * visualRatioX)
                : startHeight * startScaleY * visualRatioX;
            const desiredHeight = Math.max(1, desiredVisualHeight / liveScaleY);
            const topEdgeActive = Math.abs((targetNode.y ?? start.y) - start.y) > 0.5;
            const startBottom = start.y + startHeight;
            targetNode.height = desiredHeight;
            if (topEdgeActive) targetNode.y = startBottom - desiredHeight;

            const localRatioX = targetNode.width / startWidth;
            const localRatioY = desiredHeight / Math.max(1, totalHeight);
            const bodyRatio = independentHeader
                ? Math.max(0.01, (desiredHeight - headerHeight) / Math.max(1, metrics.height))
                : localRatioY;

            decorationEntries.forEach((entry) => {
                const decoration = entry.node;
                decoration.scaleX = 1;
                decoration.scaleY = 1;
                decoration.x = entry.x * localRatioX;
                decoration.width = Math.max(0.001, entry.width * localRatioX);
                if (independentHeader) {
                    decoration.y = entry.y;
                    decoration.height = entry.height;
                } else {
                    decoration.y = entry.y * localRatioY;
                    decoration.height = Math.max(0.001, entry.height * localRatioY);
                }
            });

            box.x = metrics.boxX * localRatioX;
            box.y = independentHeader ? metrics.boxY : metrics.boxY * localRatioY;
            box.width = Math.max(1, metrics.boxWidth * localRatioX);
            box.height = Math.max(1, metrics.boxHeight * bodyRatio);
            const livePadding = independentHeader ? effectivePadding * visualRatioX : padding;
            const liveImageWidth = Math.max(1, box.width - livePadding);
            const liveImageHeight = Math.max(1, Math.round(liveImageWidth * box.height / Math.max(1, box.width)));
            image.width = liveImageWidth + 2;
            image.height = liveImageHeight + 2;
            image.x = livePadding / 2 - 1;
            image.y = (box.height - liveImageHeight) / 2 - 1;
        };
        const allDecorations = [...decorations, ...overlays];
        const decorationEntries = allDecorations.map((node) => ({
            node,
            x: node.x || 0,
            y: node.y || 0,
            width: node.width || 0,
            height: node.height || 0,
        }));
        const resolveBasePosition = (nextScale = scale, nextRotation = rotation) => {
            const safeScale = Math.max(0.1, Math.min(3, Number(nextScale) || scale));
            const nextContentSize = hasIndependentBrowserHeader
                ? {
                    width: Math.max(1, baseContentSize.width * safeScale),
                    height: Math.max(1, baseContentSize.height * safeScale),
                }
                : baseContentSize;
            const nextMetrics = getFrameMetrics(frame, nextContentSize.width, nextContentSize.height, { headerSize: browserHeaderSize });
            const nextWidth = nextMetrics.totalWidth;
            const nextHeight = nextMetrics.totalHeight;
            if (nextRotation !== 0) {
                const rad = nextRotation * Math.PI / 180;
                const rotatedW = Math.abs(nextWidth * Math.cos(rad)) + Math.abs(nextHeight * Math.sin(rad));
                const rotatedH = Math.abs(nextWidth * Math.sin(rad)) + Math.abs(nextHeight * Math.cos(rad));
                let { x, y } = getRotatedPosition(align, rotatedW, rotatedH, frameConf.width, frameConf.height);
                x -= nextWidth / 2;
                y -= nextHeight / 2;
                return { x, y };
            }
            return getPosition(align, frameConf.width - nextWidth, frameConf.height - nextHeight);
        };
        container.__shoteasyResizePreview = previewResize;
        container.__shoteasyResizeScaleMode = hasIndependentBrowserHeader ? 'width' : 'average';
        container.__shoteasyResolveBasePosition = resolveBasePosition;
        stores.imageStore.setGeometry(layer.id, {
            x: positionX,
            y: positionY,
            width: totalWidth * (hasIndependentBrowserHeader ? 1 : scale),
            height: totalHeight * (hasIndependentBrowserHeader ? 1 : scale),
        });
        createSnap();

        return () => {
            if (container.__shoteasyResizePreview === previewResize) delete container.__shoteasyResizePreview;
            delete container.__shoteasyResizeScaleMode;
            delete container.__shoteasyResolveBasePosition;
            stores.imageStore.clearGeometry(layer.id);
            allDecorations.forEach((node) => node.remove?.());
            container.strokeWidth = null;
            container.stroke = null;
            container.scaleX = 1;
            container.scaleY = 1;
            container.skewX = 0;
            container.skewY = 0;
            container.rotation = 0;
            box.cornerRadius = null;
            container.cornerRadius = stores.option.round;
        };
    }, [box, container, image, layer, layer.id, layer.transform.x, layer.transform.y, layer.transform.rotation, layer.transform.scale, runtimeImage?.width, runtimeImage?.height, stores.option.align, stores.option.browserHeaderSize, stores.option.browserUrl, stores.option.frame, stores.option.frameConf.width, stores.option.frameConf.height, stores.option.padding, stores.option.shadow]);

    useEffect(() => {
        parent.add(container);
        stores.imageStore.registerNode(layer.id, container);
        return () => {
            stores.imageStore.unregisterNode(layer.id, container);
            container.remove();
            createSnap.cancel();
        };
    }, [container, layer.id, parent, stores.imageStore]);
    return null;
});
