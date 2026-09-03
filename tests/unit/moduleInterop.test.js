import { describe, expect, it } from 'vitest';
import { unwrapCallableDefault } from '../../src/utils/moduleInterop.js';

describe('unwrapCallableDefault', () => {
    it('unwraps a callable Babel CommonJS default export', () => {
        const component = () => null;

        expect(unwrapCallableDefault({ __esModule: true, default: component })).toBe(component);
    });

    it('keeps direct callable and non-callable module values unchanged', () => {
        const component = () => null;
        const namespace = { default: 'not callable' };

        expect(unwrapCallableDefault(component)).toBe(component);
        expect(unwrapCallableDefault(namespace)).toBe(namespace);
    });
});
