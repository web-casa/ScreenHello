# Changelog

ScreenHello 的重要用户可见变化记录在这里。版本采用何种 SemVer 起点将在首次公共发布前确认；在此之前所有条目保留在 `Unreleased`。

## Unreleased

### Added

- 纯本地截图美化、项目/预设、多个图片图层、批量导出和 PWA 离线能力。
- PNG、JPEG、WebP、AVIF 与 1x/2x/3x 导出；不支持 Canvas WebP 的浏览器使用本地 Worker/WASM 兜底。
- Chrome/Edge 111+、Firefox 128+、Safari 16.4+ 的声明基线，以及当前/最低浏览器发布门禁。
- 可多实例隔离的内部 React library 构建与独立 consumer 验证。
- 传统 `文件 / 编辑 / 视图 / 帮助` 菜单、项目文件/本机草稿双状态、本地资料库与完整导出面板。
- 上下文本地建议、可重开的快速入门、图层缩略图/拖放/键盘排序，以及移动单菜单、标注 Sheet 和紧凑缩放。
- Tauri 2 桌面壳 PoC：独立桌面入口、main-window 最小 capability/CSP、脱敏环境 IPC、Linux 原生 WebView smoke 和 Web/PWA/library 产物隔离。
- 桌面原生文件/图片剪贴板，以及有界的显示器、窗口、区域截图；固定主屏快捷键、托盘动作与单实例恢复均复用同一编辑器命令层。
- 删除图层/标注、重置图片样式和移除背景改为直接执行并弹出带“撤销”按钮的提示（8 秒内一次点击可恢复；删除后若又有新编辑，旧提示不再生效）。
- 设备区新增 18 款 Devices.css（MIT）机型、35 个配色：素材在构建期从 vendored 的 CSS 渲染为透明 PNG 并随仓库分发，自动量取屏幕矩形与 alpha 掩膜后走既有位图管线；因许可明确，下载前不再需要素材许可确认。MacBook 机身保留上游绘制的型号标签。
- 设备机型素材（可选本地包与 Devices.css 机型）只进入独立站与桌面构建：library 产物替换为空表，嵌入编辑器不显示设备卡片、不携带这些位图，`pnpm audit:pwa:library` 新增 `libraryDeviceAssets` 回归。自绘「简约设备框」矢量形态已移除（旧 `generic*` 与历史 ID 仍按原样渲染）。
- 本地资料库删除草稿（项目）、预设或最近项目记录时，二次确认后同样可撤销一次；草稿连同图片资源、预设连同背景图片一起写回本地存储。
- 桌面新增内部 macOS ARM64 签名候选 workflow：它在受保护 Environment 审批后才导入 Developer ID P12，并验证签名、stapling、Gatekeeper、DMG payload、SBOM 和摘要；当前没有已运行的签名或公证候选。
- 桌面新增独立 macOS Intel 签名候选 workflow：它使用 macos-15-intel、单独的显式确认、包通道和内部 artifact；与 ARM64 共用受保护 Environment 的凭据映射，但两种架构的签名、公证和安装证据互不推导。
- 桌面新增 Windows x64 Authenticode 签名候选 workflow：它在受保护 Environment 审批后临时导入 CurrentUser PFX 证书，按 SHA-256 与 RFC 3161 构建并验证主程序和 NSIS 安装器，保留内部 SBOM、验证输出和摘要；当前没有已运行的签名或时间戳候选。
- 桌面新增独立 Windows ARM64 Authenticode 签名候选 workflow：它固定 `windows-11-arm`、显式 `aarch64-pc-windows-msvc` target、ARM64 SignTool 优先策略和独立 artifact 通道；它与 Windows x64 共用受保护 Environment 的 PFX 凭据边界，但两种架构的签名、时间戳和安装证据互不推导。
- 桌面新增 Linux x64/ARM64 DEB APT 仓库签名候选 workflow：它先构建并复验两种无签名 DEB 输入，再在受保护 Environment 中生成和 OpenPGP 签署 `Release`/`InRelease`，以公开 keyring、`gpgv` 和隔离 `signed-by` APT root 复验；当前没有已运行候选、公开仓库或密钥分发端点。
- 桌面 Linux DEB 候选新增内部客户端信任包和密钥生命周期契约：独立 public-only trust home 导出最小化 `.gpg`/`.asc` keyring，验证 armor 还原，拒绝已撤销、过期、禁用或无效的受信任主键，支持活动键与可选下一把公开键的 30 天重叠，并记录不依赖疑似泄露签名的带外撤销响应；当前没有远端运行、公开 endpoint、客户端 rollout、轮换或撤销演练。
- 五条受保护桌面签名候选新增 GitHub SLSA provenance：签名临时凭据清理后才以固定 `actions/attest` SHA 对已验证的 DMG、NSIS installer 或 Linux DEB/Release/keyring subject 生成 attestation，并把 Sigstore bundle、公开记录和 SHA-256 清单保留为 14 天内部候选证据；当前没有远端 attestation、公开 Release 或下载渠道。
- 五条受保护桌面签名候选新增 provenance verification plan：每份内部候选都包含 checksum 覆盖的本地预检和严格 GitHub CLI 验证参数；显式验证成功后才在候选目录外写本地收据。当前没有远端 attestation、验证收据、公开 Release 或下载渠道。
- 桌面候选验证收据升级为可本地重验证的 schema v2：写入前再次核对候选和离线 trusted root，候选外交接文件以固定文件名原子创建；人工交接或平台验收前可在不联网、不重跑 `gh` 的情况下重新关联当前候选与收据。当前没有远端 attestation、验证收据、公开 Release 或下载渠道。
- 桌面候选新增候选绑定的平台人工验收计划与记录：计划、未执行模板和 evidence 均在候选目录外复核；Linux DEB 仓库候选分别覆盖 x64 与 ARM64。完整人工记录也不会将 `releaseReady` 改为 `true`。
- 桌面候选新增跨候选人工验收汇总：标准本地 bundle 重新关联 macOS ARM64/Intel、Windows x64/ARM64 和 Linux DEB 仓库的五个候选，要求同一 immutable SHA 并覆盖六个实际平台目标；汇总计划和复核始终保持 `releaseReady=false`。
- 桌面候选新增候选外本地发布审查档案：仅在完整跨候选人工验收通过后固定汇总计划与五份平台记录哈希；档案重检会重新验证整个 bundle，始终保持 `releaseReady=false`，也不授权发布或部署。
- 桌面候选新增候选载荷交接清单：它只消费已复核的本地审查档案，重新关联五个候选的 11 个 attested subject 和 SHA-256，并在 bundle 与审查目录外独占写入；清单始终保持 `releaseReady=false`，也不授权发布或部署。
- 桌面候选新增私有 GitHub readiness 预检：固定 numeric repository ID，候选 workflow 与 provenance 验证均先绑定该 ID；只读检查 `main`、Actions policy、三个 signing Environment 和组织 secret scope，任何失败或未验证项保持 `releaseReady=false`。
- 桌面发布信任策略升为 schema v22：所有 workflow 以 SHA-pinned GitHub-owned Action 与仓库内 Corepack pnpm bootstrap 替代第三方 package-manager Action；只读 readiness 预检新增 Enterprise Cloud organization plan 和 selected Actions policy。当前私有组织仍不满足 Enterprise Cloud entitlement，结果保持 `blocked` 与 `releaseReady=false`。
- 桌面发布信任策略升为 schema v24：新增候选外、不可覆盖的公开发布交接文件，将 immutable candidate commit 的 `package.json` 版本、公开源码导出 tree hash、六个 direct-download asset 与五个 APT sidecar 绑定。交接会按提交 blob 重建并审计公开内容，仍固定 `releaseReady=false`；公开 target workflow、Environment、跨仓库身份和实际发布均未配置。
- 桌面发布信任策略升为 schema v23：候选外 publication plan 将六个可直接下载的 macOS/Windows/Linux 安装包与五个必须保持 APT `dists/`/`pool/` 布局的 Linux sidecar 分开，禁止把后者作为 GitHub Release asset。公开源码目标 identity 已只读确认，受保护 publisher、Environment、APT endpoint 和正式发布仍未配置，`releaseReady=false`。

### Added

- 新增可核对的隐私计数器：顶栏常驻「公网发送 0 B」，数字由运行时出口监控统计（fetch/XHR/sendBeacon/WebSocket 的公网请求体字节，外加 Resource Timing 的外部资源加载次数）；检测到发送字节或无法定长的公网请求体时转为告警色，帮助中心与首屏同步显示。

### Changed

- 桌面截图在 Linux Wayland、无显示器和 macOS 未授权时会显示明确边界；macOS 只在用户点击并确认后请求系统屏幕录制权限，候选 Gate 记录权限拒绝与能力契约，不再把未获人工批准的截图写成成功。
- 桌面候选新增非破坏性本地状态标记：未知或损坏标记保留并报告不可用，不读取或重写项目、草稿和 WebView 本地存储；Windows NSIS 明确采用当前用户安装并拒绝 downgrade。安装、升级和卸载仍需六目标人工验收。
- 桌面发布信任策略升为 schema v22：无签名候选继续拒绝凭据、签名、更新、OIDC 和 attestation 权限；macOS ARM64/Intel、Windows x64/ARM64 及 Linux DEB 的受保护签名 job 才获得最小 OIDC/attestation 权限并记录 provenance verification plan。收据、平台验收记录、跨候选汇总、候选外审查档案与 11 个 attested payload 的交接清单都会重新关联当前候选，离线 root 和人工 evidence 可重新哈希；私有候选身份、Enterprise Cloud entitlement、Environment 保护、基础/selected Actions policy、组织 secret scope、GitHub Enterprise Cloud 私有 attestation 可用性、实际签名/公证/时间戳/仓库运行、公开 key 分发和正式发布仍未配置为已完成。
- 独立站快捷键采用传统项目文件语义；`workspace=false` library 继续保留原下载行为。
- 最低浏览器 evidence schema 升至 v2，同一候选同时验证桌面编辑、四格式导出、纯本地请求与移动 Web 核心入口。
- 独立站的 Radix 样式改为按需引入（主题变量 + 组件样式），并在构建期裁掉未使用的调色板与未渲染组件的规则：静态 CSS 从 790 KiB 降到 304 KiB（gzip 99.6 → 49.4 KiB），PWA 预缓存从 3178.5 KiB 降到 2704.8 KiB；整页 753 个元素的计算样式快照与裁剪前逐字节一致，Radix 控件外观不变。
- 库产物自带 Radix 主题变量、组件样式与接入桥接（`radix-bridge.css`），宿主只引 `style.css` 即可，无需安装或引入 Radix；`@radix-ui/react-slider` 归入构建期依赖，公开的宿主契约仍只有 `peerDependencies`。
- 危险操作提示的细节：同类提示互相替换（不再留下点不动的旧提示）、每次删除各自成一步撤销（文案与撤销范围一致）、屏幕阅读器可播报、触屏下撤销按钮满足 44px 目标；资料库删除的撤销会跳过窗口内更新的数据，也不会抢回已被其他项目占用的“当前文件”标记。

### Fixed

- 修复桌面端菜单、尺寸浮层、浏览器地址输入、裁剪弹窗和导出抽屉在 Ant Design layer 样式缺失时无法正常定位或溢出的问题；桌面顶栏不再重复显示网页内的品牌。Tauri 本机 IPC/asset bridge 不再被隐私计数误报为公网发送。
- 独立站的短提示现在由实例级原生计时器关闭，并会在 React StrictMode 模拟的 cleanup/setup 后重新激活；提示不再因通知组件的逐帧更新与编辑器渲染交叉而消失或留下失效状态。
- 独立站切换语言时会在下一次绘制前同步更新文档语言和本地偏好；用户紧接着重载页面时仍会保留刚选择的语言。
- 可撤销操作的提示改用单次到期计时器并保留悬停暂停，避免通知组件的逐帧状态更新与编辑器渲染交叉而在开发控制台报错。
- 外框面板在深浅主题切换的中间帧不再以深色次级文字压在白底上，避免短暂低于 WCAG AA 对比度。
- 顶栏控件被短提示覆盖时，悬停不会再暂停普通提示的倒计时并长期拦截点击；带“撤销”按钮的提示仍会在悬停时保留可操作时间。
- 外框抽屉的选项标签在深色主题下只有 2.1:1 对比度（移动端紧凑面板抽屉渲染在 `--se-*` 作用域之外，固定深灰压不住 antd 的深色浮层）；改用 antd 文本 token，浅色/深色都达标。
- 项目替换/打开失败时的数据保护、当前图片资源安全替换、浮层焦点归还与移动窄屏溢出。
- 颜色控件 ARIA 关系、标注 toolbar/本地上传语义，以及移动菜单 tab 的 44×44 px 触控目标。
- 首屏高负载时菜单命令早于抽屉/文件选择器动作注册而偶发无响应的问题。

### Security

- 本地资源、项目归档、SVG、背景 URL、Service Worker 缓存和公开晋级内容使用 fail-closed 校验。
- 桌面 CI 的 Corepack bootstrap 现在为每个 job 创建随机临时 home，禁用 checkout 中的 `.corepack.env`、last-known-good 查询和 inherited integrity-key override，并把同一隔离 home 传给后续步骤；审计会拒绝 workflow 对 Corepack 安全环境的覆盖。它不运行签名或发布。

[Unreleased]: https://github.com/web-casa/ScreenHello/commits/main
