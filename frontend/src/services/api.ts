import axios from 'axios';
import type { ApiResponse } from '../types';
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  timeout: 30000,
});
let token: string | null = null;
let refreshing: Promise<string> | null = null;
export function setToken(value: string | null) {
  token = value;
}
api.interceptors.request.use((config) => {
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config;
    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !String(original.url).startsWith('/auth/')
    ) {
      original._retry = true;
      try {
        if (!refreshing)
          refreshing = api
            .post('/auth/refresh')
            .then((r) => {
              setToken(r.data.data.accessToken);
              return r.data.data.accessToken;
            })
            .finally(() => {
              refreshing = null;
            });
        await refreshing;
        return api(original);
      } catch {
        setToken(null);
        window.dispatchEvent(new Event('session-expired'));
      }
    }
    return Promise.reject(error);
  },
);
export const request = async <T = any>(
  method: string,
  url: string,
  data?: unknown,
  params?: unknown,
): Promise<ApiResponse<T>> => (await api.request({ method, url, data, params })).data;
export const errorMessage = (error: unknown) =>
  axios.isAxiosError(error)
    ? error.response?.data?.message ||
      (error.code === 'ECONNABORTED'
        ? 'The request took too long. Please try again.'
        : 'Unable to connect. Check the server and try again.')
    : error instanceof Error
      ? error.message
      : 'Something went wrong. Please try again.';
export async function downloadReport(type: string, format: string, params: Record<string, unknown> = {}) {
  const res = await api.get(`/reports/${type}`, { params: { ...params, format }, responseType: 'blob' });
  const blob = new Blob([res.data], {
    type: String(res.headers['content-type'] ?? 'application/octet-stream'),
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `asset-management-${type}-${new Date().toISOString().slice(0, 10)}.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}
