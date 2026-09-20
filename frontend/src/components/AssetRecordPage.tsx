import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeftRight,
  ArrowRight,
  ChevronDown,
  Edit3,
  History,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react';
import { useResource } from '../hooks/useResource';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { RecordData } from '../types';
import { Badge, ConfirmDialog, DataTable, Details, ErrorState, Loading, PageHeader, Timeline } from './ui';
import { AssetEditor, AssetOperation } from './AssetForms';
import type { Operation } from './AssetForms';
import { AssetActionMenu, AssetTypeIcon, statusTargets } from './AssetConsoleTools';
import { date, holder, human, initials, money, warranty } from '../utils/format';
import { errorMessage, request } from '../services/api';
export function AssetDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const manager = user?.role !== 'EMPLOYEE';
  const resource = useResource<RecordData>(`/assets/${id}`);
  const toast = useToast();
  const [operation, setOperation] = useState<Operation | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestedTab = params.get('tab') ?? 'overview';
  const allowedTabs = [
    'overview',
    'assignment',
    'history',
    ...(manager ? ['repairs', 'maintenance'] : []),
    ...(user?.role === 'ADMIN' ? ['audit'] : []),
  ];
  const tab = allowedTabs.includes(requestedTab) ? requestedTab : 'overview';
  const setTab = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'overview') next.delete('tab');
    else next.set('tab', value);
    setParams(next, { replace: true });
  };
  const [auditPage, setAuditPage] = useState(1);
  const maintenance = useResource<RecordData[]>(
    manager && tab === 'maintenance' && resource.data?.assetTag ? '/maintenance' : null,
    {
      search: resource.data?.assetTag,
      pageSize: 100,
    },
  );
  const [maintenanceRows, setMaintenanceRows] = useState<RecordData[]>([]);
  const [maintenanceMoreLoading, setMaintenanceMoreLoading] = useState(false);
  const [maintenanceMoreError, setMaintenanceMoreError] = useState('');
  useEffect(() => {
    let active = true;
    if (!maintenance.data || tab !== 'maintenance') return;
    const rows = [...maintenance.data];
    setMaintenanceRows(rows);
    setMaintenanceMoreError('');
    const pages = maintenance.meta?.totalPages ?? 1;
    if (pages < 2) {
      setMaintenanceMoreLoading(false);
      return;
    }
    setMaintenanceMoreLoading(true);
    void (async () => {
      try {
        for (let page = 2; page <= pages && active; page++) {
          const next = await request<RecordData[]>('GET', '/maintenance', undefined, {
            search: resource.data?.assetTag,
            pageSize: 100,
            page,
          });
          if (!active) return;
          rows.push(...next.data);
        }
        if (active) setMaintenanceRows(rows);
      } catch (error) {
        if (active) setMaintenanceMoreError(errorMessage(error));
      } finally {
        if (active) setMaintenanceMoreLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [maintenance.data, maintenance.meta?.totalPages, resource.data?.assetTag, tab]);
  const audit = useResource<RecordData[]>(user?.role === 'ADMIN' && tab === 'audit' ? '/audit-logs' : null, {
    entityId: id,
    page: auditPage,
    pageSize: 15,
  });
  if (resource.loading) return <Loading />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.reload} />;
  const asset = resource.data!;
  const current = holder(asset);
  const canOperate = manager && !asset.deletedAt;
  const tabs = [
    ['overview', 'Overview', Package],
    ['assignment', 'Assignments', Users],
    ['history', 'History', History],
    ...(manager
      ? [
          ['repairs', 'Repairs', Wrench],
          ['maintenance', 'Maintenance', ShieldCheck],
        ]
      : []),
    ...(user?.role === 'ADMIN' ? [['audit', 'Audit', ShieldCheck]] : []),
  ] as const;
  const moreActions = [
    ...(canOperate
      ? [
          { label: 'Move location', icon: MapPin, onSelect: () => setOperation('move') },
          ...(!['DISPOSED', 'RETIRED', 'UNDER_REPAIR', 'LOST'].includes(asset.status)
            ? [{ label: 'Send for repair', icon: Wrench, onSelect: () => setOperation('repair') }]
            : []),
          ...(statusTargets(asset, user?.role).length
            ? [{ label: 'Change status', icon: RefreshCw, onSelect: () => setOperation('status') }]
            : []),
        ]
      : []),
    ...(user?.role === 'ADMIN'
      ? [
          asset.deletedAt
            ? {
                label: 'Restore asset',
                icon: RotateCcw,
                onSelect: async () => {
                  try {
                    await request('POST', `/assets/${id}/restore`);
                    resource.reload();
                    toast('Asset restored.');
                  } catch (e) {
                    toast(errorMessage(e), 'error');
                  }
                },
              }
            : {
                label: current
                  ? 'Return asset before archiving'
                  : asset.status === 'UNDER_REPAIR'
                    ? 'Close repair before archiving'
                    : 'Archive asset',
                icon: Trash2,
                danger: true,
                disabled: Boolean(current) || asset.status === 'UNDER_REPAIR',
                onSelect: () => setDeleting(true),
              },
        ]
      : []),
  ];
  const refresh = () => {
    resource.reload();
    maintenance.reload();
    audit.reload();
  };
  return (
    <div className="asset-console asset-detail-console">
      <PageHeader
        back="/assets"
        eyebrow={asset.category?.name ?? 'ASSET RECORD'}
        title={asset.assetTag}
        description={`${asset.manufacturer} ${asset.model}`}
        actions={
          <>
            {canOperate && (
              <button className="btn secondary" onClick={() => setEditing(true)}>
                <Edit3 size={15} />
                Edit asset
              </button>
            )}
            {canOperate && asset.status === 'AVAILABLE' && (
              <button className="btn primary" onClick={() => setOperation('assign')}>
                <UserRound size={16} />
                Assign asset
              </button>
            )}
            {canOperate && current && (
              <>
                {asset.status === 'ASSIGNED' && (
                  <button className="btn secondary" onClick={() => setOperation('transfer')}>
                    <ArrowLeftRight size={16} />
                    Transfer
                  </button>
                )}
                <button className="btn primary" onClick={() => setOperation('return')}>
                  <RotateCcw size={16} />
                  Return asset
                </button>
              </>
            )}
            {!manager && current && (
              <button className="btn primary" onClick={() => setOperation('request')}>
                <Plus size={16} />
                Make a request
              </button>
            )}
            {moreActions.length > 0 && (
              <AssetActionMenu
                label="More asset actions"
                items={moreActions}
                buttonText="More"
                icon={ChevronDown}
              />
            )}
          </>
        }
      />
      <section className="asset-record-banner">
        <span className="asset-record-symbol">
          <AssetTypeIcon asset={asset} size={32} />
        </span>
        <div className="asset-record-name">
          <strong>
            {asset.manufacturer} {asset.model}
          </strong>
          <span>
            {asset.assetType} · {asset.serialNumber ?? 'Serial not recorded'}
          </span>
        </div>
        <Badge value={asset.status} />
        <div className="asset-record-fact">
          <span>Condition</span>
          <strong>{human(asset.condition)}</strong>
        </div>
        <div className="asset-record-fact">
          <span>Location</span>
          <strong>
            <MapPin size={13} />
            {asset.location?.name ?? 'Not recorded'}
          </strong>
        </div>
        {asset.deletedAt && <span className="asset-archived-label">Archived record</span>}
      </section>
      <div className="asset-detail-layout">
        <div className="asset-record-main">
          <div className="asset-record-tabs" role="tablist" aria-label="Asset information sections">
            {tabs.map(([value, label, Icon]) => {
              const I = Icon as typeof Package;
              return (
                <button
                  key={String(value)}
                  role="tab"
                  aria-selected={tab === value}
                  tabIndex={tab === value ? 0 : -1}
                  aria-controls={`asset-panel-${value}`}
                  id={`asset-tab-${value}`}
                  onClick={() => setTab(String(value))}
                  onKeyDown={(event) => {
                    const buttons = Array.from(
                      event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
                    );
                    const index = buttons.indexOf(event.currentTarget);
                    const next =
                      event.key === 'ArrowRight'
                        ? (index + 1) % buttons.length
                        : event.key === 'ArrowLeft'
                          ? (index - 1 + buttons.length) % buttons.length
                          : event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? buttons.length - 1
                              : -1;
                    if (next < 0) return;
                    event.preventDefault();
                    buttons[next].focus();
                    buttons[next].click();
                  }}
                >
                  <I size={15} />
                  {String(label)}
                  {value === 'history' && <span>{asset.history?.length ?? 0}</span>}
                </button>
              );
            })}
          </div>
          <div role="tabpanel" id={`asset-panel-${tab}`} aria-labelledby={`asset-tab-${tab}`}>
            {tab === 'overview' && (
              <>
                <section className="panel asset-detail-section">
                  <div className="panel-heading">
                    <h2>Asset information</h2>
                    <span className="subtle-tag">System of record</span>
                  </div>
                  <Details
                    items={[
                      ['Asset tag', asset.assetTag],
                      ['Type', asset.assetType],
                      ['Category', asset.category?.name],
                      ['Manufacturer', asset.manufacturer],
                      ['Model', asset.model],
                      ['Serial number', asset.serialNumber],
                      ['Department', asset.department?.name],
                      ['Location', asset.location?.name],
                      ['Condition', human(asset.condition)],
                      ['Registered on', date(asset.createdAt, true)],
                      ['Internal asset ID', <span className="mono">{asset.id}</span>],
                      ['Description', asset.description],
                    ]}
                  />
                </section>
                <section className="panel asset-detail-section">
                  <div className="panel-heading">
                    <h2>Purchase & warranty</h2>
                    <span
                      className={`asset-coverage-state ${warranty(asset.warrantyExpiry) === 'Active' ? 'active' : ''}`}
                    >
                      <ShieldCheck size={14} />
                      {warranty(asset.warrantyExpiry)}
                    </span>
                  </div>
                  <Details
                    items={[
                      ['Purchase date', date(asset.purchaseDate)],
                      ['Purchase cost', money(asset.purchaseCost)],
                      ['Vendor', asset.vendor],
                      ['Invoice number', asset.invoiceNumber],
                      ['Warranty start', date(asset.warrantyStart)],
                      ['Warranty expiry', date(asset.warrantyExpiry)],
                    ]}
                  />
                </section>
                {asset.notes && (
                  <section className="panel asset-detail-section">
                    <h2>Notes</h2>
                    <p className="asset-notes">{asset.notes}</p>
                  </section>
                )}
                <section className="panel asset-detail-section">
                  <div className="panel-heading">
                    <div>
                      <h2>Recent lifecycle activity</h2>
                      <p>The latest events in this asset's history</p>
                    </div>
                    <button className="text-link" onClick={() => setTab('history')}>
                      Full timeline
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  <Timeline items={asset.history?.slice(0, 5)} />
                </section>
              </>
            )}
            {tab === 'assignment' && (
              <section className="panel table-panel">
                <div className="panel-heading padded">
                  <div>
                    <h2>Assignment history</h2>
                    <p>Closed assignments remain part of the permanent record.</p>
                  </div>
                </div>
                <DataTable
                  columns={[
                    {
                      key: 'employee',
                      label: 'Employee',
                      render: (r) =>
                        manager ? (
                          <Link className="text-link" to={`/employees/${r.employeeId}`}>
                            {r.employee?.name ?? r.employeeId}
                          </Link>
                        ) : (
                          (r.employee?.name ?? 'Employee')
                        ),
                    },
                    { key: 'assignedAt', label: 'Assigned', render: (r) => date(r.assignedAt, true) },
                    {
                      key: 'returnedAt',
                      label: 'Released',
                      render: (r) => (r.returnedAt ? date(r.returnedAt, true) : <Badge value="ACTIVE" />),
                    },
                    {
                      key: 'conditionAtAssignment',
                      label: 'Issue condition',
                      render: (r) => human(r.conditionAtAssignment),
                    },
                    {
                      key: 'conditionAtReturn',
                      label: 'Return condition',
                      render: (r) => human(r.conditionAtReturn) || '—',
                    },
                    {
                      key: 'notes',
                      label: 'Notes',
                      render: (r) => <span className="asset-import-message">{r.notes ?? '—'}</span>,
                    },
                  ]}
                  rows={asset.assignments}
                />
              </section>
            )}
            {tab === 'history' && (
              <section className="panel asset-detail-section">
                <div className="panel-heading">
                  <div>
                    <h2>Complete asset timeline</h2>
                    <p>Every lifecycle event, preserved in order.</p>
                  </div>
                  <span className="subtle-tag">{asset.history?.length ?? 0} events</span>
                </div>
                <Timeline items={asset.history} />
              </section>
            )}
            {tab === 'repairs' && (
              <section className="panel table-panel">
                <div className="panel-heading padded">
                  <h2>Repair history</h2>
                  {canOperate && !['DISPOSED', 'RETIRED', 'UNDER_REPAIR', 'LOST'].includes(asset.status) && (
                    <button className="btn secondary small-btn" onClick={() => setOperation('repair')}>
                      <Plus size={14} />
                      New repair
                    </button>
                  )}
                </div>
                <DataTable
                  columns={[
                    { key: 'issue', label: 'Issue' },
                    { key: 'vendor', label: 'Vendor' },
                    { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
                    { key: 'cost', label: 'Cost', render: (r) => money(r.cost) },
                    { key: 'openedAt', label: 'Opened', render: (r) => date(r.openedAt) },
                    { key: 'closedAt', label: 'Closed', render: (r) => date(r.closedAt) },
                  ]}
                  rows={asset.repairs}
                  emptyTitle="No repairs recorded"
                />
              </section>
            )}
            {tab === 'maintenance' && (
              <section className="panel table-panel">
                <div className="panel-heading padded">
                  <h2>Maintenance records</h2>
                  <Link to="/maintenance" className="text-link">
                    Maintenance console
                    <ArrowRight size={14} />
                  </Link>
                </div>
                <DataTable
                  loading={maintenance.loading || maintenanceMoreLoading}
                  error={maintenance.error || maintenanceMoreError}
                  retry={maintenance.reload}
                  columns={[
                    { key: 'description', label: 'Maintenance details' },
                    { key: 'scheduledAt', label: 'Scheduled', render: (r) => date(r.scheduledAt) },
                    { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
                    { key: 'notes', label: 'Notes' },
                  ]}
                  rows={maintenanceRows.filter((r) => r.assetId === id)}
                  emptyTitle="No maintenance recorded"
                />
              </section>
            )}
            {tab === 'audit' && (
              <section className="panel table-panel">
                <div className="panel-heading padded">
                  <h2>Audit trail</h2>
                  <span className="subtle-tag">Read only</span>
                </div>
                <DataTable
                  loading={audit.loading}
                  error={audit.error}
                  retry={audit.reload}
                  page={auditPage}
                  onPage={setAuditPage}
                  meta={audit.meta}
                  columns={[
                    { key: 'timestamp', label: 'When', render: (r) => date(r.timestamp, true) },
                    { key: 'action', label: 'Action', render: (r) => human(r.action) },
                    { key: 'userName', label: 'Performed by', render: (r) => r.userName ?? 'System' },
                    { key: 'ip', label: 'IP address' },
                    {
                      key: 'details',
                      label: 'Details',
                      render: (r) => (
                        <details className="asset-audit-details">
                          <summary>View changes</summary>
                          <pre>{JSON.stringify(r.details ?? {}, null, 2)}</pre>
                        </details>
                      ),
                    },
                  ]}
                  rows={audit.data}
                />
              </section>
            )}
          </div>
        </div>
        <aside className="asset-record-side">
          <section className="panel holder-panel">
            <div className="asset-holder-heading">
              <UserRound size={17} />
              <span>CURRENT HOLDER</span>
              <i className={current ? 'assigned' : ''} />
            </div>
            {current ? (
              <>
                <span className="avatar large">{initials(current.employee?.name ?? '?')}</span>
                <h2>{current.employee?.name}</h2>
                <p>{current.employee?.employeeId}</p>
                <Details
                  items={[
                    ['Assigned on', date(current.assignedAt)],
                    ['Department', current.employee?.department?.name ?? asset.department?.name],
                    ['Location', current.employee?.location?.name ?? asset.location?.name],
                    ['Expected return', date(current.expectedReturnAt)],
                    ['Issue condition', human(current.conditionAtAssignment)],
                  ]}
                />
                {manager && (
                  <Link className="btn secondary full-width" to={`/employees/${current.employeeId}`}>
                    View employee
                    <ArrowRight size={15} />
                  </Link>
                )}
              </>
            ) : (
              <>
                <div className="unassigned-icon">
                  <Package size={28} />
                </div>
                <h2>No current holder</h2>
                <p>
                  {asset.status === 'AVAILABLE'
                    ? 'Available for its next assignment.'
                    : 'Outside employee custody.'}
                </p>
                {canOperate && asset.status === 'AVAILABLE' && (
                  <p className="asset-holder-note">Use Assign asset to record the next handover.</p>
                )}
              </>
            )}
          </section>
          <section className="asset-record-integrity">
            <ShieldCheck size={20} />
            <div>
              <strong>Complete accountability</strong>
              <p>Every handover, status change, and location move remains connected to this asset.</p>
            </div>
          </section>
        </aside>
      </div>
      {editing && <AssetEditor asset={asset} onClose={() => setEditing(false)} onSaved={refresh} />}{' '}
      {operation && (
        <AssetOperation
          asset={asset}
          operation={operation}
          onClose={() => setOperation(null)}
          onSaved={refresh}
        />
      )}{' '}
      {deleting && (
        <ConfirmDialog
          title="Archive this asset?"
          description="The asset will be hidden from active inventory. Its full history will remain available, and an administrator can restore it."
          confirmLabel="Archive asset"
          busy={busy}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await request('DELETE', `/assets/${id}`);
              setDeleting(false);
              refresh();
              toast('Asset archived.');
            } catch (e) {
              toast(errorMessage(e), 'error');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}
