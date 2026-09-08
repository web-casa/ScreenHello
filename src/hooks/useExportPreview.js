import { useEffect, useRef, useState } from 'react';
import { reaction } from 'mobx';

export default function useExportPreview(stores) {
    const service = stores.exportService;
    const [prepared, setPrepared] = useState(null);
    const [state, setState] = useState('idle');
    const [error, setError] = useState(null);
    const owner = useRef({ generation: 0, controller: null, prepared: null });

    useEffect(() => {
        const current = owner.current;
        const stop = reaction(() => service.stage, () => {
            if (current.prepared && !service.isPreparedCurrent(current.prepared.token) && !service.isHandingOff) {
                current.prepared = null;
                setPrepared(null);
                setState('stale');
            }
        });
        return () => {
            stop();
            current.generation += 1;
            current.controller?.abort();
            current.controller = null;
            if (current.prepared) service.discardPrepared('idle', current.prepared.token);
            current.prepared = null;
        };
    }, [service]);

    const clear = (nextState = 'idle') => {
        const current = owner.current;
        current.generation += 1;
        current.controller?.abort();
        current.controller = null;
        if (current.prepared) service.discardPrepared(nextState, current.prepared.token);
        current.prepared = null;
        setPrepared(null);
        setError(null);
        setState(nextState);
    };

    const generate = async settings => {
        if (owner.current.controller || service.isBusy || stores.isDisposed || !stores.isActive) return;
        clear('preparing');
        const current = owner.current;
        const generation = current.generation;
        const controller = new AbortController();
        current.controller = controller;
        try {
            const next = await service.prepareImage({ ...settings, verifyPreview: true, requireActive: true, signal: controller.signal });
            if (current.generation !== generation || controller.signal.aborted) {
                service.discardPrepared('idle', next.token);
                return;
            }
            if (!service.isPreparedCurrent(next.token)) { setState('stale'); return; }
            current.prepared = next;
            setPrepared(next);
            setState('ready');
        } catch (failure) {
            if (current.generation !== generation) return;
            setError(failure.code === 'export-cancelled' ? null : failure);
            setState(failure.code === 'export-stale' ? 'stale' : failure.code === 'export-cancelled' ? 'idle' : 'failed');
        } finally {
            if (current.controller === controller) current.controller = null;
        }
    };

    const fail = failure => { clear('failed'); setError(failure); };
    return { prepared, state, error, clear, generate, fail };
}
