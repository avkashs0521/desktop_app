// src/hooks/useSnapshots.js - Periodic webcam frame capture and IPC snapshot upload
import { useEffect } from 'react';
import { api, isElectron } from '../api';

/**
 * Periodically captures video frames from the webcam and uploads them to main process storage.
 *
 * @param {React.RefObject<HTMLVideoElement>} videoRef - Reference to the persistent <video> element
 * @param {boolean} active - True if the exam is currently in_progress
 * @param {number} [intervalSeconds=10] - Interval between consecutive snapshot captures
 */
export function useSnapshots(videoRef, active, intervalSeconds = 10) {
  useEffect(() => {
    if (!active || !isElectron) {
      return;
    }

    const intervalMs = Math.max(1, intervalSeconds) * 1000;

    const captureFrame = async () => {
      try {
        const video = videoRef?.current;
        if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
          // Video feed not ready yet or camera track stopped
          return;
        }

        // Draw current frame to an offscreen canvas
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Convert canvas image to JPEG blob with 0.7 quality
        const blob = await new Promise((resolve) => {
          canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.7);
        });

        if (!blob) return;

        const arrayBuffer = await blob.arrayBuffer();
        await api.proctor.saveSnapshot(arrayBuffer);
      } catch (err) {
        // One snapshot failure should never interrupt subsequent proctoring cycles
        console.warn('[useSnapshots] Snapshot capture error:', err);
      }
    };

    // Schedule regular snapshot interval
    const timerId = setInterval(captureFrame, intervalMs);

    return () => {
      clearInterval(timerId);
    };
  }, [videoRef, active, intervalSeconds]);
}
