# 质量基线：当前摘要与历史快照

> Phase 1 采集日期：2026-09-02；首屏 golden 于 Phase 8.5.3（2026-09-04）复核更新，移动响应式基线于 Phase 8.5.5（2026-09-04）完成终审。各节的版本、数字与结果仅对应各自采集时点，不代表任意后续 checkout。

## 当前维护摘要（2026-09-15）

大图压缩下载预算隔离的当前本地状态见 [修复与验证记录](./compression-download.md)。以下 C4 等测试数字对应各自历史候选，不能当作本轮修复的验收结果。

### 桌面 Phase 24 本地工作树（2026-09-15）

- schema v24 新增候选外、不可覆盖的公开发布交接文件。它只从同一 immutable candidate commit 的 Git blob 读取 `package.json` 版本与公开导出 allowlist，并将派生的 beta tag、Phase 23 的六个 direct-download asset、五个 APT sidecar、公开文件的模式/字节数/SHA-256 及 `treeSha256` 固定在一起；所有路径仍为 `releaseReady=false`。
- Review 修复了五个会削弱交接结论的缺口：公开快照不再受工作树或 Git replace/environment override 影响；候选提交不得预置生成的 `PUBLIC_REPOSITORY.json`；快照生成时会临时物化并运行公开仓审计；路径排序改为稳定的字节序；版本校验现遵循 SemVer 2.0.0，拒绝带前导零的纯数字 prerelease identifier。公开清单现自包含，并将交接脚本和其安全依赖纳入 allowlist；审计器本身的规则改为不与自身内容误匹配，专用负向测试不进入公开导出。
- 定向 Git fixture 覆盖版本/tag 派生、公开快照、six-versus-five 载荷边界、候选根目录内输出、重复写入和交接篡改拒绝。公开工作树预览通过，共 793 个允许文件，标记为 `local-worktree-preview` 且 `releaseReady=false`。
- 本轮本地验证：`actionlint`、lint、typecheck、90 个测试文件 / 1,328 项 unit、42 页文档站与 Web production build、文档内容检查、SEO（42 页）、PWA（54 个 precache 条目 / 2,673,156 B），以及 desktop contract、trust、workflow、artifact provenance 与 GitHub Actions 静态审计均通过。Vite 仍报告既存的大于 500 kB chunk 提示。
- 未读取 secret 值、进入 Environment、触发 GitHub workflow、创建 tag/Release、上传 asset、部署 APT endpoint、签名、公证、时间戳或 attestation。受保护公开 publisher、公开 `main` 的快照匹配、跨仓库身份、APT endpoint、updater 信任根和用户明确发布授权仍是阻断项；完整边界见[跨平台桌面 Phase 24](./desktop-cross-platform-phase-24.md)。

### 桌面 Phase 23 本地工作树（2026-09-15）

- schema v23 在 Phase 19 的 11 个 attested subject 清单上新增候选外 publication plan。它固定 six-versus-five 的载荷角色：两个 macOS DMG、两个 Windows installer 和两个 DEB 可以成为 direct-download asset；Linux `Release`、`InRelease`、`Release.gpg` 与 `.gpg`/`.asc` keyring 只能进入保留 `dists/`/`pool/` 布局的独立 HTTPS APT endpoint，不能作为 GitHub Release asset。
- plan 使用公开源码目标 `web-casa/ScreenHello` 的只读确认 numeric repository ID `1353846676`，但 `protectedPromotionWorkflow`、`protectedEnvironment` 与 `publisherIdentity` 都明确保持 `not-configured`。它从 candidate commit 的 `package.json` 延后计算 tag，不从当前 checkout 推断版本，也不把本地计划写成发布授权。
- `desktop:verify-release-publication-plan` 在写入与读取时重新复核 Phase 19 清单，拒绝输入目录内输出、符号链接、重复写入、缺失/重叠 subject 和篡改映射。当前仍没有 GitHub-hosted 签名候选、远端 attestation、平台人工验收、tag、Release、APT endpoint 或公开下载；`releaseReady=false`。
- Review 修复了 Phase 19→23 链路的目录传递缺口：payload manifest 校验现在返回已规范化的 bundle、review 和 manifest 目录，publication plan 在使用前重新核对三者与清单文件的位置。真实文件系统 fixture 覆盖 six-versus-five 映射、重复写入、输入目录嵌套、符号链接与篡改计划的拒绝。
- 本轮本地验证：`actionlint`、lint、typecheck、90 个测试文件 / 1,317 项 unit、42 页文档站与 Web production build、文档内容检查、SEO（42 页）、PWA（54 个 precache 条目 / 2,673,156 B），以及 desktop contract、trust、workflow、artifact provenance、codec 与 GitHub Actions 静态审计均通过。

### 桌面 Phase 22 本地工作树（2026-09-15）

- 本阶段不改变 schema v22 或任何远端状态。每个 Linux/macOS job 现在使用 `mktemp`、每个 Windows job 使用随机 GUID 创建独立 `RUNNER_TEMP` Corepack root；`bin` 写入 `GITHUB_PATH`，`home` 作为 `COREPACK_HOME` 写入 `GITHUB_ENV`。`.corepack.env`、last-known-good 查询和 inherited integrity-key override 均在安装前关闭或清除。
- `pnpm audit:github-actions` 继续逐字锁定 bootstrap，并拒绝 workflow 对任何 `COREPACK_*` 环境变量的覆盖。21 个定向 Vitest 检查覆盖目录共享、项目 env、latest lookup、完整性 keys、未知 Corepack 开关、后续步骤环境传递和 Windows bootstrap；Node 24 / Corepack 0.35 的 Linux 隔离实测也验证了带无效 `.corepack.env` 时仍得到 hash 固定的 pnpm 10.12.1。
- 同轮 review 修复了三个运行时边界：短通知由实例级原生计时器管理，并能在 React StrictMode 的 cleanup/setup 后重新激活；独立站语言在绘制前同步写入 `lang` 与本地偏好，避免切换后立即重载丢失选择；E2E 保持一个全局 worker，但每个引擎的 editor/runtime project 会重启 browser worker，且测试 Vite server 关闭文件监听、离线路由只阻断外部请求。
- 最终本地验证：`actionlint`、lint、typecheck、90 个测试文件 / 1,311 项 unit、Playwright Chromium/Firefox/WebKit 全量 E2E 396 passed / 24 expected skipped、Web/library/desktop web 构建、library consumer development/preview 各 18/18、`cargo check` 与 Rust 32/32、文档内容检查、SEO、PWA（54 项 / 2,673,156 B）、i18n、压缩、library PWA boundary、体积、desktop codec 以及 GitHub Actions/desktop/contract/trust/workflow/provenance/五条候选静态审计均通过。候选载荷清单的真实文件系统复核用例显式保留 10 秒上限；它构造五个候选、11 个 subject，并执行写入和读取两轮哈希复核。
- 这个结论不替代 macOS/Windows GitHub-hosted runner 的真实运行，也不改变 Enterprise Cloud、仓库 API 访问、Environment、签名、attestation 或人工平台验收的阻断状态。完整边界见[跨平台桌面 Phase 22](./desktop-cross-platform-phase-22.md)。

### 桌面 Phase 21 本地工作树（2026-09-14）

- schema v22 将私有候选的 GitHub Enterprise Cloud entitlement、selected Actions policy 与第一方 Actions supply-chain 纳入 release trust contract。八个 workflow 都用 SHA-pinned `actions/*` 与仓库内 Corepack pnpm bootstrap，避免第三方 package-manager Action；bootstrap 在 Node 24 setup 后启用，并拒绝提前的 pnpm cache。`packageManager` 同时固定 pnpm 10.12.1 和 SHA-512 tarball hash。
- Review 修复了两个会降低预检可信度的缺口：Desktop Gate 的 PR path trigger 最初遗漏新的 local action、审计脚本和测试，现已列入；新增 organization plan 请求最初不在 API allowlist 内，现只允许已声明的 GET route，因此 Free plan 会显示 `failed` 而不是 `unverified`。
- 2026-09-14 的最新实际只读预检确认 organization plan 为 Free；当前 token 对固定候选仓库的 repository API 返回 404，所以候选 identity、默认 `read` 权限、基础/selected Actions policy、`main` 保护、三个 signing Environment 和 secret scope 都为 `unverified`。没有读取 secret 值、触发 workflow、导入证书、签名或发布，结果保持预期 `blocked`。
- 定向验证已通过：本地 Corepack shim/PATH 复现、`actionlint`、11 个相关 Vitest 文件的 238 项检查，以及 GitHub Actions、contract、trust、Gate、provenance、macOS、Windows x64/ARM64 和 Linux DEB 静态审计。审阅中发现并修复 `.yaml` workflow 枚举和本地 bootstrap 内容约束缺口；完整本地验证结果与剩余远端前提见[跨平台桌面 Phase 21](./desktop-cross-platform-phase-21.md)。
- 最终本地验证：`actionlint`、lint、typecheck、642 键 i18n 审计、86 个测试文件 / 1,290 项 unit、文档内容检查与 42 页文档站构建、Web 构建、SEO/GEO 审计和 PWA 审计（54 项 / 2,670,426 B），以及 GitHub Actions、desktop、contract、trust、Gate workflow、provenance、macOS、Windows x64/ARM64、Linux DEB 仓库与 key lifecycle 静态审计均通过。782-file 公开工作树预览通过，且未包含私有候选仓库名称，继续输出 `releaseReady=false`。Web 构建仍有既存的大于 500 kB chunk 提示。

### 桌面 Phase 20 本地工作树（2026-09-14）

- schema v21 将私有候选身份固定为 numeric repository ID；受保护签名 job 和本地 provenance 验证均要求该 ID，公开源码不保存私有候选仓库名称。新增 `desktop:verify-github-readiness` 只读检查分支、Actions policy、Environment 与组织 secret scope，任何 `failed` 或 `unverified` 项都会保持 `releaseReady=false`。
- Review 修复了四个边界：provenance plan 不再从公开源码硬编码候选仓库名，而是从 attestation URL 派生后先以 repository ID 复核；Desktop Release Gate evidence 也记录 numeric repository ID，避免名称漂移放宽候选来源；Environment、organization secret 和 selected-repository inventory 会读取全部分页；候选身份未确认时 secret scope 会明确保持 `unverified`。
- 此处记录的是 Phase 20 的历史预检输出；当前状态以 Phase 21 为准。2026-09-14 的最新预检中，当前 token 对固定候选仓库的 repository API 返回 404，因此不再把身份或默认权限写为已验证。没有读取 secret 值、触发 workflow、导入证书、签名或发布，结果仍是预期的 `blocked`。
- 最终本地验证：`actionlint`、lint、typecheck、642 键 i18n 审计、85 个测试文件 / 1,268 项 unit、文档内容检查与 42 页文档站构建、Web 构建和 PWA 审计（54 项 / 2,670,426 B），以及 contract、trust、Gate workflow、provenance、macOS、Windows x64/ARM64 与 Linux DEB 签名 workflow 静态审计均通过。778-file 公开工作树预览通过且未包含私有候选仓库名称，继续输出 `releaseReady=false`。Web 构建仍有既存的大于 500 kB chunk 提示。

### 桌面 Phase 19 本地工作树（2026-09-14）

- schema v20 在 Phase 18 候选外审查档案之上新增候选载荷交接清单：只有完整的五候选、六平台 Phase 17 复核和已验证审查档案存在时，才会重新关联五个签名候选的 11 个 attested subject、字节数和 SHA-256。
- Review 补足了交接输出的目录边界和 Gate 触发范围：清单目录必须同时位于 bundle 与审查目录之外，拒绝符号链接和既有文件；Desktop Gate 的路径审计会覆盖 Phase 13 至 Phase 19 的关联脚本。候选、receipt、人工记录、审查档案或任一 subject 在写入/复核期间变化都会 fail-closed。
- 最终本地验证：actionlint、lint、typecheck、642 键 i18n 审计、84 个测试文件 / 1,241 项 unit、相对 Markdown 链接检查、文档内容检查与 42 页构建、Web 构建和 PWA 审计（54 项 / 2,670,426 B），以及 desktop、Gate、contract、trust、provenance、macOS、Windows x64/ARM64、Linux DEB 仓库和 key lifecycle 静态审计均通过。775-file 公开工作树预览继续输出 `releaseReady=false`。Web 构建仍有既存的大于 500 kB chunk 提示。
- `pnpm audit:desktop:release` 仍按设计 fail-closed：六个目标均没有实际 evidence，因而没有 candidate SHA 或统一 workflow attempt；这不能由本地审查档案或交接清单绕过。没有创建真实候选 bundle、审查档案或载荷清单，它们不表示真实平台安装、权限、签名、公证、时间戳、GitHub Environment、attestation 或公开发布已经执行。完整边界见[跨平台桌面 Phase 19](./desktop-cross-platform-phase-19.md)。

### 桌面 Phase 18 本地工作树（2026-09-14）

- schema v19 在 Phase 17 的五候选、六平台汇总之后增加候选外本地发布审查档案。它只在全部人工项已经通过时创建，固定汇总计划与五份平台 record 的 SHA-256，并在写入和复核时重新验证候选、receipt、plan、record 和 evidence。
- Review 补足了 Phase 17 汇总计划不绑定动态 record 的边界：Phase 18 在验收完成后才冻结 record 哈希，拒绝 bundle 内输出、已有档案、未完成验收、档案篡改和仍有效但已改写的 record；所有输出继续固定 `releaseReady=false`。
- 最终本地验证：actionlint、lint、typecheck、i18n 审计、84 个测试文件 / 1,230 项 unit、相对 Markdown 链接检查、文档内容检查与 42 页构建、Web 构建和 PWA 审计（54 项 / 2,670,426 B），以及 desktop、Gate、contract、trust、provenance、macOS、Windows x64/ARM64、Linux DEB 仓库和 key lifecycle 静态审计均通过。773-file 公开工作树预览继续输出 `releaseReady=false`。Web 构建仍有既存的大于 500 kB chunk 提示。
- `pnpm audit:desktop:release` 仍按设计 fail-closed：六个目标均没有实际 evidence，因而没有 candidate SHA 或统一 workflow attempt；这不是可由本地档案绕过的失败。没有创建真实候选 bundle 或审查档案，本地审查档案不表示真实平台安装、权限、签名、公证、时间戳、GitHub Environment、attestation 或公开发布已经执行。完整边界见[跨平台桌面 Phase 18](./desktop-cross-platform-phase-18.md)。

### 桌面 Phase 17 本地工作树（2026-09-14）

- schema v18 在 Phase 16 的逐候选人工记录之上增加本地跨候选复核：五个受保护候选必须位于同一标准 bundle，绑定同一 immutable SHA，并展开为 macOS ARM64/Intel、Windows x64/ARM64、Linux x64/ARM64 六个实际平台目标。汇总计划只绑定稳定的 receipt/provenance/checksum 哈希；复核时重新验证每份 Phase 16 plan、record 和 evidence。
- Review 修复了一个 bundle 边界缺口：候选或各 target 的 review 目录即使单个文件本身通过验证，也不能经真实路径逃离标准 bundle。实现现拒绝这种目录逃逸，并对离线 receipt 自动从对应 target 的固定 `trusted-root.jsonl` 重新哈希。汇总计划和完整复核均固定 `releaseReady=false`。
- 最终本地验证：actionlint、lint、typecheck、i18n 审计、84 个测试文件 / 1,221 项 unit、相对 Markdown 链接检查、文档内容检查与 42 页构建、Web 构建和 PWA 审计（54 项 / 2,670,426 B），以及 desktop、Gate、contract、trust、provenance、macOS、Windows x64/ARM64、Linux DEB 仓库和 key lifecycle 静态审计均通过。771-file 公开工作树预览继续输出 `releaseReady=false`。Web 构建仍有既存的大于 500 kB chunk 提示。
- 这些本地合同不表示真实平台安装、权限、签名、公证、时间戳、GitHub Environment、attestation 或公开发布已经执行。完整边界见[跨平台桌面 Phase 17](./desktop-cross-platform-phase-17.md)。

### 桌面 Phase 16 本地工作树（2026-09-14）

- schema v17 为 Phase 15 的候选外收据增加候选绑定的平台人工验收计划、未执行模板和本地记录复核。计划/模板只能原子创建在候选目录外；记录会重新校验候选、收据、计划和 evidence 的媒体类型、普通文件边界与 SHA-256。Linux DEB 仓库候选拆分为 x64/ARM64 两组人工项。
- Review 拒绝候选目录输出、路径逃逸、候选/计划/记录/evidence 在复核期间变化、无 evidence 的 `passed`、篡改 evidence、错误计划哈希、重复 CLI 参数，以及把收据、计划、record 或 offline trusted root 当作人工证据。未执行模板和完整记录都保持 `releaseReady=false`。
- 最终本地验证：actionlint、lint、typecheck、83 个测试文件 / 1,213 项 unit、文档内容检查与 42 页构建、Web 构建和 PWA 审计（54 项 / 2,670,426 B），以及 desktop、Gate、contract、trust、provenance、macOS、Windows x64/ARM64、Linux DEB 仓库和 key lifecycle 静态审计均通过。768-file 公开工作树预览继续输出 `releaseReady=false`。Web 构建仍有既存的大于 500 kB chunk 提示。
- 这些本地结果不表示真实平台安装、权限、签名、公证、时间戳、GitHub Environment、attestation 或公开发布已经执行。当前完整边界见[跨平台桌面 Phase 19](./desktop-cross-platform-phase-19.md)。

### 桌面 Phase 15 本地工作树（2026-09-14）

- schema v16 将受保护候选的收据契约升至 v2。收据只会在严格 GitHub CLI 验证完成后、最终候选 plan/清单重检一致时，以固定文件名原子写入候选外目录；离线模式还会重哈希 trusted root。新增 `--verify-receipt` 在不联网、不重跑 `gh` 的情况下，将当前候选、收据、plan、bundle、subject 和离线 root（如适用）重新关联。
- Review 修复了两处会削弱交接结论的缺口：Phase 14 的收据没有独立重验证入口，且在 CLI 返回后没有再次检查候选。实现还拒绝收据在候选内、错误文件名、收据字段/subject 篡改、root 替换和竞争写入；最终重检或原子创建失败不会留下成功收据。
- 最终本地验证：actionlint、lint、typecheck、82 个测试文件 / 1,199 项 unit、文档内容检查与 42 页构建、Web 构建和 PWA 审计（54 项 / 2,670,426 B），以及 desktop、Gate、contract、trust、provenance、macOS、Windows x64/ARM64、Linux DEB 仓库和 key lifecycle 静态审计均通过。765-file 公开工作树预览继续输出 `releaseReady=false`。Web 构建仍有既存的大于 500 kB chunk 提示。
- 没有读取、设置或验证真实凭据，也没有进入 GitHub Environment、运行远端 workflow、产生真实 attestation、签名、公证、时间戳、安装、公开 key 分发、tag、Release、updater 或公开分发。私有仓库的 GitHub Enterprise Cloud 可用性和 Environment/组织 action policy 仍待管理员确认；`releaseReady` 保持 `false`。完整边界见[跨平台桌面 Phase 15](./desktop-cross-platform-phase-15.md)。

### 桌面 Phase 14 本地工作树（2026-09-14）

- schema v15 为五条受保护签名候选新增 checksum 覆盖的 provenance verification plan。本地预检对 record、bundle、subject 和全量 SHA-256 清单 fail-closed；显式 GitHub CLI 验证固定仓库、signer workflow、候选 SHA、main ref、SLSA predicate、候选 bundle、GitHub-hosted runner 和私有 Sigstore 实例，且只在全部 subject 成功后向候选目录外写收据。
- Review 补强了 fail-closed 静态审计：拒绝额外或未固定的 attestation action、错误 job 权限、custom predicate、记录步骤中的 secret、错误 subject/attestation URL、在凭据清理前 attestation、缺少 provenance/verification-plan checksum、候选 workflow 内执行 `gh`、以及任何 tag、Release 或发布操作。记录和预检脚本还拒绝候选目录外或符号链接文件、未列入 checksum 的候选文件、非显式 runner 临时目录 bundle、重复/不完整 subject、篡改 plan、篡改 checksum 和非固定 policy，且以流式哈希处理 artifact。
- 最终本地验证：actionlint、lint、typecheck、82 个测试文件 / 1,191 项 unit、文档内容检查与 42 页构建、Web 构建和 PWA 审计（54 项 / 2,670,426 B），以及 provenance、contract、trust、Gate、macOS、Windows x64/ARM64、Linux DEB 仓库和 key lifecycle 静态审计均通过。764-file 本地公开工作树预览也通过，且继续输出 `releaseReady=false`。Web 构建仍有既存的大于 500 kB chunk 提示。
- 没有读取、设置或验证真实凭据，也没有进入 GitHub Environment、运行远端 workflow、产生真实 attestation、签名、公证、时间戳、安装、公开 key 分发、tag、Release、updater 或公开分发。私有仓库的 GitHub Enterprise Cloud 可用性和 Environment/组织 action policy 仍待管理员确认；`releaseReady` 保持 `false`。完整边界见[跨平台桌面 Phase 14](./desktop-cross-platform-phase-14.md)。

### 桌面 Phase 12 本地工作树（2026-09-14）

- schema v13 为 Linux x64/ARM64 DEB 仓库候选增加内部客户端信任包和生命周期契约。签名私钥 home 不再直接导出客户端 keyring；workflow 将活动公开键和可选下一把公开键导入独立 trust home，拒绝其中任何私钥、未知主键、重复 fingerprint 或不完整的下一把键配对。它以 `export-minimal` 同时生成 `.gpg` 和 `.asc`，还原 armor 后逐字节比对，并将 manifest、轮换/撤销响应说明和 keyring 全部纳入 SHA-256 清单。
- Review 修复了新增公开导出文件在 `public-export-manifest.json` 中未按字节序排列的问题；该问题会被 fail-closed 公共仓清单校验拒绝。后续复核补上了对受信任主键已撤销、过期、禁用和无效状态的拒绝，避免下一把已撤销的公开键进入 trust bundle。轮换契约要求活动键与下一把键至少重叠 30 天，带有效期的键至少还有 30 天；撤销流程先停止发布和 endpoint，再通过独立带外渠道恢复，候选 artifact 不包含撤销证书。
- 最终本地验证：actionlint、shell 语法、lint、typecheck、79 个测试文件 / 1,140 项 unit、文档内容检查与 42 页构建、Web 构建和 PWA 审计（54 项 / 2,670,426 B）、本机 Linux 无 bundle 桌面生产构建、桌面审计，以及 Linux key lifecycle、仓库签名、contract、trust 和 Gate workflow 审计均通过。另用临时带口令的活动/下一把 OpenPGP key 复现 public-only trust home、精确主 fingerprint、最小二进制/armor 还原比对、`InRelease` 的 `gpgv` 校验和重叠 manifest；也用临时 key 的撤销证书确认 GnuPG colon 状态从 `-` 变为 `r`，并由新 guard 拒绝它；不使用真实 Linux 凭据。756-file 本地公开工作树预览继续输出 `releaseReady=false`。Web/desktop 构建仍有既存的大于 500 kB chunk 提示。
- 未读取或验证任何 Linux secret，也没有配置或进入 GitHub Environment、运行远端 x64/ARM64 runner、签署正式候选、建立公开 endpoint、分发公开 key、完成支持客户端 rollout、实际轮换/撤销演练、安装/升级/卸载、tag、Release、updater 或真实 attestation；Phase 12 的历史细节见[跨平台桌面 Phase 12](./desktop-cross-platform-phase-12.md)，当前 provenance 预检、收据、平台人工验收、跨候选复核、候选外审查档案和载荷交接清单边界见[Phase 19](./desktop-cross-platform-phase-19.md)。

### 桌面 Phase 11 本地工作树（2026-09-14）

- schema v12 增加 Linux x64/ARM64 DEB APT 仓库签名候选。两个原生 runner 先构建、检查并复验无签名 DEB 输入；只有在 `linux-repository-signing` Environment 的 sign job 中，才会导入单一 OpenPGP 私钥，生成带 14 天有效期的 `Release`、`InRelease` 和分离签名，并以公开 keyring、`gpgv` 与隔离 `signed-by` APT root 复验。无签名 Gate 仍没有 secret，且所有 workflow 保持 `contents: read`。
- Review 修复了隔离 APT root 的 `Dir::Etc`/state 路径，避免 `apt-get update` 在未读取候选 source list 时误报成功；同时在签名完成后才把候选仓库设为 APT sandbox 可读。静态审计新增 ARM64 索引过滤、14 天 `Valid-Until`、隔离 source list、可读权限、清理与无发布操作的负向用例。
- 最终本地验证：actionlint、lint、typecheck、77 个测试文件 / 1,115 项 unit、文档内容检查与 42 页构建、Web 构建和 PWA 审计（54 项 / 2,670,426 B）、本机 Linux 无 bundle 桌面生产构建，以及 Linux 仓库、contract、trust 和 Gate workflow 审计均通过。另用临时测试密钥和临时 DEB 仓库实际复现 `apt-ftparchive → OpenPGP → gpgv → signed-by APT update`；它不替代 Ubuntu 22.04 runner、真实 Environment 或公开仓库验收。站点构建仍有既存的大于 500 kB chunk 提示。
- 未读取或验证任何 Linux secret，也没有配置或进入 GitHub Environment、运行远端 x64/ARM64 runner、签署正式候选、建立公开 endpoint、分发公开 keyring、完成密钥轮换/撤销、安装/升级/卸载、tag、Release、updater 或 attestation。`releaseReady` 保持 `false`；完整边界见[跨平台桌面 Phase 11](./desktop-cross-platform-phase-11.md)。

### 桌面 Phase 10 本地工作树（2026-09-14）

- schema v11 增加独立 Windows ARM64 Authenticode/RFC 3161 签名候选。它固定 `windows-11-arm`、`windows-arm64`、`aarch64-pc-windows-msvc`、`windows-signing` Environment、SHA-256、RFC 3161、NSIS 和 14 天内部 artifact；无签名 Gate 仍无 secret、全局只有 `contents: read`。签名 job 仅在 preflight 成功后导入一个带私钥和 Code Signing EKU 的非空密码 PFX 到 CurrentUser 证书库，并在失败或结束时删除 PFX、证书和临时 Tauri overlay。
- Review 将 Windows 静态审计整理为 x64/ARM64 profile，并新增 ARM64 workflow、独立配置、显式 Rust target、ARM64 Windows SDK SignTool 优先选择和目标专属 artifact channel。包检查继续验证 ARM64 主程序和 NSIS payload；Tauri 的 NSIS wrapper 本身可为 x86 仿真程序，不能用其外层架构替代应用架构检查。
- 最终本地验证：actionlint、lint、typecheck、75 个测试文件 / 1,091 项 unit、文档内容检查与 42 页构建、Web 构建和 PWA 审计（54 项 / 2,670,426 B）、Windows ARM64 静态 overlay 与临时外部 runtime overlay（dummy thumbprint）的 `--no-sign --no-bundle` 配置解析、本机 Linux 无 bundle 桌面生产构建，以及 macOS/Windows x64/Windows ARM64 签名、contract、trust、Gate workflow 和桌面审计均通过；745-file 公开工作树预览继续输出 `releaseReady=false`。站点构建仍有既存的大于 500 kB chunk 提示。
- 未读取或验证任何 Windows secret，也没有运行 Windows ARM64 runner、导入真实 PFX、执行 Authenticode/RFC 3161、检查 Windows 信任 UI、安装、升级、卸载、tag、Release、updater 或 attestation。Environment 保护、组织 secret 范围、Windows ARM64 build tools 和 runner 可用性仍需管理员在首次手动候选前配置；完整边界见[跨平台桌面 Phase 10](./desktop-cross-platform-phase-10.md)。

### 桌面 Phase 5 本地工作树（2026-09-14）

- 本轮保留 AVIF、WebP 与 PNG scalar WASM Worker 的严格资源校验、`wasm-unsafe-eval` CSP、生产资产审计、有限截图能力与真实 WebView smoke；新增非破坏性 `desktop-state-v1.json` 标记、脱敏 `desktop_state_status` IPC、Windows current-user NSIS/拒绝 downgrade 策略，以及 schema v6 的 `stateMigration` runtime evidence 和所有目标的安装生命周期人工项。标记不会读取、重写或删除 WebView IndexedDB、项目、草稿或预设；损坏、未知 schema、未知字段和 symlink 均保留原数据并返回 `unavailable`。
- 最终本地验证：lint、typecheck、71 files / 997 unit、三引擎 E2E 396 passed / 24 expected skipped、PWA 52 passed、Web/library build、consumer development/preview 各 18/18、PWA 审计（54 entries / 2,670,426 B）、低级依赖审计、Rust 32/32、Clippy、无 bundle 的生产桌面构建，以及 desktop/codec/contract/workflow 审计均通过。Vite 仍报告大于 500 kB 的 chunk 提示，PWA 预算审计通过，但该提示不是本阶段已解决的性能结论。
- Linux ARM64 的 Xvfb/隔离 DBus 真实 Tauri WebView smoke 返回 `x11` / `ready`，`stateMigration` 为 `initialized`；两个未授权截图 IPC 被拒绝，示例编辑器导入、PNG 剪贴板、快捷键、托盘、单实例和三个 codec 通过；因没有人工原生授权，runtime 正确记录 `capture: manual`。生产 dependency tree 与 binary 都没有 runner-only WebDriver 标记。
- Review 修正了把稳定 bundle identifier 推导为 WebView profile 连续性的过度表述：它只保证原生标记路径一致，WebView profile、安装、升级和卸载仍须逐平台实机验收。六个远端原生候选仍均为 `not-run`，没有新的最低浏览器、真实 Apple Safari、安装、签名或公开发布证据；边界见[跨平台桌面 Phase 5](./desktop-cross-platform-phase-5.md)。

### 桌面 Phase 6 本地工作树（2026-09-14）

- Phase 6 当时以 schema v7 新增 `releaseTrustPolicy` 与 `trustPolicy` build check。候选 Gate 继续固定为无签名、无 secrets、全局仅 `contents: read`；审计拒绝 updater、更新 artifact、macOS/Windows 签名配置、签名凭据、发布 action、OIDC/attestation 写权限和 job 级权限扩张。Phase 7 当时将契约升至 schema v8，Phase 8 已将当前契约升至 schema v9 并要求 ARM64 与 Intel 签名候选都通过静态审计；`pnpm audit:desktop:trust` 仍明确输出 `releaseReady=false` 及发布前 blockers。
- 本轮 review 发现公开仓库清单新增 trust 审计文件后未保持字典序；修正后全量 72 files / 1,012 unit、lint、typecheck、站点/文档构建、PWA 审计（54 entries / 2,670,426 B）、桌面前端与无 bundle 生产构建、codec/desktop/contract/trust/workflow 审计、Rust 32/32、fmt 与 Clippy 均通过。
- Linux ARM64 的 Xvfb/隔离 DBus 真实 Tauri WebView smoke 仍返回 `x11` / `ready`、`stateMigration: initialized`、本地 codec、编辑器导入、PNG 剪贴板、快捷键、托盘和单实例通过；未授权截图正确记录为 `manual`。没有触发远端六目标 Gate、安装/升级/卸载人工矩阵、签名、公证、更新、attestation、tag、GitHub Release 或公开下载；完整边界见[跨平台桌面 Phase 6](./desktop-cross-platform-phase-6.md)。

### 桌面 Phase 7 本地工作树（2026-09-14）

- schema v8 增加独立 macOS ARM64 签名候选的静态契约。无签名 Gate 仍是无 secrets / contents-read；新 workflow 仅在私有 main、手动确认和 macos-signing Environment 下进入签名 job，P12 空密码只用于一次性临时钥匙串，Apple ID/app-specific password/Team ID 只进入 Tauri build step。
- 本地已通过 macOS workflow 静态审计、contract/trust 审计与相关单元测试；尚未读取或验证组织 secret 值，也没有运行 macOS runner、签名、公证、stapling、Gatekeeper、安装、tag、Release、updater 或 attestation。Environment 的保护规则和组织 secret 访问范围仍需管理员在首次手动候选前配置；完整边界见[跨平台桌面 Phase 7](./desktop-cross-platform-phase-7.md)。
- 本轮再通过 `actionlint`、lint、typecheck、73 files / 1,028 unit、文档内容检查与 42 页构建、站点构建和 PWA 审计（54 entries / 2,670,426 B）、本机 Linux 无 bundle 桌面构建，以及 733-file 的本地公开工作树预览审计。公开审计补齐了 Vite 配置依赖和文档图片 allowlist，未放宽秘密或内部内容扫描；站点仍有既存的 Vite 大于 500 kB chunk 提示。

### 桌面 Phase 8 本地工作树（2026-09-14）

- schema v9 增加独立 macOS Intel 签名候选。它固定 macos-15-intel、macos-x64、独立确认值、包通道和 artifact 目录；ARM64 与 Intel 都必须通过同一 fail-closed 静态审计，且不允许从一个架构的结果推导另一个架构。
- 两个签名 workflow 都只在私有 main、显式确认、preflight 成功和 macos-signing Environment 下使用四个 Apple secret。P12 空密码继续只用于临时钥匙串；本轮同时修正了 Developer ID authority 提取的 POSIX sed 转义，避免把错误 authority 当作通过。
- 尚未读取或验证组织 secret 值，也没有运行 macOS runner、签名、公证、stapling、Gatekeeper、安装、tag、Release、updater 或 attestation。完整边界见[跨平台桌面 Phase 8](./desktop-cross-platform-phase-8.md)。
- 最终本地验证：actionlint、lint、typecheck、73 个测试文件 / 1,047 项 unit、文档内容检查、站点构建与 PWA 审计（54 项 / 2,670,426 B）、本机 Linux 无 bundle 桌面构建，以及双架构签名、contract、trust、Gate workflow 审计均通过；735-file 公开工作树预览继续输出 releaseReady=false。站点构建仍有既存的大于 500 kB chunk 提示。

### 桌面 Phase 9 本地工作树（2026-09-14）

- schema v10 增加独立 Windows x64 Authenticode/RFC 3161 签名候选。它固定 `windows-2025`、`windows-x64`、`windows-signing` Environment、SHA-256、RFC 3161、NSIS 和 14 天内部 artifact；无签名 Gate 仍无 secret、全局只有 `contents: read`。签名 job 仅在 preflight 成功后导入一个带私钥和 Code Signing EKU 的非空密码 PFX 到 CurrentUser 证书库，并在失败或结束时删除 PFX、证书和临时 Tauri overlay。
- Review 发现公开导出清单把已由 `src-tauri/` 目录覆盖的 Windows overlay 又列为单文件，触发 fail-closed 的重叠路径拒绝；已保留该配置为 required file，并移除重复 include。静态审计也补充了空 Windows PFX 密码和不在失败后执行 cleanup 的负向用例。
- 最终本地验证：actionlint、lint、typecheck、74 个测试文件 / 1,066 项 unit、文档内容检查与 42 页构建、Web 构建和 PWA 审计（54 项 / 2,670,426 B）、Windows 签名 overlay 与临时外部 runtime overlay（dummy thumbprint）的 `--no-sign --no-bundle` 配置解析、本机 Linux 无 bundle 桌面生产构建，以及 macOS/Windows 签名、contract、trust、Gate workflow 和桌面审计均通过；740-file 公开工作树预览继续输出 `releaseReady=false`。站点构建仍有既存的大于 500 kB chunk 提示。
- 未读取或验证任何 Windows secret，也没有运行 Windows runner、导入真实 PFX、执行 Authenticode/RFC 3161、检查 Windows 信任 UI、安装、升级、卸载、tag、Release、updater 或 attestation。Environment 保护和组织 secret 范围仍需管理员在首次手动候选前配置；完整边界见[跨平台桌面 Phase 9](./desktop-cross-platform-phase-9.md)。

### 25 张图片背景（本地工作树）

- 22 张维护者提供图片 + 三张已选自然背景已接入，详见[实现及验证记录](./preset-backgrounds.md)。最后 lint/typecheck、46/453 unit、三引擎背景专项 15/15、Web/library 构建通过；PWA 全组 13/13、最后 CSS 补修后背景离线 1/1。未运行全库 E2E 或新的远端/最低浏览器矩阵。
- Review 修复了背景历史资源释放、存档类型遗漏、库宿主缩略图内联，以及嵌套手机 Drawer 越界/Portal 选中描边缺失；失败与复测范围见专题，不继承历史候选 Gate。
- 最终 library consumer 经 offline strict-peer 清洁重建后 development/production 各 14/14。一次在线安装失败及扩大回归中的两项失败/定向复测均保留记录；不是全库 E2E 全绿声明。

### 导出压缩 C4 本地工作树（较早历史快照）

- Web C4 开发与 review/fix 完成：显式释放预览位图/Canvas、取消微任务所有权、ZIP 平台交付互斥及公开资产/测试闭包。2 MP / 1.5 MP 正式 UI 压力超线后，新模式与完整预览收紧到 1,048,576 px；标准直接导出不变。最终三引擎 18 组 × 6 次压力全部通过，单实例最大 RSS 增量 366.8 MiB；双实例与 12 张批量独立测量，WebKit 整批 599.1 MiB，不冒充低于单操作 384 MiB 线。
- 最后源码 lint/typecheck、42 files / 417 unit 通过。相同产品代码的隔离副本通过全部 18 个 Web clean-room 命令，含 E2E 199 passed / 20 expected skipped、PWA 8/8、current release 9/9、consumer dev/production 各 6/6、Web/library 与相关审计。子路径/严格 CSP/真正源站不可用冷暖恢复三引擎通过；598 键七语、低等级漏洞与许可检查通过。测试方法修正、候选边界及复现见 [C4 验证报告](./export-compression-c4.md)。
- 无新的最低浏览器、真实 Apple Safari 或 Rust/原生桌面矩阵。桌面 WASM 的 CSP/自定义资源协议兼容为独立 HOLD；desktop:web:build 和 PNG palette/tRNS 保存 stub 不替代原生验收。本地公开副本 releaseReady=false，未提交、推送、晋级或发布。

### 导出压缩 C3 本地工作树（2026-09-06 历史快照）

- 存档/预设/最近项目压缩设置往返、兼容警告、批量完整参数、冻结背景/主题和重试 ZIP 已完成开发及 review/fix。最后修复后的 lint/typecheck、42 files / 400 unit、全量当前三引擎 E2E 193 passed / 20 expected skipped（含 C3 15/15）、Web/library 构建、consumer development/production 各 6/6、PWA 8/8 全部通过；主题补修的 12 张专项另 3/3。
- 七语静态审计 598 键，无缺失或占位符错误；三引擎七语 × 深浅主题 × 390 px axe A/AA 与无横向溢出检查通过，未宣称所有批量控件达到 44 px。codec/PWA/体积/许可审计通过，low audit 无已知漏洞。实现与实际失败/修复记录见 [C3 验证报告](./export-compression-c3.md)。
- C4 全链路压力、公开导出清单和候选验收仍待实施。没有新的最低浏览器、Apple Safari、Rust/原生桌面或远端 Gate 证据，未提交/推送/发布，不继承历史候选的通过结论。

### 导出压缩 C2 本地工作树（同日较早历史快照）

- C0/C1 之后已完成 C2 单图设置与手动真实预览、同 Blob 交付、七语/深浅/窄屏和取消隔离，未提交或发布。最终 lint/typecheck、40 files / 364 unit、当前三引擎全量 E2E 178 passed / 20 expected skipped、Web/library 构建、consumer development/production 各 6/6、PWA 8/8 均通过。
- 七语静态审计为 595 键，无缺失/占位符错误；新面板三引擎七语 × 双主题 × 390 px 的 axe A/AA 与溢出检查通过。codec/PWA/体积/许可审计通过，low audit 无已知漏洞。失败、修复、产物字节及复现命令见 [C2 验证记录](./export-compression-c2.md)。
- C3 存档/批量重试快照、C4 全链路压力/公开清单仍待实施。本轮没有新的 Rust/原生桌面、最低浏览器、Apple Safari 或远端 release Gate 证据，不能继承下面历史候选的通过结论。

### 全项 Review 候选（同日较早历史快照）

- 全项 Review 续作的源码候选 `39c538a525a6db43ad6cbed9ab04e47ad5f19548`：36 files / 268 unit、Rust 24/24 与 Clippy、lint/typecheck、当前三引擎 E2E 118 passed / 20 expected skipped、Web/library/desktop 构建、PWA 5/5、current release 9/9、consumer dev/preview 各 3/3 已通过。299-file 公开导出通过内容/秘密审计、独立 strict-peer install、lint/typecheck、公开 35/256 unit、i18n、Web/library/PWA 审计与 consumer 双模式；没有执行完整 22-command clean-room，也没有远端发布。
- 普通与隔离 test-driver Linux aarch64 runtime 均通过编辑器、PNG 剪贴板、系统状态及未授权截图拒绝；native consent 成功链路为 manual，新三平台 Gate 仍 HOLD。生产 binary/default tree 无测试 driver 标记；新原生语言与真实 OS 确认还需 Windows/macOS 实机验证。
- 国际化审计覆盖静态翻译键和插值参数，英文首屏、菜单、编辑、移动导出和资料库已检查；不代表 Emoji Mart 英文选择器或静态中文安装元数据已经双语。PWA 核心清单同步新首屏 chunk，保持 3 MiB 总预算和重资源按需缓存。

### 上一轮保存/多实例修复（2026-09-05）

- 当前工具定义：Node 24.18.0、pnpm 10.12.1、Vite 8.2.2、`@vitejs/plugin-react` 6.1.1、Vitest 4.1.11；旧 SWC plugin 不再是当前依赖。
- 本轮保存/多实例 review 修复后的本地结果：lint/typecheck、34 files / 256 unit、Rust 20/20 与 Clippy、当前三引擎 E2E 97 passed / 20 expected skipped、PWA 5/5、current release 9/9、Web/library build、consumer dev/preview 各 2/2 均通过。新增回归覆盖保存冲突、两个句柄竞争、重复保存、双实例 portal 标签关联和动态 ID 的最低浏览器脚本读取逻辑；未运行新的最低浏览器或桌面三平台远端矩阵。
- 本轮 285-file 公开导出快照通过内容审计、秘密扫描、独立严格锁文件安装、lint/typecheck 和 33 files / 244 unit；没有执行全套 21-command clean-room，也没有上传或发布该快照。
- Review 修复前代码的本地 unit 为 33 files / 250 tests；Phase 9.3 代码 clean-room 为公开 32 files / 239 tests、E2E 97 passed / 20 expected skipped、PWA 5、current release 9、Rust 13，consumer dev/preview 均通过。下面 Phase 1 的 10 项与 Phase 8.5 的 188 项是历史数字，不应覆盖重写成最新结果。
- Phase 8.5 的 `76035d8004d556771ce327e234811cee94313917` 已通过公共 CI 与四浏览器矩阵，先前 HOLD 已关闭。准确 run 与限制见 [Web Release Gate](./web-release-gate.md)。
- Phase 9.3 的 `4bbe72a1b7ed779375c9ac950219e98769a2bd77` 三平台自动 Gate 通过，`releaseReady=false`，详见 [桌面 PoC](./phase-9-desktop-poc.md)。后续保存/多实例修复需要自己的本地与远端证据，旧候选不能代替复验。

## Phase 1 环境与版本（历史快照）

| 项目 | 基线 |
| --- | --- |
| 上游源码 | Shoteasy `799c454b288bc17518afc3d4a54d5588fc10c587` |
| Phase 1 前私有本地基线 | `bce533b`（规划纳入仓库，未推送） |
| 操作系统 | Debian GNU/Linux 13.2，Linux arm64 |
| Node / pnpm | Node 24.18.0 / pnpm 10.12.1 |
| 构建/测试工具 | Vite 6.4.3、`@vitejs/plugin-react-swc` 4.3.3、Vitest 3.2.6、Playwright 1.62.1 |
| locale / 测试时区 | 主机 `en_CN.UTF-8`；Playwright `zh-CN` / UTC |
| 浏览器视口 | Playwright Desktop profiles，Chromium golden 为 1280×720、device scale factor 1 |
| 当前引擎 | Chrome for Testing 151.0.7922.34、Firefox 153.0、WebKit 26.5 |

`package.json` 的 `engines` 接受 Node 24.x 和 pnpm 10.12.1～10.x；`.node-version` 与 `.nvmrc` 固定当前维护版本 24.18.0。pnpm 安装会提示 `@swc/core`、`esbuild` 的依赖 build script 被安全策略忽略；在未执行交互式批准的情况下，frozen install、lint 和双构建均已通过，因此 Phase 1 不扩大脚本执行许可。

## Phase 1 已执行的自动验证（历史快照）

| 层 | 命令 | 已验证结果 |
| --- | --- | --- |
| 安装 | `pnpm install --frozen-lockfile` | 通过 |
| 依赖审计 | `pnpm audit --audit-level=high` | `No known vulnerabilities found` |
| 静态检查 | `pnpm lint` | 通过，0 warning |
| 单元测试 | `pnpm test:unit` | 2 files，10 passed，1 todo |
| 当前浏览器 | `pnpm test:e2e` | Chromium/Firefox/WebKit 的离线启动、导入、编辑、撤销、重做均通过；golden 仅在 Chromium 执行 |
| Web 构建 | `pnpm build` | 通过 |
| library 构建 | `pnpm build:lib` | 通过 |
| library consumer | `pnpm test:consumer` | 构建产物导入、CSS 生效、卸载通过 |
| 体积报告 | `pnpm size:report` | 通过并输出 JSON |

E2E 对非 localhost、`blob:`、`data:` 的请求执行阻断，确保 smoke 流程不上传图片、不依赖外部服务。测试 fixture 由仓库内代码确定性生成，不读取用户文件。

## Golden 基线

- `tests/e2e/app.spec.js-snapshots/initial-page-chromium-linux.png`：Ambient Shelf 离线首屏，2026-09-07 更新为新品牌标识；已目视上传、本地说明、快速入门与图标。测试隐藏可选设备图片区，避免将私有第三方图片嵌入公开 golden；真实设备快捷区由独立布局/图片加载/E2E 验证。
- `tests/e2e/app.spec.js-snapshots/export-chromium-linux.png`：64×48 自生成四象限 fixture 在代码渐变背景上的 PNG 导出；已人工查看尺寸和颜色分区。
- `tests/e2e/app.spec.js-snapshots/workspace-center-chromium-linux.png`：Phase 8.5.2 后的 560 px 本地资料库四 Tabs 空状态；文件动作和智能建议不再混入。
- `tests/e2e/app.spec.js-snapshots/generic-device-frames-chromium-linux.png`：四种代码原生无品牌设备外框导出。
- 当前 SHA-256：首屏 `17e7c9f4bae8f15e198d2c2e3e5d20db381a58f6278cbc30b72dc0cd85a08e21`；导出 `6b77d20505a1315834cc9940e17aef6cd99a8a66672c56ff19414b75b2087123`；本地资料库 `19f15d4f39c49c2fe875b663177f56295c3719359097a62ae483ff696190c44e`；设备外框 `2d3eee31b8778ad0f98861ada90170f3723bc125ca310735142e088095ac6724`。首屏使用当前 Ambient Shelf/品牌版本；其余三个 golden 本轮未改。

golden 变化只能由人工查看后使用 `playwright test --update-snapshots` 更新；CI 失败不得自动覆盖。

## Phase 8.5.4 移动增量基线

- 390×844、430×932、768×1024、1024×768、1440×900 各深浅主题共 10 组均为 axe A/AA 0 violation、页面/顶栏横向溢出 0、外部请求 0、page error 0；390/430 px 可见交互目标低于 44 px 为 0。
- 专项在 Chromium、Firefox、WebKit 共 12/12，覆盖移动单菜单、四组命令可达、后继面板焦点归还、标注 Sheet、缩放菜单、横屏、390×500 低高度、200% 文本、reduced motion 与 768/1024/1180/1280/1440 编辑区切换。
- PWA production 5/5，直接验证状态卡不与移动导出、标注、缩放入口相交；current release 三引擎 9/9，完整 E2E 94 passed / 20 expected skipped。
- 人工查看 390/430、768/1024/1440、菜单和标注 Sheet 证据；本阶段没有更新既有 golden。精确最低浏览器最终候选复验仍属于 Phase 8.5.5。

## Phase 8.5.5 最终候选本地证据

- Node 24.18.0 / pnpm 10.12.1 frozen strict-peer install、ignored builds None、low audit、license audit、typecheck 和 lint 通过；26 files / 188 unit tests passed。
- 当前 Chromium/Firefox/WebKit 为 94 passed / 20 expected skipped；production release 9/9，PWA 5/5，library consumer dev/preview 各 1/1。项目/草稿/预设、多图层、批量、PNG/JPEG/WebP/AVIF、WebP fallback、多实例与 `workspace=false` 均有覆盖。
- 390/430/768/1024/1440 × dark/light 共 10 captures 为 0 axe violation、0 外网请求、0 page error、0 页面/顶栏横向溢出；390/430 可见交互目标小于 44 px 为 0。人工复核代表图后没有更新 golden。
- 终审修复了关闭态 ColorPicker 的悬空 `aria-controls`、标注 toolbar/本地 file input 语义和移动菜单内层 `role=tab` 仅 28×22 px 的问题；复跑后不再有 ARIA incomplete，剩余 incomplete 仅为 axe 无法自动判断的渐变/图片背景对比度。
- Web entry 为 868,858 B / gzip 271,417 B；library package entry 为 322,955 B / gzip 85,011 B；PWA precache 为 20 entries / 2,620,813 B，均在门限内。
- minimum-browser evidence 已升为 schema v2，除桌面编辑/四格式/同源请求外，还强制验证移动菜单、标注、缩放、44 px 与无横向溢出。Chrome 111.0.5563.146、Edge 111.0.1661.62 本地仿真只证明 runner 功能，不作为可信发布证据。

本节采集时判定为“本地 GO / 远端 HOLD”；随后第七公开候选 `76035d80…` 完成同 SHA 公共 CI、原生 amd64 三浏览器、`macos-14` Safari 与证据汇总，Phase 8.5 技术 Gate 已 GO。旧 Phase 7 SHA 或本地仿真未被用来替代该验收。

## Phase 1 构建体积快照（历史）

| 产物 | 原始字节 | gzip 字节 | 备注 |
| --- | ---: | ---: | --- |
| Web entry JS | 2,142,572 | 648,854 | 15 个 `data:image/` |
| Web entry CSS | 49,673 | 10,559 | 1 个 `data:image/` |
| library JS | 12,803,535 | 7,145,734 | 50 个 `data:image/` |
| library CSS | 49,673 | 10,559 | 1 个 `data:image/` |

Web build 共输出 38 个图片文件；library 另有 CSS 中的 1 个图片文件。当前体积只作为零点，不代表可接受的长期预算。Web 主 chunk 超过 Vite 500 kB warning，library 将大量图片内联；两项均是 Phase 3 性能/资源工作的量化输入。

初次 review 发现 Vitest 2.1.9 的 critical advisory 和 Vite 5 无 5.x 修复的 high advisory。按“发现 CRITICAL/HIGH 先修复”的阶段规则，Phase 1 以独立安全闭环升级到 Vitest 3.2.6、Vite 6.4.3 和 React SWC plugin 4.3.3；`pnpm audit --audit-level=high` 最终为 `No known vulnerabilities found`。Vite 6 默认改变 library CSS 文件名，已通过正式的 `build.lib.cssFileName` 配置保持原公共产物 `style.css`，consumer 回归通过。

## 最低浏览器验收方法

Playwright bundled engines 不是最低版本证明。Release owner 负责在候选发布前安排并保存以下证据：执行日期、操作者、OS、浏览器完整版本、启动/导入/编辑/撤销/重做/导出结果、失败截图或日志。

| 浏览器 | 最低版本 | 执行环境 | Phase 1 状态 |
| --- | ---: | --- | --- |
| Chrome | 111 | 受控版本 VM 或可信云真机 | 方法已定义，未执行 |
| Edge | 111 | 受控 Windows VM 或可信云真机 | 方法已定义，未执行 |
| Firefox | 128 | 受控版本 VM/官方版本环境或可信云真机 | 方法已定义，未执行 |
| Safari | 16.4 | macOS 真机或可信云真机；不得用 Playwright WebKit 代替 | 方法已定义，未执行 |

Phase 7 Web Release Gate 前，上述四行必须有实际记录。P0 引入项目保存后，矩阵再加入 File System Access 可用路径与 file input/download 回退路径；当前不把尚未实现的 P0 保存功能写成已通过。

## 已发现但未在 Phase 1 混入修复的问题

- `normalizeShape()` 对空字符串数值字段没有完全兑现“默认化”的注释；单元测试以 todo 登记，进入 Phase 2 正确性处理。
- 模块级 Store 和固定 DOM ID 仍不支持可靠多实例；Phase 1 consumer 只验证单实例导入/卸载，双实例属于 Phase 2。
- 首屏仍包含 Google Fonts 和 6 个 Unsplash 快捷背景请求，不满足最终纯本地发布目标；必须在 Phase 3 本地化、移除或改为显式离线安全方案。
- 当前开发模式存在第三方图标 SVG 属性、Ant Design deprecated API 和 `findDOMNode` console warning；依赖升级波次前需建立 warning 预算并逐项清理。

> 后续状态：上述 `normalizeShape` todo、模块级 Store、固定 DOM ID、主图/背景 object URL 释放和单实例 consumer 缺口已在 Phase 2 修复；Google Fonts/Unsplash、library 资源外置与类型/platform 边界已在 [Phase 3](./phase-3-foundation.md) 处理。Phase 8 又把第三方背景缩略图/原图替换为代码渐变。除明确标注的当前 golden 外，本页数字仍保留为 Phase 1 历史基线。
