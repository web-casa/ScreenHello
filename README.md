# ScreenHello — browser test candidate

ScreenHello is a local-first image editor built with React, Vite, MobX and LeaferJS. It supports backgrounds, annotations, project files and PNG/JPEG/WebP/AVIF export. Images are processed locally; no account or cloud storage is required.

This branch is an unpublished compatibility-test candidate, not a release or the version deployed at https://screenhello.com. Existing documentation inherited from main describes an earlier revision. No desktop release or npm publication is enabled here.

## Develop and verify

Use Node 24.18.0 and pnpm 10.12.1.

```sh
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm dev
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
```

The manual Web Release Browser Matrix workflow checks Chrome 111, Edge 111, Firefox 128 and real Safari on macOS 14. Its standard-format compatibility checks do not constitute complete compression, memory or physical mobile-device acceptance. Each run records its commit, built-file fingerprint and host environment. Passing does not authorize deployment.

Optional device artwork is not included in this source snapshot. See [asset provenance](ASSET_PROVENANCE.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

ScreenHello is based on [Shoteasy](https://github.com/ricocc/shoteasy). The upstream copyright and MIT license are preserved in [LICENSE](LICENSE) and [NOTICE](NOTICE).
