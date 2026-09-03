# Changelog

ScreenHello 的重要用户可见变化记录在这里。版本采用何种 SemVer 起点将在首次公共发布前确认；在此之前所有条目保留在 `Unreleased`。

## Unreleased

### Added

- 纯本地截图美化、项目/预设、多个图片图层、批量导出和 PWA 离线能力。
- PNG、JPEG、WebP、AVIF 与 1x/2x/3x 导出；不支持 Canvas WebP 的浏览器使用本地 Worker/WASM 兜底。
- Chrome/Edge 111+、Firefox 128+、Safari 16.4+ 的声明基线，以及当前/最低浏览器发布门禁。
- 可多实例隔离的内部 React library 构建与独立 consumer 验证。

### Security

- 本地资源、项目归档、SVG、背景 URL、Service Worker 缓存和公开晋级内容使用 fail-closed 校验。

[Unreleased]: https://github.com/web-casa/ScreenHello/commits/main
