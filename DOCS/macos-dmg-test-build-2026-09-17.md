# macOS ARM64 测试 DMG（2026-09-17）

用户授权在公开仓库构建新的 DMG，用于真实 Mac 测试。本次沿用公开仓库的 `macOS ARM64 DMG` 工作流与测试分支，不合并 main、不创建 GitHub Release。

## 来源与范围

- 公开仓库：<https://github.com/web-casa/ScreenHello>。
- 公开提交：`1ac61bfb095fbe4d80cbbe0054c8a8d0e6bbab9e`。
- 本地来源提交：`2063f04f1de7f52b13a2c638fe040201fc732c39`。
- 分支：`build/macos-arm64-dmg-20260916`；沿用上一轮分支名，产物以本次 SHA 和 run ID 区分。
- [构建 run 35132257556](https://github.com/web-casa/ScreenHello/actions/runs/35132257556)。
- 目标：macOS ARM64（Apple Silicon），应用版本仍为 `1.0.4`。
- 包含[两轮桌面审阅修复](./desktop-review-fixes-2026-09-17.md)和[工作区生命周期修复](./project-review-2026-09-17.md)：原生退出保护、保存快照、预设请求失效、文件 token 回收、截图窗口恢复及相关契约测试。

## 构建准备

按公开导出 allowlist 导出 807 个文件，审计通过；新回归测试和专题文档已加入公开清单。未复制工作目录缓存、未导出私有 Git 历史。最初导出因测试中的示例 Windows 用户目录触发隐私规则，改为 `C:\exports` 后通过；没有放宽扫描规则。公开导出单测 18 项、修改后的 native-files 单测 14 项通过。

已有组织 secret 仅由 GitHub Actions 使用；P12 密码沿用用户确认的空字符串。工作流先执行生产 CSP WebKit、lint、typecheck、JS/Rust 测试，再导入签名证书，构建并公证 app 与最终 DMG，验证 staple、Gatekeeper 和 ARM64 架构后上传 artifact。

## 当前结果

同一源码第二次尝试成功，已下载并复核最终 DMG。构建与签名检查不能替代用户 Mac 上的安装、权限和 GUI 验收。

| 项目 | 最终结果 |
| --- | --- |
| 下载 | [Artifact 10463051868](https://github.com/web-casa/ScreenHello/actions/runs/35132257556/artifacts/10463051868)，需登录 GitHub 后下载 ZIP，解压得到 DMG |
| 文件 | `ScreenHello_1.0.4_aarch64.dmg`，8,391,522 字节 |
| SHA-256 | `56254d90cf3f32fbbb3a2ccae00b18cbb8226228bd0e8cae444f2fc7fdd1cb89`，本机 `sha256sum -c SHA256SUMS.txt` 通过 |
| Artifact 到期 | 2026-10-16 18:27:31 UTC |
| 源码、架构 | `build-info.txt` 与公开提交一致；app 可执行文件 `lipo -archs` 为 arm64 |
| 源码检查 | lint、typecheck 通过；78 文件、1,246 项 JS 测试通过，5 项按平台跳过；39 项 Rust 测试通过 |
| 界面检查 | macOS 15 runner 的生产 CSP WebKit 深浅主题 2 项通过（31.8 秒） |
| app 信任检查 | Developer ID 签名、严格签名验证、staple、Gatekeeper 通过；公证 ID `80cd4e0e-d1eb-47e9-89b2-a8148b8798ed`，Accepted |
| 最终 DMG 信任检查 | 公证 ID `926cdadb-cac2-44fb-b948-2a98e7254b0e`，Accepted；staple、validate、Gatekeeper 通过，随后才计算校验值 |
| 本地文件 | `/tmp/screenhello-dmg-35132257556/`，包括 DMG、校验文件、构建信息、签名信息和公证回执 |
| 用户设备验收 | 未执行；交由用户安装测试，`gui-acceptance=not-run` |

第一次尝试的源码检查、生产 CSP WebKit 2 项、78 文件中的 1,246 项 JS 测试（5 项按平台跳过）、39 项 Rust 测试均通过。应用完成 Developer ID 签名，公证 ID `4bac4ff0-9f5a-4dfa-8020-b07f4341acd4` 返回 Accepted，随后在 Tauri `bundle_dmg.sh` 创建 DMG 时失败。日志没有包含脚本内部错误，因此尚不能判定具体原因。对同一 SHA 启动一次干净 runner 重试，未把首次失败改写为成功，也未复用旧 DMG。

第二次尝试未经代码或检查阈值调整即通过；只能确认失败未在本次重试复现，不能据此断言具体故障已定位。两次完整日志分别保存在本机 `/tmp/screenhello-dmg-attempt1-full.log` 与 `/tmp/screenhello-dmg-attempt2-full.log`。

## 独立 PR 检查的已知失败

- [通用 Desktop Release Gate](https://github.com/web-casa/ScreenHello/actions/runs/35132261640)：matrix source 固定为基线 `4d318fa9ea8961faf148d22720458b7e8b4af7eb`，其中尚无 `scripts/desktop-release-matrix.mjs`，在候选矩阵选择阶段报 `MODULE_NOT_FOUND`，随后汇总缺少六平台 evidence。没有执行六平台原生构建，不计为通过。
- [通用 Linux CI](https://github.com/web-casa/ScreenHello/actions/runs/35132261611)：`brandAssets.test.js` 的 maskable 图标逐像素测试触发默认 5 秒超时；其余 1,245 项通过、5 项跳过。保留失败状态，没有调大超时、跳过测试或绕过合并保护。
- 这两项与目标 macOS DMG workflow 独立，不能用单个 DMG 成功替代完整发布门；本次不合并 PR。

## 用户 Mac 复测建议（未执行）

1. 完全退出旧版再安装本次 DMG；版本号仍为 1.0.4，用本次下载来源与 SHA-256 区分。
2. 导入图片并修改，分别关闭窗口、Cmd+Q、托盘退出，确认有保存/不保存/取消选择；取消后编辑内容仍在。
3. 保存时继续调整内边距，确认新修改仍显示未保存；退出对话框中保存失败或取消选择文件时应留在编辑器。
4. 快速连续应用两个预设，随后新建/打开项目，确认旧请求不会覆盖最后的选择或新项目。
5. 深浅主题分别操作文件/编辑/视图/帮助、自动尺寸、浏览器地址、裁剪和导出，检查弹层位置、背景和边界。
6. 从最小化或隐藏状态进行原生截图，核对恢复行为；测试首次屏幕录制权限允许与拒绝。CI 签名成功不表示这些用户权限流程已经验收。
