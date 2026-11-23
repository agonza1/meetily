// Meet's DOM is not a public API. An unrecognized layout or locale is unknown.
function meetPhase(path, leave, inCall, rejoin) {
  if (!/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(path)) return 'unknown';
  if (leave && inCall && !rejoin) return 'joined';
  if (rejoin && !leave && !inCall) return 'ended';
  return 'unknown';
}

if (typeof module !== 'undefined') module.exports = { meetPhase };
