import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  Search,
  X,
  CheckCircle2,
  UserRoundCheck,
  Wrench,
  AlertTriangle,
  Archive,
  Ban,
  Clock3,
  CircleDot,
  ArrowLeftRight,
  RotateCcw,
  MapPin,
  PackagePlus,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { human } from '../utils/format';
import type { Meta, RecordData } from '../types';
export function Badge({ value }: { value?: string }) {
  const icons: Record<string, typeof CircleDot> = {
    AVAILABLE: CheckCircle2,
    ACTIVE: CheckCircle2,
    COMPLETED: CheckCircle2,
    APPROVED: CheckCircle2,
    RETURNED: RotateCcw,
    REPAIRED: CheckCircle2,
    ASSIGNED: UserRoundCheck,
    TRANSFERRED: ArrowLeftRight,
    UNDER_REPAIR: Wrench,
    IN_REPAIR: Wrench,
    DAMAGED: AlertTriangle,
    LOST: AlertTriangle,
    RETIRED: Archive,
    DISPOSED: Ban,
    INACTIVE: Ban,
    REJECTED: Ban,
    PENDING: Clock3,
    PENDING_RETURN: Clock3,
    OPEN: Clock3,
    SCHEDULED: Clock3,
    ADMIN: ShieldCheck,
    ASSET_MANAGER: ShieldCheck,
  };
  const Icon = icons[value ?? ''] ?? CircleDot;
  return (
    <span className={`badge badge-${String(value).toLowerCase()}`}>
      <Icon size={12} aria-hidden="true" />
      {human(value) || '—'}
    </span>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  back?: string;
}) {
  return (
    <div className="page-heading">
      <div>
        {back && (
          <Link className="back-link" to={back}>
            <ArrowLeft size={15} />
            Back
          </Link>
        )}
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}
export function Loading({ variant = 'detail' }: { variant?: 'detail' | 'table' | 'cards' } = {}) {
  return (
    <div className={`skeleton-stack skeleton-${variant}`} aria-label="Loading content" role="status">
      <div className="skeleton skeleton-short" />
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={24} />
      <div>
        <strong>We couldn't load this information</strong>
        <p>{message}</p>
      </div>
      {retry && (
        <button className="btn secondary" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function EmptyState({
  title = 'Nothing here yet',
  description = 'Records will appear here as your team gets started.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Inbox size={28} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
  slideOver = false,
  busy = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  slideOver?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const closer = useRef(onClose);
  closer.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [formBusy, setFormBusy] = useState(false);
  const close = () => {
    if (!busyRef.current && !ref.current?.querySelector('form[aria-busy="true"]')) closer.current();
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    window.dispatchEvent(new Event('workspace-dialog-opened'));
    const element = ref.current;
    const observer = new MutationObserver(() =>
      setFormBusy(Boolean(element?.querySelector('form[aria-busy="true"]'))),
    );
    if (element)
      observer.observe(element, {
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-busy'],
        childList: true,
      });
    const focusable = () =>
      Array.from(
        element?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== element) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
      if (e.key === 'Tab') {
        const els = focusable();
        if (!els.length) {
          e.preventDefault();
          element?.focus();
          return;
        }
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      observer.disconnect();
      document.body.style.overflow = scroll;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className={`modal-backdrop ${slideOver ? 'slide-over-backdrop' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-busy={busy || formBusy || undefined}
        tabIndex={-1}
        aria-label={title}
        aria-describedby={description ? `${id}-description` : undefined}
        className={`modal ${wide ? 'modal-wide' : ''} ${slideOver ? 'slide-over' : ''}`}
      >
        <div className="modal-header">
          <div>
            <h2 id={id}>{title}</h2>
            {description && <p id={`${id}-description`}>{description}</p>}
          </div>
          <button
            className="icon-button"
            onClick={close}
            disabled={busy || formBusy}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function SlideOver(props: Omit<Parameters<typeof Modal>[0], 'slideOver'>) {
  return <Modal {...props} slideOver />;
}
export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <p className="dialog-copy">{description}</p>
      <div className="form-actions">
        <button className="btn secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn danger" disabled={busy} onClick={onConfirm}>
          {busy && <Loader2 className="spin" size={16} />} {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search records…',
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-input">
      <Search size={17} />
      <input
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange('')}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
export type Column = {
  key: string;
  label: string;
  render?: (row: RecordData) => ReactNode;
  sortable?: boolean;
  className?: string;
};
export function DataTable({
  columns,
  rows,
  loading,
  error,
  retry,
  meta,
  page,
  onPage,
  sort,
  onSort,
  selected,
  onSelect,
  emptyTitle,
  emptyAction,
  emptyDescription,
}: {
  columns: Column[];
  rows?: RecordData[];
  loading?: boolean;
  error?: string;
  retry?: () => void;
  meta?: Meta;
  page?: number;
  onPage?: (page: number) => void;
  sort?: { sortBy: string; sortOrder: string };
  onSort?: (key: string) => void;
  selected?: string[];
  onSelect?: (ids: string[]) => void;
  emptyTitle?: string;
  emptyAction?: ReactNode;
  emptyDescription?: string;
}) {
  if (error) return <ErrorState message={error} retry={retry} />;
  if (loading) return <Loading variant="table" />;
  if (!rows?.length)
    return (
      <EmptyState
        title={emptyTitle || 'No matching records'}
        description={emptyDescription || 'Try adjusting your filters, or add your first record.'}
        action={emptyAction}
      />
    );
  const ids = rows.map((r) => r.id);
  return (
    <>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {onSelect && (
                <th className="selection-cell">
                  <input
                    type="checkbox"
                    aria-label="Select all records on this page"
                    ref={(element) => {
                      if (element)
                        element.indeterminate =
                          ids.some((id) => selected?.includes(id)) &&
                          !ids.every((id) => selected?.includes(id));
                    }}
                    checked={ids.every((id) => selected?.includes(id))}
                    onChange={(e) =>
                      onSelect(
                        e.target.checked
                          ? Array.from(new Set([...(selected ?? []), ...ids]))
                          : (selected ?? []).filter((id) => !ids.includes(id)),
                      )
                    }
                  />
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={c.className}
                  scope="col"
                  aria-sort={
                    c.sortable && sort?.sortBy === c.key
                      ? sort.sortOrder === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  {c.sortable && onSort ? (
                    <button className="sort-button" onClick={() => onSort(c.key)}>
                      {c.label}
                      <ArrowUpDown size={12} className={sort?.sortBy === c.key ? 'active-sort' : ''} />
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id ?? index}>
                {onSelect && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.assetTag ?? row.name ?? 'record'}`}
                      checked={selected?.includes(row.id) ?? false}
                      onChange={(e) =>
                        onSelect(
                          e.target.checked
                            ? [...(selected ?? []), row.id]
                            : (selected ?? []).filter((id) => id !== row.id),
                        )
                      }
                    />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={c.className}>
                    {c.render
                      ? c.render(row)
                      : row[c.key] === null || row[c.key] === undefined
                        ? '—'
                        : String(row[c.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meta && onPage && (
        <div className="table-pagination">
          <span>
            {meta.total === 0 ? 0 : ((page ?? 1) - 1) * meta.pageSize + 1}–
            {Math.min((page ?? 1) * meta.pageSize, meta.total)} of {meta.total} records
          </span>
          <div>
            <button
              className="icon-button"
              disabled={(page ?? 1) <= 1}
              aria-label="Previous page"
              onClick={() => onPage((page ?? 1) - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <span>
              Page {page ?? 1} of {Math.max(1, meta.totalPages)}
            </span>
            <button
              className="icon-button"
              disabled={(page ?? 1) >= meta.totalPages}
              aria-label="Next page"
              onClick={() => onPage((page ?? 1) + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
export function Details({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="detail-grid">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Timeline({ items, linkAssets = true }: { items?: RecordData[]; linkAssets?: boolean }) {
  if (!items?.length)
    return (
      <EmptyState title="No activity recorded" description="Each lifecycle event will be preserved here." />
    );
  return (
    <div className="timeline">
      {items.map((item, index) => {
        const event = String(item.eventType ?? item.action ?? '');
        const Icon = event.includes('TRANSFER')
          ? ArrowLeftRight
          : event.includes('RETURN')
            ? RotateCcw
            : event.includes('ASSIGN')
              ? UserRoundCheck
              : event.includes('REPAIR') || event.includes('MAINTENANCE')
                ? Wrench
                : event.includes('LOST') || event.includes('DAMAGE')
                  ? AlertTriangle
                  : event.includes('MOV')
                    ? MapPin
                    : event.includes('CREAT') || event.includes('REGISTER')
                      ? PackagePlus
                      : CircleDot;
        return (
          <div className="timeline-item" key={item.id ?? index}>
            <div className="timeline-event-icon">
              <Icon size={14} aria-hidden="true" />
            </div>
            <div>
              <strong>{human(item.eventType ?? item.action)}</strong>
              {item.asset && linkAssets && (
                <Link to={`/assets/${item.asset.id}`} className="timeline-asset">
                  {item.asset.assetTag} · {item.asset.model}
                </Link>
              )}
              {item.asset && !linkAssets && (
                <span className="timeline-asset">
                  {item.asset.assetTag} · {item.asset.model}
                </span>
              )}
              <p>
                {item.notes ??
                  (item.previousStatus && item.newStatus
                    ? `${human(item.previousStatus)} → ${human(item.newStatus)}`
                    : 'Record saved to asset history')}
              </p>
              <small>
                {new Date(item.timestamp ?? item.createdAt).toLocaleString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                {item.performedByName && `· ${item.performedByName}`}
              </small>
            </div>
          </div>
        );
      })}
    </div>
  );
}
