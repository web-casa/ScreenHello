import { AssetStore } from './assetStore';
import { BaseSnapshotService } from './baseSnapshot';
import { DraftService } from './draftService';
import { DraftStore } from './draftStore';
import { Editor } from './editor';
import { ExportService } from './exportService';
import { History } from './history';
import { ImageStore } from './imageStore';
import { Option } from './option';
import { WorkspaceStore } from './workspaceStore';
import { BatchStore } from './batchStore';
import { CommandService } from './commandService';
import { browserPlatform } from '../platform/browserPlatform';

let runtimeSequence = 0;
let activeRuntime = null;

/**
 * 一个可嵌入编辑器实例拥有的完整运行时图。
 * Store 只通过这个 root 引用同一实例内的兄弟 Store，禁止回退到模块单例。
 */
export class ScreenHelloRuntime {
    constructor({ draftDatabaseName, renderTaskTracker = null, batchEnabled = true, platform = browserPlatform } = {}) {
        runtimeSequence += 1;
        this.id = `screenhello-${runtimeSequence}`;
        this._disposeTimer = null;
        this._disposed = false;
        this.renderTaskTracker = renderTaskTracker;
        this.platform = platform;

        this.assetStore = new AssetStore({ platform: this.platform });
        this.draftStore = new DraftStore({ databaseName: draftDatabaseName, storage: this.platform.storage });
        this.baseSnapshot = new BaseSnapshotService(this);
        this.imageStore = new ImageStore(this);
        this.editor = new Editor(this);
        this.history = new History(this);
        this.option = new Option(this);
        this.draftService = new DraftService(this);
        this.workspace = new WorkspaceStore(this);
        this.exportService = new ExportService(this, { platform: this.platform });
        this.batch = batchEnabled ? new BatchStore(this, { platform: this.platform }) : null;
        this.commands = new CommandService(this);
    }

    scheduleDispose() {
        clearTimeout(this._disposeTimer);
        this._disposeTimer = setTimeout(() => {
            this._disposeTimer = null;
            this.dispose();
        }, 0);
    }

    cancelScheduledDispose() {
        clearTimeout(this._disposeTimer);
        this._disposeTimer = null;
    }

    activate({ onlyIfNone = false } = {}) {
        if (!onlyIfNone || !activeRuntime) activeRuntime = this;
    }

    get isActive() {
        return activeRuntime === this;
    }

    get isDisposed() {
        return this._disposed;
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        if (activeRuntime === this) activeRuntime = null;
        this.cancelScheduledDispose();
        this.batch?.dispose();
        this.commands.dispose();
        this.exportService.dispose();
        this.draftService.teardown();
        this.workspace.dispose();
        this.option.destroy();
        this.editor.dispose();
        this.history.destroy();
        this.imageStore.dispose();
        this.assetStore.clear();
        this.baseSnapshot.invalidate();
        this.baseSnapshot.onUpdate = null;
        void this.draftStore.close();
    }
}

export const createScreenHelloRuntime = (options) => new ScreenHelloRuntime(options);
