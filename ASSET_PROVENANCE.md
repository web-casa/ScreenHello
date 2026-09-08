# Asset Provenance

ScreenHello's public source distribution only accepts visual assets that can
be redistributed with the source repository and built applications.

## Maintainer confirmation for the public website — 2026-09-08

After reviewing the outstanding asset list, the maintainer stated that all listed
assets were acceptable and requested this confirmation be recorded. This is
recorded as maintainer approval for use in ScreenHello's public Web deployment:

- Surface Studio and Surface Pro (Pro 8), including their derived masks.
- The five historical Shoteasy MacBook Pro, MacBook Air, iMac, iPad and iPhone PNGs.
- The nine Monkr MacBook Air M2 / iMac 24-inch color variants.
- The telephone Pixel 9 Pro derivative.
- The two supplied Apple webpage example screenshots (`101.webp` / `102.webp`).
- The 22 supplied backgrounds, three generated natural backgrounds, and the
  project illustrations discussed in the same review.

This records the maintainer's confirmation, not independent verification of
third-party rights. No additional rights-holder license evidence was supplied
in this confirmation. Existing source links, copyright notices, known license
terms and artwork-specific `unverified` metadata remain intact; unknown artwork
licenses are not changed to MIT. Earlier statements below about missing public
approval describe the prior review status: maintainer approval for this website
is now recorded, while independent permission verification remains distinct.
This does not authorize standalone asset redistribution, inclusion of optional
packs in the public source repository, or redistribution in library/desktop
packages. It also does not record an actual deployment or waive release gates.

## Web favicon and installation icons

The reviewed [Web icon manifest](config/webIconAssets.json) records six
verbatim RealFaviconGenerator outputs supplied by the maintainer from the
project's existing logo. The record pins source URL, source-logo SHA-256 and
every output SHA-256. No runtime request to the generator is made. Its two
transparent web-app PNGs are used as `any`, not the `maskable` purpose declared
in the downloaded manifest; existing opaque maskable artwork is retained.
The generator's separate `site.webmanifest` is not installed. Desktop icons
and the original logo are unchanged.

## Optional local device pack (not included in public source)

The editor supports a separately installed `local-device-assets/` pack, ignored
by Git and excluded from the public export manifest. Local builds made while
the pack is installed include its PNG derivatives; they are not cleared for
public redistribution and the images are not relicensed under MIT.

- Surface Studio: Tony Thomas / Medialoot, [source](https://medialoot.com/item/surface-studio-mockup/),
  [Medialoot license](https://medialoot.com/member/license/).
- Surface Pro 8: MockupFree.co, [source](https://mockupfree.co/product/free-microsoft-surface-pro-8-mockup-psd-template/),
  [MockupFree license](https://mockupfree.co/licence/). Displayed as Surface Pro;
  the source generation and persisted `surface-pro-8` identifier are unchanged.
- Local PNGs are device-group and screen-mask derivatives of the supplied PSDs;
  they are not AI recreations. The original PSDs are not included in builds or
  project files. Download notices link to the original terms and do not grant
  permission or waive attribution requirements.
- A clean source build without the optional pack remains functional and omits
  unavailable device choices. See [integration notes](DOCS/raster-device-frames.md).

The optional pack may also contain five original PNGs recovered from local
Shoteasy history: MacBook Pro (`macbook-pro.png`, 1920×1266), MacBook Air
(`macbook-air.png`, 1920×1147), iMac (`imac.png`, 1920×1599), iPad (`ipad.png`,
1920×1425), and iPhone (`iphone.png`, 968×1920). Their direct source is the
[upstream Shoteasy project](https://github.com/ricocc/shoteasy); the original
artwork authors and specific licenses remain unverified. They are not approved
for public redistribution and are not asserted to be MIT artwork. They are
unchanged bitmap files, not AI recreations; masks are derived only at runtime.
The UI retains source links without a repeated verification-status warning;
the unverified status remains recorded here and in the asset registry. The code
license is not linked as the artwork license. These PNGs remain outside the public export.

The approved local DM0 sample pack additionally installs these bounded PNGs:

- MacBook Air M2 in silver, starlight, space gray and midnight, and iMac 24-inch
  in blue, orange, purple, source-named red (pink appearance) and silver. These
  nine files come from Monkr commit `33e69fb008d3ea53718ac19dae87260bd72c9cfb`,
  under [`static/devices`](https://github.com/blaineam/Monkr/tree/33e69fb008d3ea53718ac19dae87260bd72c9cfb/static/devices).
  Their original artwork authors and specific licenses are **unverified**;
  Monkr's code license is not asserted to cover this artwork. These are not the
  separate Apple official iMac M4 seven-color assets, which were not installed.
- Pixel 9 Pro derives from the static SVG in telephone commit
  `c1644a3d49dcd50ebf8c76306409c4b1d9b7a2b4`,
  [`pixel-9-pro.html.ts`](https://github.com/sneas/telephone/blob/c1644a3d49dcd50ebf8c76306409c4b1d9b7a2b4/packages/telephone/src/pixel-9-pro.html.ts).
  Copyright (c) 2024 Dimah Snisarenko, MIT. The simulated status-bar paths were
  removed; the body gradients, camera cutout and buttons were preserved. This
  is rasterized vector artwork, not a photographic asset or standard Pixel 9.
  The full license is retained in [third-party notices](THIRD_PARTY_NOTICES.md).
- All ten bodies are normalized to a maximum 1440-pixel edge, with separate
  maximum 320-pixel thumbnails. No hue filter creates substitute colors. The
  local installation manifest records the pinned source and output hashes.
  This optional pack, including Pixel, remains excluded from public source
  exports; this integration did not publish assets or authorize redistribution
  of the nine unverified Monkr images.

## Project assets

- `src/assets/backgrounds/bg-image-n01.webp` through `n03` and their
  `bg-thumb-*` derivatives are the three project-generated natural backgrounds
  selected by the maintainer (misty mountains, coast, dunes). They were generated
  from text descriptions, not downloaded stock photos or copies of a reference image.
- `src/assets/backgrounds/bg-image-u01.webp` through `u22` and their thumbnails
  derive from 22 unique maintainer-provided images explicitly approved for use
  in ScreenHello. This approval is recorded as project-use permission, not an
  assertion of CC0, a third-party site license, or a new MIT license grant over
  the supplied artwork. No additional attribution requirement was supplied.
- The [background manifest](src/assets/backgrounds/manifest.json) records source
  hashes, provenance categories and derivative hashes/dimensions. The full images
  preserve original dimensions; only thumbnails are cropped. Before any separate
  public redistribution, retain the source permissions; this local integration
  does not itself publish or expand those permissions.

- `src/assets/logo.svg` is the project-supplied ScreenHello identity source
  provided for the 2026-09-07 brand replacement. Its original 1254×1254 SVG is
  retained byte-for-byte: SHA-256
  `d9412cf6667d8a18ed0ea171db6a48cfeef0c0e5cc35629e3c50626b89217489`.
- `src/assets/logo.png`, `src/assets/favicon.png`, `public/pwa-*.png` and
  `src-tauri/icons/*` derive from that one SVG through
  `scripts/generate-brand-assets.mjs` and the pinned Tauri CLI 2.11.4. These UI,
  compatibility and desktop icons use a centered, tighter viewport; maskable icons keep the
  original safe padding on an opaque `#111318` base. Paths and gradient colors
  are not redrawn. The SVG replaces the previous identity artwork and does not
  add a third-party icon pack. See [regeneration instructions](DOCS/development.md#品牌图标).
- `src/assets/demo-mobile.webp` and `src/assets/demo-desktop.webp` are verbatim
  maintainer-provided screenshots (`101.webp` and `102.webp`), approved for local
  example use on 2026-09-08. They contain third-party Apple webpage artwork;
  project-use approval is not an assertion of MIT/CC0 rights over that artwork.
  Confirm redistribution permission before a separate public release. SHA-256:
  mobile `209fed62c74603b0c874aca780d0d5115868946807d4f7a320118b6247c89c79`,
  desktop `5a8548eb6272286fd4158b137332b26acec11ffa4d01b8258d1865aaac4ab0a7`.
  No request to Apple or another third-party host occurs when loading them.
- `src/assets/demo.jpg` is the historical ScreenHello example illustration,
  retained for existing codec experiments; the welcome button no longer uses it.
- `src/assets/ambient-import.webp` is a ScreenHello-specific decorative glass
  picture-frame illustration generated with OpenAI Image Gen on 2026-09-06
  from the project's selected Ambient Shelf design. No third-party stock,
  brand or font asset was used in this illustration. It is distributed with
  this project under the repository's MIT license; no separate third-party
  attribution is required. The bitmap has an opaque near-black background;
  the UI blends it into its theme surface, rather than claiming alpha. The
  original PNG was encoded as WebP at quality 88 for the core offline budget.
- `src/assets/blur.svg`, `src/assets/color.svg` and `src/assets/icon/*.svg` are
  interface assets inherited from the MIT-licensed Shoteasy source tree and
  modified or redistributed under the repository license.
- Legacy background presets and default device frames remain code-native
  gradients and vector geometry. The 25 newly selected image backgrounds above
  use separate stable identifiers and do not replace those legacy mappings.
- `tests/e2e/app.spec.js-snapshots/*.png` are deterministic screenshots and
  exports produced from repository fixtures, then visually reviewed as test
  baselines.

The former third-party gradient originals/thumbnails and the five legacy
branded device mockup sets were removed from the public distribution before the first public release.
Persisted background and frame identifiers remain readable, but resolve to
code-native replacements.

## Contributions

Do not add stock photos, icon packs, fonts, mockups, generated media or other
visual files without recording their source, author, exact license and any
required attribution here or in `THIRD_PARTY_NOTICES.md`. A link to a download
page is not a redistribution license.
# Public product illustrations

`public/site/before.svg`, `after.svg` and `social.svg` are original code-native schematic illustrations created for ScreenHello, with no third-party screenshot or device artwork. `social.png` is a 1200×630 raster derivative of `social.svg`, generated locally by `scripts/generate-site-social.mjs`. These illustrations are distributed under this repository's MIT licence. The product pages label the comparison as illustrative; it is not a screenshot of a branded device or a promise of an installed optional asset pack. The Web favicon remains governed by the existing brand-asset record.
