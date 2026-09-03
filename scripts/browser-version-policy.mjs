const parseVersion = (value) => {
    const match = String(value || '').match(/^(\d+)(?:\.(\d+))?/);
    if (!match) return null;
    return {
        major: Number(match[1]),
        minor: match[2] == null ? null : Number(match[2]),
    };
};

export const browserVersionIsAccepted = (observedValue, target) => {
    const observed = parseVersion(observedValue);
    const required = target?.version;
    if (!observed || !Number.isInteger(required?.major)) return false;

    const policy = target.versionPolicy || 'exact';
    if (policy === 'minimum') {
        if (observed.major !== required.major) return observed.major > required.major;
        if (required.minor == null) return true;
        return observed.minor != null && observed.minor >= required.minor;
    }
    if (policy !== 'exact') throw new Error(`Unsupported browser version policy: ${policy}`);
    if (observed.major !== required.major) return false;
    return required.minor == null || observed.minor === required.minor;
};
