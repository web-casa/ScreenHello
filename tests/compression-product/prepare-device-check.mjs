import assert from 'node:assert/strict';
import { prepareDeviceHandoff } from './device-handoff.mjs';

const [manifestFile, webDirectory, outputDirectory, ...extra] = process.argv.slice(2);
assert.ok(manifestFile && webDirectory && outputDirectory && !extra.length,
    'usage: node tests/compression-product/prepare-device-check.mjs MANIFEST.json FROZEN_WEB NEW_OUTPUT_DIRECTORY');
console.log(JSON.stringify(await prepareDeviceHandoff({ manifestFile, webDirectory, outputDirectory }), null, 2));
// exit 0 means the handoff was prepared, never that device/release gates passed.
