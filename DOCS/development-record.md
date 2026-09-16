# 开发总记录

> 最后更新：2026-09-16。本页汇总本地开发过程、代码 review、验证证据和仍未完成的外部条件。它是导航与交接记录；每个阶段的实现细节、输入输出和历史证据以链接的专题文档为准。

## 当前结论

当前工作树已具备 Web 编辑器、公开文档站、SEO/GEO、PWA 边界和跨平台桌面发布链的本地实现；桌面发布契约推进至 Phase 24。代码美化卡片和 GIF 仍未实现。代码与本地验证均不能替代真实签名候选、平台安装验收、受保护 GitHub Environment 或公开发布。

桌面链路的所有本地交接对象继续固定 `releaseReady=false`。没有因为本页记录而创建 tag、GitHub Release、公开下载、APT endpoint、签名、公证、时间戳或 attestation。

2026-09-16 的桌面 UI 回归审计发现，菜单、尺寸 Popover、浏览器地址输入、裁剪 Modal 和导出 Drawer 的集中失效来自 Ant Design layer 的静态 CSS 遗漏，而不是五个业务命令各自失效；另修复了 reduced-motion Portal 定位、Tauri IPC 被误记为公网发送，以及仅接收资源被错误标成上传告警的问题。完整的证据、修复、验证结果和未完成的 macOS/Windows 人工验收见[桌面 UI 回归审计](./desktop-ui-regression-audit-2026-09-16.md)。

## 记录方法

每个开发阶段按同一顺序推进：先检查现有实现和契约，再限定本阶段输入/输出边界，完成实现与自动化检查，进行代码 review 并补足负向用例，最后把结果、已知限制和后续前提写入本地文档。

| 记录位置 | 内容 |
| --- | --- |
| 本页 | 跨阶段时间线、当前结论、最新 review 修复和待办 |
| [质量基线](./quality-baseline.md) | 每轮本地验证的历史快照与明确未执行项 |
| 各 Phase 文档 | 当时的方案、实现边界、review 和复现命令 |
| [开发指南](./development.md) | 日常命令、输入输出和维护约定 |
| [变更日志](../CHANGELOG.md) | 面向用户的可见变化，不替代工程证据 |

## 产品与 Web 开发过程

| 阶段 | 完成的本地工作 | 详细记录 |
| --- | --- | --- |
| 基础质量与架构 | 建立实例级 runtime、生命周期约束、质量门禁和技术栈升级记录。 | [Phase 2](./phase-2-quality.md)、[Phase 3](./phase-3-foundation.md)、[Phase 4](./phase-4-upgrades.md) |
| 本地工作流 | 实现项目/预设、草稿、最近项目、图片安全验证、多图层和布局。 | [Phase 5](./phase-5-web-p0.md)、[Phase 6](./phase-6-web-p1.md) |
| 导出与离线 | 建立导出队列、批量处理、AVIF、PWA 和导出预算边界。 | [Phase 7](./phase-7-web-p2.md)、[导出压缩 C0–C4](./export-compression-c4.md) |
| 大图与压缩复核 | 将预览和下载预算分开，记录编码器、内存和跨浏览器复核的实际边界。 | [大图压缩下载](./compression-download.md) |
| SEO / GEO 与文档 | 建立七语静态文档、结构化数据、hreflang、CSP、PWA 和上线检查清单。 | [SEO / GEO](./seo-geo.md) |
| 桌面基础 | 建立 Tauri 2 独立入口、原生能力桥接、Linux runtime smoke 和无签名候选边界。 | [Phase 9 桌面 PoC](./phase-9-desktop-poc.md) |

这些文档记录已实现的本地能力和当时验证结果。涉及浏览器最低版本、真实 Safari、系统权限、平台安装、线上缓存、搜索收录或正式域名的结论，必须以对应的真实环境证据为准。

## 跨平台桌面开发时间线

| Phase | 主要建设内容 | 本地状态与记录 |
| --- | --- | --- |
| 1 | 固定 Linux、macOS、Windows 的 x64/arm64 六目标支持契约。 | [基线与支持契约](./desktop-cross-platform-phase-1.md) |
| 2 | 定义六目标候选构建、DMG/DEB/NSIS 载荷检查。 | [六目标候选构建](./desktop-cross-platform-phase-2.md) |
| 3 | 接入本地 AVIF/WebP/PNG Worker/WASM、CSP 与资源协议边界。 | [本地 WASM 编码兼容](./desktop-cross-platform-phase-3.md) |
| 4 | 明确截图权限、Wayland、macOS 和 Windows 的系统能力边界。 | [截图权限与系统能力](./desktop-cross-platform-phase-4.md) |
| 5 | 规定安装、升级、卸载与本地状态迁移的非破坏性约束。 | [安装生命周期与状态迁移](./desktop-cross-platform-phase-5.md) |
| 6 | 固定签名、公证、更新信任根、Linux 渠道和 provenance 的准备边界。 | [发布签名与信任准备](./desktop-cross-platform-phase-6.md) |
| 7 | 增加 macOS ARM64 受保护签名候选的静态契约。 | [macOS ARM64 签名候选](./desktop-cross-platform-phase-7.md) |
| 8 | 增加独立 macOS Intel 签名候选，避免从 ARM64 推导 Intel 结论。 | [macOS Intel 签名候选](./desktop-cross-platform-phase-8.md) |
| 9 | 增加 Windows x64 Authenticode/RFC 3161 候选与清理边界。 | [Windows x64 签名候选](./desktop-cross-platform-phase-9.md) |
| 10 | 增加 Windows ARM64 独立 target、runner 与签名候选。 | [Windows ARM64 签名候选](./desktop-cross-platform-phase-10.md) |
| 11 | 定义 Linux x64/arm64 DEB 输入和受保护 APT 仓库签名候选。 | [Linux DEB APT 仓库候选](./desktop-cross-platform-phase-11.md) |
| 12 | 定义客户端 `.gpg`/`.asc` 信任包、双键重叠及撤销流程。 | [Linux 信任包与密钥生命周期](./desktop-cross-platform-phase-12.md) |
| 13 | 为五条候选定义最小 OIDC、SLSA provenance 和 Sigstore bundle。 | [GitHub provenance](./desktop-cross-platform-phase-13.md) |
| 14 | 定义本地 provenance 预检与严格 GitHub CLI 验证计划。 | [本地预检与验证收据](./desktop-cross-platform-phase-14.md) |
| 15 | 增加候选重检、候选外交接和收据重验证。 | [原子交接](./desktop-cross-platform-phase-15.md) |
| 16 | 定义候选绑定的平台人工验收计划、模板和 evidence 复核。 | [平台人工验收记录](./desktop-cross-platform-phase-16.md) |
| 17 | 将五个候选关联为同一 immutable SHA 的六平台复核。 | [跨候选人工验收复核](./desktop-cross-platform-phase-17.md) |
| 18 | 生成候选外本地发布审查档案。 | [本地发布审查档案](./desktop-cross-platform-phase-18.md) |
| 19 | 生成五候选、11 个 attested subject 的载荷交接清单。 | [候选载荷交接清单](./desktop-cross-platform-phase-19.md) |
| 20 | 固定候选 repository ID，并定义只读 GitHub 配置预检。 | [候选身份与 GitHub 配置预检](./desktop-cross-platform-phase-20.md) |
| 21 | 固定 Enterprise Cloud、第一方 SHA-pinned Actions 和供应链约束。 | [Actions 供应链](./desktop-cross-platform-phase-21.md) |
| 22 | 隔离每个 job 的 Corepack home，拒绝项目控制的 Corepack 环境。 | [Hermetic Corepack](./desktop-cross-platform-phase-22.md) |
| 23 | 区分 6 个 GitHub Release 直链安装包和 5 个必须保留 APT 布局的 sidecar。 | [直链与 APT 边界](./desktop-cross-platform-phase-23.md) |
| 24 | 将候选提交、公开源码快照、版本、6+5 载荷和发布计划哈希写入候选外不可覆盖交接文件。 | [公开源码快照与发布交接](./desktop-cross-platform-phase-24.md) |

## Phase 24：最新开发与 review 记录

### 目标和实现步骤

Phase 24 解决的是“私有候选提交与公开 GitHub Release 目标不在同一 Git 提交空间”的问题。开发按以下步骤完成：

1. 将桌面发布矩阵升级为 schema v24，并把公开目标、beta metadata、6 个 direct-download asset、5 个 APT sidecar 和 `releaseReady=false` 固定为 fail-closed 策略。
2. 新增 `desktop-release-publication-handoff`：它只从指定的 immutable candidate commit 读取 `package.json` 和公开导出 allowlist，写入候选外、不可覆盖的交接 JSON。
3. 新增 committed-blob 公开导出快照：记录每个公开文件的路径、模式、字节数、SHA-256 和确定性的 `treeSha256`，并包含由导出器生成的 `PUBLIC_REPOSITORY.json`。
4. 让公开快照临时物化后复用公开仓审计，确认 allowlist、私有内容扫描、相对模块引用、文档链接、许可和资源声明仍然成立。
5. 将交接脚本、配置、测试和文档加入 Desktop Release Gate 与公开导出 allowlist，避免发布前出现未纳入审计的依赖。

### Review 发现并修复的边界

- Git 读取改为提交 blob，清除会影响对象选择的 Git 环境覆盖，并禁用 replace ref；工作树变化不会改变既有候选快照。
- 候选提交若预置 `PUBLIC_REPOSITORY.json` 会被拒绝；该标记只能由导出器生成。
- 快照树的排序改为稳定比较，避免运行环境的 locale 排序造成哈希不一致。
- 公开审计器自身需要检测内部名称，但不会因代码中保存检测规则而误报自身；检测能力没有放宽。
- 版本校验改为严格 SemVer 2.0.0：拒绝纯数字 prerelease identifier 的前导零，并保留允许的 build metadata 进入 tag。
- 交接写入、读取和最终复核都会重新验证输入；目录重叠、符号链接、已有输出、篡改 JSON 或输入变化都会失败。

### Phase 24 本地验证记录

| 检查 | 结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过；Web 构建保留既有大于 500 kB chunk 提示。 |
| `pnpm test:unit` | 90 个测试文件、1,328 项通过。 |
| 发布链测试 | 发布交接集成测试和桌面契约负向测试通过，覆盖 6+5 划分、commit 快照、重复写入、篡改和非法 prerelease 版本。 |
| 发布静态审计 | desktop contract、trust、workflow 与 GitHub Actions 供应链审计通过；trust 仍报告 `releaseReady=false`。 |
| 文档与站点 | 文档内容检查通过；42 页 Web/文档构建、SEO 与 PWA 审计通过。 |
| 公开导出预览 | 793 个允许文件通过，标记为 `local-worktree-preview`，且 `releaseReady=false`。 |

完整的命令、旧阶段测试数字和历史约束见[质量基线](./quality-baseline.md)与[开发指南](./development.md)。

## 尚未完成的外部步骤

下列事项不是本地代码可以替代的工作，完成前不得把开发记录解释为正式发布完成：

1. 在公开目标仓库配置并实际运行受保护 promotion workflow、Environment 和最小权限 publisher identity。
2. 在公开目标 `main` 上重建公开导出，并与候选交接中的 `treeSha256` 精确匹配。
3. 在 macOS ARM64/Intel、Windows x64/ARM64、Linux x64/arm64 上取得真实签名候选、安装/升级/卸载和权限生命周期证据。
4. 配置独立 HTTPS APT endpoint，完成 `dists/`/`pool/` 布局、keyring 分发、密钥轮换和撤销演练。
5. 确定 updater 信任根、端点、密钥轮换和商店渠道方案，并取得明确发布授权后才执行发布操作。

## 后续维护

后续 Phase 或修复完成后，应在同一变更中更新本页、对应专题文档、[质量基线](./quality-baseline.md)和必要的用户可见变更日志。记录必须写明日期、实际执行的命令、通过/失败结果、未执行的外部操作和仍需人工确认的条件；不要把计划或本地静态检查写成已上线、已签名或已发布。


## 2026-09-16：公开仓库 macOS ARM64 DMG 构建

用户要求在 `web-casa/ScreenHello` 公开仓库构建 Apple Silicon DMG。新增手动工作流 `.github/workflows/macos-arm64-dmg.yml`，限定公开仓库 numeric ID；main 支持手动触发，本次专用 `build/macos-arm64-dmg-20260916` 分支支持 push 构建；使用 macOS 14 ARM64 runner、Node 24、锁定 pnpm/Rust 和 Cargo.lock，复用空密码 P12 导入与清理流程。构建包含本轮桌面 UI 与公网计数修复，通过公开源码 allowlist 导出，不带本地设备素材包。

工作流验证 Developer ID 签名、应用及最终 DMG 公证/staple、Gatekeeper 和主程序 ARM64 架构，输出最终 DMG 的 SHA-256 与源码/run 信息。产物仅上传 Actions，保留 30 天，不创建 Release。Secrets 缺失会明确失败，不静默降级为未签名包。原有私有六平台候选流程保持独立；本流程不表示六平台发布 Gate 或人工 GUI 验收通过。

本地新增流程已通过 actionlint、Actions 供应链审计、lint 和相关 39 项 unit 测试；公开源码预览审计通过。远端构建结果在实际运行结束后补记。
