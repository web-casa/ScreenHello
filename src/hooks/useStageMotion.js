import { useEffect } from 'react';

// Must match the `.polka` tile so lit dots land exactly on the resting ones.
const DOT_TILE = 14;
const EASE = 0.14;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const pad = (value) => String(Math.max(0, Math.round(value))).padStart(4, '0');

/**
 * Pointer-driven light and parallax for the empty welcome stage.
 * Writes CSS custom properties on the stage only; the stylesheet decides what moves.
 * Inert on touch input and under prefers-reduced-motion.
 */
export default function useStageMotion({ stageRef, frameRef, coordRef, sizeRef }) {
    useEffect(() => {
        const stage = stageRef.current;
        const frame = frameRef.current;
        if (!stage || !frame || typeof globalThis.matchMedia !== 'function') return undefined;
        const fine = globalThis.matchMedia('(hover: hover) and (pointer: fine)');
        const calm = globalThis.matchMedia('(prefers-reduced-motion: reduce)');
        const target = { x: 0, y: 0, tx: 0, ty: 0 };
        const current = { x: 0, y: 0, tx: 0, ty: 0 };
        let raf = 0;
        let lit = false;
        let coords = '';

        const writeSize = () => {
            if (sizeRef.current) sizeRef.current.textContent = `${frame.offsetWidth} × ${frame.offsetHeight}`;
        };
        const alignDots = () => {
            const origin = stage.closest('.shoteasy-app')?.getBoundingClientRect();
            if (!origin) return;
            const box = stage.getBoundingClientRect();
            const offset = (delta) => `${-(((delta % DOT_TILE) + DOT_TILE) % DOT_TILE)}px`;
            stage.style.setProperty('--se-dot-x', offset(box.left - origin.left));
            stage.style.setProperty('--se-dot-y', offset(box.top - origin.top));
        };
        const paint = () => {
            raf = 0;
            let moving = false;
            for (const key of ['x', 'y', 'tx', 'ty']) {
                const delta = target[key] - current[key];
                const settled = Math.abs(delta) < (key.length === 1 ? 0.3 : 0.002);
                current[key] = settled ? target[key] : current[key] + delta * EASE;
                moving ||= !settled;
            }
            stage.style.setProperty('--se-lx', `${current.x.toFixed(1)}px`);
            stage.style.setProperty('--se-ly', `${current.y.toFixed(1)}px`);
            stage.style.setProperty('--se-tx', current.tx.toFixed(3));
            stage.style.setProperty('--se-ty', current.ty.toFixed(3));
            if (coordRef.current && coordRef.current.textContent !== coords) coordRef.current.textContent = coords;
            if (moving) raf = requestAnimationFrame(paint);
        };
        const schedule = () => { raf ||= requestAnimationFrame(paint); };
        const rest = () => {
            lit = false;
            delete stage.dataset.lit;
            target.tx = 0;
            target.ty = 0;
            schedule();
        };
        const onMove = (event) => {
            if (event.pointerType === 'touch' || !fine.matches || calm.matches) return;
            const box = stage.getBoundingClientRect();
            const slot = frame.getBoundingClientRect();
            target.x = event.clientX - box.left;
            target.y = event.clientY - box.top;
            // Full tilt is reached a little outside the slot, so it still reads when the pointer is inside it.
            target.tx = clamp((event.clientX - (slot.left + slot.width / 2)) / (slot.width * 0.8), -1, 1);
            target.ty = clamp((event.clientY - (slot.top + slot.height / 2)) / (slot.height * 1.1), -1, 1);
            coords = `X ${pad(clamp(event.clientX - slot.left, 0, slot.width))}  Y ${pad(clamp(event.clientY - slot.top, 0, slot.height))}`;
            if (!lit) {
                // Start under the pointer instead of sweeping in from the corner.
                lit = true;
                current.x = target.x;
                current.y = target.y;
                stage.dataset.lit = '';
            }
            schedule();
        };
        const onLayout = () => { alignDots(); writeSize(); };

        onLayout();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onLayout) : null;
        observer?.observe(stage);
        observer?.observe(frame);
        stage.addEventListener('pointermove', onMove, { passive: true });
        stage.addEventListener('pointerleave', rest, { passive: true });
        calm.addEventListener?.('change', rest);
        return () => {
            observer?.disconnect();
            stage.removeEventListener('pointermove', onMove);
            stage.removeEventListener('pointerleave', rest);
            calm.removeEventListener?.('change', rest);
            if (raf) cancelAnimationFrame(raf);
            delete stage.dataset.lit;
            for (const name of ['--se-lx', '--se-ly', '--se-tx', '--se-ty', '--se-dot-x', '--se-dot-y']) stage.style.removeProperty(name);
        };
    }, [stageRef, frameRef, coordRef, sizeRef]);
}
