const DURATION_OPTIONS = [30, 60, 90, 120]; // seconds
const DEFAULT_DURATION_SECONDS = 60;

const SPEED_OPTIONS = [800, 500, 300]; // grid refresh interval, ms (lower = faster)
const DEFAULT_REFRESH_MS = 800;

// Host-chosen settings are untrusted input; fall back to defaults for anything
// outside the fixed allowed sets instead of trusting arbitrary client values.
function resolveGameSettings({ durationSeconds, refreshMs } = {}) {
  return {
    durationSeconds: DURATION_OPTIONS.includes(durationSeconds) ? durationSeconds : DEFAULT_DURATION_SECONDS,
    refreshMs: SPEED_OPTIONS.includes(refreshMs) ? refreshMs : DEFAULT_REFRESH_MS,
  };
}

module.exports = {
  DURATION_OPTIONS,
  DEFAULT_DURATION_SECONDS,
  SPEED_OPTIONS,
  DEFAULT_REFRESH_MS,
  resolveGameSettings,
};
