import assert from 'node:assert/strict';

// Empty preserves historical workflow dispatches; a supplied identity fails closed.
export function checkExpectedWebBuild(actual, expected = '') {
    assert.match(actual, /^[a-f0-9]{64}$/, 'invalid actual Web build SHA256');
    assert.equal(typeof expected, 'string', 'invalid expected Web build SHA256');
    if (expected === '') return { expectedWebBuildSha256: null, expectedWebBuildMatched: null };
    assert.match(expected, /^[a-f0-9]{64}$/, 'invalid expected Web build SHA256');
    assert.equal(actual, expected, 'unexpected Web candidate bytes');
    return { expectedWebBuildSha256: expected, expectedWebBuildMatched: true };
}
