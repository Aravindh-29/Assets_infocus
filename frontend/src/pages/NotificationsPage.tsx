import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ArrowRightLeft,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Clock3,
  Inbox,
  Loader2,
  Package,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  UserCheck,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useResource } from '../hooks/useResource';
import { EmptyState, ErrorState, Loading, PageHeader } from '../components/ui';
import { date } from '../utils/format';
import { errorMessage, request } from '../services/api';
import './dashboard-console.css';

type Notification = {
  id: string;
  title: string;
  message: string;
  link?: string;
  readAt?: string | null;
  createdAt: string;
};
function notificationType(title: string): { icon: LucideIcon; label: string; tone: string } {
  const text = title.toLowerCase();
  if (text.includes('warrant')) return { icon: ShieldAlert, label: 'Warranty', tone: 'amber' };
  if (text.includes('lost') || text.includes('damage'))
    return { icon: CircleAlert, label: 'Asset incident', tone: 'rose' };
  if (text.includes('transfer')) return { icon: ArrowRightLeft, label: 'Custody transfer', tone: 'blue' };
  if (text.includes('return')) return { icon: RotateCcw, label: 'Asset return', tone: 'teal' };
  if (text.includes('assign')) return { icon: UserCheck, label: 'Assignment', tone: 'blue' };
  if (text.includes('repair')) return { icon: Wrench, label: 'Repair', tone: 'amber' };
  if (text.includes('request') || text.includes('offboarding'))
    return { icon: ClipboardList, label: 'Action required', tone: 'blue' };
  return { icon: Package, label: 'Asset update', tone: 'teal' };
}
function relativeTime(value: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : days < 7 ? `${days} days ago` : date(value);
}
function dayLabel(value: string, now: number) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const received = new Date(value);
  received.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - received.getTime()) / 86400000);
  return days === 0
    ? 'Today'
    : days === 1
      ? 'Yesterday'
      : received.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function NotificationsPage() {
  const { user } = useAuth();
  const employee = user?.role === 'EMPLOYEE';
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [markingAll, setMarkingAll] = useState(false);
  const [now, setNow] = useState(Date.now());
  const resource = useResource<Notification[]>('/notifications', {
    page,
    pageSize: 15,
    ...(unreadOnly ? { unread: 'true' } : {}),
  });
  const toast = useToast();
  const unread = resource.meta?.unreadCount;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const groups = (resource.data ?? []).reduce<{ label: string; items: Notification[] }[]>((all, item) => {
    const label = dayLabel(item.createdAt, now);
    const last = all[all.length - 1];
    if (last?.label === label) last.items.push(item);
    else all.push({ label, items: [item] });
    return all;
  }, []);
  async function markRead(item: Notification) {
    if (item.readAt || busyIds.includes(item.id)) return;
    setBusyIds((current) => [...current, item.id]);
    try {
      await request('PATCH', `/notifications/${item.id}/read`);
      if (unreadOnly && resource.data?.length === 1 && page > 1) setPage((current) => current - 1);
      resource.reload();
      window.dispatchEvent(new Event('notifications-changed'));
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusyIds((current) => current.filter((id) => id !== item.id));
    }
  }
  async function markAll() {
    setMarkingAll(true);
    try {
      await request('POST', '/notifications/read-all');
      setPage(1);
      resource.reload();
      window.dispatchEvent(new Event('notifications-changed'));
      toast('All notifications marked as read.');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setMarkingAll(false);
    }
  }
  function target(item: Notification) {
    if (!item.link || !item.link.startsWith('/') || item.link.startsWith('//')) return null;
    if (employee) {
      if (item.link.startsWith('/assets/')) return '/profile';
      if (!['/assets', '/profile', '/requests', '/notifications'].includes(item.link.split('?')[0]))
        return null;
    }
    return item.link;
  }
  return (
    <div className="dc-console dc-notifications-console">
      <PageHeader
        eyebrow="WORKSPACE / INBOX"
        title="Notification center"
        description="Assignments, requests, and important asset updates in one place."
        actions={
          <>
            <button
              className="btn secondary"
              title="Refresh notifications"
              disabled={resource.loading}
              onClick={resource.reload}
            >
              <RefreshCw size={15} className={resource.loading ? 'spin' : ''} />
              Refresh
            </button>
            <button
              className="btn primary"
              onClick={() => void markAll()}
              disabled={markingAll || unread === 0 || unread === undefined}
            >
              {markingAll ? <Loader2 className="spin" size={16} /> : <CheckCheck size={16} />}
              {markingAll ? 'Marking as read…' : 'Mark all as read'}
            </button>
          </>
        }
      />
      <div className="dc-inbox-layout">
        <aside className="dc-panel dc-inbox-nav" aria-label="Notification filters">
          <div className="dc-inbox-summary">
            <span className="dc-queue-icon dc-tone-teal">
              <BellRing size={23} />
            </span>
            <div>
              <strong>{unread === undefined ? '—' : unread.toLocaleString()}</strong>
              <span>unread notifications</span>
            </div>
          </div>
          <div className="dc-inbox-folder-list">
            <button
              className={!unreadOnly ? 'active' : ''}
              aria-pressed={!unreadOnly}
              onClick={() => {
                setUnreadOnly(false);
                setPage(1);
              }}
            >
              <Inbox size={17} />
              All notifications{!unreadOnly && resource.meta && <b>{resource.meta.total}</b>}
            </button>
            <button
              className={unreadOnly ? 'active' : ''}
              aria-pressed={unreadOnly}
              onClick={() => {
                setUnreadOnly(true);
                setPage(1);
              }}
            >
              <Bell size={17} />
              Unread{unread !== undefined && <b>{unread}</b>}
            </button>
          </div>
          <div className="dc-inbox-note">
            <CheckCheck size={16} />
            <p>Notifications are personal to your account. Read items remain available in your inbox.</p>
          </div>
          <Link className="dc-inbox-profile" to="/profile">
            View my profile
            <ArrowRight size={14} />
          </Link>
        </aside>
        <section
          className="dc-panel dc-inbox-main"
          aria-label={unreadOnly ? 'Unread notifications' : 'All notifications'}
          aria-busy={resource.loading}
        >
          <div className="dc-panel-head">
            <div>
              <h2>
                {unreadOnly ? 'Unread' : 'All notifications'}
                {resource.meta && <span className="dc-counter">{resource.meta.total}</span>}
              </h2>
              <p>Newest updates first</p>
            </div>
            <span className="dc-inbox-account">
              <UserCheck size={14} />
              {user?.name}
            </span>
          </div>
          {resource.error ? (
            <ErrorState message={resource.error} retry={resource.reload} />
          ) : resource.loading ? (
            <Loading />
          ) : groups.length ? (
            <div className="dc-notification-groups">
              {groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <h3 className="dc-notification-day">
                    <Clock3 size={12} />
                    {group.label}
                  </h3>
                  <ul className="dc-notification-list">
                    {group.items.map((item) => {
                      const type = notificationType(item.title);
                      const link = target(item);
                      const busy = busyIds.includes(item.id);
                      return (
                        <li key={item.id} className={item.readAt ? '' : 'unread'}>
                          <span className={`dc-notification-type dc-tone-${type.tone}`}>
                            <type.icon size={20} />
                          </span>
                          <div className="dc-notification-content">
                            <div className="dc-notification-title">
                              <h4>{item.title}</h4>
                              {!item.readAt && (
                                <span className="dc-unread-label">
                                  <i />
                                  Unread
                                </span>
                              )}
                            </div>
                            <p>{item.message}</p>
                            <div className="dc-notification-meta">
                              <span>{type.label}</span>
                              <span aria-hidden="true">·</span>
                              <time dateTime={item.createdAt} title={date(item.createdAt, true)}>
                                {relativeTime(item.createdAt, now)}
                              </time>
                              {item.readAt && (
                                <span className="dc-read-label">
                                  <Check size={12} />
                                  Read
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="dc-notification-actions">
                            {link && (
                              <Link
                                to={link}
                                className="dc-text-link"
                                onClick={() => void markRead(item)}
                                aria-label={`View record for ${item.title}`}
                              >
                                View
                                <ArrowRight size={13} />
                              </Link>
                            )}
                            {!item.readAt && (
                              <button
                                className="dc-read-button"
                                disabled={busy || markingAll}
                                aria-label={`Mark ${item.title} as read`}
                                title="Mark as read"
                                onClick={() => void markRead(item)}
                              >
                                {busy ? <Loader2 className="spin" size={16} /> : <CheckCheck size={17} />}
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <EmptyState
              title={unreadOnly ? 'You’re all caught up' : 'Your inbox is clear'}
              description={
                unreadOnly
                  ? 'There are no unread notifications. Previous updates are still in your inbox.'
                  : 'Asset assignments, requests, and warranty updates will appear here.'
              }
              action={
                unreadOnly ? (
                  <button
                    className="btn secondary"
                    onClick={() => {
                      setUnreadOnly(false);
                      setPage(1);
                    }}
                  >
                    View all notifications
                  </button>
                ) : (
                  <Link className="btn secondary" to="/assets">
                    <Package size={15} />
                    View assets
                  </Link>
                )
              }
            />
          )}
          {resource.meta && resource.meta.total > 0 && (
            <div className="dc-notification-pagination">
              <span>
                {Math.min((page - 1) * 15 + 1, resource.meta.total)}–
                {Math.min(page * 15, resource.meta.total)} of {resource.meta.total} notifications
              </span>
              <div>
                <button
                  className="btn secondary small-btn"
                  aria-label="Previous notification page"
                  disabled={page <= 1 || resource.loading}
                  onClick={() => setPage((value) => value - 1)}
                >
                  <ChevronLeft size={15} />
                  Previous
                </button>
                <span>
                  Page {page} of {Math.max(1, resource.meta.totalPages)}
                </span>
                <button
                  className="btn secondary small-btn"
                  aria-label="Next notification page"
                  disabled={page >= resource.meta.totalPages || resource.loading}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
