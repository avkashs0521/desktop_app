// electron/core/trust.cjs - Origin and URL trust verification helper

/**
 * Checks if a given URL originates from our authorized development server or local packaged file.
 * @param {string} url - The URL to test.
 * @returns {boolean} True if the URL is trusted.
 */
function isTrustedUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }

  if (process.env.ARGUS_DEV_URL) {
    return url.startsWith(process.env.ARGUS_DEV_URL);
  }

  return url.startsWith('file://');
}

module.exports = { isTrustedUrl };
