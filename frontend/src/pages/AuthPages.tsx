import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Eye,
  EyeOff,
  Fingerprint,
  Hand,
  LockKeyhole,
  Mail,
  Pause,
  Play,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { request, errorMessage, setToken } from '../services/api';
import { RecordForm } from '../components/RecordForm';
import { PageHeader } from '../components/ui';
import { LoginOrbit } from '../components/LoginOrbit';
import './login-experience.css';

const orbitPhrases = ['Assets, connected.', 'People, in sync.', 'Every handover, clear.'];

function OrbitTypewriter({ active }: { active: boolean }) {
  const [text, setText] = useState(orbitPhrases[0]);
  useEffect(() => {
    if (!active) return;
    let phrase = 0;
    let length = orbitPhrases[0].length;
    let deleting = true;
    let timer: ReturnType<typeof setTimeout>;
    setText(orbitPhrases[0]);
    const tick = () => {
      const current = orbitPhrases[phrase];
      length += deleting ? -1 : 1;
      setText(current.slice(0, length));
      let delay = deleting ? 35 : 72;
      if (length === 0) {
        deleting = false;
        phrase = (phrase + 1) % orbitPhrases.length;
        delay = 280;
      } else if (length === current.length && !deleting) {
        deleting = true;
        delay = 2600;
      }
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 3000);
    return () => clearTimeout(timer);
  }, [active]);
  return (
    <span className="login-typewriter" aria-hidden="true">
      {active ? text : orbitPhrases[0]}
      <span className="login-type-caret" />
    </span>
  );
}

function useLoginMotion() {
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [userPaused, setUserPaused] = useState(() => {
    try {
      return localStorage.getItem('asset-login-motion') === 'paused';
    } catch {
      return false;
    }
  });
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(preference.matches);
    const visibility = () => setHidden(document.hidden);
    preference.addEventListener('change', change);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      preference.removeEventListener('change', change);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  const toggle = () => {
    const next = !userPaused;
    setUserPaused(next);
    try {
      localStorage.setItem('asset-login-motion', next ? 'paused' : 'playing');
    } catch {
      /* Motion works without browser storage. */
    }
  };
  return { reducedMotion, paused: reducedMotion || userPaused || hidden, userPaused, toggle };
}

export function AuthPage({ mode = 'login' }: { mode?: 'login' | 'forgot' | 'reset' }) {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [resetUrl, setResetUrl] = useState('');
  const motion = useLoginMotion();
  const heroRef = useRef<HTMLElement>(null);
  const pointerFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(pointerFrame.current), []);
  const moveSpotlight = (event: ReactPointerEvent<HTMLElement>) => {
    if (motion.paused || event.pointerType === 'touch') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = requestAnimationFrame(() => {
      heroRef.current?.style.setProperty('--pointer-x', `${x}px`);
      heroRef.current?.style.setProperty('--pointer-y', `${y}px`);
    });
  };
  if (user && mode === 'login')
    return <Navigate to={user.mustChangePassword ? '/change-password' : '/'} replace />;
  return (
    <div className="login-experience" data-motion={motion.paused ? 'paused' : 'playing'}>
      <a className="login-skip" href="#workspace-sign-in">
        Skip to sign in
      </a>
      <section
        className="login-hero"
        ref={heroRef}
        onPointerMove={moveSpotlight}
        aria-label="Your connected workspace"
      >
        <div className="login-aurora" aria-hidden="true" />
        <div className="login-hero-top">
          <Link to="/login" className="login-brand" aria-label="INFOCUS Asset Management home">
            <span className="login-brand-icon">
              <Boxes size={23} strokeWidth={1.6} />
            </span>
            <span>
              <span className="login-company-name">INFOCUS</span>
              <small>ASSET MANAGEMENT</small>
            </span>
          </Link>
          <span className="login-edition" aria-hidden="true">
            WORKSPACE / 01
          </span>
          <a className="login-mobile-entry" href="#workspace-sign-in">
            Sign in <ArrowRight size={13} aria-hidden="true" />
          </a>
        </div>
        <div className="login-hero-content">
          <div className="login-intro">
            <div className="login-hero-eyebrow">
              <span />
              YOUR WORLD, CONNECTED
            </div>
            <h1>
              Everything.
              <br />
              <span>In your orbit.</span>
            </h1>
            <p>
              Your equipment. Your people.
              <br className="login-mobile-break" /> One beautifully connected workspace.
            </p>
          </div>
          <LoginOrbit paused={motion.paused} reducedMotion={motion.reducedMotion} />
          <div className="login-scene-caption">
            <span className="login-scene-index" aria-hidden="true">
              01 — 03
            </span>
            <OrbitTypewriter active={!motion.paused} />
            <span className="login-sr-only">Assets, people, and every handover, connected.</span>
            <span className="login-caption-line" aria-hidden="true" />
          </div>
        </div>
        <div className="login-hero-footer">
          <span className="login-drag-hint">
            <Hand size={14} strokeWidth={1.7} />
            Drag to explore. Make it yours.
          </span>
          {motion.reducedMotion ? (
            <span
              className="login-motion-control login-motion-reduced"
              title="Animation follows your device’s reduced motion preference."
            >
              <Pause size={13} />
              Reduced motion
            </span>
          ) : (
            <button
              type="button"
              className="login-motion-control"
              onClick={motion.toggle}
              aria-label={motion.userPaused ? 'Play animation' : 'Pause animation'}
            >
              {motion.userPaused ? <Play size={13} /> : <Pause size={13} />}
              <span>{motion.userPaused ? 'Play motion' : 'Pause motion'}</span>
            </button>
          )}
        </div>
      </section>
      <main className="login-panel" id="workspace-sign-in" tabIndex={-1}>
        <div className="login-panel-top">
          <span className="login-panel-label">
            <span />
            INFOCUS WORKSPACE
          </span>
          <span className="login-access-label">
            <LockKeyhole size={12} />
            PRIVATE WORKSPACE
          </span>
        </div>
        <div className="auth-form-wrap login-form-wrap">
          <div className="login-form-heading">
            <div className="login-fingerprint" aria-hidden="true">
              <Fingerprint size={30} strokeWidth={1.4} />
              <span />
            </div>
            <span className="login-form-step">
              {mode === 'login' ? '01 / SIGN IN' : '02 / RECOVER ACCESS'}
            </span>
          </div>
          <p className="eyebrow">A LITTLE CLARITY STARTS HERE</p>
          <h2 id="login-form-title">
            {mode === 'login'
              ? 'Welcome back.'
              : mode === 'forgot'
                ? 'Forgot your password?'
                : 'Set a new password.'}
          </h2>
          <p className="auth-subtitle">
            {mode === 'login'
              ? 'Sign in to your INFOCUS asset workspace.'
              : mode === 'forgot'
                ? 'Enter your work email and we’ll help you get back in.'
                : 'Choose a strong password to secure your account.'}
          </p>
          {mode === 'login' ? (
            <form
              aria-labelledby="login-form-title"
              aria-busy={busy}
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                setBusy(true);
                setError('');
                const values = new FormData(e.currentTarget);
                try {
                  await login(
                    String(values.get('identifier')),
                    String(values.get('password')),
                    values.get('remember') === 'on',
                  );
                  navigate('/');
                } catch (err) {
                  setError(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="field">
                <label htmlFor="login-identifier">Email or employee ID</label>
                <div className="login-input-wrap">
                  <Mail size={18} aria-hidden="true" />
                  <input
                    id="login-identifier"
                    name="identifier"
                    placeholder="you@company.com"
                    autoComplete="username"
                    required
                    aria-describedby={error ? 'login-error' : undefined}
                    disabled={busy}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="login-password">Password</label>
                <div className="password-input login-input-wrap">
                  <LockKeyhole size={18} aria-hidden="true" />
                  <input
                    id="login-password"
                    name="password"
                    type={show ? 'text' : 'password'}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                    disabled={busy}
                    aria-describedby={error ? 'login-error' : undefined}
                  />
                  <button
                    type="button"
                    aria-label={show ? 'Hide password' : 'Show password'}
                    aria-pressed={show}
                    onClick={() => setShow(!show)}
                  >
                    {show ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              <div className="auth-options">
                <label className="checkbox-label">
                  <input type="checkbox" name="remember" disabled={busy} />
                  Remember me
                </label>
                <Link to="/forgot-password">Forgot password?</Link>
              </div>
              {error && (
                <div className="inline-error" id="login-error" role="alert">
                  {error}
                </div>
              )}
              <button type="submit" className="btn primary auth-submit" disabled={busy}>
                <span>{busy ? 'Opening your workspace…' : 'Sign in to workspace'}</span>
                <span
                  className={`login-submit-icon${busy ? ' login-submit-loading' : ''}`}
                  aria-hidden="true"
                >
                  {busy ? <span className="login-loading-dot" /> : <ArrowRight size={18} />}
                </span>
              </button>
            </form>
          ) : sent ? (
            <div className="success-panel">
              <CheckCircle2 size={25} />
              <h3>Check your email</h3>
              <p>If this address has an account, a reset link will be sent.</p>
              {resetUrl && (
                <p className="dev-reset">
                  Local development:{' '}
                  <Link
                    to={`/reset-password?token=${new URL(resetUrl, window.location.origin).searchParams.get('token')}`}
                  >
                    Open password reset link
                  </Link>
                </p>
              )}
              <Link to="/login" className="btn secondary">
                Back to sign in
              </Link>
            </div>
          ) : (
            <RecordForm
              fields={
                mode === 'forgot'
                  ? [{ name: 'email', label: 'Work email', type: 'email', required: true, full: true }]
                  : [
                      {
                        name: 'password',
                        label: 'New password',
                        type: 'password',
                        required: true,
                        minLength: 10,
                        full: true,
                        help: 'At least 10 characters with upper/lowercase letters, a number and a symbol.',
                      },
                    ]
              }
              submitLabel={mode === 'forgot' ? 'Send reset link' : 'Reset password'}
              onSubmit={async (values) => {
                if (mode === 'forgot') {
                  const result = await request('POST', '/auth/forgot-password', values);
                  setSent(true);
                  setResetUrl(result.data?.resetUrl ?? '');
                } else {
                  await request('POST', '/auth/reset-password', { ...values, token: params.get('token') });
                  toast('Password reset. You can now sign in.');
                  navigate('/login');
                }
              }}
            />
          )}
          <div className="auth-bottom">
            <ShieldCheck size={15} />
            <span>Secure access. Complete accountability.</span>
          </div>
          {mode !== 'login' && (
            <Link className="back-link" to="/login">
              ← Back to sign in
            </Link>
          )}
        </div>
        <div className="login-panel-footer">
          <span>Everything in its right place.</span>
          <span className="login-footer-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      </main>
    </div>
  );
}
export function ChangePassword() {
  const toast = useToast();
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Change password" description="Keep your workspace account secure." />
      <section className="panel narrow-panel">
        <RecordForm
          fields={[
            {
              name: 'currentPassword',
              label: 'Current password',
              type: 'password',
              required: true,
              full: true,
            },
            {
              name: 'newPassword',
              label: 'New password',
              type: 'password',
              required: true,
              minLength: 10,
              full: true,
              help: 'At least 10 characters with upper/lowercase letters, a number and a symbol.',
            },
          ]}
          submitLabel="Update password"
          onSubmit={async (values) => {
            const result = await request('POST', '/auth/change-password', values);
            setToken(result.data.accessToken);
            await refreshUser();
            toast('Password updated successfully.');
            navigate('/');
          }}
        />
      </section>
    </>
  );
}
