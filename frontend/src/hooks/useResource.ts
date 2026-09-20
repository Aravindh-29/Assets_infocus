import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage, request } from '../services/api';
import type { ApiResponse } from '../types';
export function useResource<T = any>(url: string | null, params?: Record<string, unknown>) {
  const [result, setResult] = useState<ApiResponse<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const sequence = useRef(0);
  const key = JSON.stringify(params ?? {});
  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    const id = ++sequence.current;
    setLoading(true);
    setError('');
    request<T>('GET', url, undefined, JSON.parse(key))
      .then((r) => {
        if (sequence.current === id) setResult(r);
      })
      .catch((e) => {
        if (sequence.current === id) setError(errorMessage(e));
      })
      .finally(() => {
        if (sequence.current === id) setLoading(false);
      });
    return () => {
      sequence.current++;
    };
  }, [url, key, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data: result?.data, meta: result?.meta, loading, error, reload };
}
export function useDebounce<T>(value: T, delay = 280) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
