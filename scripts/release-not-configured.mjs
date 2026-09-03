import process from 'node:process';

process.stderr.write([
    'npm-publication-not-configured',
    'ScreenHello remains private on npm until its package name, SemVer policy,',
    'trusted publisher, protected environment, and public release tag contract are approved.',
].join('\n') + '\n');
process.exitCode = 1;
