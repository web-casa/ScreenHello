// Serialized into the page by WebDriver: deliberately has no module closures.
// Observe only public Worker APIs; never hold messages, pixels or transfer lists.
export function installCancelObserver({ cancelSelector = '[data-testid="export-cancel"]', cancelText = null, batch = false } = {}) {
    const state = window.__screenhelloCancelObserver = { jobs: [], overflow: false, workers: 0 };
    window.Worker = new Proxy(window.Worker, {
        construct(Target, args, NewTarget) {
            const worker = Reflect.construct(Target, args, NewTarget);
            if (args[1]?.name !== 'screenhello-avif-encoder') return worker;
            const workerId = ++state.workers;
            let current;
            const post = worker.postMessage;
            const terminate = worker.terminate;
            worker.postMessage = function (...values) {
                const message = values[0];
                const job = { id: message.id, workerId, width: message.width, height: message.height,
                    compression: message.compression || 'standard', startedAt: performance.now(),
                    completedAt: null, terminatedAt: null, cancelRequestedAt: null, failed: false };
                const result = Reflect.apply(post, this, values);
                current = job;
                if (state.jobs.length < 16) state.jobs.push(job);
                else state.overflow = true;
                return result;
            };
            worker.terminate = function (...values) {
                const result = Reflect.apply(terminate, this, values);
                if (current) current.terminatedAt = performance.now();
                return result;
            };
            worker.addEventListener('message', event => {
                if (current && event.data?.id === current.id) {
                    current.completedAt = performance.now();
                    current.failed = event.data.ok !== true;
                }
            });
            worker.addEventListener('error', () => { if (current) current.failed = true; });

            return worker;
        },
    });
    document.addEventListener('click', event => {
        const button = event.target?.closest?.(cancelSelector);
        const batchButton = batch && event.target?.closest?.('.shoteasy-batch-drawer button');
        const batchMatch = batchButton && ['取消全部', '取消当前'].includes(batchButton.textContent.replace(/\s/g, ''));
        if (!batchMatch && (!button || (cancelText !== null && button.textContent.replace(/\s/g, '') !== cancelText))) return;
        const job = state.jobs[state.jobs.length - 1];
        if (job && job.completedAt === null && job.terminatedAt === null) job.cancelRequestedAt = performance.now();
    }, true);
}
