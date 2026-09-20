import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Eye,
  Filter,
  Headphones,
  History,
  Laptop,
  LayoutGrid,
  List,
  Mail,
  MapPin,
  Monitor,
  Package,
  Plus,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  UserRound,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useResource, useDebounce } from '../hooks/useResource';
import { useToast } from '../context/ToastContext';
import {
  Badge,
  ConfirmDialog,
  DataTable,
  Details,
  EmptyState,
  ErrorState,
  Loading,
  SlideOver as Modal,
  PageHeader,
  SearchInput,
  Timeline,
} from '../components/ui';
import { RecordForm } from '../components/RecordForm';
import { EmployeePreview } from '../components/RecordPreview';
import type { Field } from '../components/RecordForm';
import { AssetOperation, choices, options } from '../components/AssetForms';
import { EMPLOYEE_STATUSES } from '../types';
import type { Lookups, RecordData } from '../types';
import { clean, date, human, initials } from '../utils/format';
import { errorMessage, request } from '../services/api';
import './people-operations.css';

const employeeAssetCount = (employee: RecordData) =>
  Number(
    employee.assetCount ??
      employee.activeAssetCount ??
      employee.assignments?.filter((assignment: RecordData) => !assignment.returnedAt).length ??
      employee._count?.assignments ??
      0,
  );
function EquipmentIcon({ asset }: { asset: RecordData }) {
  const category = `${asset.assetType ?? ''} ${asset.category?.name ?? ''}`.toLowerCase();
  const Icon = category.includes('laptop')
    ? Laptop
    : category.includes('monitor') || category.includes('desktop')
      ? Monitor
      : category.includes('mobile') || category.includes('phone') || category.includes('tablet')
        ? Smartphone
        : category.includes('headset')
          ? Headphones
          : category.includes('modem') || category.includes('router')
            ? Wifi
            : Package;
  return <Icon size={23} aria-hidden="true" />;
}
export function EmployeeEditor({
  employee,
  onClose,
  onSaved,
}: {
  employee?: RecordData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const lookups = useResource<Lookups>('/lookups');
  const toast = useToast();
  const fields: Field[] = [
    { name: 'employeeId', label: 'Employee ID', required: true, placeholder: 'EMP1011' },
    { name: 'name', label: 'Full name', required: true, placeholder: 'John Smith' },
    { name: 'email', label: 'Work email', type: 'email', required: true },
    { name: 'designation', label: 'Designation' },
    {
      name: 'departmentId',
      label: 'Department',
      type: 'select',
      options: options(lookups.data?.departments),
    },
    { name: 'locationId', label: 'Location', type: 'select', options: options(lookups.data?.locations) },
    {
      name: 'managerId',
      label: 'Reporting manager',
      type: 'select',
      options: options(lookups.data?.employees).filter((e) => e.value !== employee?.id),
    },
    {
      name: 'status',
      label: 'Employment status',
      type: 'select',
      required: true,
      options: choices(employee ? Array.from(new Set([...EMPLOYEE_STATUSES, employee.status])) : ['ACTIVE']),
      defaultValue: 'ACTIVE',
      disabled: Boolean(employee && ['OFFBOARDING', 'OFFBOARDED'].includes(employee.status)),
    },
    { name: 'joinedAt', label: 'Joined date', type: 'date' },
  ];
  return (
    <Modal
      title={employee ? 'Edit employee' : 'Add an employee'}
      description="Maintain employee identity, reporting relationships, and asset accountability."
      wide
      onClose={onClose}
    >
      {lookups.loading ? (
        <Loading />
      ) : lookups.error ? (
        <ErrorState message={lookups.error} retry={lookups.reload} />
      ) : (
        <RecordForm
          fields={fields}
          initial={employee}
          submitLabel={employee ? 'Save employee' : 'Add employee'}
          onCancel={onClose}
          onSubmit={async (values) => {
            await request(
              employee ? 'PUT' : 'POST',
              employee ? `/employees/${employee.id}` : '/employees',
              clean(values, ['joinedAt'], [], Boolean(employee)),
            );
            toast(employee ? 'Employee updated.' : 'Employee added successfully.');
            onSaved();
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
export function EmployeesPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<RecordData | null | undefined>(undefined);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounce(search);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [departmentId, setDepartmentId] = useState(params.get('departmentId') ?? '');
  const [view, setView] = useState<'table' | 'cards'>(() =>
    window.matchMedia('(max-width: 640px)').matches ? 'cards' : 'table',
  );
  const lookups = useResource<Lookups>('/lookups');
  const resource = useResource<RecordData[]>('/employees', {
    search: debounced,
    page,
    pageSize: 12,
    status,
    departmentId,
  });
  useEffect(() => {
    if (params.get('new')) {
      setEditing(null);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);
  useEffect(() => setPage(1), [debounced, status, departmentId]);
  const rows = resource.data ?? [];
  const filtered = Boolean(search || status || departmentId);
  const clearFilters = () => {
    setSearch('');
    setStatus('');
    setDepartmentId('');
    setPage(1);
  };
  const canEdit = (employee: RecordData) => user?.role === 'ADMIN' || employee.user?.role !== 'ADMIN';
  return (
    <div className="po-console">
      <PageHeader
        eyebrow="PEOPLE"
        title="Employees"
        description="Manage employee records, assigned equipment, and departures from one directory."
        actions={
          <button className="btn primary" onClick={() => setEditing(null)}>
            <Plus size={17} />
            Add employee
          </button>
        }
      />
      <div className="po-directory-summary" aria-label="Directory summary">
        <div>
          <span className="po-summary-icon">
            <Users size={19} />
          </span>
          <span>
            <strong>{resource.loading ? '—' : (resource.meta?.total ?? rows.length)}</strong>
            <small>{filtered ? 'Matching employees' : 'Employees in directory'}</small>
          </span>
        </div>
        <div>
          <span className="po-summary-icon">
            <Package size={19} />
          </span>
          <span>
            <strong>
              {resource.loading ? '—' : rows.reduce((sum, row) => sum + employeeAssetCount(row), 0)}
            </strong>
            <small>Assigned assets · this page</small>
          </span>
        </div>
        <div>
          <span className="po-summary-icon">
            <ShieldCheck size={19} />
          </span>
          <span>
            <strong>{resource.loading ? '—' : rows.filter((row) => row.status === 'ACTIVE').length}</strong>
            <small>Active employees · this page</small>
          </span>
        </div>
      </div>
      <section className="panel table-panel po-directory">
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, employee ID or email…" />
          <select
            className="compact-select"
            aria-label="Filter employee department"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">All departments</option>
            {lookups.data?.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
          <select
            className="compact-select"
            aria-label="Filter employment status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All employment statuses</option>
            {EMPLOYEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {human(s)}
              </option>
            ))}
          </select>
          <div className="po-view-switch" role="group" aria-label="Employee directory view">
            <button
              className={view === 'table' ? 'active' : ''}
              aria-label="Employee table view"
              aria-pressed={view === 'table'}
              title="Table view"
              onClick={() => setView('table')}
            >
              <List size={17} />
            </button>
            <button
              className={view === 'cards' ? 'active' : ''}
              aria-label="Employee cards view"
              aria-pressed={view === 'cards'}
              title="Cards view"
              onClick={() => setView('cards')}
            >
              <LayoutGrid size={17} />
            </button>
          </div>
        </div>
        {filtered && (
          <div className="po-filter-bar">
            <Filter size={14} />
            <span>Filtered directory</span>
            {status && (
              <button onClick={() => setStatus('')}>
                {human(status)}
                <X size={12} />
              </button>
            )}
            {departmentId && (
              <button onClick={() => setDepartmentId('')}>
                {lookups.data?.departments.find((department) => department.id === departmentId)?.name ??
                  'Department'}
                <X size={12} />
              </button>
            )}
            <button className="po-clear-filter" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}
        {!resource.loading && !resource.error && !rows.length ? (
          <EmptyState
            title={filtered ? 'No employees match these filters' : 'Build your employee directory'}
            description={
              filtered
                ? 'Try a different name, employment status, or department.'
                : 'Add employees to assign equipment and maintain a complete custody record.'
            }
            action={
              <button className="btn secondary" onClick={filtered ? clearFilters : () => setEditing(null)}>
                {filtered ? 'Clear filters' : 'Add employee'}
              </button>
            }
          />
        ) : view === 'cards' ? (
          resource.loading ? (
            <Loading />
          ) : resource.error ? (
            <ErrorState message={resource.error} retry={resource.reload} />
          ) : (
            <>
              <div className="po-employee-grid">
                {rows.map((employee) => (
                  <article className="po-employee-card" aria-label={employee.name} key={employee.id}>
                    <div className="po-card-top">
                      <span className="avatar">{initials(employee.name)}</span>
                      <Badge value={employee.status} />
                    </div>
                    <Link to={`/employees/${employee.id}`} className="po-card-person">
                      <strong>{employee.name}</strong>
                      <span>
                        {employee.employeeId} · {employee.designation || 'Team member'}
                      </span>
                    </Link>
                    <div className="po-card-facts">
                      <span>
                        <Building2 size={14} />
                        {employee.department?.name ?? 'No department'}
                      </span>
                      <span>
                        <MapPin size={14} />
                        {employee.location?.name ?? 'Location not recorded'}
                      </span>
                      <span>
                        <UserRound size={14} />
                        {employee.manager?.name ?? 'Manager not recorded'}
                      </span>
                    </div>
                    <div className="po-card-footer">
                      <Link
                        to={`/employees/${employee.id}#employee-current-assets`}
                        className="po-count-link"
                      >
                        <Package size={15} />
                        <strong>{employeeAssetCount(employee)}</strong> assets
                      </Link>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          aria-label={`Quick view ${employee.name}`}
                          title={`Quick view ${employee.name}`}
                          onClick={() => setPreviewId(employee.id)}
                        >
                          <Eye size={16} />
                        </button>
                        {canEdit(employee) && (
                          <button
                            className="icon-button"
                            aria-label={`Edit ${employee.name}`}
                            title="Edit employee"
                            onClick={() => setEditing(employee)}
                          >
                            <Edit3 size={15} />
                          </button>
                        )}
                        <Link
                          className="icon-button"
                          to={`/employees/${employee.id}`}
                          aria-label={`View ${employee.name}`}
                          title="Open profile"
                        >
                          <ArrowRight size={16} />
                        </Link>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {resource.meta && (
                <div className="table-pagination">
                  <span>
                    {(page - 1) * resource.meta.pageSize + 1}–
                    {Math.min(page * resource.meta.pageSize, resource.meta.total)} of {resource.meta.total}{' '}
                    employees
                  </span>
                  <div>
                    <button
                      className="icon-button"
                      aria-label="Previous page"
                      title="Previous page"
                      disabled={page <= 1}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <span>
                      Page {page} of {Math.max(1, resource.meta.totalPages)}
                    </span>
                    <button
                      className="icon-button"
                      aria-label="Next page"
                      title="Next page"
                      disabled={page >= resource.meta.totalPages}
                      onClick={() => setPage(page + 1)}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )
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
                key: 'name',
                label: 'Employee',
                render: (r) => (
                  <Link to={`/employees/${r.id}`} className="person-cell">
                    <span className="avatar">{initials(r.name)}</span>
                    <span>
                      <strong>{r.name}</strong>
                      <small>
                        {r.employeeId} · {r.email}
                      </small>
                    </span>
                  </Link>
                ),
              },
              {
                key: 'department',
                label: 'Department / role',
                render: (r) => (
                  <span className="po-stacked-cell">
                    <span>{r.department?.name ?? '—'}</span>
                    <small>{r.designation ?? 'Role not recorded'}</small>
                  </span>
                ),
              },
              {
                key: 'location',
                label: 'Location',
                render: (r) => (
                  <span className="po-icon-text">
                    <MapPin size={13} />
                    {r.location?.name ?? '—'}
                  </span>
                ),
              },
              { key: 'manager', label: 'Manager', render: (r) => r.manager?.name ?? '—' },
              { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
              {
                key: 'assets',
                label: 'Assets',
                render: (r) => (
                  <span className="asset-count">
                    <Package size={13} />
                    {employeeAssetCount(r)}
                  </span>
                ),
              },
              { key: 'joinedAt', label: 'Joined', render: (r) => date(r.joinedAt) },
              {
                key: 'actions',
                label: '',
                render: (r) => (
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      aria-label={`Quick view ${r.name}`}
                      title={`Quick view ${r.name}`}
                      onClick={() => setPreviewId(r.id)}
                    >
                      <Eye size={16} />
                    </button>
                    {canEdit(r) && (
                      <button
                        className="icon-button"
                        aria-label={`Edit ${r.name}`}
                        title={`Edit ${r.name}`}
                        onClick={() => setEditing(r)}
                      >
                        <Edit3 size={15} />
                      </button>
                    )}
                    <Link
                      to={`/employees/${r.id}`}
                      className="icon-button"
                      aria-label={`View ${r.name}`}
                      title={`View ${r.name}`}
                    >
                      <ArrowRight size={16} />
                    </Link>
                  </div>
                ),
              },
            ]}
          />
        )}
      </section>
      {previewId && <EmployeePreview id={previewId} onClose={() => setPreviewId(null)} />}
      {editing !== undefined && (
        <EmployeeEditor
          employee={editing ?? undefined}
          onClose={() => setEditing(undefined)}
          onSaved={resource.reload}
        />
      )}
    </div>
  );
}
export function EmployeeDetailPage({ profile = false }: { profile?: boolean }) {
  const { id } = useParams();
  const { user } = useAuth();
  const employeeId = profile ? user?.employeeId : id;
  const resource = useResource<RecordData>(employeeId ? `/employees/${employeeId}` : null);
  const history = useResource<RecordData[]>(employeeId ? `/employees/${employeeId}/history` : null);
  const [editing, setEditing] = useState(false);
  const [offboarding, setOffboarding] = useState(false);
  const [archive, setArchive] = useState(false);
  const [returnAsset, setReturnAsset] = useState<RecordData | null>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const manager = user?.role !== 'EMPLOYEE';
  if (!employeeId)
    return (
      <>
        <PageHeader title="My profile" description="Your workspace account details." />
        <section className="panel narrow-panel">
          <div className="profile-summary">
            <span className="avatar large">{initials(user?.name ?? '')}</span>
            <div>
              <h2>{user?.name}</h2>
              <p>{user?.email}</p>
              <Badge value={user?.role} />
            </div>
          </div>
          <Link className="btn secondary" to="/change-password">
            Change password
          </Link>
        </section>
      </>
    );
  if (resource.loading) return <Loading />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.reload} />;
  const employee = resource.data!;
  const assignments = employee.assignments ?? [];
  const active = assignments.filter((a: any) => !a.returnedAt);
  const previous = assignments.filter((a: any) => a.returnedAt);
  const canManageEmployee = manager && (employee.user?.role !== 'ADMIN' || user?.role === 'ADMIN');
  const canOffboard = canManageEmployee && employee.status === 'ACTIVE' && employee.user?.id !== user?.id;
  const assetColumns = [
    {
      key: 'asset',
      label: 'Asset',
      render: (r: RecordData) => {
        const content = (
          <>
            <span className="table-asset-icon">
              <Package size={18} />
            </span>
            <span>
              <strong>{r.asset?.assetTag}</strong>
              <small>
                {r.asset?.manufacturer} {r.asset?.model}
              </small>
            </span>
          </>
        );
        return manager || active.some((assignment: RecordData) => assignment.assetId === r.assetId) ? (
          <Link className="asset-cell" to={`/assets/${r.assetId}`}>
            {content}
          </Link>
        ) : (
          <div className="asset-cell">{content}</div>
        );
      },
    },
    { key: 'assignedAt', label: 'Assigned', render: (r: RecordData) => date(r.assignedAt) },
    {
      key: 'conditionAtAssignment',
      label: 'Issue condition',
      render: (r: RecordData) => human(r.conditionAtAssignment),
    },
  ];
  return (
    <div className="po-console po-profile">
      <PageHeader
        back={profile ? undefined : '/employees'}
        eyebrow={profile ? 'MY PROFILE' : 'EMPLOYEE PROFILE'}
        title={employee.name}
        description={`${employee.employeeId} · ${employee.designation ?? employee.department?.name ?? 'Team member'}`}
        actions={
          manager ? (
            <>
              <button
                className="btn secondary"
                disabled={!canManageEmployee}
                onClick={() => setEditing(true)}
              >
                <Edit3 size={16} />
                Edit employee
              </button>
              <button
                className="btn primary"
                disabled={!canOffboard}
                title={
                  !canOffboard
                    ? 'Offboarding requires an active employee and an authorized colleague.'
                    : undefined
                }
                onClick={() => setOffboarding(true)}
              >
                <UserRound size={16} />
                Start offboarding
              </button>
            </>
          ) : (
            <Link className="btn secondary" to="/change-password">
              Change password
            </Link>
          )
        }
      />
      <section className="po-profile-hero" aria-label="Employee overview">
        <div className="po-profile-identity">
          <span className="avatar large">{initials(employee.name)}</span>
          <div>
            <div className="po-identity-heading">
              <h2>{employee.name}</h2>
              <Badge value={employee.status} />
            </div>
            <p>
              {employee.employeeId} <span>·</span> {employee.designation ?? 'Team member'}
            </p>
            <div className="po-contact-line">
              <span>
                <Building2 size={14} />
                {employee.department?.name ?? 'No department'}
              </span>
              <span>
                <MapPin size={14} />
                {employee.location?.name ?? 'Location not recorded'}
              </span>
              <a href={`mailto:${employee.email}`}>
                <Mail size={14} />
                {employee.email}
              </a>
            </div>
          </div>
        </div>
        <div className="po-profile-metrics">
          <a href="#employee-current-assets">
            <Package size={17} />
            <strong>{active.length}</strong>
            <span>Current assets</span>
          </a>
          <a href="#employee-previous-assets">
            <History size={17} />
            <strong>{previous.length}</strong>
            <span>Previous assignments</span>
          </a>
        </div>
      </section>
      <nav className="po-section-nav" aria-label="Employee profile sections">
        <a href="#employee-overview">
          <UserRound size={15} />
          Overview
        </a>
        <a href="#employee-current-assets">
          <Package size={15} />
          Current assets <span>{active.length}</span>
        </a>
        <a href="#employee-previous-assets">
          <History size={15} />
          Assignment history
        </a>
        <a href="#employee-timeline">
          <CalendarDays size={15} />
          Activity
        </a>
      </nav>
      <div className="detail-layout">
        <div className="detail-main">
          <section
            className="panel table-panel po-profile-section"
            id="employee-current-assets"
            tabIndex={-1}
          >
            <div className="panel-heading padded">
              <div>
                <h2>Currently assigned assets</h2>
                <p>Equipment currently in {profile ? 'your' : `${employee.name.split(' ')[0]}'s`} care</p>
              </div>
              <span className="count-pill">{active.length}</span>
            </div>
            {active.length ? (
              <div className="po-custody-grid">
                {active.map((assignment: RecordData) => (
                  <article
                    className="po-custody-card"
                    aria-label={`${assignment.asset?.assetTag} assignment`}
                    key={assignment.id}
                  >
                    <div className="po-custody-top">
                      <span className="po-equipment-icon">
                        <EquipmentIcon asset={assignment.asset ?? {}} />
                      </span>
                      <Badge value={assignment.asset?.status} />
                    </div>
                    <span className="po-category-label">
                      {assignment.asset?.category?.name ?? assignment.asset?.assetType ?? 'Equipment'}
                    </span>
                    <Link className="po-custody-title" to={`/assets/${assignment.assetId}`}>
                      {assignment.asset?.manufacturer} {assignment.asset?.model}
                    </Link>
                    <span className="po-asset-tag">{assignment.asset?.assetTag}</span>
                    <dl className="po-custody-facts">
                      <div>
                        <dt>Serial number</dt>
                        <dd>{assignment.asset?.serialNumber ?? 'Not recorded'}</dd>
                      </div>
                      <div>
                        <dt>Assigned</dt>
                        <dd>{date(assignment.assignedAt)}</dd>
                      </div>
                      <div>
                        <dt>Condition</dt>
                        <dd>{human(assignment.asset?.condition ?? assignment.conditionAtAssignment)}</dd>
                      </div>
                      {assignment.expectedReturnAt && (
                        <div>
                          <dt>Expected return</dt>
                          <dd>{date(assignment.expectedReturnAt)}</dd>
                        </div>
                      )}
                    </dl>
                    <div className="po-custody-actions">
                      <Link className="btn secondary small-btn" to={`/assets/${assignment.assetId}`}>
                        View asset
                        <ArrowRight size={14} />
                      </Link>
                      {manager && (
                        <button
                          className="btn secondary small-btn"
                          onClick={() =>
                            setReturnAsset({
                              ...assignment.asset,
                              currentAssignment: { ...assignment, employee },
                            })
                          }
                        >
                          <RotateCcw size={14} />
                          Return
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No assets currently assigned"
                description={
                  profile
                    ? 'Equipment issued to you will appear here with its condition and assignment details.'
                    : 'This employee has no equipment in their current custody.'
                }
                action={
                  manager ? (
                    <Link className="btn secondary" to="/assignments">
                      Assign an asset
                      <ArrowRight size={14} />
                    </Link>
                  ) : undefined
                }
              />
            )}
          </section>
          <section
            className="panel table-panel po-profile-section"
            id="employee-previous-assets"
            tabIndex={-1}
          >
            <div className="panel-heading padded">
              <div>
                <h2>Previous assets</h2>
                <p>Assignment history stays with the employee</p>
              </div>
            </div>
            <DataTable
              rows={previous}
              columns={[
                ...assetColumns,
                { key: 'returnedAt', label: 'Released on', render: (r) => date(r.returnedAt) },
                {
                  key: 'conditionAtReturn',
                  label: 'Return condition',
                  render: (r) => human(r.conditionAtReturn) || '—',
                },
              ]}
              emptyTitle="No previous assignments"
            />
          </section>
          <section className="panel po-profile-section" id="employee-timeline" tabIndex={-1}>
            <div className="panel-heading">
              <div>
                <h2>Asset timeline</h2>
                <p>Every issue, handover, and return</p>
              </div>
            </div>
            {history.loading ? (
              <Loading />
            ) : history.error ? (
              <ErrorState message={history.error} retry={history.reload} />
            ) : (
              <Timeline items={history.data ?? employee.history} linkAssets={manager} />
            )}
          </section>
        </div>
        <aside className="detail-side">
          <section className="panel po-profile-section" id="employee-overview" tabIndex={-1}>
            <div className="po-section-heading">
              <UserRound size={17} />
              <h2>Employee information</h2>
            </div>
            <Details
              items={[
                ['Employee ID', employee.employeeId],
                ['Email', <a href={`mailto:${employee.email}`}>{employee.email}</a>],
                ['Department', employee.department?.name],
                ['Designation', employee.designation],
                ['Location', employee.location?.name],
                ['Reporting manager', employee.manager?.name],
                ['Joined date', date(employee.joinedAt)],
              ]}
            />
            {user?.role === 'ADMIN' && (
              <button
                className="btn text-danger full-width"
                disabled={active.length > 0 || employee.user?.id === user?.id}
                title={
                  active.length > 0
                    ? 'Resolve assigned assets before archiving'
                    : employee.user?.id === user?.id
                      ? 'Your own employee record cannot be archived'
                      : undefined
                }
                onClick={() => setArchive(true)}
              >
                Archive employee
              </button>
            )}
          </section>
          <div className="po-context-note">
            <ShieldCheck size={20} />
            <div>
              <h3>Complete custody record</h3>
              <p>
                Transfers and returns remain in the assignment history after equipment leaves this employee's
                care.
              </p>
            </div>
          </div>
        </aside>
      </div>
      {editing && (
        <EmployeeEditor employee={employee} onClose={() => setEditing(false)} onSaved={resource.reload} />
      )}{' '}
      {offboarding && (
        <Modal
          title="Start employee offboarding"
          description={`${employee.name} · ${active.length} assets currently assigned`}
          onClose={() => setOffboarding(false)}
        >
          <div className="po-dialog-summary">
            <ClipboardSummary count={active.length} />
            <p>
              The checklist will include every currently assigned asset. Completion requires each item to be
              returned, transferred, or explicitly resolved.
            </p>
          </div>
          <RecordForm
            fields={[
              {
                name: 'notes',
                label: 'Offboarding notes',
                type: 'textarea',
                placeholder: 'Last working date, handover arrangements…',
              },
            ]}
            onCancel={() => setOffboarding(false)}
            submitLabel="Create offboarding checklist"
            onSubmit={async (values) => {
              const result = await request('POST', '/offboarding', {
                employeeId: employee.id,
                ...clean(values),
              });
              toast('Offboarding checklist created.');
              navigate(`/offboarding/${result.data.id}`);
            }}
          />
        </Modal>
      )}
      {returnAsset && (
        <AssetOperation
          asset={returnAsset}
          operation="return"
          onClose={() => setReturnAsset(null)}
          onSaved={() => {
            resource.reload();
            history.reload();
          }}
        />
      )}
      {archive && (
        <ConfirmDialog
          title="Archive employee?"
          description="Active assignments must be accounted for before this employee can be archived. Historical assignments will remain available."
          confirmLabel="Archive employee"
          onClose={() => setArchive(false)}
          onConfirm={async () => {
            try {
              await request('DELETE', `/employees/${employee.id}`);
              toast('Employee archived.');
              navigate('/employees');
            } catch (e) {
              toast(errorMessage(e), 'error');
            }
          }}
        />
      )}
    </div>
  );
}

function ClipboardSummary({ count }: { count: number }) {
  return (
    <span className="po-icon-text">
      <Package size={18} />
      <strong>
        {count} {count === 1 ? 'asset' : 'assets'} to account for
      </strong>
    </span>
  );
}
