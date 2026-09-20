import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Headphones,
  Laptop,
  Loader2,
  MapPin,
  Monitor,
  MoreHorizontal,
  Package,
  Router,
  ShieldAlert,
  Smartphone,
  Upload,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Lookups, RecordData } from '../types';
import { CONDITIONS, STATUSES } from '../types';
import { Badge, DataTable, Details, ErrorState, Loading, SlideOver } from './ui';
import { RecordForm } from './RecordForm';
import type { Field } from './RecordForm';
import { useResource } from '../hooks/useResource';
import { useAuth } from '../context/AuthContext';
import { request, errorMessage } from '../services/api';
import { clean, human, holder } from '../utils/format';
import { prepareAssetImport, templateCsv } from './assetCsv';
import type { ImportRow } from './assetCsv';
import { statusTargets } from './assetCapabilities';
export { statusTargets } from './assetCapabilities';

export function AssetTypeIcon({ asset, size = 20 }: { asset: RecordData; size?: number }) {
  const kind = String(asset.category?.name ?? asset.assetType ?? '').toLowerCase();
  const Icon = kind.includes('laptop')
    ? Laptop
    : kind.includes('monitor') || kind.includes('desktop')
      ? Monitor
      : kind.includes('phone') || kind.includes('mobile') || kind.includes('tablet')
        ? Smartphone
        : kind.includes('router') || kind.includes('modem')
          ? Router
          : kind.includes('head')
            ? Headphones
            : Package;
  return <Icon size={size} />;
}
type MenuItem = {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};
export function AssetActionMenu({
  label,
  items,
  icon: Icon = MoreHorizontal,
  buttonText,
}: {
  label: string;
  items: MenuItem[];
  icon?: LucideIcon;
  buttonText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const rect = trigger.current!.getBoundingClientRect();
    const height = Math.min(items.length * 38 + 14, 420);
    setPosition({
      left: Math.max(8, Math.min(rect.right - 225, window.innerWidth - 233)),
      top: rect.bottom + height > window.innerHeight ? Math.max(8, rect.top - height - 5) : rect.bottom + 5,
    });
    const focus = window.requestAnimationFrame(() =>
      menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(),
    );
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node))
        setOpen(false);
    };
    const hide = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      cancelAnimationFrame(focus);
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open, items.length]);
  return (
    <>
      <button
        ref={trigger}
        className={buttonText ? 'btn secondary small-btn' : 'icon-button'}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon size={16} />
        {buttonText}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={label}
            className="asset-context-menu"
            style={position}
            onKeyDown={(e) => {
              const buttons = Array.from(
                menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
              );
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                buttons[
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? buttons.length - 1
                      : (current + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
                ]?.focus();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
              if (e.key === 'Tab') setOpen(false);
            }}
          >
            {items.map((item) => {
              const ItemIcon = item.icon;
              return (
                <button
                  role="menuitem"
                  key={item.label}
                  disabled={item.disabled}
                  className={item.danger ? 'destructive' : ''}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  {ItemIcon && <ItemIcon size={16} />}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
export const assetFilterKeys = [
  'status',
  'categoryId',
  'departmentId',
  'locationId',
  'condition',
  'assigned',
  'employeeId',
  'purchaseFrom',
  'purchaseTo',
  'warrantyFrom',
  'warrantyTo',
  'deleted',
] as const;
const labels: Record<string, string> = {
  status: 'Status',
  categoryId: 'Category',
  departmentId: 'Department',
  locationId: 'Location',
  condition: 'Condition',
  assigned: 'Custody',
  employeeId: 'Assigned user',
  purchaseFrom: 'Purchased from',
  purchaseTo: 'Purchased until',
  warrantyFrom: 'Warranty from',
  warrantyTo: 'Warranty until',
  deleted: 'Records',
};
export function filterLabel(key: string, value: string, lookups?: Lookups) {
  const collections: Record<string, keyof Lookups> = {
    categoryId: 'categories',
    departmentId: 'departments',
    locationId: 'locations',
    employeeId: 'employees',
  };
  return `${labels[key] ?? key}: ${collections[key] ? (lookups?.[collections[key]]?.find((i) => i.id === value)?.name ?? 'Selected record') : key === 'assigned' ? (value === 'true' ? 'Assigned' : 'Unassigned') : key === 'deleted' ? 'Archived' : key.endsWith('From') || key.endsWith('To') ? value : human(value)}`;
}
export function AssetFilters({
  filters,
  lookups,
  isAdmin,
  onApply,
  onClose,
}: {
  filters: Record<string, string>;
  lookups?: Lookups;
  isAdmin: boolean;
  onApply: (filters: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({ ...filters });
  const [error, setError] = useState('');
  const options = (key: keyof Lookups) =>
    lookups?.[key]?.map((i) => ({
      value: i.id,
      label: i.name + (i.employeeId ? ` · ${i.employeeId}` : ''),
    })) ?? [];
  const sets: [string, string, { value: string; label: string }[]][] = [
    ['status', 'Status', STATUSES.map((s) => ({ value: s, label: human(s) }))],
    ['categoryId', 'Category', options('categories')],
    ['departmentId', 'Department', options('departments')],
    ['locationId', 'Location', options('locations')],
    ['condition', 'Condition', CONDITIONS.map((s) => ({ value: s, label: human(s) }))],
    [
      'assigned',
      'Custody',
      [
        { value: 'true', label: 'Assigned' },
        { value: 'false', label: 'Unassigned' },
      ],
    ],
    ['employeeId', 'Assigned user', options('employees')],
  ];
  if (isAdmin) sets.push(['deleted', 'Record scope', [{ value: 'true', label: 'Archived assets' }]]);
  return (
    <SlideOver title="Advanced filters" description="Refine the live asset inventory." onClose={onClose}>
      <div className="asset-filter-panel">
        <div className="form-fields">
          {sets.map(([key, label, items]) => (
            <label className={key === 'employeeId' ? 'field full' : 'field'} key={key}>
              {label}
              <select
                aria-label={label}
                value={draft[key] ?? ''}
                onChange={(e) => setDraft((f) => ({ ...f, [key]: e.target.value }))}
              >
                <option value="">
                  {key === 'deleted' ? 'Active inventory' : `Any ${label.toLowerCase()}`}
                </option>
                {items.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <h3 className="asset-filter-section">Purchase & warranty dates</h3>
          {[
            ['purchaseFrom', 'Purchased from'],
            ['purchaseTo', 'Purchased until'],
            ['warrantyFrom', 'Warranty from'],
            ['warrantyTo', 'Warranty until'],
          ].map(([key, label]) => (
            <label className="field" key={key}>
              {label}
              <input
                aria-label={label}
                type="date"
                value={draft[key] ?? ''}
                onChange={(e) => setDraft((f) => ({ ...f, [key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            className="btn secondary"
            onClick={() => {
              setDraft({});
              setError('');
            }}
          >
            Clear filters
          </button>
          <button
            className="btn primary"
            onClick={() => {
              if (
                (draft.purchaseFrom && draft.purchaseTo && draft.purchaseFrom > draft.purchaseTo) ||
                (draft.warrantyFrom && draft.warrantyTo && draft.warrantyFrom > draft.warrantyTo)
              ) {
                setError('The end date must be on or after the start date.');
                return;
              }
              onApply(Object.fromEntries(Object.entries(draft).filter(([, v]) => v)));
              onClose();
            }}
          >
            Apply filters
          </button>
        </div>
      </div>
    </SlideOver>
  );
}
type Outcome = { id: string; label: string; success: boolean; message: string };
export function BulkAssetAction({
  kind,
  assets,
  onClose,
  onCompleted,
}: {
  kind: 'assign' | 'status' | 'move';
  assets: RecordData[];
  onClose: () => void;
  onCompleted: (succeeded: string[]) => void;
}) {
  const { user } = useAuth();
  const lookups = useResource<Lookups>('/lookups');
  const [review, setReview] = useState<RecordData | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const title =
    kind === 'assign'
      ? 'Assign selected assets'
      : kind === 'move'
        ? 'Move selected assets'
        : 'Change selected statuses';
  const eligible = assets.filter((a) => !a.deletedAt && (kind !== 'assign' || a.status === 'AVAILABLE'));
  const sharedStatuses = eligible.length
    ? statusTargets(eligible[0], user?.role).filter((s) =>
        eligible.every((a) => statusTargets(a, user?.role).includes(s)),
      )
    : [];
  const fields: Field[] =
    kind === 'assign'
      ? [
          {
            name: 'employeeId',
            label: 'Employee',
            type: 'select',
            required: true,
            options: lookups.data?.employees.map((e) => ({
              value: e.id,
              label: `${e.name} · ${e.employeeId}`,
            })),
            full: true,
          },
          { name: 'notes', label: 'Assignment notes', type: 'textarea' },
        ]
      : kind === 'move'
        ? [
            {
              name: 'locationId',
              label: 'New location',
              type: 'select',
              required: true,
              options: lookups.data?.locations.map((e) => ({ value: e.id, label: e.name })),
              full: true,
            },
            { name: 'notes', label: 'Movement notes', type: 'textarea' },
          ]
        : [
            {
              name: 'status',
              label: 'New status',
              type: 'select',
              required: true,
              options: sharedStatuses.map((s) => ({ value: s, label: human(s) })),
              full: true,
            },
            { name: 'notes', label: 'Reason for change', type: 'textarea', required: true },
          ];
  async function apply() {
    if (!review || busy) return;
    setBusy(true);
    const results: Outcome[] = [];
    for (const asset of assets) {
      try {
        const fresh = (await request<RecordData>('GET', `/assets/${asset.id}`)).data;
        if (fresh.deletedAt) throw new Error('Archived assets cannot be changed.');
        if (kind === 'assign' && fresh.status !== 'AVAILABLE')
          throw new Error('Skipped: asset is no longer available.');
        if (kind === 'status' && !statusTargets(fresh, user?.role).includes(review.status))
          throw new Error('Skipped: status transition is no longer valid.');
        if (kind === 'move' && fresh.locationId === review.locationId)
          throw new Error('Skipped: asset is already at this location.');
        await request(kind === 'status' ? 'PATCH' : 'POST', `/assets/${asset.id}/${kind}`, clean(review));
        results.push({ id: asset.id, label: asset.assetTag, success: true, message: 'Completed' });
      } catch (e) {
        results.push({ id: asset.id, label: asset.assetTag, success: false, message: errorMessage(e) });
      }
      setOutcomes([...results]);
    }
    setBusy(false);
    onCompleted(results.filter((r) => r.success).map((r) => r.id));
  }
  return (
    <SlideOver
      title={title}
      description={`${assets.length} selected assets · each change retains its history`}
      busy={busy}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="asset-bulk-panel">
        <div className="asset-callout">
          <ShieldAlert size={18} />
          <p>
            Each asset is validated and saved separately. Successful changes remain saved if another asset
            fails. You will see an outcome for every record.
          </p>
        </div>
        {outcomes.length > 0 ? (
          <>
            <div className="asset-import-metrics">
              <span>
                <strong>{outcomes.filter((o) => o.success).length}</strong>completed
              </span>
              <span>
                <strong>{outcomes.filter((o) => !o.success).length}</strong>need attention
              </span>
            </div>
            <div className="asset-outcomes" role="status">
              {outcomes.map((r) => (
                <div key={r.id}>
                  {r.success ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
                  <span>
                    <strong>{r.label}</strong>
                    <small>{r.message}</small>
                  </span>
                </div>
              ))}
            </div>
            <div className="form-actions">
              <button className="btn primary" disabled={busy} onClick={onClose}>
                {busy ? `Processing ${outcomes.length} of ${assets.length}…` : 'Done'}
              </button>
            </div>
          </>
        ) : review ? (
          <>
            <h3>Review changes</h3>
            <Details
              items={[
                [
                  kind === 'assign' ? 'Assign to' : kind === 'move' ? 'Move to' : 'New status',
                  kind === 'assign'
                    ? lookups.data?.employees.find((e) => e.id === review.employeeId)?.name
                    : kind === 'move'
                      ? lookups.data?.locations.find((l) => l.id === review.locationId)?.name
                      : human(review.status),
                ],
                ['Assets', `${eligible.length} eligible of ${assets.length} selected`],
                ['Notes', review.notes],
              ]}
            />
            <div className="asset-review-tags">
              {assets.map((a) => (
                <span key={a.id}>{a.assetTag}</span>
              ))}
            </div>
            <div className="form-actions">
              <button className="btn secondary" disabled={busy} onClick={() => setReview(null)}>
                Back
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void apply()}>
                {busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />}Confirm{' '}
                {kind === 'assign' ? 'assignment' : kind === 'move' ? 'location move' : 'status change'}
              </button>
            </div>
          </>
        ) : lookups.loading ? (
          <Loading />
        ) : lookups.error ? (
          <ErrorState message={lookups.error} retry={lookups.reload} />
        ) : !eligible.length || (kind === 'status' && !sharedStatuses.length) ? (
          <div className="asset-callout">
            <AlertCircle size={18} />
            <p>
              {kind === 'status'
                ? 'The selected assets have no common valid status transition. Select assets with compatible statuses.'
                : 'No selected assets are eligible for this operation.'}
            </p>
          </div>
        ) : (
          <>
            <div className="asset-selection-summary">
              <strong>{eligible.length} eligible assets</strong>
              <span>{assets.length - eligible.length} will be skipped</span>
            </div>
            <RecordForm
              fields={fields}
              onCancel={onClose}
              submitLabel="Review changes"
              onSubmit={async (v) => setReview(v)}
            />
          </>
        )}
      </div>
    </SlideOver>
  );
}
function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function AssetCsvImport({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const lookups = useResource<Lookups>('/lookups');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const file = useRef<HTMLInputElement>(null);
  const valid = rows.filter((r) => !r.errors.length && r.state !== 'imported');
  async function readFile(selected?: File) {
    if (!selected) return;
    setError('');
    setRows([]);
    setPage(1);
    setFilename(selected.name);
    if (selected.size > 2 * 1024 * 1024) {
      setError('Choose a CSV file smaller than 2 MB.');
      return;
    }
    try {
      const preview = prepareAssetImport(await selected.text(), lookups.data!);
      setRows(preview);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function runImport() {
    if (busy) return;
    setBusy(true);
    let successes = 0;
    for (const row of valid) {
      try {
        await request('POST', '/assets', row.data);
        successes++;
        setRows((current) =>
          current.map((r) =>
            r.line === row.line ? { ...r, state: 'imported', message: 'Registered successfully' } : r,
          ),
        );
      } catch (e) {
        setRows((current) =>
          current.map((r) => (r.line === row.line ? { ...r, state: 'failed', message: errorMessage(e) } : r)),
        );
      }
    }
    setBusy(false);
    if (successes) onSaved();
  }
  const imported = rows.filter((r) => r.state === 'imported').length;
  const failed = rows.filter((r) => r.state === 'failed').length;
  return (
    <SlideOver
      title="Import assets"
      description="Upload, validate, and register assets from a CSV file."
      busy={busy}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="asset-import-panel">
        <div className="asset-stepper">
          <span className={rows.length ? 'done' : 'active'}>
            <i>1</i>Upload CSV
          </span>
          <span className={rows.length && !imported ? 'active' : ''}>
            <i>2</i>Validate & review
          </span>
          <span className={imported ? 'active' : ''}>
            <i>3</i>Import results
          </span>
        </div>
        <div className="asset-callout">
          <FileSpreadsheet size={20} />
          <div>
            <strong>Use the asset registration template</strong>
            <p>
              Category, department, and location accept existing names or IDs. Import creates new assets only;
              current assignments and history are preserved.
            </p>
            <button
              className="text-link"
              disabled={!lookups.data}
              onClick={() => saveFile('asset-import-template.csv', templateCsv(lookups.data!))}
            >
              <Download size={14} />
              Download template
            </button>
          </div>
        </div>
        {lookups.loading ? (
          <Loading />
        ) : lookups.error ? (
          <ErrorState message={lookups.error} retry={lookups.reload} />
        ) : (
          <>
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv"
              aria-label="Asset CSV file"
              className="asset-file-input"
              disabled={busy}
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
            <button className="asset-upload-zone" disabled={busy} onClick={() => file.current?.click()}>
              <Upload size={25} />
              <strong>{filename || 'Choose a CSV file'}</strong>
              <span>Up to 500 rows · 2 MB maximum</span>
            </button>
          </>
        )}
        {error && (
          <div role="alert" className="inline-error">
            {error}
          </div>
        )}
        {rows.length > 0 && (
          <>
            <div className="asset-import-metrics">
              <span>
                <strong>{rows.length}</strong>total rows
              </span>
              <span>
                <strong>{valid.length}</strong>ready to import
              </span>
              <span>
                <strong>{rows.filter((r) => r.errors.length).length + failed}</strong>need attention
              </span>
              <span>
                <strong>{imported}</strong>imported
              </span>
            </div>
            <DataTable
              rows={rows.slice((page - 1) * 8, page * 8).map((r) => ({ ...r, id: String(r.line) }))}
              columns={[
                { key: 'line', label: 'Row' },
                { key: 'assetTag', label: 'Asset tag', render: (r) => r.data.assetTag || '—' },
                {
                  key: 'model',
                  label: 'Model',
                  render: (r) => `${r.data.manufacturer ?? ''} ${r.data.model ?? ''}`,
                },
                {
                  key: 'state',
                  label: 'Validation',
                  render: (r) => (
                    <span
                      className={`asset-import-state ${r.errors.length || r.state === 'failed' ? 'invalid' : ''}`}
                    >
                      {r.state === 'imported' ? (
                        <CheckCircle2 size={14} />
                      ) : r.errors.length || r.state === 'failed' ? (
                        <AlertCircle size={14} />
                      ) : (
                        <Check size={14} />
                      )}{' '}
                      {r.errors.length
                        ? 'Needs correction'
                        : r.state === 'imported'
                          ? 'Imported'
                          : r.state === 'failed'
                            ? 'Failed'
                            : 'Ready'}
                    </span>
                  ),
                },
                {
                  key: 'issues',
                  label: 'Details',
                  render: (r) => (
                    <span className="asset-import-message">
                      {r.errors.join(' · ') || r.message || 'Ready to register'}
                    </span>
                  ),
                },
              ]}
              page={page}
              onPage={setPage}
              meta={{ page, pageSize: 8, total: rows.length, totalPages: Math.ceil(rows.length / 8) }}
            />
            <p className="asset-import-disclosure">
              Only valid rows will be submitted. Existing duplicate tags and serial numbers are rejected by
              the server. Failed rows remain visible, and imported rows will never be submitted twice.
            </p>
            <div className="form-actions">
              <button className="btn secondary" disabled={busy} onClick={onClose}>
                {imported ? 'Done' : 'Cancel'}
              </button>
              <button
                className="btn primary"
                disabled={busy || !valid.length}
                onClick={() => void runImport()}
              >
                {busy ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}{' '}
                {busy
                  ? 'Importing…'
                  : failed
                    ? 'Retry failed rows'
                    : `Import ${valid.length} valid ${valid.length === 1 ? 'asset' : 'assets'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </SlideOver>
  );
}
