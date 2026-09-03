import { describe, expect, it } from 'vitest';
import { createWatermarkSvg, numSvg } from '../../src/utils/utils.js';

describe('watermark SVG safety', () => {
    it('escapes user text before inserting it into foreignObject markup', () => {
        const svg = createWatermarkSvg({
            text: '</span><script>alert("xss")</script>&\'',
            color: '#00000030',
            angleDegrees: 45,
            width: 200,
            height: 100,
        });

        expect(svg).not.toContain('<script>');
        expect(svg).not.toContain('</span><script>');
        expect(svg).toContain('&lt;/span&gt;&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&amp;&apos;');
    });

    it('rejects CSS and transform injection in color, angle, and dimensions', () => {
        const svg = createWatermarkSvg({
            text: 'safe',
            color: 'red;position:fixed',
            angleDegrees: '45);background:url(javascript:alert(1))',
            width: '10" onload="alert(1)',
            height: -20,
        });

        expect(svg).not.toContain('position:fixed');
        expect(svg).not.toContain('javascript:');
        expect(svg).not.toContain('onload=');
        expect(svg).toContain('transform:rotate(0deg)');
        expect(svg).toContain('viewBox="0 0 1 1"');
    });

    it('escapes step text restored from an untrusted project document', () => {
        const decodedSvg = decodeURIComponent(numSvg('</span><script>alert("step")</script>&'));

        expect(decodedSvg).not.toContain('<script>');
        expect(decodedSvg).not.toContain('</span><script>');
        expect(decodedSvg).toContain('&lt;/span&gt;&lt;script&gt;alert(&quot;step&quot;)&lt;/script&gt;&amp;');
    });
});
