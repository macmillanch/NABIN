// =========================================================================
// ONE gate for every developer convenience that weakens a security rule:
// fixed OTP codes, unauthenticated media uploads, echoed test codes.
//
// It exists because six call sites each wrote
//   NODE_ENV !== 'production' || NABIN_TEST_MODE === 'true'
// The `||` meant an environment that *is* production could opt out of it by
// carrying a leftover NABIN_TEST_MODE=true — at which point anyone who typed
// 7729 was logged in as whoever they named. Production is decided by
// NODE_ENV alone; nothing else can open it, and a mis-set flag can only ever
// close a door further, never widen one.
// =========================================================================

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * True only outside production. Name it at the call site as what it permits,
 * not as what environment you happen to be in.
 */
function allowsTestConvenience(what) {
  if (!isProduction()) return true;
  if (process.env.NABIN_TEST_MODE === 'true') {
    console.error(
      `🚨 NABIN_TEST_MODE=true is ignored in production. Test convenience refused: ${what || 'unnamed'}.`
    );
  }
  return false;
}

module.exports = { isProduction, allowsTestConvenience };
