import { gzipSync } from 'node:zlib';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const imageExtensions = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp']);

async function listFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
    }));
    return nested.flat();
}

async function describe(file) {
    const contents = await readFile(file);
    const text = contents.toString('utf8');
    const dataImageUrls = [...text.matchAll(/data:image\/[^,]+,([^"')\s]+)/g)];
    return {
        file: path.relative(root, file),
        bytes: contents.length,
        gzipBytes: gzipSync(contents).length,
        dataImageUrls: dataImageUrls.length,
        largestDataImageUrlBytes: dataImageUrls.reduce((largest, match) => Math.max(largest, match[0].length), 0),
    };
}

async function main() {
    const distPath = path.join(root, 'dist');
    const libPath = path.join(root, 'lib');
    await Promise.all([stat(distPath), stat(libPath)]);
    const [distFiles, libraryFiles] = await Promise.all([listFiles(distPath), listFiles(libPath)]);
    const described = await Promise.all([...distFiles, ...libraryFiles].map(describe));
    const entryJavaScript = described
        .filter((item) => item.file.startsWith('dist/') && item.file.endsWith('.js'))
        .sort((left, right) => right.bytes - left.bytes)[0];
    const entryCss = described
        .filter((item) => item.file.startsWith('dist/') && item.file.endsWith('.css'))
        .sort((left, right) => right.bytes - left.bytes)[0];
    const largestFile = described
        .filter((item) => item.file.startsWith('dist/'))
        .sort((left, right) => right.bytes - left.bytes)[0];
    const libraryJavaScriptFiles = described.filter((item) => item.file.startsWith('lib/') && item.file.endsWith('.js'));
    const libraryPackageEntry = libraryJavaScriptFiles.find((item) => item.file === 'lib/image-beautifier.es.js');
    const libraryJavaScript = [...libraryJavaScriptFiles].sort((left, right) => right.bytes - left.bytes)[0];
    const libraryCss = described.find((item) => item.file === 'lib/style.css');
    const webWasmFiles = described.filter((item) => item.file.startsWith('dist/') && item.file.endsWith('.wasm'));
    const libraryWasmFiles = described.filter((item) => item.file.startsWith('lib/') && item.file.endsWith('.wasm'));
    const summarizeWasm = (files) => ({
        files: files.length,
        assets: [...files].sort((left, right) => left.file.localeCompare(right.file)),
        largest: [...files].sort((left, right) => right.bytes - left.bytes)[0] || null,
    });

    const report = {
        generatedAt: new Date().toISOString(),
        web: {
            entryJavaScript,
            entryCss,
            largestFile,
            imageFiles: distFiles.filter((file) => imageExtensions.has(path.extname(file).toLowerCase())).length,
            dataImageUrls: described
                .filter((item) => item.file.startsWith('dist/'))
                .reduce((total, item) => total + item.dataImageUrls, 0),
            wasm: summarizeWasm(webWasmFiles),
        },
        library: {
            entryJavaScript: libraryJavaScript,
            packageEntry: libraryPackageEntry,
            totalJavaScript: {
                files: libraryJavaScriptFiles.length,
                bytes: libraryJavaScriptFiles.reduce((total, item) => total + item.bytes, 0),
                gzipBytes: libraryJavaScriptFiles.reduce((total, item) => total + item.gzipBytes, 0),
            },
            entryCss: libraryCss,
            imageFiles: libraryFiles.filter((file) => imageExtensions.has(path.extname(file).toLowerCase())).length,
            dataImageUrls: described
                .filter((item) => item.file.startsWith('lib/'))
                .reduce((total, item) => total + item.dataImageUrls, 0),
            largestDataImageUrlBytes: described
                .filter((item) => item.file.startsWith('lib/'))
                .reduce((largest, item) => Math.max(largest, item.largestDataImageUrlBytes), 0),
            wasm: summarizeWasm(libraryWasmFiles),
        },
    };

    if (!entryJavaScript || !entryCss || !libraryJavaScript || !libraryPackageEntry || !libraryCss) {
        throw new Error('Expected Web and library build outputs were not found. Run both builds first.');
    }
    const violations = [];
    if (entryJavaScript.bytes > 1_650_000 || entryJavaScript.gzipBytes > 525_000) {
        violations.push('Web entry JavaScript exceeds the Phase 3 budget (1,650,000 raw / 525,000 gzip bytes).');
    }
    if (libraryJavaScript.bytes > 1_350_000) {
        violations.push('Largest library JavaScript chunk exceeds the Phase 3 budget (1,350,000 bytes).');
    }
    if (report.library.largestDataImageUrlBytes > 100_000) {
        violations.push('Library contains a data image URL larger than the Phase 3 100,000-byte ceiling.');
    }
    const expectedWasm = [
        { name: 'AVIF', pattern: /\/avif_enc-[^/]+\.wasm$/, bytes: 3_600_000, gzipBytes: 1_200_000 },
        { name: 'WebP', pattern: /\/webp_enc-[^/]+\.wasm$/, bytes: 300_000, gzipBytes: 130_000 },
    ];
    for (const [target, wasm] of [['Web', report.web.wasm], ['Library', report.library.wasm]]) {
        if (wasm.files !== expectedWasm.length) {
            violations.push(`${target} must emit exactly one standalone AVIF WASM asset and one WebP WASM asset.`);
        }
        for (const expected of expectedWasm) {
            const matches = wasm.assets.filter(({ file }) => expected.pattern.test(file));
            if (matches.length !== 1) {
                violations.push(`${target} must emit exactly one standalone ${expected.name} WASM asset.`);
                continue;
            }
            const [asset] = matches;
            if (asset.bytes > expected.bytes || asset.gzipBytes > expected.gzipBytes) {
                violations.push(
                    `${target} ${expected.name} WASM exceeds its budget (${expected.bytes} raw / ${expected.gzipBytes} gzip bytes).`
                );
            }
        }
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (violations.length) throw new Error(violations.join('\n'));
}

main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
