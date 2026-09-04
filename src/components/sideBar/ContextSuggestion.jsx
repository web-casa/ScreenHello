import { Button } from 'antd';
import { observer } from 'mobx-react-lite';
import useStores from '@stores/useStores';
import { getFrameDefinition } from '@utils/frameConfig';

const LABELS = Object.freeze({
    background: '背景',
    'inner-border': '内描边',
    frame: '外框',
});

const sameColor = (left, right) => String(left || '').toLowerCase() === String(right || '').toLowerCase();

function suggestionPresentation(kind, suggestion) {
    if (kind === 'background') {
        return {
            value: suggestion.edgeColor,
            preview: <span className="shoteasy-context-suggestion__swatch" style={{ background: suggestion.edgeColor }} aria-hidden="true" />,
        };
    }
    if (kind === 'inner-border') {
        return {
            value: `${suggestion.innerBorder.width}px · ${suggestion.innerBorder.color}`,
            preview: (
                <span
                    className="shoteasy-context-suggestion__border-preview"
                    style={{ boxShadow: `inset 0 0 0 ${Math.max(1, suggestion.innerBorder.width)}px ${suggestion.innerBorder.color}` }}
                    aria-hidden="true"
                />
            ),
        };
    }
    const frame = getFrameDefinition(suggestion.frame);
    return {
        value: frame.title,
        preview: (
            <span className="shoteasy-context-suggestion__frame-preview" data-kind={frame.kind} aria-hidden="true">
                <i />
            </span>
        ),
    };
}

function isSuggestionApplied(kind, suggestion, option) {
    if (kind === 'background') {
        return option.background === 'custom_solid'
            && sameColor(option.frameConf.background?.color, suggestion.edgeColor);
    }
    if (kind === 'inner-border') {
        return option.innerBorder.visible === suggestion.innerBorder.visible
            && option.innerBorder.width === suggestion.innerBorder.width
            && sameColor(option.innerBorder.color, suggestion.innerBorder.color);
    }
    return option.frame === suggestion.frame;
}

export default observer(function ContextSuggestion({ kind }) {
    const stores = useStores();
    if (!stores.workspace.enabled || !stores.imageStore.list.length) return null;

    const state = stores.workspace.suggestions;
    const label = LABELS[kind];
    const busy = stores.commands.isBusy;
    const retry = () => { void stores.workspace.analyzeSuggestions(); };

    if (state.status === 'analyzing' || state.status === 'idle') {
        return (
            <div className="shoteasy-context-suggestion is-pending" aria-busy={state.status === 'analyzing'}>
                <span className="shoteasy-context-suggestion__eyebrow">本地建议</span>
                <span>{state.status === 'analyzing' ? '正在此设备分析…' : '等待分析图片'}</span>
            </div>
        );
    }

    if (state.status === 'unavailable' || !state.result) {
        return (
            <div className="shoteasy-context-suggestion is-error">
                <span>暂时无法生成{label}建议</span>
                <Button
                    type="link"
                    size="small"
                    disabled={busy}
                    aria-label={busy ? `${label}本地建议暂不可用：正在处理其他本地任务` : `重新分析${label}本地建议`}
                    onClick={retry}
                >
                    {busy ? '处理中' : '重试'}
                </Button>
            </div>
        );
    }

    const suggestion = state.result;
    const presentation = suggestionPresentation(kind, suggestion);
    const applied = isSuggestionApplied(kind, suggestion, stores.option);

    return (
        <div className="shoteasy-context-suggestion" data-suggestion-kind={kind}>
            <span className="shoteasy-context-suggestion__preview">{presentation.preview}</span>
            <span className="shoteasy-context-suggestion__copy">
                <span className="shoteasy-context-suggestion__eyebrow">本地建议</span>
                <strong>{presentation.value}</strong>
            </span>
            <Button
                type="link"
                size="small"
                disabled={applied || busy}
                aria-label={applied
                    ? `${label}本地建议已应用`
                    : busy
                        ? `${label}本地建议暂不可用：正在处理其他本地任务`
                        : `应用${label}本地建议`}
                onClick={() => stores.workspace.applySuggestion(kind)}
            >
                {applied ? '已应用' : busy ? '处理中' : '应用'}
            </Button>
        </div>
    );
});
