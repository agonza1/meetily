// Count only contiguous samples when the action is visible and usable.
function advanceCountdown(previous, nonce, now, usable) {
  if (!usable) return null;
  if (!previous || previous.nonce !== nonce || now < previous.last || now - previous.last > 2500) {
    return { nonce, since: now, last: now };
  }
  return { ...previous, last: now };
}

if (typeof module !== 'undefined') module.exports = { advanceCountdown };
