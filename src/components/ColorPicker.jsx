import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react';
import { Button, ColorPicker as AntColorPicker } from 'antd';
import { TinyColor } from '@ctrl/tinycolor';
import Icon from '@components/Icon';

const HEX_COLOR = /^#?(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;

const parseColor = (value) => {
    let input = value;
    if (value && typeof value.toRgb === 'function') input = value.toRgb();
    const parsed = new TinyColor(input);
    if (!parsed.isValid) return null;
    const { r, g, b, a } = parsed.toRgb();
    return new TinyColor({
        r,
        g,
        b,
        a: Number.isFinite(a) ? Math.max(0, Math.min(1, a)) : 1,
    });
};

const parseHexColor = (value) => {
    const candidate = String(value ?? '').trim();
    if (!HEX_COLOR.test(candidate)) return null;
    return parseColor(candidate.startsWith('#') ? candidate : `#${candidate}`);
};

const initialColor = (value) => parseColor(value) ?? new TinyColor('#000000');

function AccessibleColorPanel({
    accessibleName,
    color,
    disabled,
    disabledAlpha,
    hexDraft,
    ids,
    onAlphaChange,
    onAlphaComplete,
    onColorInput,
    onEscape,
    onHexBlur,
    onHexChange,
    onHexKeyDown,
    onPreset,
    onUseDropper,
    presets,
}) {
    const alpha = Math.round(color.getAlpha() * 100);
    const hasEyeDropper = typeof window !== 'undefined' && typeof window.EyeDropper === 'function';

    return (
        <div
            id={ids.dialog}
            className="shoteasy-color-picker-panel"
            role="dialog"
            aria-label={`${accessibleName}设置`}
            onKeyDown={onEscape}
        >
            <div className="shoteasy-color-picker-panel__header">
                <strong>{accessibleName}</strong>
                {hasEyeDropper && (
                    <Button
                        type="text"
                        shape="circle"
                        size="small"
                        aria-label="吸取屏幕颜色"
                        icon={<Icon.Pipette size={16} />}
                        onClick={onUseDropper}
                    />
                )}
            </div>

            <div className="shoteasy-color-picker-panel__row">
                <label htmlFor={ids.color}>色彩</label>
                <input
                    id={ids.color}
                    type="color"
                    value={color.toHexString()}
                    disabled={disabled}
                    aria-label={`${accessibleName}色彩`}
                    onChange={onColorInput}
                />
            </div>

            <div className="shoteasy-color-picker-panel__row">
                <label htmlFor={ids.hex}>十六进制</label>
                <input
                    id={ids.hex}
                    type="text"
                    value={hexDraft}
                    disabled={disabled}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label={`${accessibleName}十六进制值`}
                    aria-invalid={!parseHexColor(hexDraft)}
                    onBlur={onHexBlur}
                    onChange={onHexChange}
                    onKeyDown={onHexKeyDown}
                />
            </div>

            {!disabledAlpha && (
                <div className="shoteasy-color-picker-panel__alpha">
                    <div>
                        <label htmlFor={ids.alpha}>不透明度</label>
                        <output htmlFor={ids.alpha}>{alpha}%</output>
                    </div>
                    <input
                        id={ids.alpha}
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={alpha}
                        disabled={disabled}
                        aria-label={`${accessibleName}不透明度`}
                        onChange={onAlphaChange}
                        onKeyUp={onAlphaComplete}
                        onPointerUp={onAlphaComplete}
                    />
                </div>
            )}

            {presets.map((preset, groupIndex) => (
                <fieldset className="shoteasy-color-picker-panel__presets" key={`${preset.label ?? 'preset'}-${groupIndex}`}>
                    <legend>{preset.label ?? '预设颜色'}</legend>
                    <div>
                        {(preset.colors ?? []).map((presetColor, colorIndex) => {
                            const parsed = parseColor(presetColor);
                            if (!parsed) return null;
                            const cssColor = parsed.toRgbString();
                            return (
                                <button
                                    type="button"
                                    key={`${cssColor}-${colorIndex}`}
                                    className="shoteasy-color-picker-panel__preset"
                                    style={{ backgroundColor: cssColor }}
                                    disabled={disabled}
                                    aria-label={`使用颜色 ${parsed.toHex8String()}`}
                                    onClick={() => onPreset(parsed)}
                                />
                            );
                        })}
                    </div>
                </fieldset>
            ))}
        </div>
    );
}

/**
 * AntD 负责触发器、定位和浮层生命周期；面板由 ScreenHello 自己渲染，确保每个
 * 可操作控件都有稳定的原生语义，不依赖 AntD 私有 DOM 或版本相关选择器。
 */
export default function ColorPickerWithDropper(props) {
    const {
        children,
        defaultValue,
        disabled = false,
        disabledAlpha = false,
        onChange,
        onChangeComplete,
        onKeyDown,
        onOpenChange,
        open,
        presets = [],
        value,
        ...pickerProps
    } = props;
    const accessibleName = props['aria-label'] || '选择颜色';
    const generatedId = useId().replaceAll(':', '');
    const ids = {
        alpha: `shoteasy-color-alpha-${generatedId}`,
        color: `shoteasy-color-value-${generatedId}`,
        dialog: `shoteasy-color-dialog-${generatedId}`,
        hex: `shoteasy-color-hex-${generatedId}`,
    };
    const wrapperRef = useRef(null);
    const mountedRef = useRef(true);
    const [internalColor, setInternalColor] = useState(() => initialColor(value ?? defaultValue));
    const [internalOpen, setInternalOpen] = useState(false);
    const controlledColor = value === undefined ? null : initialColor(value);
    const color = controlledColor ?? internalColor;
    const [hexDraft, setHexDraft] = useState(() => color.toHex8String());
    const colorHex = color.toHex8String();
    const colorRef = useRef(color);
    colorRef.current = color;
    const isOpen = open === undefined ? internalOpen : open;

    useEffect(() => {
        setHexDraft(colorHex);
    }, [colorHex]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (!isOpen) return undefined;
        const frame = requestAnimationFrame(() => document.getElementById(ids.color)?.focus());
        return () => cancelAnimationFrame(frame);
    }, [ids.color, isOpen]);

    const setOpen = (nextOpen) => {
        if (open === undefined) setInternalOpen(nextOpen);
        onOpenChange?.(nextOpen);
    };

    const emitColor = (nextColor, { complete = false, notify = true } = {}) => {
        const normalized = initialColor(nextColor);
        if (disabledAlpha) normalized.setAlpha(1);
        colorRef.current = normalized;
        setInternalColor(normalized);
        setHexDraft(normalized.toHex8String());
        if (notify) onChange?.(normalized, normalized.toRgbString());
        if (complete) onChangeComplete?.(normalized);
    };

    const completeCurrentColor = () => onChangeComplete?.(colorRef.current);

    const restoreTriggerFocus = () => {
        requestAnimationFrame(() => {
            wrapperRef.current?.querySelector('button, [role="button"], [tabindex]')?.focus();
        });
    };

    const handleEscape = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        restoreTriggerFocus();
    };

    const handleHexCommit = () => {
        const nextColor = parseHexColor(hexDraft);
        if (!nextColor) {
            setHexDraft(colorRef.current.toHex8String());
            return;
        }
        emitColor(nextColor, { complete: true });
    };

    const handleHexChange = (event) => {
        setHexDraft(event.target.value);
    };

    const useDropper = async () => {
        if (typeof window === 'undefined' || typeof window.EyeDropper !== 'function') return;
        try {
            const result = await new window.EyeDropper().open();
            if (!mountedRef.current) return;
            emitColor(result.sRGBHex, { complete: true });
        } catch {
            // 用户取消系统取色器不是错误状态。
        }
    };

    const triggerAccessibility = children ? {} : {
        role: 'button',
        tabIndex: disabled ? -1 : 0,
        'aria-disabled': disabled || undefined,
        'aria-expanded': isOpen,
        'aria-haspopup': 'dialog',
        'aria-controls': ids.dialog,
        'aria-label': accessibleName,
        onKeyDown: (event) => {
            onKeyDown?.(event);
            if (event.defaultPrevented || disabled || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            event.currentTarget.click();
        },
    };
    const trigger = isValidElement(children)
        ? cloneElement(children, {
            'aria-controls': ids.dialog,
            'aria-expanded': isOpen,
            'aria-haspopup': 'dialog',
        })
        : children;

    return (
        <span className="shoteasy-color-picker-adapter" ref={wrapperRef}>
            <AntColorPicker
                {...pickerProps}
                {...triggerAccessibility}
                disabled={disabled}
                disabledAlpha={disabledAlpha}
                open={isOpen}
                presets={presets}
                value={colorHex}
                onOpenChange={setOpen}
                panelRender={() => (
                    <AccessibleColorPanel
                        accessibleName={accessibleName}
                        color={color}
                        disabled={disabled}
                        disabledAlpha={disabledAlpha}
                        hexDraft={hexDraft}
                        ids={ids}
                        presets={presets}
                        onAlphaChange={(event) => {
                            const nextColor = initialColor(colorRef.current);
                            nextColor.setAlpha(Number(event.target.value) / 100);
                            emitColor(nextColor);
                        }}
                        onAlphaComplete={completeCurrentColor}
                        onColorInput={(event) => {
                            const nextColor = initialColor(event.target.value);
                            nextColor.setAlpha(colorRef.current.getAlpha());
                            emitColor(nextColor, { complete: true });
                        }}
                        onEscape={handleEscape}
                        onHexBlur={handleHexCommit}
                        onHexChange={handleHexChange}
                        onHexKeyDown={(event) => {
                            if (event.key !== 'Enter') return;
                            event.preventDefault();
                            event.currentTarget.blur();
                        }}
                        onPreset={(presetColor) => emitColor(presetColor, { complete: true })}
                        onUseDropper={useDropper}
                    />
                )}
            >
                {trigger}
            </AntColorPicker>
        </span>
    );
}
