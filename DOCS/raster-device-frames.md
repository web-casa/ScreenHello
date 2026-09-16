# 可选真实位图设备框

## 实现与分发范围

2026-09-08 更新：拥有者已确认本次清单中的全部素材用于 ScreenHello 公开 Web 部署没有问题，并要求记录。该项目方确认已写入[素材声明](../ASSET_PROVENANCE.md)，包括本页全部已安装设备及其配色；此前“尚未获准公开”的记录不再表示缺少拥有者对网站使用的确认。原作者许可的独立核验状态、来源与版权仍如实保留，不将未知许可改成 MIT。本次确认不扩展到素材单独再分发、公开源码包或 library/桌面包，也不代表已部署或通过其他发布门槛。

当前本地工作区的设备区包含 Surface Studio、Surface Pro、MacBook Pro、MacBook Air M2（四色）、iMac 24″（五色）、iPad、iPhone、Pixel 9 Pro。每个型号一张卡片，颜色在型号内选择。Surface Pro 仅简化显示名称，底层素材仍为 Pro 8、内部 ID 仍是 `surface-pro-8`，不改成其他代际。公开代码默认不包含这个第三方素材包；公开发布与原作者授权确认仍是独立事项。

历史五款原 PNG 的 ID 为 `macbook-pro-bitmap`、`macbook-air-bitmap`、`imac-bitmap`、`ipad-bitmap`、`iphone-bitmap`，不是把简笔画另存位图。新 Air/iMac 安装时，仅隐藏对应历史型号的新建入口；旧项目继续渲染原图。原 `generic*` 与 `macbookpro16/macbookair/imacpro/ipadpro/iphonepro` 继续保持原先矢量含义，已有项目不会静默换机身；这些矢量已从新建/推荐移除，加载旧项目显示兼容说明，仍可导出及撤销更换。

新变体为 `macbook-air-m2-{silver,starlight,space-gray,midnight}-v1`、`imac-24-{blue,orange,purple,red,silver}-v1`、`pixel-9-pro-original-v1`。Air 银色不是白色；iMac 是现代五色素材，不是 M4 七色，源名 red 在 UI 简称“红色”（七语同步），不修改素材颜色、色点或存档 ID。Pixel 是 telephone 精细 SVG 去除模拟状态栏后的 PNG，保留挖孔、按钮和机身渐变，不冒充摄影图片或标准 Pixel 9。

`local-device-assets/` 受 Git 忽略规则保护，不在公开仓导出清单内。Surface 包含 `<id>.png` 透明机身和 `<id>-screen.png` 屏幕 alpha：Studio 1440×1257，Pro 8 1440×1160。五款历史 PNG 保留原始字节和尺寸，以 `macbook-pro.png`、`macbook-air.png`、`imac.png`、`ipad.png`、`iphone.png` 安装；渲染时最长边最多 1440 px，不另行分发生成的屏幕遮罩。文件缺失时，构建仍可运行，但不显示该设备的新建选项。打开已有设备项目时保留原 ID，不静默改成无外框；缺失或失败的位图效果会阻止图片导出。

本地安装包会进入此工作区生成的 Web/library 构建产物。公开网站使用已取得上述拥有者确认，但不能因此把任意本地产物视为已通过发布验收的版本；正式 Web 仍须遵循既定发布来源与构建审计。公开源码和 library 构建继续从不含素材包的清洁副本生成。原 PSD 不参与编辑器构建或项目存档。来源与许可见 [素材声明](../ASSET_PROVENANCE.md) 和 [第三方声明](../THIRD_PARTY_NOTICES.md)。

## Devices.css 机型（提交进仓库，MIT）

2026-09-11 起设备区还包含 18 款来自 [Devices.css](https://github.com/picturepan2/devices.css)
（MIT，Yan Zhu）的机型：iPhone 14 Pro / 14 / X / 8、Google Pixel 6 Pro / Pixel / Pixel 2 XL、
Samsung Galaxy S8、iPad Pro / iPad Pro (2017)、MacBook Pro (2018) / MacBook Pro / MacBook、
iMac、Pro Display XDR、Surface Book、Apple Watch Ultra / Series 8，共 35 个配色变体。

- 与上面那些“可选本地包”不同，这一族由 `scripts/generate-devicescss-assets.mjs`
  在构建期从 vendored 的 `vendor/devices.css/devices.css` 渲染成 PNG 并**提交进仓库**
  （MIT 允许再分发），因此任何构建都自带、离线可用，不需要额外素材包。
- 每款配色包含：机身 PNG、缩略图、以及每机型一份的屏幕 alpha 掩膜（与机身同尺寸）。
  屏幕矩形与圆角由脚本从 DOM 量取后写进 `src/assets/devicescss/manifest.json`，
  不是人工标四角；`src/utils/devicesCssConfig.js` 把它并进现有的位图设备表。
- 机身最长边 ≤1440 px、缩略图 ≤320 px；导出仍走既有位图管线（投影 + 掩膜裁剪 + Worker 合成），
  3x 导出是在该位图上放大，不增加源细节。
- 许可状态明确为 MIT，因此下载前**不弹**素材许可说明（`deviceLicenseService` 对 MIT 直接放行）；
  侧栏仍显示作者、素材来源与完整许可链接。型号名按上游样式表原样使用（含 MacBook 机身上的标签），
  属于描述性的指名使用。详见 [素材声明](../ASSET_PROVENANCE.md) 与
  [第三方声明](../THIRD_PARTY_NOTICES.md)。
- 体积：站点 PWA 不预缓存这些 PNG（只有核心图标/首屏资源进 precache，设备走按需运行时缓存），
  预缓存仍是 54 项 / 约 2.75 MiB。
- **library 产物不含这一族**：`config/libraryDeviceBoundaryPlugin.mjs` 在 lib 构建里把
  `devicesCssConfig` 替换成空表，`lib/assets` 因此没有 devicescss PNG（`pnpm audit:pwa:library`
  会以 `library-device-assets-bundled` 失败做回归）。宿主侧表现为“没有这些机型卡片”，
  与缺少可选本地素材包时的降级一致；站点与桌面构建照常包含。

## 使用

初始页左侧“外框”直接展示 4 个浏览器快捷选项（包含“无外框”）和最多 4 个已安装的设备型号；设备优先为 MacBook Air M2、iMac 24″、Surface Pro、Pixel 9 Pro，缺少时由其他可用型号补位。下方“更多外框”打开完整基础、创意、浏览器与设备列表。无素材包时不显示空设备区或失效卡片；移动端从“菜单 → 视图 → 显示尺寸与外框”打开同一面板。

可以先选设备及配色，再导入图片；导入不清除已选外框。从完整列表选择其他可用浏览器/设备后，该选项会出现在快捷区，当前设备卡片反映当前颜色。快捷列表最多各 4 项，不产生额外历史或改写旧项目 ID。

设备缩略图使用透明底色，暗色模式下沿 PNG 透明轮廓增加轻微白色投影，浅色模式不加投影。该样式仅作用于快捷区和完整列表，并跟随各实例的主题（包括移动抽屉）；不改变原素材、画布设备效果或导出图片。

缩略图与画布使用同一真实机身。支持覆盖、包含和拉伸；包含模式的余白使用当前图片留白颜色。图片留白、内描边、圆角、翻转与 HDR 在屏幕贴合前处理；整体缩放、平移和旋转沿用图片图层操作。机身比例决定选框，不随导入图片的横竖比例变形。

型号内配色在侧栏和选择抽屉都可操作：原生单选控件、文字/色点/选中描边、方向键切换、至少 44 px 命中区；每个实例的控件 ID/name 独立。首次选择 Air 为银色、iMac 为蓝色（缺少默认色时取首个已安装色），当前型号卡片反映已选颜色。切色沿用项目级 `option.frame`，产生一步历史，不另加存档字段或改变背景/导出设置。切换到其他型号后再选回来，当前版本使用该型号首个可用色；跨型号记忆上次成功色及设备子分类仍是后续体验项，不宣称已实现。

设备图层进入正式 Leafer 树，因此参与最终导出、底图快照/放大镜、项目历史和批量渲染。导出不写入底部署名、文字衬底或试验页留白。

Surface 及 Monkr 图在每次图片下载、压缩预览结果下载、图片剪贴板交付和批量 ZIP 下载前，显示当前输出对应素材的来源，已知时提供作者和完整许可链接。取消/Escape 不交付文件；许可确认不跨实例共享或永久记忆。历史 Shoteasy 五款位图按用户要求不再弹素材许可说明；Pixel 也维持无强制弹窗。两类仍受缺包/取消/销毁检查，不自动确认其他来源的待处理弹窗。压缩预览继续交付已生成的同一 Blob；批量使用开始时冻结的具体颜色，不受后来切换当前编辑器影响。内部离屏渲染、项目保存与像素预览不弹下载提示。

五款历史素材的原作者和具体授权尚未核实：这一状态保留在素材注册表与来源文档中。侧栏、设备抽屉不显示“原作者及具体授权尚待核实”段落，仍保留来源；不伪造“完整许可”链接，也不把 Shoteasy 的代码 MIT 当作图像授权。本次取消这五款的交付弹窗，不改变素材许可状态、缺图拒绝或公开分发边界。

Monkr 的九张 Air/iMac 同样在注册表与文档中保留未核实状态，界面不再重复提示。Apple 官方 M4 七色包没有接入。新机身独立规范化为最长边 ≤1440 px PNG（Air 1440×936、iMac 1440×1215、Pixel 682×1440），每色另有最长边 ≤320 px 缩略图；不在正式编辑器执行 SVG/第三方 Web Component，也不以滤镜伪造配色。

项目、预设和草稿只记录设备 ID 与原有风格参数，不嵌入第三方机身 PNG 或许可同意状态。迁移到没有素材包的安装环境需要另行准备相同素材，或选择其他外框后导出。

## 技术与限制

- `rasterDeviceConfig.js` 用静态 Vite glob 导入本地资产 URL，缺包得到空集合；不自动请求第三方网站。普通编辑不解码设备 PNG，也不加载投影 Worker。
- 宿主 `defaultImg` 的远程 URL 沿用原有匿名 CORS 契约，设备合成的二次解码也设置 `crossOrigin`；服务器仍须允许跨域，不能绕过其 CORS 限制。
- `deviceProjection.js` 复用本地试验已验证的逆单应性与双线性采样。Studio 屏幕源比例为 4500:3000，Pro 8 为 3302:2074；使用精确四角，不用 CSS 假透视。
- Surface 沿用 PSD 四角和 alpha。五款历史机身在 Worker 中从中心透明像素提取闭合屏幕连通域，保留圆角、刘海和悬浮挖孔；若透明区泄漏到机身外缘则拒绝导出。用户内容画在原机身下方，不覆盖真实不透明材质。
- `renderRasterDevice.js` 的机身和屏幕合成最长边最多 1440 px。Worker 输入/输出单边不超过 2048、各不超过 300 万像素；加载/投影/编码均有超时。处理源机身的临时 Canvas 取像素后立即释放；更高导出倍率扩大合成位图，不宣称增加源素材细节。
- 每个图片效果有独立 AbortController、Blob URL、Canvas 与错误状态；同一 runtime 复用已有图片处理队列串行计算。切换/卸载取消旧任务，URL 与画布按所有权释放；RenderTaskTracker 等待完整结果后才允许导出。
- 设备资产/Worker 是同源哈希资源，Web PWA 沿用已有按需缓存策略，不加入首屏预缓存。未使用过的设备在离线时可能尚不可用；失败时不会导出缺失机身的图片。
- 本轮不改变公共组件 props、项目版本、原导出格式/倍率或快捷键。新 UI 文案覆盖七语；第三方名称与许可原文不机器改写。
- 真实 Safari 最低版本、原生桌面 WebView 与公开发布不由当前浏览器测试代替。

## 验证

### Shoteasy 交付不弹窗（2026-09-08，本地）

仅注册表 `sourceProject: Shoteasy` 的五款历史位图免弹窗，不按作者显示文案或所有 `unverified` 状态一概放行。共享 DeviceLicenseService 覆盖普通下载、预览结果交付、剪贴板和冻结批量。出处与许可记录保留；Surface/Monkr 仍要求原有确认。该交互修改未部署，不改变大图压缩修复的 WebKit 性能 HOLD。

- 验证通过：lint/typecheck、47 files / 488 unit、Web/library 构建；保留既有大 chunk 警告。
- 当前三引擎真实设备回归 45/45，通过单图及冻结批量免弹窗、其他来源仍需确认、来源元数据保留、多实例隔离、透明 PNG/倍率/尺寸及 JPG/WebP 白底等检查。
- consumer 开发/生产各 15/15、设备离线 PWA 专项 4/4 通过；相关 diff whitespace 检查通过。未重跑全产品 E2E/全量 PWA、最低浏览器或原生桌面矩阵，未提交、推送或部署。用户中断期间测试正常完成，恢复后复核退出码均为 0。
- 代码审查保持缺包、已取消和已销毁请求先校验，不将免弹窗视为自动同意其他素材，也不改变素材许可元数据。

### 透明缩略图与红色简称（历史）

2026-09-07，设备选择器去除灰白底块，暗色主题采用沿 PNG alpha 的轻微白色投影；仅调整 UI，不修改原图或导出内核。主题由各 runtime 提供，移动抽屉不依赖全局主题选择器。red 的七语显示名简化，ID/色点/素材不变。

- `pnpm lint`、`pnpm typecheck`、46 files / 454 unit、i18n 617 keys、Web/library 双构建通过；保留原有大 chunk 提示。
- 当前 Chromium / Firefox / WebKit 相关专项最终 12/12：透明底色、深浅切换、移动完整列表、七语颜色名、配色撤销/存档/冻结批量及设备三适配/四格式导出（PNG 透明/2x/尺寸、JPG/WebP 白底）。目视检查深浅选择器截图。
- `pnpm test:consumer` 开发/生产宿主各 14/14，包含同页两实例不同主题的透明底色与投影隔离。
- 新 UI 测试最初未等待移动面板挂载，修正等待后又发现定位包含隐藏的桌面面板；最终限定可见面板后完整专项复跑通过，未放宽样式断言。未重跑全产品 E2E/PWA、真实最低版本浏览器或桌面矩阵；未提交、推送或发布。

### 首屏浏览器与设备快捷入口（历史）

2026-09-07，首屏增加设备快捷区与下方“更多外框”按钮，沿用现有 Ambient Shelf、实例级状态、原生单选和缩略图，不改渲染/导出内核、项目格式或素材许可状态。

- `pnpm lint`、`pnpm typecheck`、44 files / 435 unit、七语 i18n 审计 612 keys、Web/library 双构建通过。
- 当前 Chromium / Firefox / WebKit 的初始页与真实设备专项 72/72。覆盖 1280×720 首屏按钮可见、深浅主题、390 px/七语/axe、键盘打开与焦点返回、先选设备/颜色再导入、完整列表与快捷区同步、撤销，以及 PNG 透明/2x/尺寸、JPG/WebP 白底等原设备回归。
- 首页与旧设备格式/golden 专项另为 5 passed / 4 expected skipped；两个 golden 仅在 Chromium 验证。公开首页截图测试隐藏可选设备图片区，避免把本地第三方图片写入公开基线；实际设备卡片另有加载、边界、交互与本地截图验证。
- `pnpm test:consumer` 开发/生产宿主各 12/12，含未导图双实例快捷区隔离。`pnpm test:pwa` 12/12；核心预缓存 25 项 / 2,987,954 bytes，仍低于 3 MiB。PWA/library 边界审计通过；原有大 chunk 提示保留。
- 369-file 无素材包隔离副本严格冻结离线安装、外框 unit 9/9、Chromium 初始页 9 passed / 1 expected skipped（设备导入用例缺包跳过）。验证空包不出现失效设备、更多按钮与移动入口正常；该副本未重新运行完整构建/clean-room，`releaseReady=false`。

Review 修正完整列表中“已保存但未安装的配色”不应替代可用型号卡片；测试使用可见移动面板/完整列表作用域，避免新增快捷卡片导致重复定位。PWA 首轮 Air 用例遇到冷重载自动恢复草稿与再次导入竞争，改为等待草稿保存及真实恢复完成再继续离线重合成，最终 12/12。原有 React 开发期 `Notification`/`Button` 跨组件更新警告仍有出现，不声称控制台零警告。未重跑全产品 E2E、真实最低浏览器、Safari 或桌面矩阵；未提交、推送或发布。

### 待核实提示精简（历史）

2026-09-07，按用户要求移除侧栏、设备抽屉、下载弹窗里的 Shoteasy/Monkr 待核实段落及对应七语文案；保留来源、已有下载确认和许可元数据，不改渲染/导出内核。

`pnpm lint`、`pnpm typecheck`、44 files / 433 unit、i18n 610 keys、Web/library 双构建与差异检查通过。当前三引擎相关专项 15/15，覆盖两来源七语侧栏/抽屉无额外段落、元数据未改成已授权、来源链接、取消/过期/压缩同 Blob、批量 ZIP 与窄屏 axe。此小改未重新运行全产品 E2E、consumer/PWA 或最低版本/桌面矩阵；下方是接入时的历史完整专项记录。

### DM0 样板正式接入（历史）

2026-09-07，用户确认样板后，本地 Node 24.18.0 / pnpm 10.12.1：

- `pnpm lint`、`pnpm typecheck`、`pnpm test:unit` 通过，44 files / 433 tests。
- 当前 Chromium / Firefox / WebKit 真实设备专项 39/39。15 个历史/新颜色机身逐像素验证不透明外壳不被截图覆盖，三种适配 × PNG/JPG/WebP/AVIF、PNG 透明/2x、JPG/WebP 白底、尺寸、快速切色、加载失败恢复、旧预览失效、颜色单次撤销、七语、390 px/axe、双实例 URL 回收、项目/预设及冻结批量通过。
- 旧框/导出 golden 专项另有 4 passed / 2 expected skipped（三引擎旧矢量几何/格式均通过，另两个跳过是仅 Chromium 的 golden）。未更新旧 golden 掩盖几何回归。
- Web/library 双构建通过；`pnpm test:consumer` 开发/生产宿主各 11/11，新增 Air 星光、iMac 紫色和 Pixel 的实际安装/打包/PNG 下载，MIT 与未知来源提示分别验证。
- `pnpm test:pwa` 12/12，新增 Air 星光及 Pixel 在清除 HTTP 缓存、断网并冷重载后的重合成/下载，像素与在线一致。i18n 审计 612 个实际使用 key；许可/PWA/库边界/体积审计通过。核心预缓存 25 项 / 2,989,914 bytes，未提高 3 MiB 门槛；原有大 chunk 提示保留。
- 无素材包的 369-file 隔离副本：严格冻结安装、43 files / 418 unit、Web/library 双构建通过。源码未带私有规划或素材包，两个产物均未命中本地 29 张 PNG 的 hash；实际 Chromium 遍历全部 17 个设备 ID，保留 ID/拉伸方式，隐藏不可用选项，图片导出明确报 `device-render-failed`。隔离副本 `releaseReady=false`，不是公开晋级或完整 clean-room。
- 实际查看正式选择器、银色 Air / 蓝色 iMac / Pixel 的 3x PNG（1800×1500）与编辑器截图；机身、刘海/镜头、文字边界正常，无新增底部署名。素材安装清单 SHA-256 和来源记录保留在本地，不上传源素材。

Review 修复了 Store 误依赖 Canvas 配置、旧 generic 新建测试预期、型号重复入口、来源混用和 Pixel MIT 全文缺口。移动测试初次缩放后继续引用旧抽屉失败，改为经真实菜单重新打开；随后一次遗漏“视图”tab 的超时已纠正，最终三引擎完整专项重跑通过，没有放宽 axe/像素规则。

本轮未重新执行全产品 E2E、真实最低版本浏览器、Apple Safari、原生桌面或全量压力测试。跨型号记忆成功色、分类与专用重试按钮仍是后续体验项；Air/iMac 来源许可 HOLD 不因本地验收解除。未提交、推送或公开发布。

### 设备列表纠偏与显示名（历史）

2026-09-07，本地 Node 24.18.0 / pnpm 10.12.1：

- `pnpm lint`、`pnpm typecheck`、`pnpm test:unit` 通过，unit 为 44 files / 430 tests。新增闭合屏幕、刘海、外部 alpha 与新 ID/适配模式存档回归。
- 当前 Chromium/Firefox/WebKit 设备与旧框专项 34 passed / 2 expected skipped，其中真实设备 30/30。五款原机身全不透明像素与原 PNG 同浏览器缩放结果逐字节比较；覆盖三适配/四格式、PNG 透明/2x、JPG/WebP 白底、折叠区、Surface 显示名及未核实来源的取消/批量交付。旧矢量 golden 未更新；两个跳过是仅 Chromium 使用的旧框 golden，不是功能测试失败。
- Web/library 双构建通过；`pnpm test:consumer` 开发/生产模式各 8/8，含 Surface Pro 与 iPhone 的真实宿主打包、下载提示和双实例隔离。
- `pnpm test:pwa` 10/10，新增 iPhone 与保留 Surface Pro 的设备图片/Worker 冷重载离线导出像素回归。
- 七语审计 608 keys、许可声明审计、Web PWA/库边界审计、体积报告及差异检查通过；核心预缓存 25 项 / 2,978,133 bytes，仍低于 3 MiB。原有大 chunk 提示保留；依赖许可审计不代表图像再分发授权。
- 无素材包 369-file 隔离副本通过严格冻结安装、43 files / 415 unit、Web/library 构建；两个构建不含九张可选 PNG。实际 Chromium 验证七个缺包 ID 全部保留、选项隐藏，图片导出明确报 `device-render-failed`，不是静默丢掉机身。首次安装和补拍因 `/tmp` inode 耗尽失败，完整迁移本轮临时目录并更换 TMPDIR 后复验通过，不清理其他项目文件。
- 目视核对正式设备列表及五款真实 PNG 导出；显示器支架不再覆盖名称，旧矢量在默认折叠区。原素材 SHA-256 未变。仅本地预览，隔离副本 `releaseReady=false`，不是完整公开 clean-room 或发布候选。

本轮没有重新运行全产品 E2E、最低浏览器、真实 Safari、原生桌面或全产品内存压力测试。下方仅 Surface 的结果是历史记录。

### 首轮 Surface 接入（历史）

2026-09-07，本地 Node 24.18.0 / pnpm 10.12.1，安装可选素材包后的结果：

- `pnpm lint`、`pnpm typecheck`、`pnpm test:unit` 通过；unit 为 44 files / 427 tests。
- `pnpm build`、`pnpm build:lib`、`pnpm test:consumer` 通过；真实设备 consumer 开发/生产模式分别 7/7，库资产和 Worker 可在宿主构建后加载。
- 当前三引擎全量 E2E 复跑 220 passed / 20 expected skipped；其后最后一处 CORS 修复再运行设备专项 24/24。没有把最终专项复验写成再次执行全量 E2E。
- 专项覆盖两款设备 × 三种适配 × 四格式，PNG 透明/倍率与最终尺寸、JPG/WebP 白底、许可取消/Escape/过期/同 Blob、缩略图边界、深色/窄屏 axe、失败恢复、跨域默认图片、放大镜快照、双实例资源隔离、冻结批量 ZIP、项目/预设 ZIP 往返。
- `pnpm test:pwa` 9/9；设备测试在清除 HTTP 缓存、断网并重载后，重新合成/下载并与在线导出像素比较。
- `audit:i18n` 606 keys、`audit:licenses`、`audit:pwa`、`audit:pwa:library`、`size:report` 与差异检查通过；这些依赖/构建审计不是第三方图片再分发授权。PWA 核心预缓存仍低于 3 MiB，原有大 chunk 提示保留。
- 无素材包隔离源码已通过严格冻结安装、43 files / 412 unit、Web/library 构建；实际页面不显示缺包设备，已有 ID 保留且图片导出显式失败。不是完整公开 clean-room 或可发布候选。

Review 修复了机身选框比例、暗色许可链接对比度、位图缩略图越界/对比度、跨域默认图二次解码，以及新增公开清单排序。全量首跑曾有一条 WebKit 裁剪取消失败（219 passed / 20 skipped / 1 failed）；未改裁剪代码，单用例连续 3/3、随后完整复跑通过，保留偶发记录而不声称原因已修复。最终专项日志还出现一次 React 开发期 `Notification`/`Button` 跨组件更新警告，未导致断言失败；本轮未完成独立归因，不声称控制台零警告。

新增 `deviceProjection.test.js`、`deviceLicense.test.js` 及设备几何/历史测试。真实设备 E2E 位于 `raster-device.spec.js`，仅在安装本地素材包时运行，不把缺包跳过写成已通过。未运行真实最低版本浏览器、Apple Safari 或原生桌面；未提交、推送、发布素材或构建产物。
