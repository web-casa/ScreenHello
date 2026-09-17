/**
 * 记录应用真正设置给 `<a download>` 的文件名。
 *
 * 为什么需要它：Playwright 的 `download.suggestedFilename()` 取决于浏览器回报，而当前
 * Chromium（HeadlessChrome 151，Playwright 1.62）对**非 ASCII 文件名**会回落成 `"download"`，
 * blob: 与 data: 都一样；Firefox 与 WebKit 正常。最小复现（真实 http 源 + 真实用户手势）：
 *
 *   chromium  blob+中文  → download        firefox  blob+中文 → 未命名项目.screenhello
 *   chromium  blob+ASCII → report.txt      webkit   blob+中文 → 未命名项目.screenhello
 *
 * 应用侧行为正确（同源 blob、锚点已挂载、属性设置无误），所以文件名断言改为以"应用实际写入
 * 锚点的值"为准：这与 `suggestedFilename()` 表达的是同一个用户可见结果，且不受引擎回落影响。
 * 下载是否真的发生、内容是什么，仍然由真实的 download 事件与字节内容验证。
 */
export async function trackDownloadNames(page) {
    await page.addInitScript(() => {
        window.__screenhelloDownloadNames = [];
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function patchedClick(...args) {
            if (this.download) {
                window.__screenhelloDownloadNames.push({ name: this.download, protocol: this.protocol });
            }
            return click.apply(this, args);
        };
    });
}

/** 最近一次 `<a download>` 的文件名；没有记录时返回 null。 */
export function lastDownloadName(page) {
    return page.evaluate(() => {
        const list = window.__screenhelloDownloadNames || [];
        return list.length ? list[list.length - 1].name : null;
    });
}
