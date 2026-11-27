import { describe, expect, it, vi } from 'vitest';
import {
    CODE_CARD_MAX_CHARS,
    CODE_CARD_MAX_EXPORT_PIXELS,
    CODE_CARD_MAX_LINES,
    CODE_CARD_MAX_LOGICAL_HEIGHT,
    CODE_CARD_MAX_UTF8_BYTES,
    normalizeCodeCard,
    truncateUtf8,
    utf8ByteLength,
} from '@utils/codeCardSchema';
import { CODE_THEME_PALETTES, detectCodeLanguage, tokenizeCode } from '@utils/codeHighlighter';
import { layoutCodeCard, renderCodeCardBlob } from '@utils/codeCardRenderer';

describe('codeCardSchema & codeHighlighter', () => {
    it('clamps oversized code by char count, line count, and UTF-8 bytes without splitting surrogate pairs', () => {
        const emojiLine = '😀'.repeat(100);
        const truncated = truncateUtf8(emojiLine, 10);
        expect(utf8ByteLength(truncated)).toBeLessThanOrEqual(10);
        expect(truncated).toBe('😀😀');

        const manyLines = Array.from({ length: CODE_CARD_MAX_LINES + 50 }, (_, i) => `const x${i} = ${i};`).join('\n');
        const normalized = normalizeCodeCard({
            code: manyLines,
            fontSize: 99,
            lineHeight: 5,
            padding: 2,
            cardWidth: 9999,
            tabSize: 3,
            language: 'unknown-lang',
            theme: 'unknown-theme',
            windowStyle: 'invalid',
        });
        expect(normalized.code.split('\n').length).toBeLessThanOrEqual(CODE_CARD_MAX_LINES);
        expect(normalized.code.length).toBeLessThanOrEqual(CODE_CARD_MAX_CHARS);
        expect(utf8ByteLength(normalized.code)).toBeLessThanOrEqual(CODE_CARD_MAX_UTF8_BYTES);
        expect(normalized.fontSize).toBe(24);
        expect(normalized.lineHeight).toBe(2.0);
        expect(normalized.padding).toBe(16);
        expect(normalized.cardWidth).toBe(1200);
        expect(normalized.tabSize).toBe(2);
        expect(normalized.language).toBe('auto');
        expect(normalized.theme).toBe('one-dark');
        expect(normalized.windowStyle).toBe('mac');
    });

    it('detects common languages accurately across 14 supported grammars', () => {
        expect(detectCodeLanguage('{"name": "screenhello", "ok": true}')).toBe('json');
        expect(detectCodeLanguage('export function add(a: number): number { return a + 1; }')).toBe('typescript');
        expect(detectCodeLanguage('export const App = () => <Button>Hi</Button>;')).toBe('jsx');
        expect(detectCodeLanguage('const sum = (a, b) => a + b;')).toBe('javascript');
        expect(detectCodeLanguage('def fib(n):\n    return n if n < 2 else fib(n - 1)')).toBe('python');
        expect(detectCodeLanguage('fn main() {\n    let mut x = 1;\n    println!("{}", x);\n}')).toBe('rust');
        expect(detectCodeLanguage('package main\nfunc main() { fmt.Println("hi") }')).toBe('go');
        expect(detectCodeLanguage('SELECT id, name FROM users WHERE active = 1;')).toBe('sql');
        expect(detectCodeLanguage('#!/usr/bin/env bash\nexport MODE=prod\necho $MODE')).toBe('bash');
        expect(detectCodeLanguage('#include <iostream>\nint main() { std::cout << 1; }')).toBe('cpp');
        expect(detectCodeLanguage('public class Demo { public static void main(String[] args) {} }')).toBe('java');
        expect(detectCodeLanguage('<!DOCTYPE html><html><body><div>hi</div></body></html>')).toBe('html');
        expect(detectCodeLanguage('.card { color: #ff00aa; padding: 12px; }')).toBe('css');
        expect(detectCodeLanguage('just plain notes here')).toBe('plaintext');
    });

    it('tokenizes multiline comments, template strings, Python triple quotes, and runs in linear time', () => {
        const ts = tokenizeCode('/* start\n   still comment */\nconst s = `line1\nline2`;', 'typescript');
        expect(ts.lines[0][0].type).toBe('comment');
        expect(ts.lines[1][0].type).toBe('comment');
        expect(ts.lines[2].some((t) => t.type === 'keyword' && t.value === 'const')).toBe(true);
        expect(ts.lines[3][0].type).toBe('string');

        const py = tokenizeCode('"""doc\nline"""\n@decorator\ndef run():\n    return 42', 'python');
        expect(py.lines[0][0].type).toBe('string');
        expect(py.lines[1][0].type).toBe('string');
        expect(py.lines[2][0].type).toBe('attribute');
        expect(py.lines[3].some((t) => t.type === 'keyword' && t.value === 'def')).toBe(true);

        const json = tokenizeCode('{"key": "value", "n": 42, "ok": true}', 'json');
        expect(json.lines[0].some((t) => t.type === 'property' && t.value === '"key"')).toBe(true);
        expect(json.lines[0].some((t) => t.type === 'string' && t.value === '"value"')).toBe(true);
        expect(json.lines[0].some((t) => t.type === 'number' && t.value === '42')).toBe(true);

        // Adversarial long input completes rapidly without catastrophic backtracking.
        const adversarial = `${'a'.repeat(4000)} /* ${'*'.repeat(4000)}\n`.repeat(3);
        const started = Date.now();
        const result = tokenizeCode(adversarial, 'javascript');
        expect(Date.now() - started).toBeLessThan(200);
        expect(result.lines.length).toBeGreaterThan(1);
    });

    it('lays out extreme code safely within 4096 logical height with truncation notice and releases export canvas', async () => {
        expect(Object.keys(CODE_THEME_PALETTES)).toHaveLength(6);

        const tallCode = Array.from({ length: 200 }, (_, i) => `const line_${i} = "${'x'.repeat(80)}";`).join('\n');
        const layout = layoutCodeCard((text) => text.length * 9, {
            code: tallCode,
            fontSize: 24,
            lineHeight: 2.0,
            cardWidth: 420,
            padding: 64,
        });
        expect(layout.logicalHeight).toBeLessThanOrEqual(CODE_CARD_MAX_LOGICAL_HEIGHT);
        expect(layout.pixelHeight).toBeLessThanOrEqual(8192);
        expect(layout.truncatedLines).toBeGreaterThan(0);
        expect(layout.renderedRows.at(-1).isTruncationNotice).toBe(true);

        // Max width (1200) + max font (24) + tall code must still fit 2x export pixel budget.
        const wideTallLayout = layoutCodeCard((text) => text.length * 14, {
            code: tallCode,
            fontSize: 24,
            lineHeight: 2.0,
            cardWidth: 1200,
            padding: 64,
        }, { pixelRatio: 2 });
        expect(wideTallLayout.pixelWidth * wideTallLayout.pixelHeight).toBeLessThanOrEqual(CODE_CARD_MAX_EXPORT_PIXELS);
        expect(wideTallLayout.truncatedLines).toBeGreaterThan(0);

        const ctx = {
            font: '',
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 1,
            textBaseline: 'alphabetic',
            textAlign: 'left',
            measureText: vi.fn((text) => ({ width: text.length * 9 })),
            save: vi.fn(),
            restore: vi.fn(),
            scale: vi.fn(),
            clearRect: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            quadraticCurveTo: vi.fn(),
            closePath: vi.fn(),
            clip: vi.fn(),
            fillRect: vi.fn(),
            arc: vi.fn(),
            fill: vi.fn(),
            fillText: vi.fn(),
            stroke: vi.fn(),
        };
        const canvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => ctx),
            toBlob: vi.fn((callback, type) => callback(new Blob(['png'], { type }))),
        };
        const documentRef = { createElement: vi.fn(() => canvas) };
        const rendered = await renderCodeCardBlob({ code: 'const x = 1;', language: 'javascript' }, { documentRef });
        expect(rendered.blob.type).toBe('image/png');
        expect(rendered.width).toBe(1360);
        expect(rendered.resolvedLanguage).toBe('javascript');
        expect(canvas.width).toBe(0);
        expect(canvas.height).toBe(0);
    });
});
