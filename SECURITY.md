# Security Policy

## Supported version

在首个公共版本发布前，只有公开仓库 `main` 的最新代码接受安全修复。正式版本发布后，本文件会列出仍受支持的版本范围。

## Reporting a vulnerability

请不要在公开 issue、讨论区或 PR 中披露未修复漏洞、用户数据或有效凭据。

优先使用 GitHub 的 private vulnerability reporting：

<https://github.com/web-casa/ScreenHello/security/advisories/new>

报告请包含受影响版本或 commit、复现条件、影响、最小复现和建议缓解方式。维护者会先确认收到，再协调修复与公开时间；在双方商定披露前请保留细节。

如果仓库的 private vulnerability reporting 尚未启用，请仅通过 `web-casa` 组织资料中列出的私下联系方式提醒维护者开启该渠道，不要在公开 issue 中粘贴漏洞细节。

## Scope

以下内容属于重点范围：本地文件/项目解析、SVG 与 URL 处理、剪贴板和下载、Service Worker/cache、WASM codec、依赖与 GitHub Actions 供应链，以及任何违反“用户内容不上传”承诺的网络行为。
