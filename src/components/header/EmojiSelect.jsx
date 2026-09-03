import { forwardRef, lazy, Suspense, useState } from 'react';
import { Button, Popover } from 'antd';
import Icon from '@components/Icon';

const EmojiPicker = lazy(() => import('./EmojiPicker'));

const EmojiSelect = forwardRef(function EmojiSelect({ disabled = false, toSelect, locale = 'en', theme = 'auto' }, ref) {
    const [open, setOpen] = useState(false);
    const hide = () => {
        setOpen(false);
    };
    const handleOpenChange = (newOpen) => {
        setOpen(newOpen);
    };
    const onEmojiSelect = (e) => {
        toSelect(e.native);
        hide();
    }
    return (
        <Popover
            content={(
                <div>
                    {open && (
                        <Suspense fallback={<div role="status" className="p-4 text-xs">正在加载表情…</div>}>
                            <EmojiPicker locale={locale} onEmojiSelect={onEmojiSelect} theme={theme} />
                        </Suspense>
                    )}
                </div>
            )}
            title=""
            trigger="click"
            open={open}
            onOpenChange={handleOpenChange}
        >
            <Button
                ref={ref}
                type="text"
                shape="circle"
                disabled={disabled}
                aria-label="选择表情"
                icon={<Icon.Smile size={16} />}
            ></Button>
        </Popover>
    );
});

export default EmojiSelect;
