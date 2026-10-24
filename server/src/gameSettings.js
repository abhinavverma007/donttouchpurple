const { ALL_COLORS } = require('./colors');

const DURATION_OPTIONS = [30, 60, 90, 120]; // seconds
const DEFAULT_DURATION_SECONDS = 60;

// Grid refresh interval, ms (lower = faster). This isn't simple reaction time
// (~200ms) - it's visual search across 10 tile positions, color ID, a
// decide, and a physical tap, which realistically needs 400-800ms+ even for
// an attentive player. An earlier ladder bottomed out at 300ms (robot-only);
// the one after that (bottoming at 600ms) swung too far the other way and
// felt trivial. This sits in between: still human-achievable at the top end,
// genuinely tense at the bottom.
const SPEED_OPTIONS = [1500, 1000, 700, 450];
const DEFAULT_REFRESH_MS = 1500;

const DEFAULT_DANGER_COLOR = 'purple';

// Host-chosen settings are untrusted input; fall back to defaults for anything
// outside the fixed allowed sets instead of trusting arbitrary client values.
function resolveGameSettings({ durationSeconds, refreshMs, dangerColor } = {}) {
  return {
    durationSeconds: DURATION_OPTIONS.includes(durationSeconds) ? durationSeconds : DEFAULT_DURATION_SECONDS,
    refreshMs: SPEED_OPTIONS.includes(refreshMs) ? refreshMs : DEFAULT_REFRESH_MS,
    dangerColor: ALL_COLORS.includes(dangerColor) ? dangerColor : DEFAULT_DANGER_COLOR,
  };
}

module.exports = {
  DURATION_OPTIONS,
  DEFAULT_DURATION_SECONDS,
  SPEED_OPTIONS,
  DEFAULT_REFRESH_MS,
  DEFAULT_DANGER_COLOR,
  resolveGameSettings,
};
