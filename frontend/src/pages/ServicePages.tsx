import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  ArrowRightLeft,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  History,
  Package,
  Plus,
  RotateCcw,
  ShieldAlert,
  Wrench,
  X,
} from 'lucide-react';
import { useResource, useDebounce } from '../hooks/useResource';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { AssetOperation, AssetOperationPicker, choices } from '../components/AssetForms';
import {
  Badge,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  SlideOver as Modal,
  PageHeader,
  SearchInput,
} from '../components/ui';
import { RecordForm } from '../components/RecordForm';
import type { Field } from '../components/RecordForm';
import type { RecordData } from '../types';
import { clean, date, human, initials, money } from '../utils/format';
import { request } from '../services/api';
import './people-operations.css';

function RequestIcon({ type }: { type: string }) {
  const Icon =
    type === 'LOST'
      ? ShieldAlert
      : type === 'DAMAGE'
        ? Wrench
        : type === 'TRANSFER'
          ? ArrowRightLeft
          : RotateCcw;
  return <Icon size={15} aria-hidden="true" />;
}
export function RepairsPage({ initialTab = 'repairs' }: { initialTab?: 'repairs' | 'maintenance' }) {
  const [tab, setTab] = useState(initialTab);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const query = useDebounce(search);
  const [status, setStatus] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const assetQuery = useDebounce(assetSearch);
  const [newRepair, setNewRepair] = useState(false);
  const [maintenance, setMaintenance] = useState<RecordData | null | undefined>(undefined);
  const [editRepair, setEditRepair] = useState<RecordData | null>(null);
  const resource = useResource<RecordData[]>(`/${tab}`, {
    page,
    pageSize: 12,
    search: query,
    ...(tab === 'repairs' ? { status } : {}),
  });
  const assets = useResource<RecordData[]>(maintenance === null ? '/assets' : null, {
    pageSize: 100,
    search: assetQuery,
  });
  const toast = useToast();
  useEffect(() => {
    setTab(initialTab);
    setPage(1);
    setStatus('');
  }, [initialTab]);
  return (
    <div className="po-console po-service-console">
      <PageHeader
        eyebrow="ASSET CARE"
        title="Repairs & maintenance"
        description="Keep equipment working well, and every service visit on record."
        actions={
          <button
            className="btn primary"
            onClick={() => {
              if (tab === 'repairs') setNewRepair(true);
              else {
                setAssetSearch('');
                setMaintenance(null);
              }
            }}
          >
            <Plus size={17} />
            {tab === 'repairs' ? 'Create repair' : 'Schedule maintenance'}
          </button>
        }
      />
      <div className="asset-tabs po-service-tabs" role="group" aria-label="Service register">
        <button
          className={tab === 'repairs' ? 'active' : ''}
          aria-pressed={tab === 'repairs'}
          onClick={() => {
            setTab('repairs');
            setPage(1);
            setStatus('');
            setSearch('');
          }}
        >
          <Wrench size={16} />
          Repair register
        </button>
        <button
          className={tab === 'maintenance' ? 'active' : ''}
          aria-pressed={tab === 'maintenance'}
          onClick={() => {
            setTab('maintenance');
            setPage(1);
            setStatus('');
            setSearch('');
          }}
        >
          <CalendarClock size={16} />
          Scheduled maintenance
        </button>
      </div>
      {tab === 'repairs' && (
        <div className="po-service-stages" role="group" aria-label="Filter repairs by stage">
          {[
            ['OPEN', 'Reported', ClipboardList],
            ['IN_REPAIR', 'In repair', Wrench],
            ['REPAIRED', 'Ready to close', CheckCircle2],
            ['CLOSED', 'Closed', History],
          ].map(([value, label, Icon]) => {
            const StageIcon = Icon as typeof Wrench;
            return (
              <button
                key={String(value)}
                className={status === value ? 'active' : ''}
                aria-pressed={status === value}
                onClick={() => {
                  setStatus(status === value ? '' : String(value));
                  setPage(1);
                }}
              >
                <span>
                  <StageIcon size={18} />
                </span>
                <strong>{String(label)}</strong>
                <small>{status === value ? 'Selected · click to show all' : human(String(value))}</small>
              </button>
            );
          })}
        </div>
      )}
      <section className="panel table-panel">
        <div className="po-register-heading">
          <div>
            <h2>{tab === 'repairs' ? 'Repair work orders' : 'Maintenance schedule'}</h2>
            <p>
              {resource.loading
                ? 'Loading service records…'
                : `${resource.meta?.total ?? 0} ${status || query ? 'matching ' : ''}records`}
            </p>
          </div>
          <span className="po-icon-text">
            <History size={15} />
            Service history retained
          </span>
        </div>
        <div className="table-toolbar">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search service records…"
          />
          {status ? (
            <button
              className="po-filter-chip"
              onClick={() => {
                setStatus('');
                setPage(1);
              }}
            >
              {human(status)}
              <X size={13} />
            </button>
          ) : (
            <span className="subtle-tag">
              <Wrench size={12} />
              Full service history
            </span>
          )}
        </div>
        {!resource.loading && !resource.error && !resource.data?.length ? (
          <EmptyState
            title={
              query || status
                ? 'No service records match your filters'
                : tab === 'repairs'
                  ? 'No repair work orders yet'
                  : 'No maintenance scheduled'
            }
            description={
              query || status
                ? 'Try another asset tag or clear the stage filter.'
                : tab === 'repairs'
                  ? 'Create a repair to record the issue, vendor, service costs, and resolution.'
                  : 'Schedule inspections or routine servicing to keep equipment ready for use.'
            }
            action={
              <button
                className="btn secondary"
                onClick={() => {
                  if (query || status) {
                    setSearch('');
                    setStatus('');
                  } else if (tab === 'repairs') setNewRepair(true);
                  else setMaintenance(null);
                }}
              >
                {query || status
                  ? 'Clear filters'
                  : tab === 'repairs'
                    ? 'Create repair'
                    : 'Schedule maintenance'}
              </button>
            }
          />
        ) : (
          <DataTable
            rows={resource.data}
            loading={resource.loading}
            error={resource.error}
            retry={resource.reload}
            meta={resource.meta}
            page={page}
            onPage={setPage}
            columns={[
              {
                key: 'asset',
                label: 'Asset',
                render: (r) => (
                  <Link className="asset-cell" to={`/assets/${r.assetId}`}>
                    <span className="table-asset-icon">
                      <Package size={18} />
                    </span>
                    <span>
                      <strong>{r.asset?.assetTag}</strong>
                      <small>{r.asset?.model}</small>
                    </span>
                  </Link>
                ),
              },
              {
                key: tab === 'repairs' ? 'issue' : 'description',
                label: tab === 'repairs' ? 'Issue' : 'Maintenance details',
                render: (record) => (
                  <span className="po-service-description">
                    {tab === 'repairs' ? record.issue : record.description}
                    {record.notes && <small>{record.notes}</small>}
                  </span>
                ),
              },
              { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
              ...(tab === 'repairs'
                ? [
                    { key: 'vendor', label: 'Vendor' },
                    { key: 'cost', label: 'Cost', render: (r: RecordData) => money(r.cost) },
                    { key: 'openedAt', label: 'Opened', render: (r: RecordData) => date(r.openedAt) },
                  ]
                : [
                    {
                      key: 'scheduledAt',
                      label: 'Scheduled',
                      render: (r: RecordData) => date(r.scheduledAt),
                    },
                  ]),
              {
                key: 'actions',
                label: '',
                render: (r) =>
                  ['CLOSED', 'COMPLETED', 'CANCELLED'].includes(r.status) ? (
                    <span className="po-icon-text">
                      <CheckCircle2 size={14} />
                      {r.status === 'CANCELLED' ? 'Cancelled' : 'Completed'}
                    </span>
                  ) : (
                    <button
                      className="btn secondary small-btn"
                      onClick={() => (tab === 'repairs' ? setEditRepair(r) : setMaintenance(r))}
                    >
                      Update
                      <ArrowRight size={14} />
                    </button>
                  ),
              },
            ]}
          />
        )}
      </section>
      {newRepair && (
        <AssetOperationPicker
          operation="repair"
          onClose={() => setNewRepair(false)}
          onSaved={resource.reload}
        />
      )}{' '}
      {editRepair && (
        <Modal
          title="Update repair"
          description={`${editRepair.asset?.assetTag} · ${editRepair.issue}`}
          onClose={() => setEditRepair(null)}
        >
          <div className="po-dialog-summary">
            <span className="po-icon-text">
              <Wrench size={18} />
              <strong>{editRepair.asset?.assetTag}</strong>
              <Badge value={editRepair.status} />
            </span>
            <p>{editRepair.issue}</p>
          </div>
          <RecordForm
            initial={{
              ...editRepair,
              status:
                ['OPEN', 'IN_REPAIR', 'REPAIRED', 'CLOSED'][
                  ['OPEN', 'IN_REPAIR', 'REPAIRED', 'CLOSED'].indexOf(editRepair.status) + 1
                ] ?? '',
            }}
            fields={[
              {
                name: 'status',
                label: 'Repair status',
                type: 'select',
                required: true,
                options: choices(
                  ['OPEN', 'IN_REPAIR', 'REPAIRED', 'CLOSED'].slice(
                    ['OPEN', 'IN_REPAIR', 'REPAIRED', 'CLOSED'].indexOf(editRepair.status) + 1,
                    ['OPEN', 'IN_REPAIR', 'REPAIRED', 'CLOSED'].indexOf(editRepair.status) + 2,
                  ),
                ),
                full: true,
              },
              { name: 'vendor', label: 'Repair vendor' },
              { name: 'cost', label: 'Repair cost', type: 'number', min: 0 },
              { name: 'notes', label: 'Service notes', type: 'textarea' },
            ]}
            onCancel={() => setEditRepair(null)}
            onSubmit={async (values) => {
              await request('PATCH', `/repairs/${editRepair.id}`, clean(values, [], ['cost']));
              toast('Repair record updated.');
              setEditRepair(null);
              resource.reload();
            }}
          />
          <p className="dialog-footnote">
            Move the repair forward one stage at a time. Closing a repaired asset makes it available for a new
            assignment.
          </p>
        </Modal>
      )}
      {maintenance !== undefined && (
        <Modal
          title={maintenance ? 'Update maintenance' : 'Schedule maintenance'}
          onClose={() => setMaintenance(undefined)}
        >
          {maintenance ? (
            <div className="po-dialog-summary">
              <span className="po-icon-text">
                <CalendarClock size={18} />
                <strong>{maintenance.asset?.assetTag}</strong>
                <Badge value={maintenance.status} />
              </span>
              <p>{maintenance.asset?.model}</p>
            </div>
          ) : (
            <div className="po-dialog-summary">
              <h3>Choose equipment to service</h3>
              <SearchInput
                value={assetSearch}
                onChange={setAssetSearch}
                placeholder="Find asset by tag, model or serial…"
              />
              {assets.loading && <p role="status">Finding equipment…</p>}
              {assets.error && <ErrorState message={assets.error} retry={assets.reload} />}
            </div>
          )}
          <RecordForm
            initial={maintenance ?? undefined}
            fields={[
              ...(!maintenance
                ? [
                    {
                      name: 'assetId',
                      label: 'Asset',
                      type: 'select',
                      required: true,
                      options: assets.data
                        ?.filter((asset) => !['LOST', 'RETIRED', 'DISPOSED'].includes(asset.status))
                        .map((a) => ({
                          value: a.id,
                          label: `${a.assetTag} · ${a.model}`,
                        })),
                      full: true,
                    } as Field,
                  ]
                : []),
              { name: 'description', label: 'Maintenance description', type: 'textarea', required: true },
              { name: 'scheduledAt', label: 'Scheduled date', type: 'date' },
              {
                name: 'status',
                label: 'Status',
                type: 'select',
                required: true,
                options: choices(
                  maintenance ? ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] : ['SCHEDULED'],
                ),
                defaultValue: 'SCHEDULED',
              },
              { name: 'notes', label: 'Notes', type: 'textarea' },
            ]}
            onCancel={() => setMaintenance(undefined)}
            submitLabel={maintenance ? 'Save maintenance' : 'Schedule maintenance'}
            onSubmit={async (values) => {
              if (!maintenance) delete values.status;
              await request(
                maintenance ? 'PATCH' : 'POST',
                maintenance ? `/maintenance/${maintenance.id}` : '/maintenance',
                clean(values, ['scheduledAt']),
              );
              toast('Maintenance saved.');
              setMaintenance(undefined);
              resource.reload();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
export function RequestsPage() {
  const { user } = useAuth();
  const manager = user?.role !== 'EMPLOYEE';
  const [params, setParams] = useSearchParams();
  const [create, setCreate] = useState(false);
  const [requestType, setRequestType] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [review, setReview] = useState<{ item: RecordData; status: string } | null>(null);
  const resource = useResource<RecordData[]>('/requests', { status, page, pageSize: 12 });
  const ownAssets = useResource<RecordData[]>(
    !manager && user?.employeeId ? `/employees/${user.employeeId}/assets` : null,
  );
  const toast = useToast();
  useEffect(() => {
    if (params.get('new')) {
      const type = params.get('type');
      setRequestType(type && ['DAMAGE', 'LOST', 'RETURN', 'TRANSFER'].includes(type) ? type : undefined);
      setCreate(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);
  return (
    <div className="po-console po-requests-console">
      <PageHeader
        eyebrow="REQUESTS & INCIDENTS"
        title={manager ? 'Requests inbox' : 'My requests'}
        description={
          manager
            ? 'Review asset issues and coordinate the next step.'
            : 'Report an issue, or request a return or transfer.'
        }
        actions={
          <button
            className="btn primary"
            onClick={() => {
              setRequestType(undefined);
              setCreate(true);
            }}
          >
            <Plus size={17} />
            New request
          </button>
        }
      />
      <div className="po-context-note">
        <ClipboardList size={21} />
        <div>
          <strong>
            {manager ? 'One inbox for equipment requests' : 'Keep your equipment record up to date'}
          </strong>
          <p>
            {manager
              ? 'Review reported issues, approve the next step, and complete return or transfer handovers.'
              : 'Report damage or loss and track requests from submission through resolution.'}
          </p>
        </div>
      </div>
      <div className="asset-tabs po-request-tabs" role="group" aria-label="Filter request status">
        {[
          ['', 'All requests'],
          ['PENDING', 'Pending'],
          ['APPROVED', 'Approved'],
          ['REJECTED', 'Rejected'],
          ['COMPLETED', 'Completed'],
        ].map(([value, label]) => (
          <button
            key={value}
            className={status === value ? 'active' : ''}
            aria-pressed={status === value}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
          >
            {value === 'PENDING' ? (
              <Clock3 size={15} />
            ) : value === 'COMPLETED' ? (
              <CheckCircle2 size={15} />
            ) : value === 'REJECTED' ? (
              <X size={15} />
            ) : (
              <ClipboardList size={15} />
            )}
            {label}
          </button>
        ))}
      </div>
      <section className="panel table-panel">
        <div className="po-register-heading">
          <div>
            <h2>{status ? `${human(status)} requests` : 'All requests'}</h2>
            <p>{resource.loading ? 'Loading requests…' : `${resource.meta?.total ?? 0} records`}</p>
          </div>
          {status === 'PENDING' && (
            <span className="po-icon-text">
              <Clock3 size={15} />
              Awaiting review
            </span>
          )}
        </div>
        {!resource.loading && !resource.error && !resource.data?.length ? (
          <EmptyState
            title={
              status
                ? `No ${human(status).toLowerCase()} requests`
                : manager
                  ? 'The requests inbox is clear'
                  : 'No requests yet'
            }
            description={
              status
                ? 'Requests will appear here when they reach this stage.'
                : manager
                  ? 'Employee incidents and handover requests will appear here for review.'
                  : 'Submit a request when you need help with equipment or a handover.'
            }
            action={
              status ? (
                <button
                  className="btn secondary"
                  onClick={() => {
                    setStatus('');
                    setPage(1);
                  }}
                >
                  View all requests
                </button>
              ) : (
                <button
                  className="btn secondary"
                  onClick={() => {
                    setRequestType(undefined);
                    setCreate(true);
                  }}
                >
                  New request
                </button>
              )
            }
          />
        ) : (
          <DataTable
            rows={resource.data}
            loading={resource.loading}
            error={resource.error}
            retry={resource.reload}
            meta={resource.meta}
            page={page}
            onPage={setPage}
            columns={[
              {
                key: 'asset',
                label: 'Asset',
                render: (r) => {
                  const content = (
                    <>
                      <span className="table-asset-icon">
                        <Package size={18} />
                      </span>
                      <span>
                        <strong>{r.asset?.assetTag}</strong>
                        <small>{r.asset?.model}</small>
                      </span>
                    </>
                  );
                  return manager || ownAssets.data?.some((assignment) => assignment.assetId === r.assetId) ? (
                    <Link className="asset-cell" to={`/assets/${r.assetId}`}>
                      {content}
                    </Link>
                  ) : (
                    <div className="asset-cell">{content}</div>
                  );
                },
              },
              ...(manager
                ? [
                    {
                      key: 'employee',
                      label: 'Requested by',
                      render: (r: RecordData) => (
                        <Link className="po-inline-person" to={`/employees/${r.employeeId}`}>
                          <span className="po-avatar-small">{initials(r.employee?.name ?? '')}</span>
                          <span>
                            {r.employee?.name ?? '—'}
                            <small>{r.employee?.employeeId}</small>
                          </span>
                        </Link>
                      ),
                    },
                  ]
                : []),
              {
                key: 'type',
                label: 'Request type',
                render: (r) => (
                  <span className={`po-request-type po-request-${String(r.type).toLowerCase()}`}>
                    <RequestIcon type={r.type} />
                    {human(r.type)}
                  </span>
                ),
              },
              {
                key: 'description',
                label: 'Description',
                render: (r) => (
                  <span className="wrap-cell">
                    {r.description}
                    {r.resolution && <small className="cell-subtitle">Resolution: {r.resolution}</small>}
                  </span>
                ),
              },
              { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
              { key: 'createdAt', label: 'Requested on', render: (r) => date(r.createdAt) },
              {
                key: 'actions',
                label: '',
                render: (r) =>
                  manager && r.status === 'PENDING' ? (
                    <div className="row-actions">
                      <button
                        className="btn secondary small-btn"
                        onClick={() => setReview({ item: r, status: 'APPROVED' })}
                      >
                        <Check size={14} />
                        Approve
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Reject request for ${r.asset?.assetTag}`}
                        title={`Reject request for ${r.asset?.assetTag}`}
                        onClick={() => setReview({ item: r, status: 'REJECTED' })}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : manager && r.status === 'APPROVED' && ['RETURN', 'TRANSFER'].includes(r.type) ? (
                    <Link className="btn secondary small-btn" to={`/assets/${r.assetId}`}>
                      Complete {r.type.toLowerCase()}
                      <ArrowRight size={14} />
                    </Link>
                  ) : (
                    '—'
                  ),
              },
            ]}
          />
        )}
      </section>
      {create && (
        <AssetOperationPicker
          operation="request"
          requestType={requestType}
          onClose={() => setCreate(false)}
          onSaved={resource.reload}
        />
      )}{' '}
      {review && (
        <Modal
          title={`${human(review.status === 'APPROVED' ? 'APPROVE' : 'REJECT')} request`}
          description={`${review.item.asset?.assetTag} · ${human(review.item.type)}`}
          onClose={() => setReview(null)}
        >
          <div className="po-dialog-summary">
            <span className="po-icon-text">
              <RequestIcon type={review.item.type} />
              <strong>{human(review.item.type)} request</strong>
              <Badge value={review.item.status} />
            </span>
            <p>{review.item.description}</p>
            <small>
              Requested by {review.item.employee?.name ?? 'Employee'} on {date(review.item.createdAt)}
            </small>
          </div>
          {review.status === 'APPROVED' && ['DAMAGE', 'LOST'].includes(review.item.type) && (
            <div className="po-context-note po-attention-note">
              <AlertCircle size={18} />
              <p>
                Approval will mark this asset as{' '}
                {review.item.type === 'LOST' ? 'lost and close its current assignment' : 'damaged'}.
              </p>
            </div>
          )}
          <RecordForm
            fields={[{ name: 'resolution', label: 'Review notes', type: 'textarea', required: true }]}
            submitLabel={review.status === 'APPROVED' ? 'Approve request' : 'Reject request'}
            onCancel={() => setReview(null)}
            onSubmit={async (values) => {
              await request('PATCH', `/requests/${review.item.id}`, { status: review.status, ...values });
              toast(`Request ${review.status.toLowerCase()}.`);
              setReview(null);
              resource.reload();
            }}
          />
          {['RETURN', 'TRANSFER'].includes(review.item.type) && (
            <p className="dialog-footnote">
              Approval acknowledges the request. Complete the actual handover from the asset details page.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
