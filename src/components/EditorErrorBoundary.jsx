import { Component } from 'react';
import { RecoveryContext } from '../stores/recoveryContext';
import { translateMessage } from '../i18n/i18n';

export default class EditorErrorBoundary extends Component {
    state = { error: null, safeRecovery: false };

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        this.props.onError?.(error, info);
    }

    reset = () => {
        this.setState({ error: null });
    };

    resetSafely = () => {
        this.setState({ error: null, safeRecovery: true });
    };

    render() {
        const t = (source) => translateMessage(source, this.props.getLocale?.() ?? this.props.locale, this.props.getMessages?.() ?? this.props.messages);
        if (!this.state.error) return (
            <RecoveryContext.Provider value={this.state.safeRecovery}>
                {this.props.children}
            </RecoveryContext.Provider>
        );
        return (
            <div className="shoteasy-error-boundary" role="alert">
                <strong>{t('编辑器暂时无法继续运行')}</strong>
                <span>{t('你的图片不会上传。可以重试；如果问题仍然存在，请重新打开页面。')}</span>
                <button type="button" onClick={this.reset}>{t('重试')}</button>
                <button type="button" onClick={this.resetSafely}>{t('保留草稿并以空白编辑器重试')}</button>
            </div>
        );
    }
}
