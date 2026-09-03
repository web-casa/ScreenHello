# Contributing to ScreenHello

感谢你改进 ScreenHello。项目坚持纯本地处理：新功能不得在没有清晰产品决策和用户同意的情况下上传图片、项目、草稿、剪贴板内容或分析数据。

## 开发环境

- Node.js 24.x；仓库中的 `.node-version` 和 `.nvmrc` 是准确版本来源。
- pnpm 10.12.1；使用 Corepack 或与 `packageManager` 字段一致的安装方式。
- 首次运行浏览器测试前执行 `pnpm exec playwright install --with-deps chromium firefox webkit`。

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
```

完整验证还包括 PWA、release、library consumer、许可证和体积门禁，命令见 [开发文档](DOCS/development.md)。

## 提交与 Pull Request

1. 一个 PR 聚焦一个主要问题，避免把依赖主版本、数据格式和产品功能混为一次变更。
2. 先复用现有 runtime、store、platform adapter 和导出服务；公共 API 变化必须同步类型、consumer 测试和文档。
3. 新增或修复行为要有与风险相称的单元或浏览器回归测试。
4. 不提交构建产物、真实 `.env`、访问令牌、用户图片或无法确认再分发许可的素材。
5. PR 描述应说明问题、方案、验证命令、用户可见变化和回滚方式。

提交代码或素材表示贡献者有权按本仓库 MIT License 提供该内容。素材还必须在
[资产来源记录](ASSET_PROVENANCE.md) 或第三方 notices 中写明来源、作者、精确许可和署名要求；仅有下载页面链接不构成可再分发许可。

公共贡献合并后会被维护者同步到完整开发仓，以保持下一次公开晋级不会覆盖社区修复。公开历史不会为同步需要而 force-push 或重写。

## 报告问题

普通缺陷可以使用 issue 模板。可能包含漏洞利用细节、隐私泄漏或供应链风险的问题，请不要创建公开 issue，而应按 [安全策略](SECURITY.md) 私下报告。
