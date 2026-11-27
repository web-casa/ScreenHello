/* eslint-disable react-refresh/only-export-components -- 独立对照入口，不参与应用构建。 */
import React from 'react';
import ReactDOM from 'react-dom/client';

import '@radix-ui/themes/styles.css';

import {
    Provider as SP, defaultTheme, Button as SBtn, ActionButton as SActionBtn,
    Slider as SSlider, Switch as SSwitch, Item as SItem,
    View as SView, Flex as SFlex, Heading as SHeading, ActionGroup as SActionGroup,
} from '@adobe/react-spectrum';
import SCrop from '@spectrum-icons/workflow/Crop';
import SFlipH from '@spectrum-icons/workflow/FlipHorizontal';
import SFlipV from '@spectrum-icons/workflow/FlipVertical';
import SPosition from '@spectrum-icons/workflow/Move';
import SMore from '@spectrum-icons/workflow/ChevronRight';

import {
    Theme as RT, IconButton as RIconBtn, Slider as RSlider, Switch as RSwitch,
    Tabs as RTabs, Flex as RFlex, Box as RBox,
    Text as RText, Heading as RHeading, Separator as RSeparator, Tooltip as RTooltip,
} from '@radix-ui/themes';
import { CropIcon as RCrop, TransformIcon as RFlip, LayersIcon as RLayers } from '@radix-ui/react-icons';

import './style/inspector-preview.css';

/* 目标：不是"设计一个新右栏"，而是把 main 的右栏结构原样喂给两套官方系统，
   看谁在 320px 宽、控件密集的真实约束下更精致。结构与文案完全照抄 main。 */

const PRESETS = ['无背景', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'];
const GRADIENTS = [
    'linear-gradient(135deg,#5B3DF5,#C8408F)', 'linear-gradient(135deg,#2B1B6B,#7A2EA8)',
    'linear-gradient(135deg,#2563EB,#38BDF8)', 'linear-gradient(135deg,#F5C518,#E8603C)',
    'linear-gradient(135deg,#1F6F52,#7FC8A9)', 'linear-gradient(135deg,#B45309,#F59E0B)',
    'linear-gradient(135deg,#1E1B4B,#4C1D95)', 'linear-gradient(135deg,#0EA5E9,#22D3EE)',
];
const IMAGE_BGS = ['linear-gradient(160deg,#93A7B8,#DCE3E8)', 'linear-gradient(160deg,#D9BE96,#F3E9DA)', 'linear-gradient(160deg,#8FA9A0,#E3EDE9)'];

function SectionTitle({ children, system }) {
    if (system === 'spectrum') return <SHeading level={4} margin={0} UNSAFE_style={{ fontSize: 13, fontWeight: 700 }}>{children}</SHeading>;
    return <RHeading size="2" weight="bold" m="0">{children}</RHeading>;
}

function Label({ children }) {
    return <span className="ip-label">{children}</span>;
}

/* ---------------- Spectrum 版右栏 ---------------- */
function SpectrumInspector() {
    return <SFlex direction="column" gap="size-200">
        <SectionTitle system="spectrum">背景</SectionTitle>
        <SFlex direction="column" gap="size-100">
            <SFlex justifyContent="space-between" alignItems="center">
                <Label>预设</Label>
                <SBtn variant="secondary" aria-label="更多"><SMore /></SBtn>
            </SFlex>
            <div className="ip-swatches">
                {PRESETS.map((p, i) => <button key={p} className={'ip-swatch' + (i === 1 ? ' is-on' : '')} aria-label={p}
                    style={i === 0 ? { borderStyle: 'dashed' } : { background: GRADIENTS[i - 1] }} />)}
            </div>
        </SFlex>
        <SFlex direction="column" gap="size-100">
            <SFlex justifyContent="space-between" alignItems="center">
                <Label>精选渐变</Label>
                <SBtn variant="secondary"><SMore /></SBtn>
            </SFlex>
            <div className="ip-swatches">
                {GRADIENTS.map((g, i) => <button key={g} className={'ip-swatch' + (i === 3 ? ' is-on' : '')} aria-label={'渐变' + i} style={{ background: g }} />)}
            </div>
            <div className="ip-thumbs">
                {IMAGE_BGS.map((g, i) => <button key={g} className="ip-thumb" aria-label={'图片背景' + i} style={{ background: g }} />)}
            </div>
        </SFlex>

        <SView height="size-10" UNSAFE_style={{ borderBottom: '1px solid var(--spectrum-gray-200)' }} />

        <SectionTitle system="spectrum">图片</SectionTitle>
        <Label>快速</Label>
        <SFlex gap="size-100">
            <SActionBtn aria-label="裁剪"><SCrop /></SActionBtn>
            <SActionBtn aria-label="水平翻转"><SFlipH /></SActionBtn>
            <SActionBtn aria-label="垂直翻转"><SFlipV /></SActionBtn>
            <SActionBtn aria-label="位置"><SPosition /></SActionBtn>
        </SFlex>
        <SSlider label="缩放" minValue={0.1} maxValue={3} step={0.1} defaultValue={1} />
        <SSlider label="内边距" minValue={0} maxValue={200} defaultValue={72} />
        <SSlider label="旋转" minValue={-180} maxValue={180} defaultValue={0} />

        <SectionTitle system="spectrum">边框 · 阴影</SectionTitle>
        <Label>图片填充</Label>
        <SActionGroup aria-label="图片填充" selectionMode="single" defaultSelectedKeys={['cover']} isQuiet>
            <SItem key="cover">覆盖</SItem><SItem key="fit">包含</SItem><SItem key="stretch">拉伸</SItem>
        </SActionGroup>
        <SFlex alignItems="center" gap="size-100">
            <SSwitch defaultSelected>内描边</SSwitch>
            <span className="ip-color" style={{ background: '#111827' }} />
        </SFlex>
        <SSlider label="圆角" minValue={0} maxValue={60} defaultValue={10} />
        <SSlider label="阴影" minValue={0} maxValue={60} defaultValue={12} />
    </SFlex>;
}

/* ---------------- Radix Themes 版右栏 ---------------- */
function RadixInspector() {
    return <RFlex direction="column" gap="4">
        <SectionTitle system="radix">背景</SectionTitle>
        <RFlex direction="column" gap="2">
            <RFlex justify="between" align="center"><Label>预设</Label><RText size="1" color="gray">更多 ›</RText></RFlex>
            <div className="ip-swatches">
                {PRESETS.map((p, i) => <button key={p} className={'ip-swatch' + (i === 1 ? ' is-on' : '')} aria-label={p}
                    style={i === 0 ? { borderStyle: 'dashed' } : { background: GRADIENTS[i - 1] }} />)}
            </div>
        </RFlex>
        <RFlex direction="column" gap="2">
            <RFlex justify="between" align="center"><Label>精选渐变</Label><RText size="1" color="gray">更多 ›</RText></RFlex>
            <div className="ip-swatches">
                {GRADIENTS.map((g, i) => <button key={g} className={'ip-swatch' + (i === 3 ? ' is-on' : '')} aria-label={'渐变' + i} style={{ background: g }} />)}
            </div>
            <div className="ip-thumbs">
                {IMAGE_BGS.map((g, i) => <button key={g} className="ip-thumb" aria-label={'图片背景' + i} style={{ background: g }} />)}
            </div>
        </RFlex>

        <RSeparator size="4" />

        <SectionTitle system="radix">图片</SectionTitle>
        <Label>快速</Label>
        <RFlex gap="1">
            <RTooltip content="裁剪"><RIconBtn variant="soft" color="gray" aria-label="裁剪"><RCrop /></RIconBtn></RTooltip>
            <RTooltip content="水平翻转"><RIconBtn variant="soft" color="gray" aria-label="水平翻转"><RFlip /></RIconBtn></RTooltip>
            <RTooltip content="垂直翻转"><RIconBtn variant="soft" color="gray" aria-label="垂直翻转"><RFlip /></RIconBtn></RTooltip>
            <RTooltip content="位置"><RIconBtn variant="soft" color="gray" aria-label="位置"><RLayers /></RIconBtn></RTooltip>
        </RFlex>
        {[['缩放', '1.0', 31], ['内边距', '72', 36], ['旋转', '0', 50]].map(([name, value, pct]) => (
            <RFlex key={name} direction="column" gap="1">
                <RFlex justify="between" align="center"><Label>{name}</Label><RText size="1" color="gray">{value}</RText></RFlex>
                <RSlider defaultValue={[pct]} />
            </RFlex>
        ))}

        <SectionTitle system="radix">边框 · 阴影</SectionTitle>
        <Label>图片填充</Label>
        <RTabs.Root defaultValue="cover">
            <RTabs.List size="1">
                <RTabs.Trigger value="cover">覆盖</RTabs.Trigger>
                <RTabs.Trigger value="fit">包含</RTabs.Trigger>
                <RTabs.Trigger value="stretch">拉伸</RTabs.Trigger>
            </RTabs.List>
        </RTabs.Root>
        <RFlex align="center" gap="2">
            <RSwitch defaultChecked /><Label>内描边</Label>
            <span className="ip-color" style={{ background: '#111827', marginLeft: 'auto' }} />
        </RFlex>
        {[['圆角', '10', 17], ['阴影', '12', 20]].map(([name, value, pct]) => (
            <RFlex key={name} direction="column" gap="1">
                <RFlex justify="between" align="center"><Label>{name}</Label><RText size="1" color="gray">{value}</RText></RFlex>
                <RSlider defaultValue={[pct]} />
            </RFlex>
        ))}
    </RFlex>;
}

function Panel({ system, mode, children }) {
    return <div className="ip-panel">
        <div className="ip-cap">{system} · {mode} · 320px</div>
        <div className="ip-body">{children}</div>
    </div>;
}

function App() {
    return <main className="ip-shell">
        <h1>右栏对照 · main 的结构 + 两套官方系统</h1>
        <p className="ip-lede">
            结构与文案完全照抄 main 的右栏（背景 / 图片 / 边框·阴影），宽度锁定 320px（真实约束）。
            左边是 Spectrum，右边是 Radix Themes，各自浅色与深色。没有手写 SVG，没有调参美化。
        </p>
        <div className="ip-grid">
            <Panel system="Spectrum" mode="light"><SP theme={defaultTheme} colorScheme="light" scale="medium"><SpectrumInspector /></SP></Panel>
            <Panel system="Spectrum" mode="dark"><SP theme={defaultTheme} colorScheme="dark" scale="medium"><SpectrumInspector /></SP></Panel>
            <Panel system="Radix" mode="light"><RT appearance="light" accentColor="indigo" grayColor="slate" radius="medium"><RBox p="3"><RadixInspector /></RBox></RT></Panel>
            <Panel system="Radix" mode="dark"><RT appearance="dark" accentColor="indigo" grayColor="slate" radius="medium"><RBox p="3"><RadixInspector /></RBox></RT></Panel>
        </div>
    </main>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
