import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error' | 'warning' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => undefined);

let nextId = 1;

/** Short confirmations and errors, shown one at a time as a Material snackbar. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Toast[]>([]);
  const [open, setOpen] = useState(true);
  const current = queue[0];

  const notify = useCallback((message: string, tone: Tone = 'info') => {
    setQueue((q) => [...q.slice(-4), { id: nextId++, tone, message }]);
    setOpen(true);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <Snackbar
        key={current?.id}
        open={!!current && open}
        autoHideDuration={current?.tone === 'error' || current?.tone === 'warning' ? 8000 : 4000}
        onClose={(_, reason) => reason !== 'clickaway' && setOpen(false)}
        slotProps={{ transition: { onExited: () => (setQueue((q) => q.slice(1)), setOpen(true)) } }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {current ? (
          <Alert severity={current.tone} variant="filled" onClose={() => setOpen(false)} sx={{ width: '100%' }}>
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
