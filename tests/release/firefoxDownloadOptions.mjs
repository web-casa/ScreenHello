import { Options } from 'selenium-webdriver/firefox.js';

// Configure only the disposable WebDriver profile. Keep actual anchor downloads,
// codecs, security checks, rendering throttles and all application limits intact.
// Firefox 128 otherwise opens its downloads panel and can internally preview
// WebP/AVIF files, stealing the foreground asynchronously between UI actions.
export function firefoxDownloadOptions() {
    return new Options()
        .setPreference('browser.download.alwaysOpenPanel', false)
        .setPreference('browser.download.panel.shown', true)
        .setPreference('browser.download.viewableInternally.enabledTypes', '')
        .setPreference('browser.download.useDownloadDir', true)
        .setPreference('browser.helperApps.neverAsk.saveToDisk', 'image/png,image/jpeg,image/webp,image/avif,application/zip');
}
