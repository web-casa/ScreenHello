# MAS Universal 构建与上传交接记录

日期：2026-09-19。目标是在公开仓库 `web-casa/ScreenHello` 生成含 `arm64` 与 `x86_64` 的签名 Mac App Store universal PKG，并把该构建上传到 App Store Connect。安装、GUI、审核与发布均未执行。

## 结论摘要

**已达成**：签名 MAS universal PKG 已生成并被 App Store Connect 接受，当前已上传 **1.0.4** 与 **1.0.5** 两个版本。

### 已上传版本

| 版本 | 打包运行 | 上传运行 | 源码提交 | SHA-256 | Apple 交付 UUID |
| --- | --- | --- | --- | --- | --- |
| 1.0.5 | [35388074997](https://github.com/web-casa/ScreenHello/actions/runs/35388074997) | [35389193113](https://github.com/web-casa/ScreenHello/actions/runs/35389193113) | `76c299231f3e028f0981b92b2696801eed841316` | `7cfd1a2c6d1773345bef3ec004ca84bfe783a1902968fcc2726bea40fab46fad` | `41ba89e2-73de-4014-9825-d569c16c1c40` |
| 1.0.4 | [35381654983](https://github.com/web-casa/ScreenHello/actions/runs/35381654983) | [35383159242](https://github.com/web-casa/ScreenHello/actions/runs/35383159242) | `763e436849775f8f29062715baf4ef3cb3783946` | `a1faca72c09e258a840f16cbaefa5f5df50ad8735e0d9d0dd550b779b926cf29` | `8314fef6-608c-4398-a6f7-f3b661051ed4` |

1.0.5 产物：`ScreenHello-mas-universal.pkg`，16 508 696 字节，`CFBundleShortVersionString=1.0.5`、`CFBundleVersion=1`，本地目录 `artifacts/ScreenHello-mas-universal-76c299231f3e028f0981b92b2696801eed841316-build-1/` 与 `artifacts/ScreenHello-mas-asc-upload-35388074997-35389193113/`，32/32 项核验通过。

altool 记录：`VERIFY SUCCEEDED` 与 `No errors uploading ...`（Xcode 15.4 的 altool 7.006.15006，macos-14 runner）。

**未执行**：真实安装、双架构 GUI、升级、App Store Connect processing 结果确认、审核提交、发布。`upload-evidence.json` 记录 `storeProcessing=not-run`、`storeReview=not-run`、`releaseReady=false`。**1.0.5 的 App Store Connect 版本记录需要在网页端创建或确认后才能真正提交审核。**

## 1.0.5 做了什么

- 版本号从 `1.0.4` 升到 `1.0.5`：`package.json` 是唯一声明来源，`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 必须一致（`pnpm audit:desktop:contract` 会拒绝漂移），另同步 `DOCS/component-api.md`。
- 修复桌面外壳按钮失去样式：桌面入口 `src/desktop/main.jsx` 从未导入 `@radix-ui/themes/tokens.css`、`components.css` 与 `src/style/radix-bridge.css`，打包后的应用里顶栏复制/导出按钮没有任何按钮外观（构建产物对比：Web 有 86 条 `.rt-BaseButton`，桌面为 0）。
- 顶栏复制/导出对齐 `main.css` 已声明的几何（34px 高、导出 16px 内边距、复制按钮 34×34 并补可见边）。
- 修好发版即失效的测试夹具：`tests/unit/desktopReleaseContractAudit.test.js` 把"分歧版本"写死成 `'1.0.5'`，版本号一到 1.0.5 就不再分歧；改为从当前 `package.json` 派生。

## 第一次上传失败的真实原因（已修复）

第一次上传运行 [35381321481](https://github.com/web-casa/ScreenHello/actions/runs/35381321481) 在**校验**步骤失败，上传步骤被正确跳过、未向 Apple 提交任何包。`gh run view --log-failed` 给出的权威原因是 App Store Connect 返回 HTTP 409 `STATE_ERROR.VALIDATION_ERROR`：

> The installer package includes files that are only readable by the root user. This will prevent verification of the application's code signature when your app is run.

注意这**不是**证书、profile 或身份问题：altool 已用 `APPLE_ID` + 应用专用密码完成鉴权并进入服务端校验。

根因链（由 PKG 字节直接确认，而非推测）：

1. 工作流在 `umask 077` 下用 `base64 -D` 解码 provisioning profile（保护私钥文件所必需），得到权限 `0600` 的 profile。
2. `scripts/package-desktop-store.mjs` 把该路径交给 Tauri 的 `files: { 'embedded.provisionprofile': profile }`。
3. Tauri 按源文件权限原样嵌入，`productbuild` 也保留该权限放进 PKG。
4. 解包第一次的 PKG，`./ScreenHello.app/Contents/embedded.provisionprofile` 是 `100600`，是包内**唯一**非全局可读的文件。

修复：打包入口把 profile 复制为权限 `0644` 的暂存副本再嵌入（凭据原件仍保持 `0600`），并新增断言，包内 profile 不是 `0644` 就直接失败。`763e436` 重新打包后，解包确认包内已无非全局可读文件。

## 仓库与工作树

- 主工作区：仓库根目录。存在大量用户此前开发产生的已修改和未跟踪文件，本轮未清理、未覆盖、未整体提交；`git status` 条目数保持 60 不变。
- **隔离工作树路径已变更**：本环境沙箱为每条命令提供独立且被清空的 `/tmp`，隔离临时工作树无法跨命令保留。隔离工作树改建在主工作区内的 `.mas-worktree-20260918`（相对路径），并写入本地 `.git/info/exclude`（不入库）。
- 公开远端只显式使用 `https://github.com/web-casa/ScreenHello.git`。
- 分支：打包 `build/mas-universal-candidate-20260918`（`763e436`），上传 `build/mas-asc-upload-20260919`（`a7edac1`）。两个分支均已推送公开仓库。
- 原未推送提交 `003d3f6`（强制两张 P12 使用非空密码）已撤销，本地保存在 `hold/mas-p12-password-policy-20260918`。

## P12 密码结论

运行 `35331499660` attempt 2 以 `security import … -P ''` 成功导入两张 P12 并完成打包，**以原生工具证明空密码 P12 可用**。attempt 1 的 `Unknown format in import` 来自当时上传的文件不是有效 PKCS#12 identity。因此强制非空密码的 `003d3f6` 与实际材料矛盾，已撤销。

## 上传入口设计

`.github/workflows/macos-mas-app-store-upload.yml`：

- 只允许手动 dispatch，且必须选择 `upload-mas-candidate-to-app-store-connect`；job 条件同时要求 `github.event_name == 'workflow_dispatch'`。
- 另有一条仅针对上传分支的 `push` 触发，作用只是让 Actions 注册这个手动入口（Actions 只注册已在某个分支被解析过的手动工作流）；推送本身永远不会上传，实测该 push 运行以 `completed/skipped` 结束。
- 不重新构建：从 `source_run_id` 下载候选 artifact，用 `scripts/mas-app-store-upload.mjs verify` 核对 SHA-256、`dirty=false`、`packaging=passed`、各验收项仍为 `not-run`、`releaseReady=false`，任一不符即拒绝。
- 依次执行 `xcrun altool --validate-app` 与 `--upload-app`，`product-errors` 一律视为失败；凭据只注入这两个步骤。
- 证据发布前先脱敏再扫描，命中凭据即拒绝；Apple 交付 UUID 之外不记录任何凭据内容。

## 产物核验

CI 在 macOS runner 记录、本轮在 Linux 侧复算与独立解包的证据（34/34 项检查通过）：

| 证据 | 内容 |
| --- | --- |
| `package-evidence.json` | `channel=mas`、`arch=universal`、`commit=763e436…`、`dirty=false`、`packaging=passed`，安装/GUI/升级/上传/审核全部 `not-run`、`releaseReady=false` |
| `SHA256SUMS.txt` | 与本地复算一致：`a1faca72…b926cf29` |
| `app-signature.txt` | `Identifier=com.webcasa.screenhello.mas`、`Format=app bundle with Mach-O universal (x86_64 arm64)`、`Authority=Apple Distribution: Alan Miao (H8MSV8BL2G)`、`TeamIdentifier=H8MSV8BL2G`、`flags=0x10000(runtime)`、`VersionMin=917504`（14.0） |
| `pkg-signature.txt` | 证书链首项 `3rd Party Mac Developer Installer: Alan Miao (H8MSV8BL2G)` |
| `macho-architectures.txt` | `x86_64 arm64  Contents/MacOS/screenhello-desktop` |
| 独立解包 PKG | 唯一 Mach-O 同时含 `arm64` 与 `x86_64`；所有普通文件全局可读；`embedded.provisionprofile` 为 `ScreenHello Mac App Store Distribution`、Team `H8MSV8BL2G`、有效期至 2027-08-20、无设备绑定 |
| 上传 artifact | 上传步骤使用的 PKG 与已核验候选**逐字节相同**（同一 SHA-256） |

**边界**：`codesign` / `pkgutil` 是 macOS 专用，未在 Linux 重跑；签名结论来自 runner 记录并如实标注。

## 本轮运行的本地检查

隔离工作树内全部通过：`actionlint`、`masWorkflow` / `masUploadWorkflow` / `desktopStoreConfig` Vitest、`pnpm audit:github-actions`、`pnpm check:docs-content`、`pnpm audit:desktop:artifact-provenance`、`pnpm audit:desktop:trust`、`pnpm audit:desktop:workflow`、`git diff --check`。

已知与本次改动无关的既有失败：`pnpm audit:desktop:release` 在干净基线 `bf7d72c` 上同样以六个目标证据缺失失败（措辞现为 `evidence not collected (ENOENT)`，表示原生主机尚未采集，不是证据被拒绝），原因是缺少桌面发布证据采集产物。

## 接手后的执行顺序

1. 在 App Store Connect 确认 1.0.5 的 processing 结果，并为 1.0.5 创建/确认版本记录；本仓库没有查询 processing 状态的凭据或入口，未做任何推断。
2. 补齐商店资料（隐私问卷、截图、分级、审核说明）后再人工提交审核；上传成功不等于已提交或已上架。
3. 需要新构建时，重新跑打包工作流拿到新 artifact，再用新 `source_run_id` / `artifact_name` / `expected_sha256` 手动 dispatch 上传。同一个「版本号 + build number」组合不能重复上传，Apple 会以冗余上传（ITMS-90189）拒绝；新版本用新的 `CFBundleShortVersionString`，同一版本内重传则递增 build number。
4. 仍需人工完成并如实记录：真实安装、Apple Silicon 与 Intel 双架构 GUI、沙箱文件/截图授权流程、升级验收。
5. **注意仓库结构**：公开仓库是私有开发线的**允许列表导出**（`config/public-export-manifest.json` + `PUBLIC_REPOSITORY.json`，私有侧脚本 `scripts/export-public-repository.mjs`）。本次 1.0.5 的修复同时存在于两条线；但 `tests/unit/radixStyles.test.js` 不在导出清单里，只存在于私有线，若要让它进入公开仓库需先加入清单。公开发布线（`build/mas-*`）已独立向前演进（`macos_capture.rs`、screencapturekit 探针、MAS 工作流等只在公开侧），两条线**没有共同祖先**，不要试图互相 fast-forward。
