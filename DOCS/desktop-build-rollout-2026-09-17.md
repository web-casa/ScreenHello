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
