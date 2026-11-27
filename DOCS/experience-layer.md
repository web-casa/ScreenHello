# 体验层（动效、光照与微交互）

2026-10-05 新增。本文只描述当前工作树已实现的内容；验证范围见文末，未执行的项不视为通过。

## 设计意图

ScreenHello 的工作是「给截图一个画框」，所以体验层借用截图取景框的语言：四角准星、等宽读数、扫描线，以及会被指针点亮的点阵背景。颜色、圆角和面层级仍全部来自 `src/style/main.css` 的既有 token，体验层不新增配色体系。

原则：**空态可以有表演，编辑态必须安静**。欢迎页在没有图片时承担品牌表达；进入编辑后只保留不干扰判断颜色和构图的反馈（悬停、按压、进场）。

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/style/experience.css` | 全部视觉规则，由 `main.css` 顶部 `@import` 引入。规则不在 cascade layer 内，用于细化 `@layer components` 的组件样式 |
| `src/hooks/useStageMotion.js` | 欢迎页指针追踪：在舞台元素上写 `--se-lx/--se-ly`（光照位置）、`--se-tx/--se-ty`（视差，-1～1）、`--se-dot-x/--se-dot-y`（点阵对齐），并更新坐标/尺寸读数 |
| `src/hooks/usePressedKeys.js` | 监听粘贴组合键的按下状态，让提示里的键帽同步高亮 |
| `src/components/init/Init.jsx` | 欢迎页结构：舞台光层、滚动容器、取景框卡槽 |
| `src/components/header/AppearanceControls.jsx` | 主题切换的虹膜过渡（View Transitions） |

## 效果清单

欢迎页：

- 取景框卡槽：原 `.shoteasy-init-art-button` 仍是唯一的图片选择按钮，可访问名称、`aria-describedby`、键盘激活和拖放行为不变。四角准星在悬停/聚焦时内收并变为强调色，按下时进一步收紧，拖入文件时锁定。
- 读数均为真实信息：左上是指针在卡槽内的坐标（仅精细指针且移动时显示），左下是导出格式，右下是卡槽当前的 CSS 像素尺寸。它们是 `aria-hidden` 的装饰，不引入新的 i18n 词条。
- 指针光照：点阵背景在指针附近变亮。亮点层按 `.polka` 的 14px 网格对齐，偏移量由 hook 根据舞台相对 `.shoteasy-app` 的位置计算。
- 插图视差：玻璃图标随指针做最多约 13° 的 3D 倾斜，光晕与网格反向位移；指针离开后回正。
- 键帽回显：按住 Ctrl/⌘ 或 V 时，提示里的对应键帽高亮。
- 入场编排：品牌行、标题、卡槽、操作行、页脚依次上浮；准星与读数稍后出现。
- 拖放浮层：全工作区毛玻璃 + 四角准星脉冲。编辑态的「释放以更换图片」共用同一样式。

编辑态：

- 画布背后的柔光（`.shoteasy-editor-canvas::before`），不进入 Leafer 画布，不影响导出。
- 标注工具栏和缩放控件改为毛玻璃面；工具按钮悬停上浮，当前工具带一个指示点。
- 外框缩略图悬停上浮、选中项角标；背景色片弹性缩放；预设图片卡片上浮；滑块手柄放大。
- 导出按钮与「选择图片」悬停时有一次高光扫过。

主题切换：

- 独立站在支持 `document.startViewTransition` 的浏览器中，新主题从切换按钮位置以圆形展开。作用域类 `shoteasy-theme-transition` 只在过渡期间加到 `<html>`，不会改写宿主页面自己的 view transition。
- 通过 `ImageBeautifier` 嵌入（`workspace` 未启用）时不使用该过渡，避免冻结宿主文档；菜单和快捷键路径不变。

## 约束

- **减少动效**：`prefers-reduced-motion: reduce` 下所有关键帧动画不注册，指针光照层和扫描线不显示，主题直接切换。E2E 默认运行在该模式下。
- **触控**：`pointerType === 'touch'` 或非 `(hover: hover) and (pointer: fine)` 时不做光照和视差。
- **CSP**：只通过 CSSOM 写自定义属性和类名，不注入 `<style>`。
- **多实例**：自定义属性写在各自实例的舞台元素上，卸载时移除监听、动画帧和属性。
- **层叠顺序**：`main.css` 末尾的小屏规则不在 layer 内且晚于 `@import`，因此体验层的小屏覆盖都带 `.shoteasy-app` 前缀以提高优先级。新增小屏规则时沿用这一写法。
- **混合模式**：欢迎页插图是黑底位图，依赖 `mix-blend-mode`。它必须位于不透明的 `.shoteasy-vf__plate`（自带 `isolation`）之内，否则黑底会露出来。
- **测试契约**：`tests/e2e/ambient-init.spec.js` 依赖 `.shoteasy-init-art`（卡槽内唯一的 `<img>`）、标题纯色文字、「试用示例」按钮的背景色，以及 `.shoteasy-init-canvas` 无横向溢出；改动欢迎页时保留这些条件。

## 验证

2026-10-05，本机 Linux arm64、Playwright 当前 Chromium：

- `pnpm lint`、`pnpm typecheck`、`pnpm test:unit`、`pnpm build`、`pnpm build:lib` 通过。
- `pnpm audit:pwa` 通过（预缓存 54 项、3,324,526 字节）；`pnpm test:consumer` 18 项通过。
- Chromium 全量 E2E（`chromium` + `chromium-runtime`）：145 通过、2 跳过。Firefox 与 WebKit 只跑了 `ambient-init.spec.js` 和 `theme-readability.spec.js`：44 通过、4 跳过。
- 首屏 golden 已重新生成，见 [quality-baseline.md](./quality-baseline.md#golden-基线)；其余三张 golden 未变。
- 未在真实 Safari、触控实机或 Tauri 桌面壳中验证，Firefox/WebKit 未跑全量。主题虹膜过渡、指针光照、视差和键帽回显只在 Chromium 非 reduced-motion 下截图目视确认；E2E 运行在 reduced-motion 下，不覆盖动效本身。
