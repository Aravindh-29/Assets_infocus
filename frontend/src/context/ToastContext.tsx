import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
type Toast = { id: number; message: string; kind: 'success' | 'error' };
const Context = createContext<(message: string, kind?: 'success' | 'error') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    // Feedback from the previous action must not obscure a newly opened form.
    const clearPrevious = () => setToasts([]);
    window.addEventListener('workspace-dialog-opened', clearPrevious);
    return () => window.removeEventListener('workspace-dialog-opened', clearPrevious);
  }, []);
  function toast(message: string, kind: 'success' | 'error' = 'success') {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }].slice(-2));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6500);
  }
  return (
    <Context.Provider value={toast}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div className={`toast ${t.kind}`} key={t.id}>
            {t.kind === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            <span>{t.message}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setToasts((a) => a.filter((x) => x.id !== t.id))}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </Context.Provider>
  );
}
export const useToast = () => useContext(Context);
