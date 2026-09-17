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

新增独立原生打包命令、身份和版本校验、MSIX PE/Runtime/解包检查、MAS profile/沙箱/签名检查。MAS feature 禁用共享 `/tmp` 单实例插件，前端兼容 `singleInstance: unavailable`，编译时禁止混入测试驱动。

本地已执行：lint、typecheck、Web build、desktop Web build；94 个单测文件 / 1,372 项通过（随后增加的公开仓证据测试单独再跑）；默认 Rust 与 MAS feature 各 40 项通过；MAS feature 的 clippy `-D warnings` 通过。构建保留 Vite 大 chunk 提示。缺少身份时打包命令明确以 `store-input-required:SCREENHELLO_MAS_BUNDLE_ID` 退出，没有生成假身份包。

本地是 Linux：这些结果不包含 MAS/macOS 沙箱运行、Windows MSIX 打包、WACK、商店上传、商店审核或用户实际安装。下一步应先取得最新候选六平台结果，再按 Store 文档补身份和原生验收。
