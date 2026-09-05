import { useEffect, useState } from 'react';
import { readDesktopEnvironment, readDesktopSystemStatus } from './desktopBridge';

const INITIAL_STATUS = Object.freeze({ status: 'checking' });
const PLATFORM_LABELS = Object.freeze({ linux: 'Linux', macos: 'macOS', windows: 'Windows' });
const ARCH_LABELS = Object.freeze({ aarch64: 'ARM64', x86_64: 'x64', x86: 'x86' });

export default function DesktopRuntimeStatus() {
    const [result, setResult] = useState(INITIAL_STATUS);
    const [systemResult, setSystemResult] = useState(INITIAL_STATUS);

    useEffect(() => {
        let active = true;
        readDesktopEnvironment().then((nextResult) => {
            if (active) setResult(nextResult);
        });
        readDesktopSystemStatus().then((nextResult) => {
            if (active) setSystemResult(nextResult);
        });
        return () => { active = false; };
    }, []);

    const ready = result.status === 'ready';
    const label = ready
        ? `桌面 · ${PLATFORM_LABELS[result.environment.platform]} ${ARCH_LABELS[result.environment.arch] || result.environment.arch}`
        : (result.status === 'checking' ? '正在连接桌面能力' : '桌面能力不可用');
    const systemReady = systemResult.status === 'ready';
    const title = ready
        ? [
            `ScreenHello ${result.environment.appVersion}`,
            systemReady ? `快捷键 ${systemResult.system.shortcutAccelerator}（${systemResult.system.shortcut === 'registered' ? '已注册' : '不可用'}）` : null,
            systemReady ? `托盘${systemResult.system.tray === 'ready' ? '已就绪' : '不可用'} · 单实例已就绪` : null,
            systemResult.status === 'unavailable' ? '系统快捷键与托盘状态不可用' : null,
        ].filter(Boolean).join(' · ')
        : label;

    return (
        <span
            role="status"
            aria-live="polite"
            data-testid="desktop-runtime-status"
            data-status={result.status}
            data-platform={ready ? result.environment.platform : undefined}
            data-arch={ready ? result.environment.arch : undefined}
            data-shortcut={systemReady ? systemResult.system.shortcut : undefined}
            data-tray={systemReady ? systemResult.system.tray : undefined}
            data-single-instance={systemReady ? systemResult.system.singleInstance : undefined}
            title={title}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 28,
                padding: '0 10px',
                border: '1px solid var(--se-border)',
                borderRadius: 999,
                color: 'var(--se-muted)',
                fontSize: 12,
                whiteSpace: 'nowrap',
            }}
        >
            {label}
        </span>
    );
}
