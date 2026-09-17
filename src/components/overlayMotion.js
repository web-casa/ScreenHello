// Disable overlay motion through the component API. Near-zero CSS durations can
// skip rc-motion lifecycle events and leave WebKit panels hidden or displaced.
export const NO_CSS_MOTION = Object.freeze({ motionName: '' });
export const NO_CSS_TRANSITION_NAME = '';
