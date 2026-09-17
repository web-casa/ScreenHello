# 六平台构建推进记录（2026-09-17）

## 范围

用户授权推进全部桌面系统测试构建，并增加 MAS / Microsoft Store ARM64、AMD64 包开发。商店入口与缺失材料见 [Store 打包文档](./desktop-store-packaging.md)。本轮没有创建正式 Release、移动版本 tag 或提交商店审核。

## 已执行与发现

1. 将两款非手持 iPhone Duo 的源码支持提交为 `83a7704`。Duo 第三方 PNG/PSD 未取得软件包公开再分发确认，仍是本地可选素材，不进入公开源码或安装包。
2. 从不可变提交导出公开 allowlist 快照，推送到 `web-casa/ScreenHello` 的 `build/macos-arm64-dmg-20260916`。公开源码只来自导出目录，不推送私有源仓库的完整工作树。
3. 公开候选 `4f36d371836fae77f44c36c10ba02087c16dee3f` 的 [macOS ARM64 DMG 构建](https://github.com/web-casa/ScreenHello/actions/runs/35177826656) 成功，artifact `10478553274`。这是该提交的结果，不代表后续修改也已验证。
4. 同一候选的 [六平台 Gate](https://github.com/web-casa/ScreenHello/actions/runs/35178009558) 失败。实际原因与对应修复如下。

| 原因 | 修复 | 证据边界 |
| --- | --- | --- |
| icon 单测逐像素创建大量断言，弱 runner 超时 | 仍遍历全部像素，只在累计违规数量后断言 | 本地 brand 测试通过 |
| Windows checkout 的 CRLF 改变 SVG/许可字节、使审计 mutation 测试替换失效 | `.gitattributes` 固定文本 LF、显式二进制资源规则 | 原始 Windows 日志有 35 项失败，不能把它们解读为 35 个产品 UI 缺陷 |
| `URL.pathname` 在 Windows 形成重复盘符 | 改用 `fileURLToPath` | brand 路径测试通过 |
| Linux x64 crates.io 连接超时 | 锁定依赖 fetch 增加最多三次重试与 120 秒网络超时 | 不重试/吞掉编译或测试失败 |
| xcap 的 libspa 绑定与 Ubuntu 22.04 系统头文件不兼容 | 两个 Linux 架构统一到 Ubuntu 24.04；同步矩阵、审计和支持声明 | 暂不声称支持 Ubuntu 22.04 / Debian 12 |
| Intel macOS 的五候选磁盘验证 integration fixture 超过单位测试时限 | 该文件使用明确的 120 秒 I/O 测试预算；不跳过断言 | 相关 4 文件 67 项本地通过，约 60 秒 |
| macOS ARM64 完成构建后，证据收集器仍只认私有仓库 ID | 无签名 Gate 显式允许源仓与公开仓两个 numeric ID；签名/attestation 规则不放宽 | 添加公开仓成功、其他 ID 和字符串 ID 拒绝测试 |

`9bc0f6f` 的公开导出提交为 `82ec8eff016e94694c95446884c783794c8370b9`，对应 [第二轮六平台 Gate](https://github.com/web-casa/ScreenHello/actions/runs/35178901149)。该候选尚不含随后发现的公开仓证据入口修复，不能将它视为最终全绿候选。

PR Gate 的矩阵入口读取 base SHA；公开 main 的旧基线还没有相应矩阵脚本，PR 入口会失败。当前使用已提交候选的手动六平台 Gate，保留 PR 的可信基线规则。未来合并更新公开 main 后应重新检查 PR Gate，不能通过改为执行不可信 PR 内容来掩盖它。

## Store 源码与本地验证

### 原生包检查追加修复

候选 `784ea38` 的 Windows ARM64 编译、测试、桌面运行与 NSIS 生成均通过，但包检查错误地把 `$PLUGINSDIR/nsDialogs.dll` 的 x86 架构当作应用架构错误。已核对 Tauri CLI 2.11.4 的 NSIS 模板，并用真实 NSIS 3.11 生成/解包样例复现：安装器插件运行在 x86 安装器进程，应用本体仍是 ARM64。

修复将五个明确插件路径单独检查并记录为 `installerBinaries`；应用 `nativeBinaries` 继续要求目标架构。新增错误应用 DLL、未知插件、错误插件架构和证据篡改回归，34 项相关测试通过。Gate 同时提前留存原始安装件；检查失败时保留 `PACKAGE-NOT-VERIFIED.txt` 标记，只有证据收集成功后才移除。

同一轮 Intel Mac 也完成编译、运行和 DMG 生成，但在读取包内资源时出现 ENOENT。根因是 `inspectDmgPayload` 在 `try/finally` 中直接返回异步检查 Promise，`finally` 提前卸载了 DMG。已改为等待检查结束再卸载，并增加真实文件读操作与即时卸载的回归：正确包通过、错误架构拒绝、两者都完成清理。临时恢复旧实现后测试会因 ENOENT 失败，确认测试确实覆盖该竞态；恢复修复后，相关 36 项单测和 lint 通过。

全量浏览器 CI 另外报出三引擎同一项 reduced-motion 失败：移动标注按钮仍有 160ms 过渡。此前删除全局动画覆盖是为了修复 rc-trigger 的弹层定位，因此本次只缩短编辑器自有画布工具控件的过渡，不覆盖 Portal 的动画。Chromium / Firefox / WebKit 的菜单、尺寸弹层、移动布局等 36 项回归全部通过。

该 CSS 修复之后再次通过 lint、Web / desktop Web / library 构建，并在新 library 产物上通过全部 18 项 consumer 测试。

`784ea38` 已取得 macOS ARM64、Linux x64/ARM64 的完整 Gate 证据，macOS ARM64 的独立签名、公证 DMG 在 [run 35179560957](https://github.com/web-casa/ScreenHello/actions/runs/35179560957) 成功，SHA-256 为 `536235b9702d7df8440d4f6cbcd5650e4f10cb7ea7314e0e8ac404e328b779aa`。Windows 检查修复需要新候选重跑；不能将旧候选的部分通过合并成六平台全通过。

新增独立原生打包命令、身份和版本校验、MSIX PE/Runtime/解包检查、MAS profile/沙箱/签名检查。MAS feature 禁用共享 `/tmp` 单实例插件，前端兼容 `singleInstance: unavailable`，编译时禁止混入测试驱动。

本地已执行：lint、typecheck、Web build、desktop Web build；94 个单测文件 / 1,372 项通过（随后增加的公开仓证据测试单独再跑）；默认 Rust 与 MAS feature 各 40 项通过；MAS feature 的 clippy `-D warnings` 通过。构建保留 Vite 大 chunk 提示。缺少身份时打包命令明确以 `store-input-required:SCREENHELLO_MAS_BUNDLE_ID` 退出，没有生成假身份包。

本地是 Linux：这些结果不包含 MAS/macOS 沙箱运行、Windows MSIX 打包、WACK、商店上传、商店审核或用户实际安装。下一步应先取得最新候选六平台结果，再按 Store 文档补身份和原生验收。

## 候选 `4ba1c2f` 的追加验证

完整候选源码为 `4ba1c2fbcd4cb95cc7fecca4f0cdf7003c6c1b40`，[六平台 Gate](https://github.com/web-casa/ScreenHello/actions/runs/35182662700)。macOS ARM64、Linux ARM64、Linux x64 的完整 Gate 通过；Windows 两个目标失败，不能称为六平台全绿：

- ARM64 已生成安装器并通过原生运行检查，但 NSIS 的 `MUI_PAGE_STARTMENU` 宏会间接引入 `StartMenu.dll`，此前五个插件路径未覆盖它。已核对 NSIS `StartMenu.nsh` 的 `StartMenu::Init/Show` 调用，补为六个明确路径，并让证据数量上限复用同一集合大小。下载该失败任务保留的实际安装器，使用修复后的检查器成功验证：主程序 ARM64，五个实际携带的安装器插件均为 x86。原 CI 失败状态不修改，诊断产物仍保留未验证标记。
- x64 在 `session-create` 阶段报 `NoSuchWindowError`。已核对锁定的 `tauri-plugin-wdio-webdriver 1.3.0` 源码：端口可先于窗口就绪，创建会话内置等待仅 10 秒，超时不创建会话。测试入口只对该错误最多尝试三次；应用退出、其他 session 错误或业务断言不重试。回归覆盖成功、耗尽、官方驱动不重试、进程退出和其他错误。仍需新候选实际重跑。

上述检查器/启动修复的 58 项相关测试通过。`4ba1c2f` 修复前的全量本地测试为 94 文件 / 1,380 项，不能代替后续代码验证。

追加修复后，lint、Web build 和全部 94 文件 / 1,391 项单测通过。Gate 的并发组另加入事件类型，避免同 SHA 的 PR 检查取消手动完整矩阵；保留同类型重复运行的取消机制。

同提交的 [签名 ARM64 DMG](https://github.com/web-casa/ScreenHello/actions/runs/35182596967/artifacts/10480583565) 已完成签名、公证、staple 和 Gatekeeper 检查，下载后 SHA-256 核对一致：`613877a3606890b1d05313e334007af41062b86e7962aabde2484981498115c1`。公证 ID `0563d0ea-cd2a-4bfa-a5f9-483c2cd7ffec`，状态 Accepted。真人 GUI 验收仍为未执行。

MAS 配置随后补充 WebKit 沙箱初始化所需的 `network.client`，依据 [Tauri 上游问题及维护者说明](https://github.com/tauri-apps/tauri-docs/issues/3171)。不增加网络服务端或临时例外权限，10 项 Store 配置测试、lint 和 Web build 通过。该修复已单独导出到公开 `build/store-packaging-20260917` 分支的 `b17d4f7`，不代表 MAS 原生包已生成。

## 候选 `1491ad3` 的完整安装器复核

公开候选 `1491ad33b9115d87cd37b3290983f7de6eb36885` 的 [Gate](https://github.com/web-casa/ScreenHello/actions/runs/35185106268) 中，Windows 双架构均已通过原生运行并生成安装器；包检查又定位到根目录 `uninstall.exe` 被误作应用程序检查。Tauri CLI 2.11.4 的 NSIS 模板明确通过 `WriteUninstaller` 在 `$INSTDIR` 下生成 `uninstall.exe`，其 x86 架构跟随安装器。

本地 7-Zip 25.01 没有从同一安装器展开卸载程序，[官方 7-Zip 26.03](https://www.7-zip.org/download.html) 会展开，造成此前局部复现的覆盖缺口。已用 26.03 对本轮真实 ARM64、x64 安装器完整解包并通过修复后的检查；只增加根目录 `uninstall.exe` 的明确 x86 记录，其他路径同名文件、错误架构和无效头仍拒绝。根目录卸载程序和六个标准插件共用七项允许列表与数量上限。

包内应用与上传的原始可执行文件逐字节复核，仅存在 Tauri 正常的 `__TAURI_BUNDLE_TYPE_VAR_UNK` → `NSS` 标记替换（已核对 tauri-utils 2.9.3 源码）；没有改写原始诊断 artifact 或把失败任务标为通过。43 项相关测试、lint、Web build 通过，另复核了 SBOM 和证据收集的 Windows CLI 启动、路径与元数据边界。

此前 `4ba1c2f` 的完整[浏览器 CI](https://github.com/web-casa/ScreenHello/actions/runs/35182599577) 已成功：357 项 E2E、48 项 PWA、15 项 release 检查通过；可选素材/私有文档等缺失条件下的跳过项目没有计入通过数。`1491ad3` 与它的 `src/`、`src-tauri/`、package.json 和锁文件无差异，后续变化限于构建检查脚本、单测、工作流和文档。

### 弹层重复回归与触屏修复

`1491ad3` 的[浏览器 CI](https://github.com/web-casa/ScreenHello/actions/runs/35185106987) 仍复现 WebKit 尺寸弹层宽度为零；另一次主题切换首次失败、重试通过。因此，前一提交的一次全绿不足以证明时序问题已消失。本地对两个相关用例各重复十次，尺寸弹层失败 5 次，主题用例通过 10 次；截图中尺寸按钮已展开但面板不可见。

复用现有 `NO_CSS_MOTION`，通过 Dropdown 的 `transitionName` 与 Popover 的 `motion` 关闭这两处 CSS 进入/退出动画，保留组件定位逻辑，不增加全局动画样式覆盖，也没有放宽测试断言。相同 20 次 WebKit 回归全部通过。

随后三引擎完整菜单回归发现触屏模拟鼠标悬停与点击的重复切换：`onMouseEnter` 先打开相邻菜单，紧接的点击将它关闭。改用 `onPointerEnter` 并只处理 `pointerType === 'mouse'`，触屏统一由点击处理。该修复后的 Chromium / Firefox / WebKit 菜单与移动布局共 36 项全部通过。

卸载程序检查修复后的全量单测为 94 文件 / 1,393 项通过。弹层修复后的 lint 与 typecheck 通过；这些自动检查不能替代用户 Mac、Windows 或商店沙箱中的真实 GUI 验收。

最终弹层与触屏修复后的 Web、desktop Web、library 构建通过；新 library 的开发和 preview consumer 各 18 项通过。Vite 大 chunk 提示仍存在，没有把它写成已消除。

最终再次运行全量单测，94 文件 / 1,393 项通过；PWA audit、i18n audit 与文档内容一致性检查通过。新公开候选须以它自己的 Actions 结果为准。

## 候选 `fb13ab8`

本地提交 `17a3992587710b251979d2edbf9d928f585e33b4` 导出为公开提交 `fb13ab8746182ba379cf41b46b1c321685408e1c`，已推送测试分支。对应 [六目标 Gate](https://github.com/web-casa/ScreenHello/actions/runs/35188890782)、[签名 ARM64 DMG](https://github.com/web-casa/ScreenHello/actions/runs/35188882462) 和[浏览器 CI](https://github.com/web-casa/ScreenHello/actions/runs/35188885672) 已启动，当前仍在运行；不能预先记作通过。

其中签名 ARM64 DMG 随后成功：[下载 artifact](https://github.com/web-casa/ScreenHello/actions/runs/35188882462/artifacts/10483226549)，SHA-256 `e23c33202744e4b8199d828f9ed83ac79fdad208a38ddb56393d1a4f158fac1c`，下载后核对一致。Apple 公证 `3edaf44e-8f3f-474e-a2c1-9e569ac27212` 为 Accepted，签名记录包含 stapled ticket；`gui-acceptance=not-run` 保持原样。这是 Developer ID 直装候选，不是 MAS 包。

上一轮 `1491ad3` 最终为 macOS 双架构、Linux 双架构通过，Windows 双架构在卸载程序检查失败。新候选不能混用这些旧产物作为完整矩阵的证据。

`fb13ab8` 的 macOS ARM64、Linux x64 和 Windows ARM64 Gate 已通过，Windows 的真实包验证确认卸载程序分类修复有效。Linux ARM64 的原生运行阶段在 `desktop-overlay-layout` 等待 10 秒后失败；原入口没有具体子阶段及失败截图，不能据此断言某个弹层本身有问题，也不能声称六平台通过。本地重新构建原生 test driver 后，首次运行及随后连续 10 次均通过；这不是 Ubuntu runner 的失败已解决证明。

为进一步定位，原生测试入口增加菜单、尺寸、地址编辑、裁剪与导出的子阶段，等待错误包含选择器；失败保存独立 `runtime-failure.json` / `runtime-failure.png`，保留非零退出，不写成功 `runtime.json`。没有修改业务断言或加入自动重试。

诊断入口的 lint 与 41 项相关单测通过，原生 test driver 重新构建通过。常规首次与重复运行共 11 次、限制单核的慢环境运行 10 次全部通过；仍不足以认定原 Ubuntu runner 超时的根因。

在临时脚本副本中将菜单定位器替换成不存在的测试选择器，负向运行按预期退出 1，记录 `desktop-file-menu-layout`、具体选择器及 230,969 字节 PNG；未生成成功 evidence。副本随后删除，真实入口断言未改变。

## 诊断候选 `6642b3e`

本地提交 `c2c5ab253cfb070750b5f08c15689b3e9724664d` 导出为 `6642b3e113f587e3ff0adb91ccff43504196bed9`。[六目标 Gate](https://github.com/web-casa/ScreenHello/actions/runs/35191033676)、[签名 ARM64 DMG](https://github.com/web-casa/ScreenHello/actions/runs/35191021197) 和[浏览器 CI](https://github.com/web-casa/ScreenHello/actions/runs/35191023723) 已启动。它只增加上述诊断和文档，应用源码、依赖和原生后端与 `fb13ab8` 相同；不能据此将未结束的新运行写成成功。

该候选再次在 Ubuntu ARM64 复现失败，新增证据将范围缩小到 `desktop-export-drawer-layout`：`.shoteasy-export-overlay` 外壳可见且尺寸为 1280×800，但 `.ant-drawer-content-wrapper` 等待 10 秒仍不可见，失败截图确实没有导出面板。此前的 21 次 Debian 本地通过未覆盖这个环境差异。

检查发现导出抽屉仍残留独立 CSS，把内容与遮罩动画/过渡强制压为 `0.01ms`；它没有通过组件状态机关闭 motion。本轮删除该覆盖，改为 `ExportPanel` 的 `motion` / `maskMotion` 复用 `NO_CSS_MOTION`。修复后的 Ubuntu ARM64 结果需要另一个候选验证，不能提前断言已解决。

`fb13ab8` 的浏览器 CI 另有 356 项通过、1 项 WebKit 背景选择失败、81 项条件跳过。下载的 retry trace 显示：首次背景点击时内嵌抽屉仍带 `ant-drawer-panel-motion-right-appear-active`，右侧检查器 `scrollLeft=218`，未请求任何背景原图，因此失败发生在点击而非图片加载阶段。背景抽屉及同样使用 `getContainer={false}` 的外框抽屉改用组件 motion 配置；背景回归新增检查器横向滚动为零的断言。

本地首次三引擎背景回归有 Firefox `Target crashed`；系统内核同时记录全局 OOM 杀死浏览器内容进程。清理本轮闲置临时工作树、使用磁盘临时目录并串行复测后，Firefox 五项背景测试分别通过（四项在一轮、一项单独补跑）。原崩溃保留为环境失败记录，不计作通过。

抽屉修复后的验证：36 项三引擎菜单/导出/移动布局、12 项外框入口/抽屉回归通过；WebKit 的完整 25 背景选择流程重复 10 次全部通过，横向滚动断言正常。lint、typecheck、Web / desktop Web / library 构建通过，consumer 的开发/preview 各 18 项通过，94 文件 / 1,393 项单测通过；PWA 54 项预缓存、3,287,520 字节预算及文档一致性检查通过。

修复后的本地原生程序重新编译通过，Linux ARM64 运行入口通过（约 11.9 秒），包含导出抽屉布局、背景主题、剪贴板、截图流程与单实例检查。该记录仍是 Debian 本地结果，不能替代 Ubuntu runner 的新验证。

已明确失败且应用源码即将被替换，因此取消 `6642b3e` 剩余 Gate / 浏览器 CI 任务，保留 Linux ARM64 失败日志、JSON 和截图。取消不是通过；修复需用新候选完整运行验证。

## 抽屉修复候选 `d6b354b`

本地提交 `824c038a99c1a7283403877f1930b774138c894f` 导出为 `d6b354b0781b72729475e0e382ea8558be4b7060`，已推送公开测试分支。新的[六目标 Gate](https://github.com/web-casa/ScreenHello/actions/runs/35193597248)、[签名 ARM64 DMG](https://github.com/web-casa/ScreenHello/actions/runs/35193586729) 与[浏览器 CI](https://github.com/web-casa/ScreenHello/actions/runs/35193590580) 已启动，结果待取得后补充。

额外三引擎移动端嵌套外框抽屉 3 项通过。签名 ARM64 DMG 已成功：[下载](https://github.com/web-casa/ScreenHello/actions/runs/35193586729/artifacts/10485441335)，下载后 SHA-256 验证通过：`97eaab47a6716744564ed26c41fcb7f139c858ea0482b6d4c56b788f789f46a4`。Apple 公证 `24e8bbb8-00a0-4448-9ed2-98674e93cdb9` 为 Accepted，包含 stapled ticket；真人 GUI 验收仍为未执行。测试应先退出旧进程，再替换安装，避免单实例机制唤起旧版。


该候选最终为 macOS / Windows 双架构、Linux x64 通过，Linux ARM64 在 `clipboard-write` 失败。新的现场证明导出面板检查已通过；复制按钮已恢复可用，但只记录到“正在复制”，不能据此证明复制成功。检查测试发现使用 Ant Design 旧版 `.ant-message-notice-content`，且 MutationObserver 未监听 `characterData`；靠 `body.innerText` 回退会受到提示进入动画可见性的影响。

改为序列化独立的消息观察函数，读取当前 `.ant-message-notice` 的 `textContent` 并监听文本更新，保留原来 30 秒期限与必须收到“复制成功”的断言。三引擎新增真实 Ant Design 同 key 更新及纯文本节点更新回归，全部通过。本地原生 Linux ARM64 运行通过（约 13.2 秒）；Ubuntu runner 尚需重新验证。

该候选浏览器 CI 为 354 通过、81 条件跳过、3 失败：同一动画测试在三个引擎仍断言 CSS duration 小于 0.001 秒。组件 motion 关闭后，未触发的样式声明仍可为 0.3 秒，这个断言已不对应行为。改为从页面初始化开始捕获真正的 animationstart / transitionrun，检查内容与遮罩可见且没有活动动画，保留三轮关闭/重开/焦点、不影响其他弹层与不触发编码的断言。更新后连同观察器共 6 项三引擎回归通过，没有恢复曾导致原生抽屉隐藏的微时长 CSS。

本轮检查入口修正后的 lint、Web 构建、26 项原生 driver / 公开导出契约单测通过。新增 helper 已纳入公开导出白名单和 Gate 路径触发范围。

## 检查入口修正候选 `5b24a18`

本地提交 `5f46fcd782aa5d9238409f20c21086605db5ba8c` 导出为公开 `5b24a18ca1ada5dafbae0fc11b3aa233d2047ed8`，共 822 个白名单文件。已启动[完整六目标 Gate](https://github.com/web-casa/ScreenHello/actions/runs/35198181434)、[签名 ARM64 DMG](https://github.com/web-casa/ScreenHello/actions/runs/35198162194) 和[浏览器 CI](https://github.com/web-casa/ScreenHello/actions/runs/35198164856)，PR #10 已同步当前实现和待验证边界。

该候选签名 ARM64 DMG 成功：[下载 artifact](https://github.com/web-casa/ScreenHello/actions/runs/35198162194/artifacts/10487003766)。下载后 `sha256sum -c` 通过，最终 SHA-256 `09a3eaf3a4dc76b62a3f5ee09bc3c0658eea916f2ea9b9ea79f76b5d93359cda`。Apple 公证 `824cabab-ce72-4a55-bae6-384b96af4b67` 为 Accepted，签名记录包含 stapled ticket；GUI 人工验收仍未执行。


`5b24a18` 最终完整 Gate 为五目标通过，Linux ARM64 仍在复制之前的画面就绪阶段失败。观察器修复后捕获到具体提示“等待画面或压缩处理超时”，此前误以为可能只是漏捕获“复制成功”的判断没有得到支持。本轮补充 Ant Design 的成功/错误类型识别，任何具体错误都立即以失败退出，不再只匹配“复制失败”四个字。

该候选浏览器 CI 成功：公开导出范围内 81 文件 / 1,283 单测通过、5 条件跳过；360 项 E2E 通过、81 条件跳过；48 项 PWA 通过、4 条件跳过；15 项 release 检查通过；公开 consumer 开发/preview 各 13 通过、5 项可选素材跳过。与私有工作区的 1,393 单测 / consumer 各 18 项范围不同，不能混记。五个原生目标的安装包及配套文件下载后，35 个 SHA-256 全部核对通过；本地证据汇总也仅因 Linux ARM64 缺失而拒绝完整通过。

### Ubuntu 无显示器渲染对照

建立隔离 Ubuntu 24.04 ARM64 / WebKitGTK 2.52.6 容器（与 runner 的 WebKit 版本一致），分别运行普通 MiniBrowser、本地原生测试件、精确公开 `5b24a18` 重新编译的原生程序及该候选原检查脚本。均有成功记录，但随后的原生复测捕获同样的 `export-render-timeout`。只读诊断不读取项目、图片或 URL，只记录 pending task 数量、paint revision、渲染队列、页面可见性和焦点。

失败时页面可见且聚焦、没有待处理图片任务；Leafer 渲染回调长时间未调度，最终没有在原有 10 秒期限内通过就绪检查。限制容器为 1 核后，默认合成路径再次失败。保持相同程序、CPU、检查脚本和超时不变，仅设置 `WEBKIT_DISABLE_COMPOSITING_MODE=1` 后连续三次通过，整轮约 6 秒。

这是 Xvfb 无 GPU 合成环境的对照证据，不是把所有 Linux GPU 问题归为同一原因。核对了 [Tauri 上游相近报告 #15936](https://github.com/tauri-apps/tauri/issues/15936)，并发现 `~/tools/imgconvert/scripts/smoke-linux-package-install.mjs` 已使用相同的 Xvfb 软件渲染设置。修复限于 Linux Gate 的 Xvfb 步骤及 `pnpm desktop:test:runtime` 命令；生产程序保持原有渲染选择，所有布局、原生复制、编码器和超时断言仍保留。真正桌面 GPU、Wayland 与真人 GUI 验收仍需分别执行。

运行证据新增 `graphicsMode`，明确记录当前测试环境。新的六平台候选仍需远端完整验证；本地对照通过不能替代 runner 的结果。

补充对照：使用未加入新诊断代码的公开候选原检查脚本，在同一单核 Ubuntu 容器仅禁用合成后也完整通过（约 7.2 秒）。修复后的 lint、Web 构建、65 项相关单测、三引擎消息观察器回归、桌面 PoC 与 workflow audit 通过；临时诊断容器已清理。
