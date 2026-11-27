# 跨平台桌面 Phase 24：公开源码快照与发布交接契约

## 状态

本阶段将 `config/desktop-release-matrix.json` 升至 schema v24。在 Phase 23 的候选外发布计划之上，它新增一个只可写入一次的 `desktop-public-release-handoff.json`。交接文件把同一 immutable candidate commit 的 `package.json` 版本、六个 direct-download 安装包、五个 Linux APT sidecar、Phase 23 计划 SHA-256 和公开源码导出快照绑定在一起。

交接文件始终为 `releaseReady=false`。本阶段没有读取 secret 值、进入 Environment、创建或推送 tag、创建 GitHub Release、上传 asset、部署 APT endpoint、签名、公证、时间戳、attestation 或公开下载。

## 为什么需要这个边界

候选构建所属提交与公开 GitHub Release 的目标仓库不是同一个 Git 提交空间。仅知道 candidate SHA 或 `package.json` 版本，不能证明即将公开的源码树与经过审查的内容一致。

因此交接时从 candidate Git 根目录的指定提交读取，而不读取工作树：

1. 只接受 40 位小写 immutable commit SHA，拒绝 Git replace ref 和影响 Git 对象选择的环境覆盖；
2. 从该提交的 `package.json` 读取严格 SemVer 2.0.0 版本并派生 beta tag，例如 `1.0.4` 对应 `v1.0.4`；纯数字的 prerelease identifier 不得有前导零，允许的 build metadata 也会原样进入 tag；
3. 从该提交的 `config/public-export-manifest.json` 读取 allowlist，生成所有公开文件及 `PUBLIC_REPOSITORY.json` 的路径、模式、字节数和 SHA-256，并计算稳定的 `treeSha256`；
4. 将该提交树临时物化后复用公开仓审计，拒绝未允许路径、符号链接、私有过程文件、凭据模式、未审查视觉资源、失效相对引用和不符合公开包契约的内容；
5. 拒绝候选提交伪造生成的 `PUBLIC_REPOSITORY.json`，因为这个标记只可由导出器生成；
6. 将交接输出置于 bundle、release review、payload manifest、publication plan 和 candidate Git 根目录之外，使用 `wx` 原子创建并在写入、读取前后重新验证。

这份快照证明的是“候选提交可导出的公开内容”。未来受保护的公开目标 workflow 仍必须在目标 `main` 上重建并比较该快照，确认匹配后才有资格进入发布步骤。

## 本地交接

完成 Phase 17～23 的完整复核后，准备一个与所有输入目录和 candidate Git 根目录分离的既有目录：

```bash
pnpm desktop:verify-release-publication-handoff -- \
  --write-handoff \
  --bundle-dir /secure/review/screenhello-<candidate-sha>/bundle \
  --review-dir /secure/review/screenhello-<candidate-sha>/release-review \
  --manifest-dir /secure/review/screenhello-<candidate-sha>/payload-manifest \
  --publication-plan-dir /secure/review/screenhello-<candidate-sha>/publication-plan \
  --candidate-git-dir /secure/candidates/screenhello-source \
  --handoff-dir /secure/review/screenhello-<candidate-sha>/public-handoff
```

在交接给后续受保护 publisher 前，必须重新验证：

```bash
pnpm desktop:verify-release-publication-handoff -- \
  --verify-handoff \
  --bundle-dir /secure/review/screenhello-<candidate-sha>/bundle \
  --review-dir /secure/review/screenhello-<candidate-sha>/release-review \
  --manifest-dir /secure/review/screenhello-<candidate-sha>/payload-manifest \
  --publication-plan-dir /secure/review/screenhello-<candidate-sha>/publication-plan \
  --candidate-git-dir /secure/candidates/screenhello-source \
  --handoff-dir /secure/review/screenhello-<candidate-sha>/public-handoff
```

JSON 不含绝对路径、token、证书、私有仓库名称、下载 URL 或发布操作。它只记录必要的提交、版本、相对路径、模式、字节数、SHA-256、公开导出 tree hash 和固定的 beta metadata。

## 未来受保护发布仍需配置

Phase 24 没有新增跨仓库 publisher。后续方案必须先由管理员配置并在真实 GitHub 环境复核：

1. 公开 `web-casa/ScreenHello` 的受保护 promotion workflow 与 Environment；
2. 只用于读取候选交接资料的 GitHub App installation token，以及只在公开目标仓中使用、具备最小 `contents: write` 权限的 `GITHUB_TOKEN`；
3. 将公开目标 `main` 的导出快照与交接 `treeSha256` 精确比较；
4. 由明确授权的 publisher 创建 beta tag，并只上传六个直接下载 asset 和其 SHA-256；
5. 在独立静态 HTTPS endpoint 保持 APT 的 `dists/`/`pool/` 布局、keyring 分发、轮换和撤销演练；
6. updater 信任根、endpoint、密钥轮换和商店渠道的独立方案。

这些条件、真实签名候选、远端 attestation、平台人工验收和用户明确发布授权均未满足。交接文件不构成发布许可。

## Review 与验证

`tests/unit/desktopCrossPlatformAcceptance.test.js` 使用实际 Git fixture 覆盖版本/tag 派生、6+5 载荷边界、候选根目录内输出拒绝、重复写入拒绝和 handoff 篡改拒绝。`tests/unit/publicRepository.test.js` 覆盖 committed-blob 快照、生成标记、工作树变化不影响旧提交快照、tree hash 篡改拒绝，以及候选提交预置生成标记的拒绝。contract、trust 和 Gate workflow 审计将 schema v24、公开目标、`makeLatest=false`、`releaseReady=false` 和触发路径固定为 fail-closed 约束。

本地验证只能证明这份交接代码和资料格式；它不替代 GitHub-hosted Environment 审批、跨仓库身份、真实签名/公证、公开仓快照匹配或任何发布动作。
