// @ts-check
// 库产物自带 Radix 的主题变量、组件样式与接入桥接：宿主只需要提供 peerDependencies
// （React/ReactDOM/MobX/antd 等），不需要安装 @radix-ui/themes，也不需要额外引入它的样式表。
// 只取 tokens + components：库内界面用到的是 Button/IconButton/Switch/TextField/
// SegmentedControl 与复用的 .rt-Slider* 类名，不含 Radix 布局组件与 rt-r-* 工具类。
// radix-bridge.css 与站点同一份：顶栏 Radix 包裹层的 display:contents、
// 深色 token 对齐、44px 触控目标都必须在库产物里生效，否则宿主里顶栏会被撑高。
import '@radix-ui/themes/tokens.css';
import '@radix-ui/themes/components.css';
import './style/radix-bridge.css';
import ImageBeautifierComponent from './App';

/** @type {typeof import('../types/index').ImageBeautifier} */
export const ImageBeautifier = ImageBeautifierComponent;
