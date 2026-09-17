// Self-contained because WebDriver and Playwright serialize this into the page.
export function readMobileAnnotation() {
    const drawer = document.querySelector('.shoteasy-mobile-annotation-drawer [role="dialog"]');
    const primarySection = [...(drawer?.querySelectorAll('section[aria-labelledby]') || [])]
        .find((section) => {
            const heading = document.getElementById(section.getAttribute('aria-labelledby'));
            return heading && section.contains(heading) && heading.textContent?.trim() === '形状与线条';
        });
    const buttons = [...(primarySection?.querySelectorAll('.shoteasy-mobile-tool-grid button') || [])];
    return {
        labels: buttons.map((button) => button.getAttribute('aria-label')),
        minimumTargetSize: buttons.length ? Math.round(Math.min(...buttons.map((button) => {
            const rect = button.getBoundingClientRect();
            return Math.min(rect.width, rect.height);
        }))) : 0,
        noHorizontalOverflow: Boolean(drawer && drawer.scrollWidth <= drawer.clientWidth),
    };
}
