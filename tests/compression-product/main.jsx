import { mountI18nHarness } from '../fixtures/i18n-harness.jsx';
import { AppContent } from '../../src/App.jsx';
import StoreProvider from '../../src/stores/StoreProvider.jsx';
import EditorErrorBoundary from '../../src/components/EditorErrorBoundary.jsx';

// Test-only entry: same service policy as main.jsx; PWA and draft restoration
// are exercised separately against the frozen standalone production build.
export function WebEditor(props) {
    return <EditorErrorBoundary locale={props.locale}>
        <StoreProvider runtimeOptions={{ locale: props.locale, webExportSafety: true }}>
            <AppContent {...props} />
        </StoreProvider>
    </EditorErrorBoundary>;
}
const profile = new URLSearchParams(window.location.search).get('profile') || 'library';
if (!['web', 'library'].includes(profile)) throw new Error('unknown compression harness profile');

// Actual App/ExportPanel/Workers, built for production. No alternate codec or tracker.
window.__compressionProduct = mountI18nHarness(document.getElementById('root'), profile === 'web' ? WebEditor : undefined);
window.__compressionProduct.profile = profile;
