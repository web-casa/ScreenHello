// This smoke covers foreground editing. A download may open another browser
// tab; WebDriver can still execute scripts in the now-hidden original tab.
// Return to the editor like a user would, and fail closed if it stays hidden.
export async function activateEditorWindow(driver, handle) {
    await driver.switchTo().window(handle);
    let state;
    await driver.wait(async () => {
        state = await driver.executeScript(() => ({
            visibility: document.visibilityState,
            focused: document.hasFocus(),
        }));
        return state?.visibility === 'visible' && state.focused === true;
    }, 10_000, 'editor window did not return to the foreground');
    return state;
}
