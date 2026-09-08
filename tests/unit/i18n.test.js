import { describe, expect, it } from 'vitest';
import { I18nStore, normalizeLocale, translateMessage } from '../../src/i18n/i18n.js';
import { createScreenHelloRuntime } from '../../src/stores/index.js';
import { auditTranslations } from '../../scripts/audit-i18n.mjs';
import { localeOptions } from '../../src/i18n/locales.js';

describe('instance-local translations', () => {
    it.each([
        ['de-AT', 'de-DE', 'Datei'], ['es-MX', 'es-ES', 'Archivo'],
        ['pt-BR', 'pt-PT', 'Ficheiro'], ['ko', 'ko-KR', '파일'],
        ['zh-HK', 'zh-TW', '文件'], ['zh-Hant', 'zh-TW', '文件'],
        ['zh-Hans-TW', 'zh-CN', '文件'],
    ])('normalizes %s and translates without changing content', (input, canonical, fileLabel) => {
        expect(normalizeLocale(input)).toBe(canonical);
        expect(translateMessage('文件', input)).toBe(fileLabel);
    });

    it('supports seven explicit locales with overrides and interpolation', () => {
        expect(localeOptions).toHaveLength(7);
        for (const { value } of localeOptions) {
            expect(normalizeLocale(value)).toBe(value);
            expect(translateMessage('当前：{0}', value, {}, { 0: 'user-原名' })).toContain('user-原名');
            expect(translateMessage('文件', value, { 文件: 'Host menu' })).toBe('Host menu');
            expect(translateMessage('project-用户.screenhello', value)).toBe('project-用户.screenhello');
        }
    });
    it('normalizes supported locales and falls back predictably', () => {
        expect(normalizeLocale('en-GB')).toBe('en-US');
        expect(normalizeLocale('fr-FR')).toBe('zh-CN');
        expect(normalizeLocale('constructor')).toBe('zh-CN');
        expect(translateMessage('文件', 'en-US')).toBe('File');
        expect(translateMessage('文件')).toBe('文件');
        expect(translateMessage('unknown-key', 'en-US')).toBe('unknown-key');
        expect(translateMessage('toString', 'en-US')).toBe('toString');
        expect(translateMessage(null, 'en-US')).toBeNull();
        expect(translateMessage('文件', 'en-US', null, null)).toBe('File');
    });

    it('uses own string overrides and literal parameter substitution', () => {
        const inherited = Object.create({ 文件: 'Wrong' });
        expect(translateMessage('文件', 'en-US', inherited)).toBe('File');
        expect(translateMessage('文件', 'en-US', { 文件: 42 })).toBe('File');
        expect(translateMessage('文件', 'en-US', { 文件: 'Menu' })).toBe('Menu');
        expect(translateMessage('精选渐变 {0}', 'en-US', {}, { 0: '$&<img>' })).toBe('Featured gradient $&<img>');
        expect(translateMessage('精选渐变 {0}', 'en-US')).toBe('Featured gradient {0}');
    });

    it('copies overrides and does not share mutable language state', () => {
        const messages = { 文件: 'My files' };
        const first = new I18nStore({ locale: 'en-US', messages });
        const second = new I18nStore();
        messages.文件 = 'Changed outside';
        expect(first.t('文件')).toBe('My files');
        expect(second.t('文件')).toBe('文件');
        first.setOptions('zh-CN');
        expect(first.t('文件')).toBe('文件');
        expect(second.version).toBe(1);
    });

    it('changes UI language without changing project content, history or sibling runtime', () => {
        const first = createScreenHelloRuntime();
        const second = createScreenHelloRuntime({ locale: 'en-US' });
        try {
            first.workspace.setProjectName('用户的项目');
            const before = first.editor.serializeProject();
            first.i18n.setOptions('en-US', { 文件: 'Custom File' });
            expect(first.workspace.projectName).toBe('用户的项目');
            expect(first.editor.serializeProject()).toEqual(before);
            expect(first.commands.get('file.newProject').label).not.toMatch(/\p{Script=Han}/u);
            expect(second.i18n.t('文件')).toBe('File');
        } finally {
            first.dispose();
            second.dispose();
        }
    });

    it('covers static UI keys and preserves all interpolation placeholders', async () => {
        const result = await auditTranslations();
        expect(result.keys).toBeGreaterThan(500);
        expect(result.missing).toEqual([]);
        expect(result.placeholders).toEqual([]);
    });
});
