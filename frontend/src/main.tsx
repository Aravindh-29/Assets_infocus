import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import './styles.css';
import './console.css';
import { TooltipProvider } from './components/TooltipProvider';
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <ToastProvider>
      <AuthProvider>
        <App />
        <TooltipProvider />
      </AuthProvider>
    </ToastProvider>
  </BrowserRouter>,
);
