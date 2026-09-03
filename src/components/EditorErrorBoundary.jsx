import { Component } from 'react';

export default class EditorErrorBoundary extends Component {
    state = { error: null };

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        this.props.onError?.(error, info);
    }

    reset = () => {
        this.setState({ error: null });
    };

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div className="shoteasy-error-boundary" role="alert">
                <strong>编辑器暂时无法继续运行</strong>
                <span>你的图片不会上传。可以重试；如果问题仍然存在，请重新打开页面。</span>
                <button type="button" onClick={this.reset}>重试</button>
            </div>
        );
    }
}
