# 开发指南

## 环境与安装

标准开发和 CI 环境为 Node.js 24，当前通过 `.node-version`、`.nvmrc` 和 `engines.node` 固定到 24.x；包管理器由 `packageManager` 固定为 pnpm 10.12.1 及其 SHA-512 tarball hash。基线采集使用 Node 24.18.0。

正常情况下应执行：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

开发服务器由 Vite 启动。项目没有环境变量、后端服务或数据库迁移。


## 常用命令

| 命令 | 用途 | 预期产物 |
| --- | --- | --- |
| `pnpm dev` | 启动 Vite 开发服务器 | 无提交产物 |
| `pnpm build` | Vite Web 构建自动重建 Fumadocs 文档站并合并 | `dist/`（含 `dist/docs/`） |
| `pnpm build:docs` | 生成 MDX 后构建公开文档站（内容生成 + `astro build` + 后处理） | `docs/dist/` |
| `pnpm --dir docs check` | 检查文档站 TypeScript/React 类型（不检查 Astro 模板） | 无 |
| `pnpm check:docs-content` | 校验生成的 MDX 与 `site/content/*.json` 一致 | 无 |
| `pnpm build:lib` | 构建 npm ES 模块 | `lib/` |
| `pnpm typecheck` | 检查公共 JSDoc/TypeScript 边界 | 无 |
| `pnpm lint` | 检查 `.js/.jsx` | 无 |
| `pnpm test:unit` | 一次性运行 Vitest 单元测试 | 无 |
| `pnpm test:unit:watch` | 本地监听单元测试 | 无 |
| `pnpm test:e2e` | 运行当前 Chromium/Firefox/WebKit smoke/E2E；重型导出 benchmark 默认跳过 | `artifacts/`（失败时） |
| `pnpm test:release:current` | 先 `pnpm build`，在 production preview 运行当前三引擎格式、本地优先、键盘、axe、reduced-motion 及批量 AVIF 取消/恢复检查（非最低版本矩阵） | `artifacts/release/playwright/` 与报告附件 |
| `pnpm test:release:minimum-browser` | 连接显式配置的 Selenium/WebDriver，核对版本并生成含桌面/移动闭环的 schema v2 单目标证据 | `artifacts/release/browser-matrix/*.json` |
| `pnpm audit:release:browsers` | fail-closed 合并审计 Chrome/Edge 111、Firefox 128、Safari 16.4 的同一候选提交证据 | 无 |
| `pnpm test:consumer` | 打包 tarball，在独立 package 安装后分别验证 Vite 开发态、生产 build/preview、延迟资源、双实例和卸载重挂 | `artifacts/`（包、consumer production build 与失败证据） |
| `pnpm size:report` | 输出 Web/library 体积与内联图片统计 | 标准输出 |
| `pnpm preview` | 预览站点构建 | 需要先有 `dist/` |
| `pnpm desktop:web:build` | 构建 Tauri 专用前端，不注册 PWA | `dist-desktop/` |
| `pnpm desktop:check` | locked Cargo check | `src-tauri/target/` |
| `pnpm desktop:test:rust` | Rust payload、文件/截图边界、系统事件与原子写入单测 | `src-tauri/target/` |
| `pnpm desktop:build` | Tauri release build，显式不生成安装包 | `src-tauri/target/release/screenhello-desktop`（Linux） |
| `pnpm desktop:test:runtime` | Linux Xvfb/WebKitWebDriver 的 AVIF/WebP/PNG Worker/WASM、截图能力/未授权拒绝、非破坏性本地状态标记、示例导入、剪贴板、快捷键/托盘状态与单实例 smoke；成功截图仅限交互模式 | 无提交产物 |
| `pnpm audit:desktop:codecs` | 检查桌面前端的三份 codec Worker/WASM 资产、哈希链接与大小边界 | 无 |
| `pnpm audit:desktop:contract` | 检查桌面版本、六目标、生命周期与 schema v24 发布信任契约 | 无 |
| `pnpm audit:desktop:trust` | 检查无签名候选保持无凭据，并检查独立 macOS、Windows x64/ARM64、Linux DEB 仓库/客户端信任包、provenance、跨候选复核、候选外本地发布审查档案、载荷交接清单、公开源码快照与公开直链/APT 划分；成功仍输出 `releaseReady=false` | 无 |
| `pnpm audit:desktop:artifact-provenance` | 检查五条受保护签名 workflow 的最小 OIDC/attestation 权限、固定 action、subject、凭据清理顺序、Sigstore bundle/verification plan/checksum、候选内禁用 `gh` 与无发布操作 | 无 |
| `pnpm desktop:verify-provenance -- --verify-local --candidate-dir <目录>` | 校验下载后的单个受保护候选的 record、bundle、subject、verification plan 和 SHA-256 清单；不联网、不调用 `gh` | 无 |
| `pnpm desktop:verify-provenance -- --execute-gh --candidate-dir <目录> --receipt <候选外路径>/provenance-verification-receipt.json` | 人工显式执行严格 GitHub CLI attestation 验证；最终候选重检通过后以原子方式写候选外收据，可加 `--offline-trusted-root <候选外路径>` | 候选外本地收据 |
| `pnpm desktop:verify-provenance -- --verify-receipt --candidate-dir <目录> --receipt <候选外路径>/provenance-verification-receipt.json` | 不联网重检当前候选并关联既有收据；离线收据还必须传入同一 `--offline-trusted-root` 重新哈希 | 无 |
| `pnpm desktop:verify-platform-acceptance -- --write-plan --candidate-dir <目录> --receipt <候选外路径>/provenance-verification-receipt.json --plan <候选外路径>/platform-acceptance-plan.json` | 重新关联候选和收据后，原子写入平台人工验收计划 | 候选外本地计划 |
| `pnpm desktop:verify-platform-acceptance -- --write-record-template --candidate-dir <目录> --receipt <候选外路径>/provenance-verification-receipt.json --plan <候选外路径>/platform-acceptance-plan.json --record <候选外路径>/platform-acceptance-record.json` | 原子写入全部 `not-run` 的人工记录模板 | 候选外本地模板 |
| `pnpm desktop:verify-platform-acceptance -- --verify-record --candidate-dir <目录> --receipt <候选外路径>/provenance-verification-receipt.json --plan <候选外路径>/platform-acceptance-plan.json --record <候选外路径>/platform-acceptance-record.json --evidence-dir <候选外目录>` | 不联网复核候选、收据、计划、人工记录和 evidence 哈希；始终输出 `releaseReady=false` | 无 |
| `pnpm desktop:verify-cross-platform-acceptance -- --write-plan --bundle-dir <目录>` | 对标准五候选 bundle 重新验证 receipt 和候选清单，确认同一 immutable SHA 后在 bundle 根目录原子写入汇总计划 | bundle 根目录计划 |
| `pnpm desktop:verify-cross-platform-acceptance -- --verify-plan --bundle-dir <目录>` | 不联网复核五个候选、五份 receipt、Phase 16 记录/evidence、六个目标和同一 SHA；始终输出 `releaseReady=false` | 无 |
| `pnpm desktop:verify-release-review -- --write-review --bundle-dir <目录> --review-dir <bundle 外目录>` | 在全部 Phase 17 人工项通过后，重新复核 bundle 并原子写入候选外的发布审查档案；始终输出 `releaseReady=false` | 候选外本地档案 |
| `pnpm desktop:verify-release-review -- --verify-review --bundle-dir <目录> --review-dir <bundle 外目录>` | 不联网重新复核 Phase 17 bundle，并确认审查档案仍绑定当前汇总计划和五份平台记录哈希；不授权发布或部署 | 无 |
| `pnpm desktop:verify-release-payload-manifest -- --write-manifest --bundle-dir <目录> --review-dir <bundle 外审查目录> --manifest-dir <bundle及审查目录外目录>` | 在已复核的 Phase 18 档案基础上，重新校验五候选、11 个 attested subject 并独占写入候选载荷交接清单；始终输出 `releaseReady=false` | 候选外本地清单 |
| `pnpm desktop:verify-release-payload-manifest -- --verify-manifest --bundle-dir <目录> --review-dir <bundle 外审查目录> --manifest-dir <bundle及审查目录外目录>` | 不联网重新关联 Phase 18 档案和每个 attested subject，确认清单仍精确匹配当前候选；不授权发布或部署 | 无 |
| `pnpm desktop:verify-release-publication-plan -- --write-publication-plan --bundle-dir <目录> --review-dir <bundle 外审查目录> --manifest-dir <bundle及审查目录外目录> --publication-plan-dir <上述输入外目录>` | 在已复核 Phase 19 清单上原子写入六个直链安装包与五个 APT sidecar 的发布计划；始终输出 `releaseReady=false` | 候选外本地计划 |
| `pnpm desktop:verify-release-publication-plan -- --verify-publication-plan --bundle-dir <目录> --review-dir <bundle 外审查目录> --manifest-dir <bundle及审查目录外目录> --publication-plan-dir <上述输入外目录>` | 不联网重新关联 Phase 19 清单，确认 direct-download 与 APT sidecar 映射仍精确匹配当前候选；不授权发布或部署 | 无 |
| `pnpm desktop:verify-release-publication-handoff -- --write-handoff --bundle-dir <目录> --review-dir <bundle 外审查目录> --manifest-dir <bundle及审查目录外目录> --publication-plan-dir <上述输入外目录> --candidate-git-dir <candidate Git 根目录> --handoff-dir <全部输入外目录>` | 从指定 immutable candidate commit 读取版本和公开导出 allowlist，复核公开快照并原子写入发布交接文件；始终输出 `releaseReady=false` | 候选外本地交接文件 |
| `pnpm desktop:verify-release-publication-handoff -- --verify-handoff --bundle-dir <目录> --review-dir <bundle 外审查目录> --manifest-dir <bundle及审查目录外目录> --publication-plan-dir <上述输入外目录> --candidate-git-dir <candidate Git 根目录> --handoff-dir <全部输入外目录>` | 不联网重建 candidate commit 的公开源码 tree hash，确认版本、六个直链 asset、五个 APT sidecar 和交接文件仍精确匹配；不授权发布或部署 | 无 |
| `pnpm desktop:verify-github-readiness -- --verify-github --repository <私有候选仓库>` | 只读检查固定 repository ID、Enterprise Cloud organization plan、`main` 保护、基础/selected Actions policy、三个 signing Environment 和组织 secret scope；任何未验证项都会阻断 | 无 |
| `pnpm audit:desktop:macos-signed-candidate` | 同时检查手动 macOS ARM64/Intel 签名 workflow 的 Environment、secret 作用域、P12 空密码映射、keychain cleanup、Developer ID、公证/签名验证与无发布操作边界 | 无 |
| `pnpm audit:desktop:windows-signed-candidate` | 检查手动 Windows x64 签名 workflow 的 Environment、PFX/密码作用域、CurrentUser 证书 cleanup、SHA-256/RFC 3161、Authenticode 验证与无发布操作边界 | 无 |
| `pnpm audit:desktop:windows-arm64-signed-candidate` | 检查手动 Windows ARM64 签名 workflow 的 Environment、显式 ARM64 Rust target、PFX/密码作用域、CurrentUser 证书 cleanup、SHA-256/RFC 3161、Authenticode 验证与无发布操作边界 | 无 |
| `pnpm audit:desktop:linux-deb-repository-signed-candidate` | 检查手动 Linux x64/ARM64 DEB 仓库候选的 Environment、OpenPGP secret 作用域、输入复验、Release/InRelease、`gpgv`、`signed-by` APT、清理与无发布操作边界 | 无 |
| `pnpm audit:desktop:linux-deb-key-lifecycle` | 检查 Linux 内部客户端 `.gpg`/`.asc` 信任包、公开键隔离、可选双键重叠、30 天到期/轮换约束、撤销响应、checksum 与无公开 endpoint 边界 | 无 |
| `pnpm audit:desktop:workflow` | 检查候选 workflow 的只读权限、固定 action、目标来源与无发布操作边界 | 无 |
| `pnpm audit:github-actions` | 检查全部 workflow 只使用 SHA 固定的 GitHub-owned Action 或本地 Corepack pnpm bootstrap，并检查启动顺序、每 job 临时 Corepack home、项目 env 禁用及 workflow 覆盖 | 无 |
| `pnpm audit:desktop` | capability/CSP/version/双产物隔离审计 | 无 |
| `pnpm release` | 输出 `npm-publication-not-configured` 并非零退出；当前不执行 npm 发布 | 无发布产物；解除阻断/真正发布需明确授权 |

首次运行浏览器测试前执行 `pnpm exec playwright install --with-deps chromium firefox webkit`。CI/本地完整门禁应依次覆盖 frozen strict-peer install、`pnpm ignored-builds`、low-severity 依赖审计、typecheck、零 warning lint、unit、当前浏览器 E2E/golden、Web/PWA build 与审计、当前 release suite、library build、清洁 tarball consumer 和体积预算。最新阶段证据见 [Phase 7 Web P2](./phase-7-web-p2.md) 与 [Web Release Gate](./web-release-gate.md)。

普通 `pnpm test:e2e` 固定为一个全局 worker，并把每个 Playwright 引擎拆为 `editor` 与 `runtime` 两个 project；两组之间会重启 browser worker，避免资源密集的编辑/编解码场景长期累积。测试服务器设置 `SCREENHELLO_E2E=1` 后会关闭 Vite 文件监听，因此报告、截图和 trace 写入不会触发 HMR；普通 `pnpm dev` 仍保留监听。离线断言只阻断外部 URL，回环、`blob:` 与 `data:` 资源保持浏览器原生连接。显式传入更高 `--workers` 只能用于诊断，不能替代默认回归结果。

桌面 PoC 的 Linux 构建除 Tauri 前置外还需要 `libclang-dev`、`libpipewire-0.3-dev` 和 `libgbm-dev`；runtime smoke 要求 PATH 中存在 `cargo`、`tauri-driver`、`WebKitWebDriver`、`xvfb-run` 和 `dbus-run-session`。先执行 `pnpm desktop:build`，再执行 `pnpm audit:desktop:codecs` 和 `pnpm desktop:test:runtime`；它在隔离 XDG 目录中驱动真实 Tauri release binary，验证三个打包 scalar Worker/WASM、有限截图能力响应、非破坏性本地状态标记、未授权截图拒绝、示例编辑器导入、图片剪贴板、快捷键/托盘状态和第二实例退出。成功截图只能在 `SCREENHELLO_DESKTOP_CAPTURE_INTERACTIVE=1` 的受控交互环境记录，普通 smoke 只记录权限边界；安装/升级/卸载仍必须走每平台的人工项目。候选 bundle 必须另外通过 contract、trust、workflow、artifact-provenance 和 GitHub Actions supply-chain 审计；首次远端候选下载后先运行不联网的 provenance 本地预检，再由人工显式运行 GitHub CLI 验证，交接或人工验收前重新验证候选外收据，并按 Phase 16 生成候选绑定的人工验收计划、未执行模板和 evidence 复核记录，按 Phase 17 汇总五个候选、六个目标和同一 immutable SHA，按 Phase 18 在 bundle 外固定当前汇总计划与五份记录哈希，最后由 Phase 19 在另一个外部目录复核 11 个 attested payload 并写入交接清单。首次受保护候选前还必须按 Phase 21 只读确认 private repository ID、Enterprise Cloud plan、分支、基础/selected Actions policy、Environment 与 secret scope。静态结果不提供签名、公证、远端 attestation、更新或安装证据。完整边界见 [跨平台桌面 Phase 21](./desktop-cross-platform-phase-21.md)。

最低版本证据不能从 Playwright 当前 bundled engines 推断。仓库提供手工触发的原生 amd64 workflow，固定 Chrome 111、Edge 111 和 Firefox 128 Selenium 镜像并以返回的 capabilities 为准；ARM64 上模拟 Chrome/Edge amd64 只作诊断。Safari 16.4 必须来自 Apple 设备原生会话或记录了系统/设备的可信云会话，Playwright WebKit 不可代替。可信云通过 `SCREENHELLO_BROWSER_VERSION`、`SCREENHELLO_BROWSER_PLATFORM` 和只含 provider namespaced options 的 `SCREENHELLO_WEBDRIVER_CAPABILITIES_JSON` 配置；不得把凭据写进仓库或证据。四份证据必须对应同一 40 位候选 commit，最后运行 `pnpm audit:release:browsers`。

导出预算基准必须使用独立测试端口并显式开启：`SCREENHELLO_E2E_PORT=4183 SCREENHELLO_EXPORT_BENCHMARK=1 pnpm exec playwright test --grep "characterizes the reviewed single-export pixel budget" --workers=1`。普通 `pnpm test:e2e` 不会反复分配 16 MP Canvas。

AVIF 的 production Worker/WASM/CSP/取消复核使用 `tests/spikes/avif/`。先按该目录的 Vite 配置构建并在独立端口 preview，再运行 `verify-production.mjs`；4 MP 重复内存/时间基准由 `benchmark-production.mjs` 显式执行，不并入每次普通 E2E。AVIF 源码升级后必须同时复跑这两类验证和 `pnpm test:consumer`，不能只看开发服务器。

macOS 签名候选需要先由管理员在私有仓库配置 macos-signing Environment 的分支限制和 reviewer，再分别从 main 发起 ARM64 或 Intel 的手动确认；两个 workflow 都固定该次候选 SHA，不读取任意 ref 输入。组织 Apple secrets 只应向这个私有仓库开放。

Windows x64/ARM64 签名候选同样需要先由管理员配置 `windows-signing` Environment 的分支限制和 reviewer，再从 main 明确确认。两条链路只读取 `WINDOWS_CERTIFICATE` 与非空的 `WINDOWS_CERTIFICATE_PASSWORD`，临时导入 CurrentUser 证书库并在完成或失败时清理；ARM64 还固定 `windows-11-arm`、`aarch64-pc-windows-msvc` 和原生 SignTool 优先策略。不要从 macOS P12 的空密码设置推断 Windows PFX 密码。两类远端 workflow 均尚未运行，边界见[跨平台桌面 Phase 10](./desktop-cross-platform-phase-10.md)。

Linux DEB 仓库候选需要由管理员配置 `linux-repository-signing` Environment 的分支限制和 reviewer，并仅在该 Environment 中提供 OpenPGP private-key base64、非空单行口令和主 fingerprint。签名 job 先在原生 x64/ARM64 runner 构建、检查并复验无签名 DEB 输入，再以 `apt-ftparchive` 生成索引，用 `gpgv` 与隔离的 `signed-by` APT root 验证签名仓库。当前还会从独立 trust home 生成内部 `.gpg`/`.asc` 客户端信任包；可选下一把公开键必须与 fingerprint 同时提供，所有 expiring key 至少剩余 30 天。它仍没有公开 endpoint、source list、客户端 rollout、轮换或撤销演练。

五条签名候选只有在签名临时材料清理后才请求 GitHub SLSA provenance；管理员还必须确认私有仓库实际使用 GitHub Enterprise Cloud，且 Environment 审批/分支规则与组织 selected Actions policy 均允许固定的 `actions/attest` 和本地 Corepack bootstrap。不在本地填入或输出 secret 值。首次远端运行后，先对下载 candidate 运行 `desktop:verify-provenance -- --verify-local`，再由人工显式执行严格 GitHub CLI attestation 验证；交接前用 `--verify-receipt` 重新关联候选和候选外收据，用 `desktop:verify-platform-acceptance` 绑定真实平台人工项目和 evidence，以 `desktop:verify-cross-platform-acceptance` 确认五份记录属于同一个 immutable SHA，用 `desktop:verify-release-review` 在 bundle 外固定并复核当前记录哈希，最后以 `desktop:verify-release-payload-manifest` 在另一外部目录重新校验所有 attested subject 并固定交接清单。签名前由具备只读权限的管理员运行 `desktop:verify-github-readiness`；它检查 metadata，不读取 secret 值，且任何 `failed` 或 `unverified` 结果都会阻断。边界见[跨平台桌面 Phase 21](./desktop-cross-platform-phase-21.md)。

### Phase 22 Corepack 边界

`pnpm audit:github-actions` 是候选 workflow 的必经审计。它要求本地 Corepack action 在 Node setup 后为每个 job 创建随机 `RUNNER_TEMP` home，禁用 checkout 内 `.corepack.env`、清除 inherited integrity-key override，并把相同 home 传递给后续步骤；workflow 不得在 action 外设置 Corepack 安全环境。该约束只保护 package-manager bootstrap，不会读取 signing secret、触发 workflow 或替代 Phase 21 的 GitHub 只读预检。详见[跨平台桌面 Phase 22](./desktop-cross-platform-phase-22.md)。

### Phase 23 公开载荷边界

`desktop:verify-release-publication-plan` 只在完整 Phase 19 载荷清单存在时工作。它把 macOS、Windows 与两个 DEB 映射为六个稳定的 direct-download asset name；`Release`、`InRelease`、`Release.gpg` 与两份 keyring 保持 Linux APT sidecar，明确禁止被当作 GitHub Release asset。计划只记载相对路径和 SHA-256，输出必须在 bundle、release-review 和 payload-manifest 三类输入目录之外。它不创建 tag、Release、endpoint、publisher identity 或 Environment，详见[跨平台桌面 Phase 23](./desktop-cross-platform-phase-23.md)。

### Phase 24 公开源码交接边界

`desktop:verify-release-publication-handoff` 只消费已验证的 Phase 23 计划，并从指定 candidate Git 提交而非工作树读取 `package.json` 与公开导出 allowlist。它把版本、`v` 前缀 beta tag、六个 direct-download asset、五个 APT sidecar 和公开导出 `treeSha256` 固定在候选外不可覆盖文件中；生成快照时还会重用公开仓审计，拒绝预置生成标记、私有路径、凭据模式和无效引用。公开 `main` 必须在将来的受保护 workflow 中重建并匹配该快照。它不创建跨仓库凭据、Environment、tag、Release、asset 或 endpoint，详见[跨平台桌面 Phase 24](./desktop-cross-platform-phase-24.md)。

## 路径别名

维护 UI 文案时使用实例 `useI18n()` / `root.i18n.t()`，动态数量用整句参数，避免拆词丢空格。新增键同步 `src/i18n/catalog.js` 英文词典及 `src/i18n/` 下繁中、德语、韩语、西语、葡语 JSON；语言注册表位于 `locales.js`，Ant Design 映射位于 `antdLocales.js`。执行 `pnpm audit:i18n` 检查静态键、各词典覆盖和占位符，并验证七语移动布局、当前默认中文 golden、离线冷启动和多语言双实例 consumer；完整键覆盖不能证明所有动态文案或母语翻译质量合格。不得调用共享 MobX `configure()` 改变宿主策略；异步 await 后的状态修改继续使用 action/runInAction。

需要随语言切换更新的持久 UI 状态应保存消息键/参数，在渲染时翻译，不保存已翻译字符串。`PwaController` 的安装/离线/更新错误遵循此约定；修改后运行 `pnpm test:pwa` 检查提示更新及安装事件保留。顶栏语言菜单还需运行 `tests/e2e/i18n.spec.js` 的纯键盘、读屏选中态和多实例用例，并通过 consumer 验证宽视口内的窄宿主容器。

当前桌面 runtime 默认只验证截图权限拒绝，成功截图标为 manual；完整链路须设置 `SCREENHELLO_DESKTOP_CAPTURE_INTERACTIVE=1` 并真实批准 OS 确认。测试 driver 必须经专用构建入口生成到独立 target，并显式启用运行门。细节与尚未通过的新候选矩阵见 [桌面 PoC](./phase-9-desktop-poc.md)。

`vite.config.js` 与 `jsconfig.json` 共同定义：

| 别名 | 目录/文件 |
| --- | --- |
| `@components` | `src/components` |
| `@assets` | `src/assets` |
| `@style` | `src/style`（仅 Vite 配置） |
| `@stores` | `src/stores` |
| `@utils` | `src/utils` |
| `@hooks` | `src/hooks` |

新增别名时要同步更新 Vite 和 `jsconfig.json`，否则编辑器跳转与实际构建会不一致。

## 修改常见功能

### 品牌图标

`src/assets/logo.svg` 是用户提供的品牌原稿，保留原始路径、渐变和 1024×1024 viewport。`node scripts/generate-brand-assets.mjs` 使用已安装的 Tauri CLI 2.11.4 在隔离临时目录生成，再更新 23 个既有 logo、桌面 HTML favicon、兼容 PWA 与桌面 PNG/ICO/ICNS；不下载依赖，不写入移动项目或执行构建/发布。`node scripts/generate-brand-assets.mjs --check` 重新生成并逐字节检查，但不替换仓库文件。依赖来自正常的 frozen install，不要求额外图片编辑器。

Web favicon 单独采用用户提供的 RealFaviconGenerator 包：`public/favicon.svg`、`favicon-96x96.png`、`favicon.ico`、`apple-touch-icon.png` 及两张 `web-app-manifest-*.png`。来源和完整 SHA-256 固定在 [Web 图标清单](../config/webIconAssets.json)，生成脚本在任何写入前校验六个文件及品牌原稿 hash，不覆盖这些导入资产。以后更换原稿或重新生成图标时，应一起 review 并更新清单，不能只跳过检查。

Web 标签集中在 `index.html`，Apple 主屏幕名称为 ScreenHello。仍只由 PWA 插件生成 `manifest.webmanifest`，不安装生成器的 `site.webmanifest`，保留现有 id/start_url/scope、主题颜色及更新保护。生成器把两张透明 PNG 标成 maskable，但实际文件不具备不透明底色，所以接入为 `any`；继续使用已验证不透明底色与安全圆的 `pwa-maskable-*`。`pwa-192x192.png`/`pwa-512x512.png` 保留为兼容资源（后者也用于 OG 图），不再作为 manifest 默认图标。原 logo、桌面图标和组件库入口不变。

小图标直接使用原稿 viewport：该图形已经居中在 0..1024 且自带可见留白，不再套用裁切 viewport。maskable 保留原 viewport 和不透明 `#111318` 底，但把图形绕 viewport 中心缩放 `0.4 / 0.579`，因为原图形在包围盒角上的半径达 0.579，不缩放会越出半径 40% 的安全圆。若未来更换形状，须重新核对这些几何值、更新原稿 hash 与测试，不能对任意 SVG 套用裁切或缩放。UI 继续引用原有 PNG 路径，构建哈希随内容变化；顶栏、欢迎页和画布浏览器框同源，中央上传插图仍为独立资源。

`config/devFaviconPlugin.mjs` 为 Web 的六个公共图标计算 SHA-256 版本参数。开发 HTML 每次请求重新读文件；正式构建 HTML、manifest 与 Workbox 预缓存共用同一份版本，精确缓存带 `?v=` 的 URL，不忽略任意查询参数。标签使用 `%BASE_URL%` 支持子路径。公共文件本身保留原名，部署层应允许这些固定路径重新验证，不对固定路径设 immutable，也不能从缓存键中丢弃 `v`；替换图标后重新构建。已安装的 PWA 仍需接受应用更新，系统主屏幕图标刷新由平台决定，不要求清空项目/草稿存储。

桌面 HTML 沿用原有仅 `serve` 的 favicon 版本插件，正式桌面构建继续使用无查询参数的哈希 PNG。Web 图标插件不在 library/desktop 模式启用。接口依据：[Vite HTML 转换](https://vite.dev/guide/api-plugin.html#transformindexhtml)、[PWA 静态资源](https://vite-pwa-org.netlify.app/guide/static-assets.html)。根路径运行 `pnpm test:pwa`；子路径构建后，可用相同 `SCREENHELLO_BASE_PATH`、`SCREENHELLO_PWA_OUT_DIR` 运行 `pnpm exec playwright test --config playwright.pwa.config.js tests/pwa/favicon.spec.js`，仅该专项支持子路径，旧全量用例仍按根路径运行。

2026-09-12 品牌替换：用户提供新的 RealFaviconGenerator 包（`1fa47eb9-…`，蓝色行星图形，替换原青蓝渐变标识）。六个 Web 图标按原样接入并重新固定 hash 与来源；`src/assets/logo.svg` 改为该包内嵌图形，去掉生成器固定的 356px `width`/`height` 以便按 viewBox 缩放。23 个派生产物由 `generate-brand-assets.mjs` 重新生成，PWA 图标用途划分、`#111318` 主题底与单一 `manifest.webmanifest` 均未改动。`src/assets/favicon.png`（32px）与其余派生产物只含图形本身，不含生成器图标的深色圆角底与留白，这是画布浏览器框插图的既有透明约定，不要为对齐生成器预览而给它加底。

2026-09-07 本地接入及 review：lint/typecheck、46 files / 457 unit、原品牌生成器 23 个产物及 6 个导入图标校验通过。Web/library/desktop 前端构建、PWA/library/desktop 边界审计通过；根路径核心预缓存 54 项 / 2,487,051 bytes，保持 3 MiB 门槛，原有大 chunk 提示未隐藏。当前 Chromium/Firefox/WebKit 的深浅主题图标专项 6/6，根路径完整 PWA 14/14，`/tools/screenhello/` 构建审计及图标冷离线专项 1/1。实际查看 SVG/PNG/ICO 的 16/32 CSS px 深浅底色渲染。首轮根路径 PWA 的旧单 favicon 定位已修正；子路径首次命令参数未正确筛选，误跑根路径专用用例造成 2 个失败，修正命令后仅复验适用专项，不宣称子路径完整产品矩阵已通过。未执行全产品 E2E、consumer、真实 Safari/系统安装图标刷新或原生桌面构建；未提交、推送或部署。

Tauri 输出的 ICNS 条目顺序不固定。生成后使用 `scripts/canonicalize-icns.mjs` 保留全部图像 payload，仅固定条目顺序；损坏、重复或未知类型直接拒绝。这样 `--check` 仍比较完整文件字节，不通过忽略 ICNS 来掩盖差异。

修改后执行 `pnpm test:unit`、生成器 `--check`、Web/library/desktop 前端构建、`pnpm audit:pwa`、`pnpm audit:desktop` 及相关浏览器/consumer/PWA 验证，目视检查深浅主题与 16/32px。桌面资源检查不是原生安装、签名或商店验收；已安装应用可能需要更新/重新安装后才刷新系统图标。格式依据：[Tauri 图标文档](https://v2.tauri.app/develop/icons/)、[PWA 图标与安全区域](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons)。

### 公开文档站（Fumadocs）

根 `pnpm dev` 会在启动时构建并提供文档快照，编辑器帮助链接可以直接使用。修改文档后可重启根开发服务，或使用 `pnpm --dir docs dev` 启动独立 Astro 开发服务；独立服务中修改 JSON 后执行 `pnpm --dir docs build:content` 更新 MDX。

公开站位于 `docs/`（独立 Astro 应用），URL 为 `/docs/{locale}/{topic}/`。内容单一事实源仍是 `site/content/*.json`：`scripts/build-docs-content.mjs` 生成 `docs/content/docs/{locale}/{topic}.mdx` 与 `meta.json`；改动 JSON 后运行 `pnpm build:docs`，该命令先重新生成 MDX 再构建；`pnpm --dir docs build:content` 可单独生成内容。`pnpm check:docs-content` 只检查一致性，不写入文件；CI 在构建前执行该检查。不要手改生成的 MDX。

文档界面翻译来自各语言 JSON 的 `docsUi`。搜索索引从当前语言的生成正文构建并随页面传入 React island，查询完全在浏览器中执行，不依赖 `/api/search` 或外部服务。本页目录使用 Astro `render(entry)` 返回的 headings。入门截图放在 `docs/public/guide/`，使用当前应用的内置示例实拍；中文页面使用中文截图，其他语言使用英文截图并在图注说明。新增截图应核对实际控件与导出流程。

**内容结构：section 的可选第三元素。**`site/content/*.json` 仍是唯一事实源，每个 section 固定为 `[标题, 正文]`，可**追加**第三元素（子块数组），转换器据此生成 H3、GFM 表格与引用块：

```
sections[i][2] = [
  { h, p },              // -> ### 子标题 + 段落
  { table: { head, rows } },  // -> GFM 表格
  { note },              // -> > 引用块
]
```

旧生成器只解构前两个元素，因此不加第三元素的数据照常工作。新增子块时注意：**技术事实（快捷键、像素上限、格式、倍率）在所有语种必须一致**，只翻译标签与措辞；`tests/unit/docsSite.test.js` 会比对 7 语种上限表的数字序列，防止某个语言写出不同的数值。本次扩充依据均为代码内既有事实（`src/hooks/useKeyboardShortcuts.js`、`src/stores/commandService.js`、`src/utils/exportSettings.js`、`src/utils/projectDocument.js`），不虚构产品能力。

**信息架构与 URL 顺序解耦。** `DOCS_READING_ORDER`（`docs/src/lib/content.mjs`）定义侧栏主题顺序：指南 → 美化 → 外框 → 压缩 → 隐私；首页是落地页。侧栏显示主题名称，不带操作步骤编号；页尾只保留 Fumadocs 上一篇／下一篇。URL 顺序 `DOCS_TOPICS` 保持稳定，调整主题顺序不影响 slug 或 301。

**不要启用 fumadocs 的 i18n。** 它的内容存储以 `{locale}.{slug}` 为键，`parser:'dir'` 无法从 `{locale}/{topic}.mdx` 目录布局剥离 locale；实测会得到 `/en/docs/en` 这类 URL、把所有页面判成 `en`，且在提供自定义 `url` 时仍忽略显式 `slugs`。因此 `docs/src/lib/source.ts` 显式接管路由（`url: slugs => /docs/...`）并按整段匹配 locale 生成侧边栏树；`DocsShell.tsx` 显式处理语言切换并保留当前主题。改路由时同时复核这两处。

**CSP 不能退回 `unsafe-inline`。** Fumadocs 每页输出 3 个内联 `<script>`、2 个内联 `<style>` 与若干 `style="…"`。`docs/src/lib/csp.mjs` 为每个内联块算 SHA-256 并写进 `_headers`，`assertCovered()` 会在出现未覆盖内联块时让构建失败。升级 `fumadocs-core`/`fumadocs-ui`/`astro` 后必须重跑 `pnpm build:docs` 并确认 `unsafe-inline` 未出现。

`docs/scripts/post-process.mjs` 是 `_headers`、`_redirects`、`sitemap.xml`、`robots.txt`、`llms.txt`、`404.html` 的唯一写出方（应用壳规则来自 `docs/src/lib/headers.mjs`）；`site/site.mjs` 只保留根级 sitemap/robots。旧 URL → 新 URL 的 301 由 `legacyRedirects()` 生成，新增主题时必须同步 `DOCS_TOPICS`，否则会留下死链。

### 导出压缩

当前预算与修复见 [大图压缩下载](./compression-download.md)，C4 保留历史预览压力证据。直接压缩使用 `MAX_COMPRESSED_PIXELS=4_194_304`，完整预览独立使用 `MAX_PREVIEW_PIXELS=1_048_576`；UI/Service/编码器/Worker 须共享契约。预览默认用可显式 close 的 ImageBitmap 和 CPU-backed Canvas（释放时归零），缺能力时保留 HTMLImage/URL 回退；Blob 下载身份不依赖展示元素。小图 WebP Worker 空闲 5 s 回收；超过预览预算的大图压缩任务完成后立即终止，取消/销毁也立即终止。批量 UI/命令/PWA 守卫需读 `batch.isBusy`（含生成与系统交付），不能只读 `isRunning`。

[C0 编码器与预览验证](./export-compression-c0.md) 记录独立实验入口、复现命令、固定依赖转换和新模式预算。它没有接入正式导出面板；不要把实验 client 当成已有公共 API，或用当前三引擎结果代替最低浏览器/桌面验收。

[C1 内核](./export-compression-c1.md) 已接入实例级导出、设置持久化通路、绘制就绪和平台交付事务，[C2 交互](./export-compression-c2.md) 接入压缩控件与可选预览。新增异步画面效果须通过 `renderTaskTracker` 登记任务及失败/回退，并清理对应 effect/flusher；不能绕过完整画面捕获或由 UI 自行下载未知来源 Blob。Web/library 构建后运行 `node scripts/audit-compression-build.mjs` 复核固定 UPNG 修复、scalar 资产和 PWA 边界。

预览 UI 由 `useExportPreview` 持有会话代际/取消控制器，`ExportPreviewResult` 只拥有一侧展示 URL；释放旧 token 时必须校验身份。`verifyPreview` 在服务队列内完成两侧串行解码，每侧最多 10 秒，解码失败不得进入 ready。语言、缩放和预览底色切换不触发编码；真正下载必须经过命令层的 `downloadPreparedImage` 和原平台保护。相关回归在 `tests/unit/exportPreview.test.js`、`tests/e2e/compression-ui.spec.js` 与 consumer/PWA 中。

[C3](./export-compression-c3.md) 的 `BatchStore` 持有已解析风格与背景 Blob 的只读快照，只有初始化成功才签发；重试必须传原 `styleSnapshot`，不能重新解析 `presetId` 或当前设置。批量 exportImage 必须展开完整 exportSettings，不只传 format/ratio；独立 target 不订阅活动画布 tracker，但仍共享导出队列和取消/销毁。新增字段需同时检查文件导入警告、预设应用和最近项目往返；自动草稿格式不因此扩张。相关回归在 `tests/unit/batchCompression.test.js`、`tests/unit/compressionPersistence.test.js`、`tests/e2e/compression-batch.spec.js`、consumer/PWA。

### 新增画面选项

1. 在 `src/stores/option.js` 添加默认值和 action。
2. 在 `src/components/sideBar/` 增加控制项。
3. 在 `Screenshot.jsx`、`FrameBox.jsx` 或相应图层中增加响应式 effect。
4. 检查设备框、自动尺寸、HDR、放大镜快照和导出的组合行为。

### 新增标注工具

1. 在 `src/components/editor/BottomToolbar.jsx` 的 `toolList`、移动分组和标签映射加入工具；`src/components/header/` 负责应用菜单与顶栏。
2. 在 `View.jsx` 决定是单击还是拖拽创建，并定义初始业务数据。
3. 在 `ShapeLine.jsx` 创建对应 Leafer 节点，并同步几何、颜色、线宽和 editable 状态。
4. 验证选择、移动、缩放、旋转、删除、zIndex 和导出。

### 新增背景

内置背景必须优先使用 `src/utils/backgroundConfig.js` 的代码原生纯色或 Leafer 渐变，并使用唯一稳定键。不要提交来源不明的 stock 图片、预览缩略图或远程 URL；确有图片素材需求时，必须先在根目录 `ASSET_PROVENANCE.md` 记录来源、作者、精确再分发许可和署名义务，再运行 E2E 网络断言、许可审查与 `pnpm size:report`。用户自己上传的本地背景不进入仓库。

图片背景的目录、加载事务、历史资源回收、存档与离线边界见[内置图片背景](./preset-backgrounds.md)。新图片不得复用旧 `gh_img_*` 标识；增加类型时必须同步 `normalizeOption`、归档缺失资源检查和背景资源的历史引用。

### 新增尺寸预设

在 `src/utils/sizeConfig.js` 添加类别或条目，提供实际 `width`/`height` 与展示比例 `w`/`h`。尺寸值直接成为最终导出逻辑像素。

### 修改项目或预设格式

1. 先确认 `ProjectDocument v2`、`StylePreset v1` 和 workspace container v1 是否已能表达需求，不为单一字段直接升级整个容器；V1 项目只经 `validateDocument()` 迁移。
2. 同步检查 `projectDocument.js`、`stylePreset.js`、`workspaceArchive.js`、DraftStore 迁移和旧记录兼容。
3. 新 ZIP 入口必须加入固定 allowlist 和大小预算；归档中的 MIME/尺寸字段不能替代浏览器真实图片解码。
4. 增加损坏、版本不支持、校验和不符、缺资源和打开失败不污染当前画布的测试。

## 手工回归清单

最低建议覆盖：

1. 文件、拖放、粘贴和示例图片能进入编辑器；若改动媒体能力，再测屏幕捕获。
2. Auto、自定义及至少一个预设尺寸能正确调整画布。
3. 背景、圆角、阴影、留白、翻转、位置和缩放能实时更新。
4. 普通边框、浏览器标题栏和至少一个设备框显示正确。
5. 每种受影响标注能创建、选中、变形和删除；放大镜能随底图样式更新。
6. 水印前景/仅背景与 HDR 开关正常。
7. PNG/JPG/WebP/AVIF 以及 1x/2x/3x 至少各抽查一组，导出尺寸正确；AVIF 超过 4,194,304 像素时应在分配 Canvas 前给出明确回退提示。
8. 复制和所有相关快捷键在 HTTPS 或 localhost 下工作。
9. 亮/暗主题和窄屏布局无明显回归。
10. 删除图片后回到初始页，LeaferJS 画布与标注已清理。
11. 保存/另存为项目、重新打开下载文件、刷新后打开最近项目，并确认导出设置和上传背景恢复。
12. 风格预设的保存、应用、复制、重命名、删除和导入/导出正常；损坏文件不会改变画布。
13. File System Access 可用时测 picker/handle 路径，不可用时测 input/download 回退；检查存储不可用与配额不足提示。
14. 本地建议只在添加图片后计算，三项建议均需用户点击才应用，且过程不发出远程请求。
15. 批量处理至少检查当前风格与一个本地预设、横竖图、同名/损坏项、取消/重试和 ZIP 解压；处理前后活动项目、历史、dirty、草稿、Canvas 与 object URL 保持不变。

## 已知技术债与风险


- 自动测试目前覆盖多图历史/ProjectDocument v1→v2、workspace 容器与安全校验、共享资源、项目/预设跨会话恢复、runtime 与资源生命周期、多图底图快照、屏幕流释放、三引擎编辑链路、Chromium golden 和双实例 library consumer；仍不是完整功能回归套件。
- 精确 Safari 16.4 仍未重放；当前发布门采用用户确认的 GitHub `macos-14` 原生 Safari hosted-current 证据。Playwright WebKit 不能替代 Safari。
- 主题和底部工具栏折叠状态是浏览器级偏好；当前挂载实例互不覆盖，但未显式传 `isDark` 的新实例会读取同一 localStorage 主题键。
- 当前 Web 主 chunk 和 Emoji chunk 仍超过 Vite 默认 500 kB 提示线，但已通过 Phase 3 明确预算；后续只在有测量收益时继续拆分。
- library 仍是浏览器专用 ESM，需要宿主 bundler 处理公开 CSS 和相对资源 import；不支持 SSR 直接执行。
- AVIF 依赖深度锁定 `@jsquash/avif@2.1.1` 的 scalar codec 入口，其内嵌 libavif 1.0.1 落后于当前上游；升级依赖时必须重新验证输出、Worker/WASM 资产、CSP、内存和第三方 notice。
- 颜色面板已通过 AntD 的公开 `panelRender` 替换为 ScreenHello 自有原生控件，并覆盖打开态 axe、键盘焦点、Escape 返回与 legacy alpha 迁移；Safari/VoiceOver 仍随最低浏览器证据人工复核。
- 批量失败项重试会生成仅含该次重试成功项的新 ZIP；如需保留首轮已成功文件，应先下载首轮 ZIP。

## 文档维护

功能、公共属性、命令、依赖策略或目录职责变化时，同步更新 `DOCS/`。文档应描述已合入的事实；规划项要明确标为未实现。
# SEO / GEO 内容维护

Web 构建同时生成七语静态产品与帮助页；`pnpm audit:seo` 校验正文、metadata、链接、分享图和预算。`pnpm build:preview` 生成 noindex 预览包；正式部署、站长平台、子路径与 PWA 规则见 [SEO / GEO 运维指南](./seo-geo.md)。编辑器、library 和桌面入口保持分离，不将内容页当作 SSR 编辑器。

### Review 回归：部署配置与实例清理

每次 Web 构建（包括 `pnpm build:preview` 和直接 `vite build`）都会重新运行文档构建，继承当前 `SCREENHELLO_BASE_PATH`、`SCREENHELLO_SITE_ORIGIN` 和 `SCREENHELLO_SITE_INDEXABLE`；library/desktop 不构建文档。Astro 的 base/site、客户端导航、favicon、canonical、hreflang、sitemap、响应头和 301 使用同一部署配置。`dist/` 的文件目录仍相对部署根，部署到子路径时不额外复制一层 base 目录。

隐私监控在 runtime 激活后订阅，构造器不会修改全局网络 API；最后一个实例退订后还原补丁，重复退订不影响其它实例。`fetch(Request)` 的正文不被消费或克隆：流式正文或浏览器未暴露 `Request.body` 时显示长度未知，显式 `init.body` 则按可测量类型计数。该统计口径仍只覆盖已有监控通道，不能当作完整网络抓包。

撤销提示工具的时长参数仍以毫秒表示，在 Ant Design message 边界转换为秒；默认 8 秒。回归覆盖实际提示消失、Strict Mode 与双实例退订、Request 正文完整性，以及库导入缺素材设备项目后的导出阻断和再次保存。

本轮本地验证（2026-09-12，Node 24.18.0）：lint、typecheck、65 文件 / 928 项 unit 通过；Chromium/Firefox/WebKit 隐私与撤销计时专项 18/18；library consumer 开发和生产各 18/18，包含缺素材项目往返、导出阻断及 640px 宿主。Web/library 构建、根路径生产和 `/tools/editor/` 自定义 origin 的 noindex 预览 SEO 审计、两种路径的真实浏览器文档导航、PWA/库边界和文档内容一致性检查通过。初次回归发现 Firefox 未暴露 Request.body、模拟时钟差异及窄宿主溢出；修正后按上述范围复跑通过。仍有已有的大 chunk 构建提示；未执行全产品 E2E、最低版本浏览器或原生桌面验收，未部署。

### 第二轮 review 修复

- `pnpm-workspace.yaml` 显式包含 `docs`，根目录的冻结安装覆盖编辑器和文档站；`tests/consumer` 保留独立 workspace，用真实 tarball 验证。锁文件已包含文档依赖，本轮没有升级依赖版本。
- 隐私监控使用浏览器 URL 解析规则，识别前导空白、反斜杠形式和回环 WebSocket 地址。网络补丁按挂载代际管理：实例销毁后，宿主保留的旧包装只转发请求，不继续计数；清理仅还原自身仍拥有的属性，不覆盖宿主后续包装，并保留原函数、属性描述符与 WebSocket 子类语义。宿主冻结 API 时跳过该补丁，不阻断编辑器挂载；这种情况下无法监控该 API，计数仍不等价于完整网络抓包。
- 草稿和最近项目的撤销读取失败会报告失败，不再把读取异常当作记录不存在。撤销恢复在异步步骤间检查 workspace 操作代际，销毁或 teardown 后不再发起后续写入；已进入存储事务的写入不能靠这层检查撤回。

第二轮本地验证（2026-09-12，Node 24.18.0 / pnpm 10.12.1）：根 workspace 和隔离副本均通过 frozen strict-peer 安装，隔离副本使用离线依赖缓存并验证 Astro 7.3.2 可执行；lint、typecheck、65 文件 / 936 项 unit、三引擎隐私专项 24/24、项目/预设及删除撤销专项 6/6、library consumer 开发/生产各 18/18、Web/library 构建与 SEO/PWA/library 边界审计通过。最初 `/tmp` 隔离安装遇到 ENOSPC，清理本轮副本并迁到普通磁盘后重跑；另有 HTTPS 预览单测一次 5 秒超时，未放宽超时，随后全量单测通过。保留已有大 chunk 提示。未进行全产品 E2E、最低版本浏览器、原生桌面或部署验证。

### 文档平台可用性优化验证（2026-09-13）

已修复静态搜索、七语种 AVIF 说明、编辑器入口、入门操作与截图、重复页尾导航、框架 UI 本地化、标题层级与本页目录，以及 JSON → MDX → Astro 构建链。根开发服务启动时提供 Astro 文档快照，解决帮助链接在 `pnpm dev` 下返回 404 的问题；该服务只处理文档资源路径，并测试 GET、HEAD、资源类型及路径越界拒绝。

本地验证：lint、公共边界 typecheck、文档 TypeScript 检查、生成内容一致性、67 文件 / 946 项 unit 通过；根路径生产文档与 SEO 26/26、`/tools/editor/` 子路径 13/13、Chromium/Firefox/WebKit 编辑器与文档往返 6/6、library consumer 开发/生产各 18/18 通过。Web/library 构建和根路径 SEO/PWA 审计通过；深浅主题和手机/桌面截图已检查。生产 CSP 下的静态搜索已验证，查询不访问 `/api/search`，页面加载后断网仍可搜索。子路径验证使用独立 noindex 构建，不覆盖根部署产物。

最初回归暴露旧版页面结构断言和开发环境文档 404，均修正后复跑；新增开发资源服务的越界路径用例也在修正后通过。保留已有大 chunk 提示。未执行完整全产品 E2E、最低历史浏览器、真实 Safari、原生桌面或线上部署验收；文档类型命令不覆盖 Astro 模板静态诊断，模板另经构建与浏览器测试验证。
