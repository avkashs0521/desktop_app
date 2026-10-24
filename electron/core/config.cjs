// electron/core/config.cjs - Immutable exam configuration loader

const examConfigJson = require('../data/exam.config.json');

/**
 * Deep freezes an object and its nested properties/arrays to prevent accidental mutation.
 * @param {Object} obj
 * @returns {Object} The frozen object
 */
function deepFreeze(obj) {
  Object.keys(obj).forEach((prop) => {
    if (typeof obj[prop] === 'object' && obj[prop] !== null && !Object.isFrozen(obj[prop])) {
      deepFreeze(obj[prop]);
    }
  });
  return Object.freeze(obj);
}

const config = deepFreeze(examConfigJson);

module.exports = { config };
