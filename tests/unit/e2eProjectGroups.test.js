import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../../playwright.config.js';
import { e2eTestGroups } from '../e2e/testGroups.js';

const e2eFiles = readdirSync(new URL('../e2e/', import.meta.url))
    .filter((file) => file.endsWith('.spec.js'))
    .sort();
const configuredFiles = e2eTestGroups.flatMap((group) => group.files).sort();

describe('E2E browser project groups', () => {
    it('assigns every E2E spec to exactly one worker-recycling group', () => {
        expect(configuredFiles).toEqual(e2eFiles);
        expect(new Set(configuredFiles).size).toBe(configuredFiles.length);
    });

    it('keeps the visual-baseline Chromium name and creates isolated later groups for every engine', () => {
        expect(config.projects.map((project) => project.name)).toEqual([
            'chromium', 'chromium-runtime',
            'firefox', 'firefox-runtime',
            'webkit', 'webkit-runtime',
        ]);
        for (const project of config.projects) {
            expect(project.testMatch).toHaveLength(project.name.endsWith('-runtime') ? 18 : 9);
        }
    });
});
