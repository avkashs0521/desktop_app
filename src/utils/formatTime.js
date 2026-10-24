// src/utils/formatTime.js - Time formatting helpers

/**
 * Formats a duration in milliseconds into a zero-padded "HH:MM:SS" string.
 * @param {number} ms - Milliseconds duration
 * @returns {string} "HH:MM:SS"
 */
export function formatDuration(ms) {
  if (typeof ms !== 'number' || Number.isNaN(ms) || ms < 0) {
    return '00:00:00';
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
