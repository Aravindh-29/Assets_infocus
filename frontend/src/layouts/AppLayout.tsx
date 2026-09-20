import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FolderKanban,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Package,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Tag,
  Users,
  UserRound,
  Wrench,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  CircleHelp,
  CheckCheck,
  AlertTriangle,
  Clock3,
  Command,
  Keyboard,
  BookOpen,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useResource, useDebounce } from '../hooks/useResource';
import { human, initials } from '../utils/format';
import { useToast } from '../context/ToastContext';
import { request, errorMessage } from '../services/api';
import { EmptyState, ErrorState, Loading, Modal } from '../components/ui';
import type { RecordData } from '../types';

const main = [
  ['/', 'Overview', LayoutDashboard],
  ['/assets', 'All assets', Package],
  ['/employees', 'Employees', Users],
] as const;
const operations = [
  ['/assignments', 'Assignments', ClipboardCheck],
  ['/transfers', 'Transfers', ArrowLeftRight],
  ['/returns', 'Returns', RotateCcw],
  ['/repairs', 'Repairs & maintenance', Wrench],
  ['/requests', 'Requests', FolderKanban],
  ['/offboarding', 'Offboarding', UserRound],
  ['/movements', 'Location movements', MapPin],
] as const;
const organization = [
  ['/reports', 'Reports', BarChart3],
  ['/categories', 'Categories', Tag],
  ['/departments', 'Departments', Building2],
  ['/locations', 'Locations', MapPin],
] as const;
const admin = [
  ['/audit-logs', 'Audit log', History],
  ['/users', 'User management', ShieldCheck],
  ['/settings', 'Settings', Settings],
] as const;
const personal = [
  ['/', 'My overview', LayoutDashboard],
  ['/assets', 'My assets', Package],
  ['/requests', 'My requests', FolderKanban],
  ['/notifications', 'Notifications', Bell],
  ['/profile', 'My profile', UserRound],
] as const;
const labels: Record<string, string> = Object.fromEntries(
  [
    ...main,
    ...operations,
    ...organization,
    ...admin,
    ['/notifications', 'Notifications'],
    ['/profile', 'My profile'],
    ['/change-password', 'Change password'],
    ['/maintenance', 'Maintenance'],
  ].map(([path, label]) => [String(path).slice(1), label]),
);
function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1
    ? 'Just now'
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
}
export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate(),
    location = useLocation(),
    toast = useToast();
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('asset-console-sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const [profile, setProfile] = useState(false),
    [inbox, setInbox] = useState(false),
    [help, setHelp] = useState(false);
  const [query, setQuery] = useState(''),
    [searchOpen, setSearchOpen] = useState(false),
    [active, setActive] = useState(0),
    [reading, setReading] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null),
    searchWrap = useRef<HTMLDivElement>(null),
    profileRef = useRef<HTMLDivElement>(null),
    inboxRef = useRef<HTMLDivElement>(null),
    sidebarRef = useRef<HTMLElement>(null);
  const debounced = useDebounce(query.trim());
  const search = useResource(debounced.length >= 2 ? '/search' : null, { q: debounced });
  const notifications = useResource<RecordData[]>('/notifications', { pageSize: 6 });
  const employee = user?.role === 'EMPLOYEE',
    unread = notifications.meta?.unreadCount ?? 0;
  const parts = location.pathname.split('/').filter(Boolean);
  const commands = useMemo(
    () =>
      (employee
        ? personal
        : [...main, ...operations, ...organization, ...(user?.role === 'ADMIN' ? admin : [])]
      ).map(([path, title, Icon]) => ({
        id: `go-${path}`,
        title,
        subtitle: 'Open workspace page',
        path,
        Icon,
        group: 'Navigate',
      })),
    [employee, user?.role],
  );
  const results = useMemo(() => {
    const pages = commands.filter((c) => !query || c.title.toLowerCase().includes(query.toLowerCase()));
    if (query.trim().length < 2) return pages.slice(0, 6);
    if (query.trim() !== debounced || search.loading) return [];
    return [
      ...(search.data?.assets ?? []).map((r: RecordData) => ({
        id: r.id,
        title: r.assetTag,
        subtitle: [r.manufacturer, r.model, r.serialNumber].filter(Boolean).join(' · '),
        path: `/assets/${r.id}`,
        Icon: Package,
        group: 'Assets',
      })),
      ...(search.data?.employees ?? []).map((r: RecordData) => ({
        id: r.id,
        title: r.name,
        subtitle: [r.employeeId, r.email].filter(Boolean).join(' · '),
        path: `/employees/${r.id}`,
        Icon: UserRound,
        group: 'Employees',
      })),
      ...pages,
    ];
  }, [commands, query, debounced, search.data, search.loading]);
  useEffect(() => {
    try {
      localStorage.setItem('asset-console-sidebar', collapsed ? 'collapsed' : 'expanded');
    } catch {
      /* Storage is optional. */
    }
  }, [collapsed]);
  useEffect(() => {
    setMobile(false);
    setProfile(false);
    setInbox(false);
    setSearchOpen(false);
    setQuery('');
  }, [location.pathname]);
  useEffect(() => {
    setActive(0);
  }, [query, search.data]);
  useEffect(() => {
    if (searchOpen) document.getElementById(`global-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, searchOpen]);
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setProfile(false);
        setInbox(false);
        setMobile(false);
      }
    }
    function outside(e: PointerEvent) {
      const target = e.target as Node;
      if (!searchWrap.current?.contains(target)) setSearchOpen(false);
      if (!profileRef.current?.contains(target)) setProfile(false);
      if (!inboxRef.current?.contains(target)) setInbox(false);
    }
    document.addEventListener('keydown', keyboard);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', keyboard);
      document.removeEventListener('pointerdown', outside);
    };
  }, []);
  useEffect(() => {
    const reload = () => notifications.reload();
    window.addEventListener('notifications-changed', reload);
    window.addEventListener('focus', reload);
    return () => {
      window.removeEventListener('notifications-changed', reload);
      window.removeEventListener('focus', reload);
    };
  }, [notifications.reload]);
  useEffect(() => {
    if (!mobile) return;
    const previous = document.activeElement as HTMLElement,
      scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.querySelector<HTMLButtonElement>('.mobile-sidebar-close')?.focus();
    function trap(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const items = Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)') ?? [],
      ).filter((el) => el.getClientRects().length);
      const first = items[0],
        last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener('keydown', trap);
    return () => {
      document.body.style.overflow = scroll;
      document.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, [mobile]);
  useEffect(() => {
    if (profile) profileRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [profile]);
  async function markRead(id?: string) {
    setReading(true);
    try {
      await request(id ? 'PATCH' : 'POST', id ? `/notifications/${id}/read` : '/notifications/read-all');
      window.dispatchEvent(new Event('notifications-changed'));
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setReading(false);
    }
  }
  const nav = (items: readonly (readonly [string, string, any])[]) =>
    items.map(([to, label, Icon]) => (
      <NavLink
        to={to}
        end={to === '/'}
        key={to}
        aria-label={label}
        data-tooltip={collapsed ? label : undefined}
        onClick={() => setMobile(false)}
        className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
      >
        <Icon size={18} />
        <span>{label}</span>
      </NavLink>
    ));
  return (
    <div className={`app-shell enterprise-console ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {mobile && <div className="sidebar-shade" onClick={() => setMobile(false)} />}
      <aside
        ref={sidebarRef}
        className={`sidebar ${mobile ? 'is-open' : ''}`}
        aria-label="Workspace navigation"
        role={mobile ? 'dialog' : undefined}
        aria-modal={mobile || undefined}
      >
        <div className="sidebar-brand-row">
          <Link
            to="/"
            className="brand"
            aria-label="INFOCUS Asset Management home"
            data-tooltip={collapsed ? 'INFOCUS Asset Management' : undefined}
          >
            <span className="brand-mark">
              <Boxes size={24} />
            </span>
            <span className="brand-text">
              INFOCUS<small>ASSET MANAGEMENT</small>
            </span>
          </Link>
          <button
            className="icon-button mobile-sidebar-close"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="workspace-label">
          <Building2 size={18} />
          <div>
            <strong>Asset operations</strong>
            <small>Your organization, connected</small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          <p className="nav-section">WORKSPACE</p>
          {employee ? (
            nav(personal)
          ) : (
            <>
              {nav(main)}
              <p className="nav-section">OPERATIONS</p>
              {nav(operations)}
              <p className="nav-section">ORGANIZATION</p>
              {nav(organization)}
              {user?.role === 'ADMIN' && (
                <>
                  <p className="nav-section">ADMINISTRATION</p>
                  {nav(admin)}
                </>
              )}
            </>
          )}
        </nav>
        <div className="sidebar-footer">
          <span className="avatar">{initials(user?.name ?? 'User')}</span>
          <div className="sidebar-user">
            <strong>{user?.name}</strong>
            <small>{human(user?.role)}</small>
          </div>
          <button
            className="icon-button"
            aria-label="Sign out"
            onClick={() => logout().catch((e) => toast(errorMessage(e), 'error'))}
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="console-header-start">
            <button
              className="icon-button desktop-sidebar-toggle"
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
            </button>
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              <Link to="/">INFOCUS</Link>
              <ChevronRight size={13} />
              {parts.length > 1 ? (
                <>
                  <Link to={`/${parts[0]}`}>{labels[parts[0]] ?? human(parts[0])}</Link>
                  <ChevronRight size={13} />
                  <span aria-current="page">Record details</span>
                </>
              ) : (
                <span aria-current="page">{labels[parts[0]] ?? 'Overview'}</span>
              )}
            </nav>
          </div>
          <div ref={searchWrap} className="global-search">
            <Search size={16} />
            <input
              ref={searchRef}
              role="combobox"
              aria-expanded={searchOpen}
              aria-controls="global-results"
              aria-autocomplete="list"
              aria-activedescendant={searchOpen && results[active] ? `global-option-${active}` : undefined}
              aria-label="Search assets and employees"
              placeholder={employee ? 'Search your assets…' : 'Search workspace…'}
              value={query}
              onFocus={() => setSearchOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSearchOpen(true);
                  if (results.length)
                    setActive(
                      (v) => (v + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length,
                    );
                }
                if (e.key === 'Enter' && searchOpen && results[active]) {
                  e.preventDefault();
                  navigate(results[active].path);
                  setSearchOpen(false);
                  searchRef.current?.blur();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setSearchOpen(false);
                }
                if (e.key === 'Tab') setSearchOpen(false);
              }}
            />
            <kbd className="search-hint">Ctrl K</kbd>
            {query && (
              <button
                className="icon-button clear-global"
                aria-label="Clear global search"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
              >
                <X size={14} />
              </button>
            )}
            {searchOpen && (
              <div className="search-results">
                <div className="command-caption">
                  <Command size={14} />
                  <span>{query.length >= 2 ? 'Workspace results' : 'Jump to a page or search records'}</span>
                </div>
                <div id="global-results" role="listbox" aria-label="Search results">
                  {query.trim().length >= 2 && (search.loading || query.trim() !== debounced) ? (
                    <p role="status">Searching your workspace…</p>
                  ) : search.error && query.length >= 2 ? (
                    <ErrorState message={search.error} retry={search.reload} />
                  ) : !results.length ? (
                    <p>No matching records. Try an asset tag, serial number or employee name.</p>
                  ) : (
                    results.map((r, i) => (
                      <div key={`${r.group}-${r.id}`} role="presentation">
                        {(i === 0 || results[i - 1].group !== r.group) && (
                          <small className="search-group-label">{r.group}</small>
                        )}
                        <Link
                          role="option"
                          aria-selected={active === i}
                          id={`global-option-${i}`}
                          to={r.path}
                          tabIndex={-1}
                          onMouseEnter={() => setActive(i)}
                          className={active === i ? 'selected' : ''}
                          onClick={() => setSearchOpen(false)}
                        >
                          <span className="search-result-icon">
                            <r.Icon size={17} />
                          </span>
                          <div>
                            <strong>{r.title}</strong>
                            <span>{r.subtitle}</span>
                          </div>
                          <ArrowUpRight size={15} />
                        </Link>
                      </div>
                    ))
                  )}
                </div>
                <div className="command-footer">
                  <span>↑ ↓ Navigate</span>
                  <span>Enter Open</span>
                  <span>Esc Close</span>
                </div>
              </div>
            )}
          </div>
          <div className="topbar-right">
            <button
              className="icon-button console-help"
              aria-label="Workspace help"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={19} />
            </button>
            <div className="notification-wrap" ref={inboxRef}>
              <button
                className="icon-button notification-button"
                aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
                aria-expanded={inbox}
                aria-controls="notification-popover"
                onClick={() => {
                  setInbox(!inbox);
                  setProfile(false);
                  if (!inbox) notifications.reload();
                }}
              >
                <Bell size={19} />
                {unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}
              </button>
              {inbox && (
                <section
                  className="notification-popover"
                  id="notification-popover"
                  aria-label="Recent notifications"
                >
                  <div className="popover-heading">
                    <div>
                      <h2>Notifications</h2>
                      <span>{unread} unread</span>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Mark all notifications as read"
                      disabled={!unread || reading}
                      onClick={() => void markRead()}
                    >
                      <CheckCheck size={18} />
                    </button>
                  </div>
                  {notifications.loading ? (
                    <Loading />
                  ) : notifications.error ? (
                    <ErrorState message={notifications.error} retry={notifications.reload} />
                  ) : !notifications.data?.length ? (
                    <EmptyState
                      title="You're all caught up"
                      description="New assignments and workflow updates will appear here."
                    />
                  ) : (
                    <div className="notification-preview-list">
                      {notifications.data.map((n) => {
                        const notificationKind = `${n.title} ${n.message}`.toUpperCase();
                        const Icon = /LOST|DAMAGE/.test(notificationKind)
                          ? AlertTriangle
                          : /WARRANTY/.test(notificationKind)
                            ? Clock3
                            : /ASSIGN|TRANSFER|RETURN/.test(notificationKind)
                              ? Package
                              : Bell;
                        return (
                          <div className={`notification-preview ${!n.readAt ? 'unread' : ''}`} key={n.id}>
                            <span className="notification-preview-icon">
                              <Icon size={17} />
                            </span>
                            <div>
                              <Link
                                to={
                                  n.link?.startsWith('/') && !n.link.startsWith('//')
                                    ? n.link
                                    : '/notifications'
                                }
                                onClick={() => {
                                  if (!n.readAt) void markRead(n.id);
                                  setInbox(false);
                                }}
                              >
                                <strong>{n.title}</strong>
                                <p>{n.message}</p>
                              </Link>
                              <time title={new Date(n.createdAt).toLocaleString()}>
                                {relativeTime(n.createdAt)}
                              </time>
                            </div>
                            {!n.readAt && (
                              <button
                                className="icon-button"
                                aria-label={`Mark ${n.title} as read`}
                                disabled={reading}
                                onClick={() => void markRead(n.id)}
                              >
                                <CheckCheck size={15} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <Link to="/notifications" className="popover-footer" onClick={() => setInbox(false)}>
                    View all notifications
                    <ArrowUpRight size={15} />
                  </Link>
                </section>
              )}
            </div>
            <div className="profile-wrap" ref={profileRef}>
              <button
                className="profile-trigger"
                aria-expanded={profile}
                aria-haspopup="menu"
                aria-label="Open profile menu"
                onClick={() => {
                  setProfile(!profile);
                  setInbox(false);
                }}
              >
                <span className="avatar small">{initials(user?.name ?? 'User')}</span>
                <span className="header-user">
                  <strong>{user?.name}</strong>
                  <small>{human(user?.role)}</small>
                </span>
                <ChevronDown size={13} />
              </button>
              {profile && (
                <div
                  className="profile-menu"
                  role="menu"
                  aria-label="Profile"
                  onKeyDown={(e) => {
                    const buttons = Array.from(
                      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
                    );
                    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
                    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                      e.preventDefault();
                      buttons[
                        e.key === 'Home'
                          ? 0
                          : e.key === 'End'
                            ? buttons.length - 1
                            : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
                      ]?.focus();
                    }
                    if (e.key === 'Escape')
                      profileRef.current?.querySelector<HTMLButtonElement>('.profile-trigger')?.focus();
                    if (e.key === 'Tab') setProfile(false);
                  }}
                >
                  <strong>{user?.name}</strong>
                  <small>{user?.email}</small>
                  <button role="menuitem" onClick={() => navigate('/profile')}>
                    <UserRound size={16} />
                    My profile
                  </button>
                  <button role="menuitem" onClick={() => navigate('/change-password')}>
                    <ShieldCheck size={16} />
                    Change password
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setProfile(false);
                      logout().catch((e) => toast(errorMessage(e), 'error'));
                    }}
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
        <footer className="app-footer">
          <span>
            INFOCUS Asset Management <span>·</span> Enterprise asset operations
          </span>
          <button className="text-link" onClick={() => setHelp(true)}>
            <Keyboard size={13} />
            Help & shortcuts
          </button>
        </footer>
      </div>
      {help && (
        <Modal
          title="Workspace help"
          description="Find records, complete handovers and keep your inventory accountable."
          onClose={() => setHelp(false)}
        >
          <div className="help-section">
            <Keyboard size={21} />
            <div>
              <h3>Move around with your keyboard</h3>
              <p>
                <kbd>Ctrl K</kbd> opens workspace search. Use arrow keys and Enter to open a result. Escape
                closes search, menus and dialogs. Tab moves between controls.
              </p>
            </div>
          </div>
          <div className="help-section">
            <BookOpen size={21} />
            <div>
              <h3>{employee ? 'Your equipment and requests' : 'The asset lifecycle'}</h3>
              <p>
                {employee
                  ? 'Open My assets to review equipment assigned to you. Submit a return, transfer, damage or loss request from an asset. Track decisions in My requests.'
                  : 'Register an asset, assign it to an employee, and use Transfer or Return for each handover. Asset history records each change. Offboarding tracks outstanding equipment before completion.'}
              </p>
            </div>
          </div>
          <div className="help-section">
            <ShieldCheck size={21} />
            <div>
              <h3>Your workspace access</h3>
              <p>
                Signed in as {user?.name}, with {human(user?.role).toLowerCase()} access. Available actions
                follow your role and each asset’s current status.
              </p>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn primary" onClick={() => setHelp(false)}>
              Got it
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
