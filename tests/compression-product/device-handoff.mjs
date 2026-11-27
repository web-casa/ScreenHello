import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { digest, hashPaths, root, sha256, validateManifest, writeImmutableJson } from './memory-evidence.mjs';

// Preparation only. A worksheet is NOT a device supplement or an attestation.
// Reuse the frozen candidate identity, not today's (changed) collection runner.
export function deviceChecks() {
    const checks = [
        ['import-pc-example', 1, '通过PC宽度下的试用示例导入；记录最终画布尺寸，确认可编辑。'],
        ['import-mobile-example', 1, '通过手机宽度下的试用示例导入；调整窗口不算移动设备实测。'],
        ...['png-lossless', 'png-lossy', 'webp-lossless', 'webp-lossy', 'jpg-lossy'].map(mode =>
            [mode, 1, '最终输出大于1MP且不超过4,194,304像素，记录格式、质量、倍率、实际解码尺寸及用时。']),
        ['avif-lossy-small', 1, '最终输出不超过1,048,576像素，直接下载并解码，不能静默缩图。'],
        ['avif-standard-4mp', 1, '通过UI设最终尺寸2048×2048、1x、标准AVIF，下载并解码。'],
        ['avif-standard-continuous', 6, '同一编辑会话连续六次2048×2048标准AVIF，逐次记录用时、页面存活、响应和系统压力；不强制GC。'],
        ['cancel-and-recover', 1, '任务执行中取消，确认停止交付、项目仍在、可继续编辑并再次成功下载；任务已结束不能算取消成功。'],
        ['reject-large-lossy-avif', 1, '大于1MP的有损AVIF明确拒绝；主动切换标准可用，不能自动换格式/质量。'],
        ['ratio-and-dimensions', 1, '小图PNG无损2x；记录面板最终像素，解码核对倍率及尺寸。'],
        ['transparency-and-white-matte', 1, '透明背景PNG保留alpha，标准JPG/WebP按现有白底契约；记录实际像素检查。'],
        ['batch-cancel-recover', 1, '两张图批量、取消/恢复及ZIP内成功文件解码；不引入新并发或扩大既有预算。'],
        ['offline-codec-recovery', 1, '独立测试配置/副本中冷codec不可用后恢复联网；记录错误、恢复下载与项目保留，不清除用户真实草稿。'],
    ];
    // One attempt per scenario. A scenario can contain several distinct actions;
    // do not misreport e.g. a three-format alpha check as a single download.
    return checks.map(([id, continuousExports, instructions]) => ({ id, attemptLimit: 1,
        continuousExports: continuousExports === 6 ? 6 : null, instructions }));
}

export async function prepareDeviceHandoff({ manifestFile, webDirectory, outputDirectory }) {
    const manifestBytes = readFileSync(manifestFile);
    const manifest = JSON.parse(manifestBytes);
    validateManifest(manifest);
    assert.equal(manifest.scope, 'release', 'device handoff requires a release manifest');
    assert.ok(lstatSync(webDirectory).isDirectory() && !lstatSync(webDirectory).isSymbolicLink(), 'Web directory must not be a symlink');
    const web = realpathSync(webDirectory);
    // Resolve the existing parent too: a symlink alias cannot bypass this guard.
    const requestedOutput = path.resolve(outputDirectory);
    const output = path.join(realpathSync(path.dirname(requestedOutput)), path.basename(requestedOutput));
    const relative = path.relative(web, output);
    assert.ok(relative && (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)), 'output must be outside the frozen Web');
    // Creating an ancestor would fail mkdir anyway; reject it before fingerprinting.
    assert.ok(!web.startsWith(`${output}${path.sep}`), 'output must not contain the frozen Web');
    const webBuildSha256 = hashPaths(web, ['./']);
    assert.equal(webBuildSha256, manifest.candidate.webBuildSha256, 'frozen Web digest mismatch');

    const matrix = JSON.parse(readFileSync(path.join(root, 'config/browser-release-matrix.json'), 'utf8'));
    const targets = matrix.targets.map(target => ({
        id: target.id,
        deviceGate: target.browser === 'safari' ? 'macos-14-real-safari' : 'native-amd64-minimum-browsers',
        browserPolicy: target.versionPolicy || 'exact', version: target.version,
        execution: target.browser === 'safari' ? 'real Safari on macOS 14; not Playwright WebKit' : 'native amd64; not emulation',
    }));
    targets.push({ id: 'representative-mobile', deviceGate: 'representative-mobile',
        execution: 'owner-selected physical phone/tablet; desktop viewport emulation does not qualify' });
    const checks = deviceChecks();
    const handoff = {
        schema: 'screenhello-device-handoff/v1', phase: 'preparation', status: 'EVIDENCE-HOLD',
        preparedAt: new Date().toISOString(), manifestSha256: sha256(manifestBytes),
        candidate: manifest.candidate, candidateSha256: digest(manifest.candidate), webBuildSha256,
        handoffToolSha256: hashPaths(root, ['tests/compression-product/device-handoff.mjs',
            'tests/compression-product/prepare-device-check.mjs', 'tests/compression-product/memory-evidence.mjs',
            'config/browser-release-matrix.json']),
        targets, checks, deploymentAuthorized: false, deviceTestsExecuted: false,
        constraints: [
            'This contains no Web assets or deployable site. Serve a verified copy of this exact Web candidate; the current public website is not that candidate.',
            'Candidate runnerSha256 identifies historical collection, not this handoff tool. Do not rewrite old reports.',
            'Name devices and actual browser versions, candidate URL/digest, fixtures/settings, operator and bounded attempts before collecting evidence. This preparation is not that registration.',
            'Stop the affected scenario on crash/OOM/output failure; preserve first failures. No automatic retries or additional pressure rounds.',
            'Record timings, decoded output dimensions/MIME/alpha, project survival, response/cancellation and system pressure. Unavailable RAM/RSS must include a reason, never guessed or zero.',
            'A six-operation device check does not replace the existing 24-operation memory trend or explain MG2 failures.',
            'The editable worksheet is not accepted as a gate/device pass. Independent review must bind actual evidence attachments; no automatic supplement conversion.',
        ],
    };
    const worksheet = {
        schema: 'screenhello-device-worksheet/v1', status: 'pending',
        handoffContentSha256: digest(handoff), candidateSha256: handoff.candidateSha256,
        registration: null,
        targets: targets.map(target => ({ id: target.id, operator: null, model: null, os: null,
            architecture: null, browser: null, browserVersion: null, executionSource: null,
            ram: { bytes: null, unavailableReason: null },
            systemPressureEvidence: null, testUrl: null, servedWebSha256: null,
            checks: checks.map(check => ({ id: check.id, status: 'pending', observations: [], evidenceFiles: [] })),
        })),
    };
    // Exclusive directory and immutable completion marker. A partial directory is
    // retained on failure and is not ready without handoff.json; never overwrite.
    await mkdir(output);
    await writeImmutableJson(path.join(output, 'device-worksheet.json'), worksheet);
    assert.equal(hashPaths(web, ['./']), webBuildSha256, 'frozen Web changed during preparation');
    await writeImmutableJson(path.join(output, 'handoff.json'), handoff);
    return { outputDirectory: output, webBuildSha256, targets: targets.length, checksPerTarget: checks.length,
        status: 'EVIDENCE-HOLD', deviceTestsExecuted: false, deploymentAuthorized: false };
}
