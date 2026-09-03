# Asset Provenance

ScreenHello only accepts visual assets that can be redistributed with the
source repository and built applications.

## Project assets

- `src/assets/logo.png`, `src/assets/favicon.png` and `public/pwa-*.png` are
  ScreenHello application identity assets contributed with the project.
- `src/assets/demo.jpg` is the bundled ScreenHello example illustration.
- `src/assets/blur.svg`, `src/assets/color.svg` and `src/assets/icon/*.svg` are
  interface assets inherited from the MIT-licensed Shoteasy source tree and
  modified or redistributed under the repository license.
- Built-in background presets and current device frames are code-native
  gradients and vector geometry. They do not bundle stock background images
  or branded device mockups.
- `tests/e2e/app.spec.js-snapshots/*.png` are deterministic screenshots and
  exports produced from repository fixtures, then visually reviewed as test
  baselines.

The former third-party gradient originals/thumbnails and the five legacy
branded device mockup sets were removed before the first public release.
Persisted background and frame identifiers remain readable, but resolve to
code-native replacements.

## Contributions

Do not add stock photos, icon packs, fonts, mockups, generated media or other
visual files without recording their source, author, exact license and any
required attribution here or in `THIRD_PARTY_NOTICES.md`. A link to a download
page is not a redistribution license.
