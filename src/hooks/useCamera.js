// src/hooks/useCamera.js - Video stream capture and camera permission management hook
import { useState, useRef, useEffect, useCallback } from 'react';
import { api, isElectron } from '../api';

/**
 * Manages webcam access, live video streaming, and reporting readiness to the exam state machine.
 * Owns the videoRef internally so App.jsx can attach it to the <video> DOM element.
 *
 * @param {Object} options
 * @param {string} options.phase - Current exam phase
 * @param {Function} options.send - State machine command dispatcher
 * @returns {{
 *   videoRef: React.RefObject<HTMLVideoElement>,
 *   status: 'idle' | 'waiting' | 'on' | 'denied' | 'error',
 *   error: string | null,
 *   start: () => Promise<boolean>,
 *   stop: () => void,
 *   openSettings: () => Promise<void>
 * }}
 */
export function useCamera({ phase, send }) {
  // videoRef is owned here so it can be attached to the persistent <video> element in App.jsx
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  const start = useCallback(async () => {
    setStatus('waiting');
    setError(null);

    try {
      // 1. On macOS, request/verify OS-level camera authorization first
      if (isElectron) {
        const { status: osStatus } = await api.permissions.requestCamera();
        if (osStatus === 'denied' || osStatus === 'restricted') {
          setStatus('denied');
          setError('Camera permission denied');
          return false;
        }
      }

      // 2. Request video stream from Chromium getUserMedia (strictly video, audio: false)
      const constraints = {
        video: { width: 640, height: 480 },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      // Attach stream to the persistent video DOM element managed by App.jsx
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((err) => {
          console.warn('[useCamera] Video autoplay prevented:', err);
        });
      }

      // Listen for hardware disconnection or another application seizing the device
      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          setStatus('idle');
          setError('Camera is in use by another app');
          if (phase === 'setup' || phase === 'in_progress') {
            send('REPORT_CHECK', { name: 'camera', ok: false }).catch(() => {});
          }
        });
      }

      setStatus('on');

      // Report affirmative readiness to the main-process state machine
      if (phase === 'setup' || phase === 'in_progress') {
        await send('REPORT_CHECK', { name: 'camera', ok: true });
      }

      return true;
    } catch (err) {
      let friendlyMessage = err.message || 'Failed to start camera';

      if (err.name === 'NotAllowedError') {
        friendlyMessage = 'Camera permission denied';
        setStatus('denied');
      } else if (err.name === 'NotFoundError') {
        friendlyMessage = 'No camera found';
        setStatus('error');
      } else if (err.name === 'NotReadableError') {
        friendlyMessage = 'Camera is in use by another app';
        setStatus('error');
      } else {
        setStatus('error');
      }

      setError(friendlyMessage);

      if (phase === 'setup' || phase === 'in_progress') {
        send('REPORT_CHECK', { name: 'camera', ok: false }).catch(() => {});
      }

      return false;
    }
  }, [phase, send]);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStatus('idle');

    if (phase === 'setup' || phase === 'in_progress') {
      send('REPORT_CHECK', { name: 'camera', ok: false }).catch(() => {});
    }
  }, [phase, send]);

  const openSettings = useCallback(async () => {
    if (isElectron) {
      await api.permissions.openCameraSettings();
    }
  }, []);

  // Cleanup all media tracks on unmount to release webcam hardware
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return {
    videoRef,
    status,
    error,
    start,
    stop,
    openSettings,
  };
}
