/**
 * Resolve the callable default exported by legacy Babel CommonJS modules.
 *
 * Vite 8 follows Node-compatible CommonJS interop for ESM importers, so a
 * default import can be the complete `module.exports` object. Keep this
 * compatibility local to dependencies that are known to publish that shape.
 */
export function unwrapCallableDefault(moduleValue) {
    return typeof moduleValue?.default === 'function'
        ? moduleValue.default
        : moduleValue;
}
