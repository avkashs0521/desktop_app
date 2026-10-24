// src/hooks/useExamState.js - Hook managing exam state subscription and command dispatch
import { useState, useEffect, useCallback } from 'react';
import { api, isElectron } from '../api';

/**
 * Manages the single source of truth exam state from the main process.
 * Loads the initial state, listens to state-change broadcasts, and provides a safe dispatch wrapper.
 * @returns {{ state: Object | null, send: Function, error: Error | null }}
 */
export function useExamState() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    if (isElectron) {
      api.exam
        .getState()
        .then((initialState) => {
          if (mounted && initialState) {
            setState(initialState);
          }
        })
        .catch((err) => {
          if (mounted) {
            setError(err);
          }
        });

      const unsubscribe = api.exam.onState((updatedState) => {
        if (mounted && updatedState) {
          setState(updatedState);
        }
      });

      return () => {
        mounted = false;
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      };
    }
  }, []);

  const send = useCallback(async (type, payload) => {
    setError(null);
    try {
      const updatedState = await api.exam.send(type, payload);
      setState(updatedState);
      return updatedState;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, []);

  return { state, send, error };
}
