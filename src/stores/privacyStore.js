import { makeAutoObservable, runInAction } from 'mobx';
import { privacySnapshot, resetPrivacyCounters, subscribePrivacy } from '@utils/privacyMonitor';

/**
 * 隐私计数器的实例视图。
 *
 * 计数本身是**页面级**的（一个标签页里所有出口流量由同一份监控统计），
 * 因此同一页面上的多个编辑器实例会显示同一个真实数字——这一点刻意如此：
 * 它回答的是"这个页面往外发过数据吗"，而不是"这个实例"。
 * 实例只负责订阅/退订，销毁时不留监听器。
 */
export class PrivacyStore {
    uploadedBytes = 0;
    remoteRequests = 0;
    localRequests = 0;
    unknownBody = 0;
    externalResourceLoads = 0;
    resourceObserverSupported = false;
    lastRemote = null;
    channels = {};
    _disposed = false;

    constructor() {
        makeAutoObservable(this, { _disposed: false });
        this._unsubscribe = null;
        this._apply(privacySnapshot());
    }

    // React Strict Mode 可能丢弃 render 中创建的 runtime；订阅只能在挂载后启动。
    start() {
        if (this._disposed || this._unsubscribe) return;
        this._unsubscribe = subscribePrivacy((event) => {
            runInAction(() => this._apply(event.snapshot));
        });
        this._apply(privacySnapshot());
    }

    _apply(snapshot) {
        this.uploadedBytes = snapshot.uploadedBytes;
        this.remoteRequests = snapshot.remoteRequests;
        this.localRequests = snapshot.localRequests;
        this.unknownBody = snapshot.unknownBody;
        this.externalResourceLoads = snapshot.externalResourceLoads || 0;
        this.resourceObserverSupported = Boolean(snapshot.resourceObserver);
        this.lastRemote = snapshot.lastRemote;
        this.channels = snapshot.channels;
    }

    /**
     * 徽标只为公网发送负载告警：外部图片/脚本的接收和零正文请求仍会在详情中列出，
     * 但不能把「公网发送 0 B」误标成上传告警。无法测量正文长度的公网请求保守地告警。
     */
    get isClean() {
        return this.uploadedBytes === 0 && this.unknownBody === 0;
    }

    /** 供 UI 显示：0 B / 1.2 kB / 3.4 MB。 */
    formatBytes(bytes = this.uploadedBytes) {
        const value = Number(bytes) || 0;
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
        return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }

    /** 请求体有无法精确测量的项目时，已知字节数只是实际值的下界。 */
    get formattedUploadedBytes() {
        return `${this.unknownBody > 0 ? '≥ ' : ''}${this.formatBytes()}`;
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        this._unsubscribe?.();
        this._unsubscribe = null;
    }

    /** 仅测试使用：把页面计数清零，并通知所有同页已订阅实例。 */
    resetCounters() {
        resetPrivacyCounters();
        this._apply(privacySnapshot());
    }
}
