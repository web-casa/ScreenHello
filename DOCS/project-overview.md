# 项目概览

## 当前状态

桌面 `1.0.4` 首个签名 DMG 已生成，但用户复测暴露生产 CSP 阻止动态样式的问题。本轮将启动背景改为外部 CSS，并增加生产 CSP 弹层回归；构建成功、公证通过不能替代 UI 验收。详见[复测根因更正](./desktop-ui-regression-audit-2026-09-16.md)。以下历史 phase 状态仍仅对各自记录成立。


正式域名 [screenhello.com](https://screenhello.com) 已部署当前发布版本。当前工作树另含[大图压缩下载修复](./compression-download.md)、Web-only 编码器预加载兼容和严格 CSP／原站失联恢复测试；这些改动只在隔离预览验证，尚未部署到正式域名。

公开测试候选 `50702a8` 已通过原生 Chrome／Edge 111、Firefox 128 和 macOS 14 真 Safari 功能矩阵。该证据仅适用于该候选：正式域名仍不是它，跨版本更新、真实目标 HTTPS 和完整发布门仍待完成，不能用本机 WebKit 替代真实 Safari 验收。隔离预览的静态响应、三引擎离线恢复和 18 个原件复核记录见[压缩下载文档](./compression-download.md#隔离-https-预览验收)。

当前工作树的 AVIF 产品边界是仅提供标准导出，不提供压缩、质量或预览入口；旧 AVIF 压缩设置会兼容为相同格式和倍率的标准设置。PNG／JPG／WebP 压缩下载上限为 4,194,304 像素，完整预览上限为 1,048,576 像素，AVIF 标准导出上限为 4,194,304 像素。底层历史格式解析和直接服务接口仍保留兼容，不表示 UI 提供旧选项。

正式部署、缓存验证和仍待补齐的发布证据见 [SEO / GEO](./seo-geo.md)。

## 项目定位

ScreenHello 将本地图片、粘贴图片或屏幕截图放入可配置画布，叠加背景、留白、圆角、阴影、浏览器/设备外框、标注、水印与 HDR 风格处理，最后导出 PNG、JPG、WebP 或 AVIF。产品域名为 `screenhello.com`；`rico-screenshot` 只是 Web P0 前内部 library 的遗留包名。

项目提供以下交付形态：

1. 独立站点：`src/main.jsx` 将 `App` 挂载到 `index.html#root`，由 `pnpm dev` 或 `pnpm build` 使用。
2. React 组件库：`src/index.js` 导出 `ImageBeautifier`，由 `pnpm build:lib` 构建到 `lib/`。
3. 桌面 PoC：`desktop/index.html` 与 `src/desktop/` 复用同一编辑器，`src/platform/desktopPlatform.js` 和 `src-tauri/` 提供 Tauri 2 原生适配；Phase 9.3 已取得三平台自动技术 Gate 证据，当前产物仍为无签名测试包。跨平台 Phase 2 已配置 Linux、macOS、Windows 的 x64/arm64 六目标原生候选，Phase 3 已把 AVIF/WebP/PNG scalar Worker/WASM、严格本地资源协议、CSP 和 runtime evidence 接入 Gate，Phase 4 再把截图权限能力接入，Phase 5 追加非破坏性本地状态标记、Windows current-user/拒绝降级策略和 lifecycle evidence，Phase 6 将当时 schema v7 的签名、公证、更新信任根和 provenance 准备状态接入 Gate，Phase 7 至 Phase 10 依次增加 macOS ARM64、macOS Intel、Windows x64 与 Windows ARM64 的独立签名候选。Phase 11 定义 Linux x64/arm64 无签名 DEB 输入汇总为受保护的 APT `Release`/`InRelease` 签名候选；Phase 12 增加内部客户端 `.gpg`/`.asc` 信任包、可选双键重叠和撤销响应；Phase 13 增加最小 OIDC/GitHub SLSA provenance 和 Sigstore bundle 记录；Phase 14 定义 checksum 覆盖的本地预检/严格 GitHub CLI 验证计划；Phase 15 增加最终候选重检、原子候选外收据和收据的本地关联重验证；Phase 16 增加候选绑定的平台人工验收计划、未执行模板和 evidence 复核；Phase 17 汇总五份受保护候选的人工记录为同一 immutable SHA 的六平台复核；Phase 18 将当前契约升至 schema v19，并在完整复核后把汇总计划与五份 record 哈希固定为候选外本地发布审查档案。PR 跑三项基础 Gate，手动触发跑六项；当前工作树没有新的远端候选、签名、attestation、收据、平台验收或公开发布证据，详见[跨平台桌面 Phase 18](./desktop-cross-platform-phase-18.md)。

Phase 19 将当时契约升至 schema v20：它只在已复核的 Phase 18 档案基础上，重新关联五个候选中的 11 个 attested payload 及其 SHA-256，并把清单写入 bundle 与审查目录之外。清单不改变 `releaseReady=false`，当前仍没有新的远端候选、签名、attestation、收据、平台验收或公开发布证据，详见[跨平台桌面 Phase 19](./desktop-cross-platform-phase-19.md)。

Phase 20 将候选身份固定为 numeric repository ID。Phase 21 将当前契约升至 schema v22：所有 workflow 只保留 SHA-pinned GitHub-owned Action 和仓库内的 Corepack pnpm bootstrap；本地只读 GitHub API 还检查 Enterprise Cloud organization plan、selected Actions policy、固定身份、默认 workflow 权限、分支、三个 signing Environment 和组织 secret scope。2026-09-14 的最新预检确认 organization plan 仍为 Free；当前 token 对固定候选仓库的 repository API 得到 404，所以候选 identity、默认权限、Actions policy、`main`、Environment 与 secret scope 都明确为未验证，不能沿用旧结果。结果仍为 `blocked`、`releaseReady=false`，不读取 secret 值，也不触发签名或发布。详见[跨平台桌面 Phase 21](./desktop-cross-platform-phase-21.md)。

Phase 22 在不改变当时 schema v22 或远端状态的前提下，进一步把 Corepack 下载 cache 和环境读取限制在每个 CI job 的随机临时目录：它禁用 checkout 中的 `.corepack.env`，清除 inherited integrity-key override，并拒绝 workflow 级 Corepack 覆盖。

Phase 23 将当前契约升至 schema v23：它以只读确认的公开目标 `web-casa/ScreenHello`（repository ID `1353846676`）为后续 direct-download 目标，但不配置 publisher。候选外计划将两个 macOS DMG、两个 Windows installer 和两个 DEB 划为六个 GitHub Release 直链安装包；Linux `Release`/`InRelease`/签名/keyring 五个 sidecar 必须等待保留 `dists/`/`pool/` 布局的独立 HTTPS endpoint，禁止作为 Release asset。当前完整边界见[跨平台桌面 Phase 23](./desktop-cross-platform-phase-23.md)。

Phase 24 将当前契约升至 schema v24：它把 Phase 23 的六个 direct-download asset、五个 APT sidecar 和清单 SHA-256，与同一 immutable candidate commit 的 `package.json` 版本及公开源码导出 `treeSha256` 绑定为候选外、不可覆盖交接文件。快照只读取提交 blob，并复用公开仓审计拒绝预置生成标记、私有内容和失效引用；公开 `main` 仍须在未来受保护 publisher 中重建并精确匹配该快照。当前完整边界见[跨平台桌面 Phase 24](./desktop-cross-platform-phase-24.md)。

macOS ARM64、macOS Intel、Windows x64、Windows ARM64 和 Linux DEB 仓库的候选均为手动、私有 `main`、显式确认的独立链路。macOS 两条链路共用 `macos-signing` Environment；Windows 两条链路共用 `windows-signing` Environment 和临时 CurrentUser 证书库导入，ARM64 链路固定 `windows-11-arm` 与 `aarch64-pc-windows-msvc`；Linux 链路在 `linux-repository-signing` Environment 中对 x64/arm64 DEB 输入的 APT 元数据签名，并只输出内部信任包。五条签名 job 在清理临时凭据后定义 GitHub SLSA provenance、本地 Sigstore bundle 记录和 checksum 覆盖的验证计划；下载后只能先做本地预检，再由人工显式运行严格 GitHub CLI 验证，交接或人工验收前重新关联候选和候选外收据，并按各目标生成/复核人工验收记录。Phase 17 要求在同一个标准 bundle 内复核五份记录、六个实际目标和同一 immutable SHA；Phase 18 只在全部人工项通过后于 bundle 外固定当前汇总计划和记录哈希。它们都尚未远端运行；当前没有签名、公证、时间戳、真实安装、attestation、收据、平台验收、公开 key 分发或公开发布证据，详见[跨平台桌面 Phase 18](./desktop-cross-platform-phase-18.md)。

Phase 19 再把已复核的 Phase 18 档案关联到五个候选、11 个 attested subject 的相对路径、字节数和 SHA-256；它不替代任何远端或人工证据，也不配置受保护公开发布 workflow。Phase 20 进一步把候选身份绑定到 repository ID，并在签名前执行只读配置预检。Phase 21 固定 Enterprise Cloud entitlement 与 selected Actions supply-chain policy；Phase 22 再隔离 Corepack cache 与项目环境读取；Phase 23 把六个 direct-download installer 与五个 Linux APT sidecar 固定为不同的后续发布角色；Phase 24 最后将这些载荷绑定到 immutable candidate commit 的公开源码快照。当前完整边界见[跨平台桌面 Phase 24](./desktop-cross-platform-phase-24.md)。

## 已实现能力

- Web-only 七语静态产品/美化/外框/压缩/指南/隐私页面（42 页），由独立的 Fumadocs 文档站（`docs-site/`）生成在 `/docs/{locale}/{topic}/`；旧的 `/{locale}/{topic}/` 全部 301 到新地址。保留根编辑器及本地草稿，PWA 导航回退仅限编辑器根入口。静态内容页不运行编辑器，也不属于首次离线缓存。实现、CSP hash 与上线边界见 [SEO / GEO](./seo-geo.md)。

- 通过文件选择、拖放、剪贴板粘贴、屏幕捕获或内置示例导入图片。青绿色“试用示例”按点击时页面宽度加载手机（<768px）或 PC/平板（≥768px）本地网页截图，初始页不下载示例原图。初始页中央图片图标和“选择图片”按钮共用同一文件选择入口；整个欢迎工作区接收拖放，图标支持键盘激活与焦点提示。
- 自适应画布、自定义尺寸，以及 Instagram、X、YouTube、Pinterest 等尺寸预设。
- 缩放、裁剪、水平/垂直翻转和九宫格对齐。
- 图片留白、留白颜色、圆角、阴影和整体缩放。
- 独立内描边，可与基础、浏览器或设备外框组合使用。
- 纯色、代码原生渐变和上传本地图片背景；旧 `gh_img_*` 项目 token 自动解析为代码渐变。
- 基础/创意外框与可配置 URL、顶部尺寸的代码原生浏览器框。简约矢量设备已从新建和推荐移除，旧项目仍按原 ID/几何渲染和导出，不静默换成品牌图。
- 初始页左栏直接展示浏览器和可用设备两组快捷卡片，下方“更多外框”进入完整列表；支持先选设备/配色再导图，当前可用设备与颜色在快捷区保持可见。快捷区只使用已安装素材，缺包不显示空区或失效选项。
- 可选本地设备包新增 MacBook Air M2 四色、现代 iMac 24″ 五色与 Pixel 9 Pro；型号单卡、型号内切色，支持撤销及七语。保留 Surface Studio / Surface Pro、MacBook Pro / iPad / iPhone；旧 Air/iMac 位图仍可恢复，安装新款时退出新建列表。Pixel 为 MIT SVG 的透明 PNG 衍生图，非摄影素材；界面保留素材来源，但不重复展示“授权尚待核实”段落，不附加导出底部文字。素材包不进入公开源码，缺包保留项目 ID 并阻止不完整导出；本地构建含包不等于可公开分发。详见 [设备框](./raster-device-frames.md)。
- 可导出的平面旋转、缩放和位置偏移，并纳入项目级撤销/重做。
- 矩形、实心矩形、圆形、直线、箭头、自由画笔、局部放大镜、步骤编号和 Emoji 标注。
- 重复文字水印，可切换到截图下方；浏览器 Canvas 实现的 HDR 风格增强。
- PNG/JPG/WebP/AVIF 导出，1x/2x/3x 像素倍率，以及 PNG 剪贴板复制；AVIF 通过按需 module Worker/WASM 纯本地编码，WebP 在 Canvas 无原生编码能力时使用按需本地 Worker/WASM 回退，实例级导出服务统一处理串行、取消、尺寸/MIME 校验和 Canvas 释放。
- 导出压缩支持 PNG 无损/调色板有损、WebP 真无损和有损质量设置；完整面板提供手动预览、真实大小、标准参照/结果切换、100% 查看、浅深透明底及同 Blob 下载。完整画面就绪、过期结果与系统交付后的偏好提交由实例内核保护。默认质量不变；压缩下载最多 4,194,304 像素、完整预览最多 1,048,576 像素，当前本地修复及验收见 [CD 大图修复](./compression-download.md)，交互说明见 [C2](./export-compression-c2.md)。[C3](./export-compression-c3.md) 已接通存档/预设设置往返与批量完整参数，重试复用已解析风格/背景快照，原预设删除或背景 URL 释放不改变原批次。
- 独立站支持 1～12 张本地图片套用当前风格或本地预设，逐张隔离渲染并下载一个仅含成功项的安全 ZIP；支持单项失败隔离、取消与失败项重试。
- 亮色/暗色主题、画布缩放与快捷键。
- 品牌标识统一来自 `src/assets/logo.svg`：顶栏、欢迎页、画布浏览器图标和桌面图标沿用本地可复现衍生流程；Web favicon/Apple Touch/普通 PWA 图标采用用户提供、SHA-256 固定的 RealFaviconGenerator 衍生包，保留现有安全区 maskable 图标和唯一 manifest。详见 [品牌图标维护](./development.md#品牌图标)。桌面资源更新不代表已有安装包已重建或发布。
- 独立站通过 IndexedDB 自动保存和恢复草稿；组件库默认关闭，可用 `persistence` 显式开启。
- 独立站桌面/平板提供“文件 / 编辑 / 视图 / 帮助”传统菜单和项目/草稿双状态；`.screenhello` 项目动作位于文件菜单，本地资料库以四个 Tabs 管理最多 12 个最近项目、草稿、预设和存储。
- 独立站移动端提供菜单、项目状态与导出入口，右侧另有紧凑主题/语言按钮；同一组命令通过四个 Tabs 呈现，标注按主工具/更多工具/样式分组，缩放保留放大、缩小、100% 和适应画布。核心触控目标至少 44 px，并适配 safe-area、动态视口及 PWA 状态卡避让。
- 完整风格预设支持本地保存、应用、复制、重命名、删除和 `.screenhello-preset` 导入/导出。
- 图片边缘色、内描边和横竖图外框建议完全在本地生成，分别显示在背景、内描边和外框控制区，只在用户点击后应用并进入历史。
- 同一页面可挂载多个互相隔离的编辑器；图片、选项、历史、主题、草稿服务、Leafer App 和运行时资源按实例拥有。
- 顶栏隐私计数按页面级运行时出口监控显示已知公网发送字节、公网请求和仅接收的外部资源加载；Tauri IPC/asset bridge 与回环地址不计为公网，线上 HTTPS 同源 API 发送会计入。仅接收资源和零正文请求不触发“上传”告警；流式或 multipart 请求体显示已知字节下界与无法确定提示，WebSocket 同时统计连接和成功发送。
- 新增 25 张[内置图片背景](./preset-backgrounds.md)（三张自然风景 + 22 张抽象纹理），按需读取同源资源，随项目/预设/草稿保存。旧渐变 token 与默认背景保持不变。
- ProjectDocument v2 多图片画布；图层面板复用本地资源显示缩略图、选择摘要和锁定/编组状态，并支持拖放、Alt+方向键及置顶/上移/下移/置底按钮；选择/多选、移动/缩放/旋转、复制/删除、对齐/吸附/等间距及堆叠/扇形布局保持可撤销。
- 多图项目、最近项目和自动草稿可完整恢复；V1 单图项目按旧几何无损迁移。
- 每个 runtime 有独立命令编排层；项目文件/自动草稿双状态、三选一替换保护、可撤销的“替换当前图片”、四组菜单、视图显隐、帮助中心和确认式导出均已接入。
- 首屏使用 Ambient Shelf 布局：中性背景、局部光晕插图与选图/截屏操作行；空态不再铺满当前项目背景，导入后的背景配置不变。保留整区拖放、按平台显示的粘贴快捷键、深浅主题和窄屏换行；独立站另提供示例、本地处理说明与快速入门，示例原图仍只在用户点击后读取。装饰图随核心 PWA 资源缓存，不依赖外部素材服务。
- 独立站提供 Web-only PWA：可安装 manifest、经激活确认的核心 app-shell 预缓存、同源哈希重资源按需缓存，以及 dirty/busy 更新保护；library 入口不导入或注册 PWA。
- Tauri 2 桌面入口独立输出到 `dist-desktop`，不注册 PWA；main-window capability 只允许 16 个有界 application command、PNG image resource 与图片剪贴板写入。截图能力只公开有限 backend/status，不公开显示器、会话、路径、PID 或原生窗口 ID；本地状态 command 只公开 schema/status，不公开路径、标记内容、上次版本或错误。Wayland 目前明确拒绝至 Portal 集成，macOS 系统授权只由显式点击触发。原生项目打开/保存、图片导入/导出、显示器/窗口/区域截图、主屏快捷键、托盘和单实例均复用既有命令与编辑器；第二实例参数不进入 WebView。区域 PNG 截图/导入及图片剪贴板已在 Linux aarch64/WebKitGTK 真实窗口验证。

- 应用 UI 已接入实例级英文、简体中文、繁体中文（zh-TW）、德语、韩语、西班牙语和葡萄牙语（pt-PT）与 `locale/messages` API。右上角提供 Light/Dark 和语言菜单，独立站在本机记忆选择；七语词典与 Ant Design 文案同步且离线可用。用户内容与旧存档不改写，Emoji 英文选择器/数据和 OS 系统按钮不纳入自有翻译。桌面 Rust 原生提示/托盘仍是简中/英文，新增五语暂回退英文；新增词典仍待母语校对。

## 尚未完成或未接入

- 编辑器不再提供AVIF压缩预览，下载不依赖浏览器原生AVIF解码能力；仍使用本地Worker/WASM标准编码，不自动换格式，不加载生产WASM decoder。旧预览能力探测工具仅为底层兼容保留；当前边界见[压缩下载](./compression-download.md)。

- 当前恢复保护、截图授权及语言修复尚未取得新候选的远端浏览器/桌面矩阵，不能继承历史 Gate。
- macOS ARM64/Intel、Windows x64/ARM64 和 Linux DEB 仓库签名候选 workflow 已定义但尚未远端运行；当前 GitHub Free organization 不满足私有分支保护、受审批 Environment 与私有 artifact attestation 的 Enterprise Cloud 前提。Environment 审批、组织 secret 范围、Apple 公证或 Authenticode/RFC 3161 时间戳、真实 attestation、安装和权限验收均不能由静态审计替代。
- 导出压缩 C4 已完成 Web 本地复验；桌面 WASM、截图能力/权限边界、状态标记、构建资产检查、签名信任准备、候选 provenance、最终本地重检、候选外收据重验证、候选绑定人工验收记录、同 SHA 跨候选复核、候选外发布审查档案、11 个 attested payload 的交接清单、私有候选身份/Enterprise Cloud/远端配置预检、GitHub-owned Actions supply-chain、每 job 隔离的 Corepack home、Tauri runtime smoke、六个 direct-download installer、五个 APT sidecar 及 candidate commit 公开源码快照交接已接入候选 Gate，但当前工作树没有六目标远端或实机人工证据，不能标记为已支持。具体边界见 [跨平台桌面 Phase 24](./desktop-cross-platform-phase-24.md)。

- 文本美化、代码美化和 GIF：当前不提供入口，仍不属于可用功能。
- 自动化测试：已接入 Vitest 单元测试、Playwright 当前三引擎 smoke/E2E、移动响应式/axe/PWA、Chromium visual/export golden 和 library consumer smoke；Phase 8.5.5 指定候选已通过浏览器矩阵，但之后的源码修改不能继承旧 SHA 验收。
- 服务端能力：没有 API、数据库、账户系统或上传服务。
- 桌面 Phase 9.3 已验证 Windows x64、macOS 14 ARM64、Linux x64 的自动 runtime、DEB/APP/NSIS 构建、包内结构与 SBOM/摘要。真机权限、多显示器/DPI/负坐标、Wayland、远程桌面、无显示器、原生文件对话框视觉、安装升级/卸载、更新、签名与公证仍待后续验证；技术 Gate 通过不代表桌面 MVP 可正式发布。Linux 中文环境需系统 CJK 字库。
- 跨平台桌面 Phase 2 已配置 Linux arm64、macOS Intel 和 Windows arm64 的原生候选目标；Phase 3 已将三种 codec、Phase 4 已将有限截图能力与权限边界、Phase 5 已将状态迁移与安装生命周期人工项、Phase 6 已将无签名候选隔离与正式发布信任前提加入所有候选，但所有六项当前都尚无本工作树对应 SHA 的远端构建、运行、安装或签名证据，不能标记为已支持。最低 Linux 构建/运行、Wayland Portal、安装生命周期与发布信任边界见[跨平台桌面 Phase 6](./desktop-cross-platform-phase-6.md)。
- Web Release Gate：Phase 8.5 候选 `76035d8004d556771ce327e234811cee94313917` 的原生 amd64 Chrome/Edge 111、Firefox 128 与 `macos-14` Safari 矩阵已通过（含移动链路）。产品仍声明 Safari 16.4+，但当前策略不精确重放历史 16.4。Phase 8 首次公开仓晋级已完成，Phase 8.5 和桌面候选已进入独立 Draft PR，尚未合并公开 main；没有正式 tag/Release、部署或 npm 发布。后续修改需要自己的验收记录，不能继承旧 SHA 的通过状态。详见 [Web Release Gate](./web-release-gate.md)。

## 技术栈

| 类别 | 选型 | 用途 |
| --- | --- | --- |
| UI 框架 | React 19.2.8 | 组件与生命周期；Compiler 未启用 |
| 构建 | Vite 8.2.2、Rolldown、Oxc | 开发服务器、站点/库构建 |
| 文档站 | Astro 7.3.2、Fumadocs 16.15.9、fumadocs-ui | 公开七语文档站 `/docs/*` 的静态生成、侧边栏与搜索壳 |
| 状态 | MobX 7.0.3、mobx-react-lite 5.0.3 | 编辑器与美化选项的响应式状态 |
| 画布 | LeaferJS 2.2.9 及插件 | 图层、选择器、缩放、拖拽、导出 |
| 组件库 | Ant Design 6.6.2、cssinjs 2.1.2 | 按钮、抽屉、弹层、滑块、消息等 |
| 样式 | Tailwind CSS 4.3.3、CSS | Vite plugin、布局、主题、局部组件样式 |
| 图片裁剪 | CropperJS、react-cropper | 裁剪弹窗 |
| 图标/Emoji | mage-icons-react、自绘 SVG、Emoji Mart | 工具栏与 Emoji 选择器 |
| 工具 | lodash、nanoid、tinykeys | 防抖、ID、快捷键等 |
| 项目与批量容器 | fflate 0.8.3 | `.screenhello` / `.screenhello-preset` 编解码与批量导出 ZIP |
| AVIF 编码 | @jsquash/avif 2.1.1 | scalar Worker/WASM 按需本地编码；不启用线程入口 |
| WebP 回退编码 | @jsquash/webp 1.5.0 | Canvas 不返回 `image/webp` 时按需启用 scalar Worker/WASM；原生支持浏览器不加载 |
| PWA | vite-plugin-pwa 1.3.0、Workbox 7.4.1 | Web-only manifest、Service Worker、安装/更新生命周期与分层离线缓存 |
| 类型与质量 | TypeScript 5.9 checkJs、Vitest 4.1.11、Playwright 1.62.1 | 公共类型、单元、当前浏览器、golden 与 tarball consumer |
| 发布验证 | axe-core 4.13、Selenium WebDriver 4.48 | 当前引擎 WCAG/本地优先检查与精确最低版本证据采集；不进入运行时产物 |
| 桌面 PoC | Tauri API 2.11.1、CLI 2.11.4、Rust tauri 2.11.5、dialog 2.7.3、clipboard-manager 2.3.3、global-shortcut 2.3.2、single-instance 2.4.4、xcap 0.9.8 | 独立 WebView 壳、token 化原生文件/截图、图片剪贴板、固定系统入口、最小 capability/CSP 与原生 IPC smoke |

## 目录职责

```text
.
├─ DOCS/                         项目维护文档
├─ desktop/                      Tauri 专用 HTML 入口
├─ .github/workflows/ci.yml      Node 24 / pnpm 10 CI 验证
├─ config/                       Web PWA manifest、预缓存与 runtime cache 策略
├─ scripts/                      构建体积、PWA/library 边界与许可证审计
├─ tests/                        unit、E2E、PWA、fixture 与 library consumer
├─ src/
│  ├─ assets/                    品牌/示例图与可再分发 SVG 界面资源
│  ├─ components/
│  │  ├─ batch/                  批量面板与隔离 Leafer renderer
│  │  ├─ editor/                 LeaferJS 画布、缩放、快捷键与图层
│  │  ├─ header/                 应用菜单、项目状态、帮助与顶栏
│  │  ├─ init/                   未导入图片时的初始页
│  │  ├─ sideBar/                尺寸、外观、背景、水印与完整导出面板
│  │  └─ workspace/              最近项目、预设、草稿与存储资料库 UI
│  ├─ hooks/                     图片载入、粘贴、实例级快捷键
│  ├─ platform/                  浏览器/桌面文件、存储、剪贴板、捕获与导出能力边界
│  ├─ pwa/                       Web-only 安装、离线就绪与安全更新 UI
│  ├─ stores/                    MobX 实例级 root store、Provider 与持久化服务
│  ├─ style/                     Tailwind 入口和项目 CSS
│  ├─ desktop/                   Tauri React bootstrap、IPC schema 与状态 UI
│  ├─ utils/                     配置、项目文档、历史、图像/SVG 与截屏工具
│  ├─ workers/                   按需加载的 AVIF scalar module Worker
│  ├─ App.jsx                    可嵌入的顶层组件
│  ├─ index.js                   组件库导出入口
│  └─ main.jsx                   独立站点入口
├─ index.html                    ScreenHello 独立站点页面与 SEO
├─ src-tauri/                    Tauri 2 Rust 壳、capability、配置与 Cargo lock
├─ vite.config.js                路径别名及站点/库双构建配置
├─ vitest.config.js              单元测试配置
├─ playwright.config.js          当前浏览器与 E2E 配置
└─ package.json                  脚本、依赖和 npm 包元数据
```

## 外部依赖与运行条件

- 默认首屏和核心编辑链路只使用可再分发的仓库内资源、代码原生渐变/矢量图形和系统字体，不依赖外部素材服务。
- 屏幕捕获依赖 `navigator.mediaDevices.getDisplayMedia()`。
- Web 剪贴板复制依赖 `navigator.clipboard.write()` 和 `ClipboardItem`；Tauri 入口使用只获准写图片的 clipboard plugin，并显式释放 PNG image resource。
- 取色器仅在实现 `window.EyeDropper` 的浏览器显示。
- 上述屏幕、剪贴板类 API 通常要求 HTTPS 或 localhost，并受浏览器权限控制。
- Service Worker/PWA 同样要求 HTTPS 或 localhost；部署必须按构建 base path 原样托管 `manifest.webmanifest`、`sw.js`、Workbox runtime 和哈希资源，并为 manifest、JavaScript、WASM 返回正确 MIME。`sw.js` 应允许重新验证，哈希资源可长期 immutable 缓存。
- 子路径部署用 `SCREENHELLO_BASE_PATH=/目标路径/ pnpm build`，manifest 的 `start_url/scope`、HTML 引用、Service Worker scope 与静态资源路径会保持一致。CSP 至少需允许本站脚本、Worker、manifest/资源请求和现有 `blob:` 图片/Worker 路径；部署前应运行 production PWA 测试，不可只验证开发服务器。
- Web 项目文件增强保存依赖 File System Access；能力不存在或未授权时自动退回文件选择和下载。Tauri 原生文件只向 WebView 返回 owner-scoped 不透明 token、文件名、MIME 和大小，真实路径留在 Rust backend，并在同目录临时文件完整落盘后原子替换。
- 普通格式单次导出限制为单边 8192 px、总计 16,777,216 像素；AVIF 另限制为 4,194,304 像素。超过限制会在创建全尺寸 Canvas 前失败。完整基准见 [Phase 7 Web P2](./phase-7-web-p2.md)。

公开文档站提供按当前语言正文搜索、桌面和移动端本页目录、保留语言的编辑器入口及入门操作截图。导航按主题组织，页尾统一使用上一篇／下一篇；内容与界面翻译均由 `site/content/*.json` 生成。
