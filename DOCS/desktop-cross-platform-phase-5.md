# 跨平台桌面 Phase 5：安装生命周期与本地状态迁移

## 状态

> 后续状态：本页中关于旧阶段或旧 schema 的表述只说明当时边界。当前契约为 [Phase 24](./desktop-cross-platform-phase-24.md) 的 schema v24：它保留既有 fail-closed 预检，并将 immutable candidate commit 的公开源码快照绑定到 direct-download/APT 交接，仍不改变本页历史结论或 `releaseReady=false`。

本阶段建立安装、升级和卸载前的非破坏性状态边界，并把它加入候选 runtime evidence。它不构成任何平台安装器已经通过升级或卸载实机验收的声明：六个原生候选仍是 `not-run`，没有新的远端候选、签名、公证、自动更新或公开分发证据。

## 决策与边界

ScreenHello 保持 `com.webcasa.screenhello` bundle identifier。Tauri 的 `app_data_dir()` 以该 identifier 为应用数据目录后缀，因此稳定的 identifier 是原生标记路径一致性的前提；WebView profile 的连续性仍须逐平台实机验证。本阶段不改变 WebView 的 `dataDirectory`、origin、IndexedDB key 或项目格式。[Tauri PathResolver](https://docs.rs/tauri/2.11.5/tauri/path/struct.PathResolver.html#method.app_data_dir) 对 `app_data_dir()` 的契约是数据目录加 bundle identifier。

原生层只维护一个私有的 `desktop-state-v1.json` 状态标记。它不是项目、草稿、预设、图片或 WebView cache 的副本，也不会扫描、导入、删除或重写它们。这样以后若确实引入原生状态变更，有一个可测试的迁移入口，而不会把不透明的浏览器存储当作可安全转换的数据。

标记包含 schema version 和最后一次见到的应用版本。首次运行会在应用数据目录创建它；同版本启动返回 `ready`；已知 schema 的版本变化用同目录临时文件写入、`sync_all` 后替换并返回 `migrated`。标记最大 1 KiB，拒绝 symlink、空文件、未知字段、未知 schema 和不安全版本字符串。遇到损坏或未知版本时，原字节保留，状态为 `unavailable`；应用仍可启动，不能通过“自动修复”覆盖未知数据。

WebView 只能读取以下有限状态，不能获取路径、底层错误、上次版本或任意标记内容：

```json
{
  "schemaVersion": 1,
  "status": "initialized | ready | migrated | unavailable",
  "dataSchemaVersion": 1
}
```

前端要求恰好这三项字段。桌面顶栏把结果放入 tooltip 和 `data-state-migration`，以便真实 WebView smoke 同时覆盖 Rust command 与 JS schema 校验；不以此状态宣称用户项目已经完成迁移。

## 安装、升级和卸载策略

| 平台 | 当前候选包 | 本阶段配置/保护 | 仍需人工验证 |
| --- | --- | --- | --- |
| Linux amd64 / arm64 | DEB | 标记按稳定 identifier 写入应用数据目录；没有应用数据删除 command | 新装、`dpkg`/发行版升级、卸载后 profile 与 WebKit 本地数据的保留 |
| macOS Intel / Apple Silicon | DMG | 保持 bundle identifier 与 macOS 11 最低版本；不改变 WebView store | 复制覆盖旧 app、启动后本地项目/草稿、移除 app 后用户数据、签名与公证 |
| Windows x64 / arm64 | NSIS | 显式 `currentUser` 安装，禁用 package downgrade；没有 NSIS app-data cleanup hook | 新装、同用户升级、卸载/重装后的本地数据、WebView2、签名与组织策略 |

Tauri 的 NSIS `currentUser` 模式不要求管理员权限，并将安装元数据放在当前用户范围；`allowDowngrades: false` 防止 Windows 安装器静默回退版本。配置语义以 [Tauri Windows Installer 文档](https://v2.tauri.app/distribute/windows-installer/) 和 [configuration reference](https://v2.tauri.app/reference/config/#nsisinstallermode) 为准。它们只定义候选包行为，不能替代真实安装器操作。

自动更新继续是 `deferred`。仓库没有 updater plugin、更新 endpoint、签名公钥或 updater artifact；Tauri updater 会生成带签名的更新产物并要求完整配置，因此不能在本阶段把普通无签名候选包称为可自动升级。[Tauri Updater 文档](https://v2.tauri.app/plugin/updater/) 记录了这些前置条件。

候选矩阵升级为 schema v6，新增 `stateMigration` runtime check，并对每个目标保留 `install-upgrade-uninstall-local-data` 人工项。自动 evidence 只有当真实 WebView 返回非 `unavailable` 的有限状态时才通过；人工项依旧使 `releaseReady=false`。

## 人工验收步骤

每个 OS/架构候选必须在独立的普通用户账户按以下顺序保留记录：

1. 从干净环境安装目标包，启动并保存一个 `.screenhello` 项目，创建草稿、预设和桌面偏好；确认状态标记为 `initialized` 或 `ready`。
2. 用平台的正常升级路径安装更高版本，不更改 bundle identifier、WebView data store 或用户账户；启动后确认状态标记为 `migrated` 或 `ready`，并分别打开项目、草稿、预设和导出。
3. 卸载应用，不执行任何额外的“清理数据”选项；记录应用数据和 WebView 本地状态是否仍在。重新安装并确认已保留的数据是否符合产品说明。
4. 另做损坏/未来 schema 标记测试：启动必须返回有限 `unavailable`，不能覆盖原文件或清除项目。恢复动作只能由用户在有备份的条件下明确执行。

截图权限、Portal、TCC、远程桌面、多显示器、签名、公证、商店渠道和 updater 有各自的 Gate，不应与上述生命周期测试互相替代。

## 本阶段完成条件

- 原生标记迁移有 Rust 单元测试，覆盖首次创建、同版本复用、已知版本升级、损坏/未知状态保留和脱敏 IPC。
- main-window capability、`build.rs` manifest、前端 validator、runtime smoke、release collector 和审计共用 `desktop_state_status` schema。
- Windows 候选明确为 current-user NSIS 且拒绝 downgrade；仓库不存在应用数据删除 hook。
- 安装、升级和卸载的真实 OS 结果仍作为所有六目标的 pending manual check 保存，而不是被自动构建证据替代。

Phase 8 的 macOS ARM64 与 Intel 签名候选仍未运行。它们不读取、重写或验证本页的本地状态标记，也不代替安装、升级、卸载或数据保留的人工检查。

## 后续阶段

Phase 6 已把代码签名、公证、更新信任根和 provenance 的当前“未配置”状态固化为可审计契约，仍没有启用其中任何一项。任何以后启用 Tauri updater、macOS notarization、MSIX 或商店沙箱的改动都必须重新定义安装、权限、身份和回滚验证，不能复用本阶段的无签名候选结论；详见[跨平台桌面 Phase 6](./desktop-cross-platform-phase-6.md)。
