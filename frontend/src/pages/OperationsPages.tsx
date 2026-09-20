import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  History,
  MapPin,
  Package,
  Plus,
  RotateCcw,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useResource, useDebounce } from '../hooks/useResource';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { AssetOperation, AssetOperationPicker, options } from '../components/AssetForms';
import type { Operation } from '../components/AssetForms';
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
import type { Lookups, RecordData } from '../types';
import { clean, date, human, initials } from '../utils/format';
import { request, errorMessage } from '../services/api';
import type { Column } from '../components/ui';
import './people-operations.css';

function isOutstanding(item: RecordData, checklist: RecordData) {
  return (
    ['PENDING_RETURN', 'PENDING'].includes(item.resolution) ||
    (checklist.status === 'IN_PROGRESS' &&
      Boolean(
        item.asset?.assignments?.some(
          (assignment: RecordData) =>
            !assignment.returnedAt && assignment.employeeId === checklist.employeeId,
        ),
      ))
  );
}
function checklistProgress(checklist: RecordData) {
  const items: RecordData[] = checklist.items ?? [];
  const pending = items.filter((item) => isOutstanding(item, checklist)).length;
  return {
    total: items.length,
    pending,
    resolved: items.length - pending,
    percent: items.length ? Math.round(((items.length - pending) / items.length) * 100) : 100,
  };
}
const assetColumn: Column = {
  key: 'asset',
  label: 'Asset',
  render: (r) => (
    <Link className="asset-cell" to={`/assets/${r.assetId ?? r.asset?.id}`}>
      <span className="table-asset-icon">
        <Package size={18} />
      </span>
      <span>
        <strong>{r.asset?.assetTag ?? 'View asset'}</strong>
        <small>{r.asset?.model}</small>
      </span>
    </Link>
  ),
};
export function TransactionsPage({ kind }: { kind: 'assignments' | 'transfers' | 'returns' | 'movements' }) {
  const [search, setSearch] = useState('');
  const query = useDebounce(search);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const resource = useResource<RecordData[]>(`/${kind}`, {
    page,
    pageSize: 12,
    search: query,
    ...(kind === 'assignments' && activeOnly ? { active: 'true' } : {}),
  });
  useEffect(() => {
    setPage(1);
    setSearch('');
    setActiveOnly(false);
  }, [kind]);
  const type: Operation =
    kind === 'assignments'
      ? 'assign'
      : kind === 'transfers'
        ? 'transfer'
        : kind === 'returns'
          ? 'return'
          : 'move';
  const labels = {
    assignments: [
      'Assignments',
      'Equipment issued to your people. Every handover, recorded.',
      'Assign asset',
    ],
    transfers: [
      'Transfers',
      'Follow the movement of responsibility from one person to another.',
      'Transfer asset',
    ],
    returns: ['Returns', 'A complete record of equipment received back into your inventory.', 'Return asset'],
    movements: ['Location movements', 'Know where every asset has been, and where it is now.', 'Move asset'],
  };
  const columns: Column[] =
    kind === 'assignments'
      ? [
          assetColumn,
          {
            key: 'employee',
            label: 'Employee',
            render: (r) => (
              <Link className="po-inline-person" to={`/employees/${r.employeeId}`}>
                <span className="po-avatar-small">{initials(r.employee?.name ?? '')}</span>
                <span>
                  {r.employee?.name}
                  <small>{r.employee?.employeeId}</small>
                </span>
              </Link>
            ),
          },
          { key: 'assignedAt', label: 'Assigned on', render: (r) => date(r.assignedAt, true) },
          { key: 'expectedReturnAt', label: 'Expected return', render: (r) => date(r.expectedReturnAt) },
          { key: 'conditionAtAssignment', label: 'Condition', render: (r) => human(r.conditionAtAssignment) },
          {
            key: 'returnedAt',
            label: 'Assignment',
            render: (r) => <Badge value={r.returnedAt ? 'CLOSED' : 'ACTIVE'} />,
          },
        ]
      : kind === 'transfers'
        ? [
            assetColumn,
            { key: 'from', label: 'From employee', render: (r) => r.fromEmployee?.name },
            { key: 'to', label: 'To employee', render: (r) => r.toEmployee?.name },
            { key: 'transferredAt', label: 'Transferred on', render: (r) => date(r.transferredAt, true) },
            { key: 'reason', label: 'Reason' },
          ]
        : kind === 'returns'
          ? [
              assetColumn,
              { key: 'employee', label: 'Returned by', render: (r) => r.employee?.name },
              { key: 'returnedAt', label: 'Returned on', render: (r) => date(r.returnedAt, true) },
              { key: 'condition', label: 'Condition', render: (r) => human(r.condition) },
              { key: 'accessories', label: 'Accessories', render: (r) => r.accessories?.join(', ') || '—' },
              { key: 'damage', label: 'Damage' },
            ]
          : [
              assetColumn,
              { key: 'from', label: 'From location', render: (r) => r.fromLocation?.name ?? 'Not recorded' },
              { key: 'to', label: 'To location', render: (r) => r.toLocation?.name },
              { key: 'movedAt', label: 'Moved on', render: (r) => date(r.movedAt, true) },
              { key: 'notes', label: 'Notes' },
            ];
  return (
    <div className="po-console">
      <PageHeader
        eyebrow="OPERATIONS"
        title={labels[kind][0]}
        description={labels[kind][1]}
        actions={
          <button className="btn primary" onClick={() => setOpen(true)}>
            <Plus size={17} />
            {labels[kind][2]}
          </button>
        }
      />
      <nav className="po-operation-nav" aria-label="Asset operations">
        <Link
          className={kind === 'assignments' ? 'active' : ''}
          aria-current={kind === 'assignments' ? 'page' : undefined}
          to="/assignments"
        >
          <ClipboardCheck size={16} />
          Assignments
        </Link>
        <Link
          className={kind === 'transfers' ? 'active' : ''}
          aria-current={kind === 'transfers' ? 'page' : undefined}
          to="/transfers"
        >
          <ArrowRightLeft size={16} />
          Transfers
        </Link>
        <Link
          className={kind === 'returns' ? 'active' : ''}
          aria-current={kind === 'returns' ? 'page' : undefined}
          to="/returns"
        >
          <RotateCcw size={16} />
          Returns
        </Link>
        <Link
          className={kind === 'movements' ? 'active' : ''}
          aria-current={kind === 'movements' ? 'page' : undefined}
          to="/movements"
        >
          <MapPin size={16} />
          Location movements
        </Link>
      </nav>
      <section className="panel table-panel">
        <div className="po-register-heading">
          <div>
            <h2>{kind === 'assignments' ? 'Assignment register' : `${labels[kind][0]} register`}</h2>
            <p>
              {resource.loading
                ? 'Loading records…'
                : `${resource.meta?.total ?? 0} ${query ? 'matching ' : ''}records`}
            </p>
          </div>
          <span className="po-icon-text">
            <History size={15} />
            Audited history
          </span>
        </div>
        <div className="table-toolbar">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search transactions…"
          />
          {kind === 'assignments' ? (
            <label className="po-checkbox-filter">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(event) => {
                  setActiveOnly(event.target.checked);
                  setPage(1);
                }}
              />
              Active assignments only
            </label>
          ) : (
            <span className="subtle-tag">Complete history</span>
          )}
        </div>
        {!resource.loading && !resource.error && !resource.data?.length ? (
          <EmptyState
            title={
              query
                ? 'No transactions match your search'
                : `No ${kind === 'movements' ? 'location movements' : kind} recorded`
            }
            description={
              query
                ? 'Search by asset tag or the employee involved in the handover.'
                : 'Completed operations appear here with their dates and responsible employees.'
            }
            action={
              <button className="btn secondary" onClick={() => (query ? setSearch('') : setOpen(true))}>
                {query ? 'Clear search' : labels[kind][2]}
              </button>
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={resource.data}
            loading={resource.loading}
            error={resource.error}
            retry={resource.reload}
            meta={resource.meta}
            page={page}
            onPage={setPage}
          />
        )}
      </section>
      {open && (
        <AssetOperationPicker operation={type} onClose={() => setOpen(false)} onSaved={resource.reload} />
      )}
    </div>
  );
}
export function OffboardingPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const resource = useResource<RecordData[]>('/offboarding', { page, pageSize: 12 });
  const employees = useResource<Lookups>('/lookups');
  const navigate = useNavigate();
  return (
    <div className="po-console">
      <PageHeader
        eyebrow="OPERATIONS"
        title="Employee offboarding"
        description="Make the last handover as clear as the first. Account for every asset."
        actions={
          <button className="btn primary" onClick={() => setOpen(true)}>
            <Plus size={17} />
            Start offboarding
          </button>
        }
      />
      <div className="po-context-note">
        <ClipboardCheck size={22} />
        <div>
          <strong>A complete checklist for every departure</strong>
          <p>
            Resolve all outstanding assets before completing offboarding. Assignment history is always
            preserved.
          </p>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="po-register-heading">
          <div>
            <h2>Departure checklists</h2>
            <p>
              {resource.loading ? 'Loading checklists…' : `${resource.meta?.total ?? 0} offboarding records`}
            </p>
          </div>
          <span className="po-icon-text">
            <ShieldCheck size={15} />
            Every asset accounted for
          </span>
        </div>
        {!resource.loading && !resource.error && !resource.data?.length ? (
          <EmptyState
            title="No offboarding checklists yet"
            description="Start a checklist when an employee leaves to track returns, transfers, and approved resolutions."
            action={
              <button className="btn secondary" onClick={() => setOpen(true)}>
                Start offboarding
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
                key: 'employee',
                label: 'Employee',
                render: (r) => (
                  <Link className="po-inline-person" to={`/offboarding/${r.id}`}>
                    <span className="avatar">{initials(r.employee?.name ?? '')}</span>
                    <span>
                      <strong>{r.employee?.name}</strong>
                      <small>
                        {r.employee?.employeeId} · {r.employee?.department?.name ?? 'No department'}
                      </small>
                    </span>
                  </Link>
                ),
              },
              { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
              { key: 'startedAt', label: 'Started on', render: (r) => date(r.startedAt) },
              { key: 'completedAt', label: 'Completed on', render: (r) => date(r.completedAt) },
              {
                key: 'items',
                label: 'Asset return progress',
                render: (r) => {
                  const progress = checklistProgress(r);
                  return (
                    <div className="po-mini-progress">
                      <div>
                        <strong>
                          {progress.resolved} of {progress.total}
                        </strong>
                        <span>{progress.percent}%</span>
                      </div>
                      <progress
                        value={progress.resolved || (progress.total ? 0 : 1)}
                        max={progress.total || 1}
                        aria-label={`${progress.resolved} of ${progress.total} assets accounted for`}
                      />
                      <small>
                        {progress.pending ? `${progress.pending} outstanding` : 'All accounted for'}
                      </small>
                    </div>
                  );
                },
              },
              {
                key: 'actions',
                label: '',
                render: (r) => (
                  <Link className="btn secondary small-btn" to={`/offboarding/${r.id}`}>
                    Open checklist
                    <ArrowRight size={14} />
                  </Link>
                ),
              },
            ]}
          />
        )}
      </section>
      {open && (
        <Modal title="Start employee offboarding" onClose={() => setOpen(false)}>
          {employees.loading ? (
            <Loading />
          ) : employees.error ? (
            <ErrorState message={employees.error} retry={employees.reload} />
          ) : (
            <RecordForm
              fields={[
                {
                  name: 'employeeId',
                  label: 'Employee',
                  type: 'select',
                  required: true,
                  options: options(employees.data?.employees).filter(
                    (employee) => employee.value !== user?.employeeId,
                  ),
                  full: true,
                },
                { name: 'notes', label: 'Notes', type: 'textarea' },
              ]}
              submitLabel="Create checklist"
              onCancel={() => setOpen(false)}
              onSubmit={async (values) => {
                const result = await request('POST', '/offboarding', clean(values));
                navigate(`/offboarding/${result.data.id}`);
              }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
export function OffboardingDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const resource = useResource<RecordData>(`/offboarding/${id}`);
  const [operation, setOperation] = useState<{ asset: RecordData; type: Operation } | null>(null);
  const [lossAsset, setLossAsset] = useState<RecordData | null>(null);
  const [busy, setBusy] = useState(false);
  if (resource.loading) return <Loading />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.reload} />;
  const data = resource.data!;
  const { pending, total, resolved, percent } = checklistProgress(data);
  const completed = data.status === 'COMPLETED';
  return (
    <div className="po-console po-offboarding">
      <PageHeader
        back="/offboarding"
        eyebrow="OFFBOARDING CHECKLIST"
        title={data.employee?.name ?? 'Employee offboarding'}
        description={`${data.employee?.employeeId} · Started ${date(data.startedAt)}`}
        actions={
          <>
            {data.status === 'IN_PROGRESS' && (
              <button
                className="btn primary"
                disabled={busy || pending > 0}
                aria-describedby={pending ? 'po-offboarding-pending' : undefined}
                title={pending ? 'Account for outstanding assets first' : undefined}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await request('POST', `/offboarding/${id}/complete`);
                    toast('Offboarding completed. All assets are accounted for.');
                    resource.reload();
                  } catch (e) {
                    toast(errorMessage(e), 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <CheckCircle2 size={17} />
                Complete offboarding
              </button>
            )}
            <Link className="btn secondary" to={`/employees/${data.employeeId}`}>
              Employee profile
              <ArrowRight size={16} />
            </Link>
          </>
        }
      />
      <section className={`po-offboarding-summary ${pending === 0 ? 'is-ready' : ''}`}>
        <div className="po-offboarding-identity">
          <span className="avatar large">{initials(data.employee?.name ?? '')}</span>
          <div>
            <div className="po-identity-heading">
              <h2>{data.employee?.name}</h2>
              <Badge value={data.status} />
            </div>
            <p>
              {data.employee?.employeeId} · {data.employee?.department?.name ?? 'No department'}
            </p>
          </div>
        </div>
        <div className="po-progress-title">
          <div>
            <h3>Asset return progress</h3>
            <p>
              {resolved} of {total} assets accounted for
            </p>
          </div>
          <strong>
            {percent}
            <span>%</span>
          </strong>
        </div>
        <progress
          className="po-full-progress"
          value={resolved || (total ? 0 : 1)}
          max={total || 1}
          aria-label="Asset return progress"
        />
        <div className="po-progress-counts">
          <span>
            <CheckCircle2 size={15} />
            <strong>{resolved}</strong> accounted for
          </span>
          <span>
            <Clock3 size={15} />
            <strong>{pending}</strong> outstanding
          </span>
          <span>
            <Package size={15} />
            <strong>{total}</strong> checklist assets
          </span>
        </div>
      </section>
      <ol className="po-process-steps" aria-label="Offboarding workflow">
        <li className="done">
          <CheckCircle2 size={17} />
          <span>
            Checklist created<small>{date(data.startedAt)}</small>
          </span>
        </li>
        <li className={pending === 0 ? 'done' : 'current'}>
          {pending === 0 ? <CheckCircle2 size={17} /> : <Package size={17} />}
          <span>
            Account for equipment
            <small>
              {resolved} of {total} assets resolved
            </small>
          </span>
        </li>
        <li className={completed ? 'done' : pending === 0 ? 'current' : ''}>
          {completed ? <CheckCircle2 size={17} /> : <ShieldCheck size={17} />}
          <span>
            Complete offboarding
            <small>
              {completed
                ? date(data.completedAt)
                : pending
                  ? 'Awaiting asset resolution'
                  : 'Ready for completion'}
            </small>
          </span>
        </li>
      </ol>
      {pending > 0 ? (
        <div className="po-context-note po-attention-note" id="po-offboarding-pending">
          <AlertCircle size={19} />
          <div>
            <strong>
              {pending} outstanding {pending === 1 ? 'asset requires' : 'assets require'} action
            </strong>
            <p>Return or transfer each item. Only an administrator can approve a missing or lost asset.</p>
          </div>
        </div>
      ) : (
        <div className="po-context-note po-success-note">
          <CheckCircle2 size={19} />
          <div>
            <strong>{completed ? 'Offboarding completed' : 'All assets accounted for'}</strong>
            <p>
              {completed
                ? `The checklist was completed on ${date(data.completedAt)}. The asset history remains available.`
                : 'No outstanding items remain. You can now complete this checklist.'}
            </p>
          </div>
        </div>
      )}
      <section className="panel table-panel">
        <div className="po-register-heading">
          <div>
            <h2>Asset accountability checklist</h2>
            <p>Review each item and record its handover or resolution.</p>
          </div>
          <span className="count-pill">{total}</span>
        </div>
        {!total ? (
          <EmptyState
            title="No equipment to recover"
            description="This employee had no assigned assets when the checklist started. You can complete offboarding."
          />
        ) : (
          <DataTable
            rows={data.items ?? []}
            columns={[
              {
                key: 'asset',
                label: 'Asset',
                render: (r) => (
                  <Link className="asset-cell" to={`/assets/${r.assetId}`}>
                    <span className={`po-checklist-icon ${isOutstanding(r, data) ? 'pending' : 'resolved'}`}>
                      {isOutstanding(r, data) ? <Package size={19} /> : <CheckCircle2 size={19} />}
                    </span>
                    <span>
                      <strong>{r.asset?.assetTag}</strong>
                      <small>
                        {r.asset?.manufacturer} {r.asset?.model}
                      </small>
                    </span>
                  </Link>
                ),
              },
              { key: 'serial', label: 'Serial number', render: (r) => r.asset?.serialNumber ?? '—' },
              { key: 'condition', label: 'Condition', render: (r) => human(r.asset?.condition) },
              { key: 'resolution', label: 'Resolution', render: (r) => <Badge value={r.resolution} /> },
              { key: 'resolvedAt', label: 'Resolved on', render: (r) => date(r.resolvedAt) },
              {
                key: 'actions',
                label: 'Actions',
                render: (r) =>
                  data.status === 'IN_PROGRESS' && isOutstanding(r, data) ? (
                    <div className="row-actions">
                      <button
                        className="btn secondary small-btn"
                        onClick={() =>
                          setOperation({
                            asset: {
                              ...r.asset,
                              currentAssignment: {
                                ...r.asset?.assignments?.find(
                                  (assignment: RecordData) =>
                                    assignment.employeeId === data.employeeId && !assignment.returnedAt,
                                ),
                                employeeId: data.employeeId,
                                employee: data.employee,
                              },
                            },
                            type: 'return',
                          })
                        }
                      >
                        <RotateCcw size={14} />
                        Return
                      </button>
                      {r.asset?.status === 'ASSIGNED' && (
                        <button
                          className="btn secondary small-btn"
                          title="Transfer to another employee"
                          onClick={() =>
                            setOperation({
                              asset: {
                                ...r.asset,
                                currentAssignment: {
                                  ...r.asset?.assignments?.find(
                                    (assignment: RecordData) =>
                                      assignment.employeeId === data.employeeId && !assignment.returnedAt,
                                  ),
                                  employeeId: data.employeeId,
                                  employee: data.employee,
                                },
                              },
                              type: 'transfer',
                            })
                          }
                        >
                          <ArrowRightLeft size={14} />
                          Transfer
                        </button>
                      )}
                      {user?.role === 'ADMIN' && ['ASSIGNED', 'DAMAGED'].includes(r.asset?.status) && (
                        <button className="btn text-danger small-btn" onClick={() => setLossAsset(r.asset)}>
                          Resolve loss
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="positive-text">
                      <CheckCircle2 size={16} />
                      Accounted for
                    </span>
                  ),
              },
            ]}
          />
        )}
      </section>
      {data.notes && (
        <section className="panel">
          <h2>Offboarding notes</h2>
          <p className="muted">{data.notes}</p>
        </section>
      )}
      {operation && (
        <AssetOperation
          asset={operation.asset}
          operation={operation.type}
          onClose={() => setOperation(null)}
          onSaved={resource.reload}
        />
      )}
      {lossAsset && (
        <Modal
          title="Resolve missing asset"
          description={`${lossAsset.assetTag} · ${lossAsset.model}`}
          onClose={() => setLossAsset(null)}
        >
          <div className="po-context-note po-attention-note">
            <AlertCircle size={19} />
            <div>
              <strong>Administrator loss resolution</strong>
              <p>
                This records the asset as lost, closes the employee's custody, and resolves this checklist
                item. The complete asset history is preserved.
              </p>
            </div>
          </div>
          <RecordForm
            fields={[
              { name: 'notes', label: 'Reason for loss resolution', type: 'textarea', required: true },
            ]}
            submitLabel="Mark lost and resolve"
            onCancel={() => setLossAsset(null)}
            onSubmit={async (values) => {
              await request('PATCH', `/assets/${lossAsset.id}/status`, { status: 'LOST', ...clean(values) });
              toast('Asset marked lost and checklist updated.');
              setLossAsset(null);
              resource.reload();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
