export const isEditableTarget = (target) => {
    if (!target || typeof target.isContentEditable !== 'boolean') return false;
    return target.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};
