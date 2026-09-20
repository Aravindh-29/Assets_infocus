import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Edit3, KeyRound, MapPin, Plus, ShieldCheck, Tag } from 'lucide-react';
import { useResource, useDebounce } from '../hooks/useResource';
import { useToast } from '../context/ToastContext';
import {
  Badge,
  DataTable,
  Details,
  ErrorState,
  Loading,
  Modal,
  SlideOver,
  PageHeader,
  SearchInput,
} from '../components/ui';
import { RecordForm } from '../components/RecordForm';
import type { Field } from '../components/RecordForm';
import { choices, options } from '../components/AssetForms';
import type { Lookups, RecordData } from '../types';
import { clean, date, human } from '../utils/format';
import { request, errorMessage } from '../services/api';
export function MasterDataPage({ kind }: { kind: 'categories' | 'departments' | 'locations' }) {
  const [search, setSearch] = useState('');
  const query = useDebounce(search);
  const [page, setPage] = useState(1);
  const resource = useResource<RecordData[]>(`/${kind}`, { search: query, page, pageSize: 12 });
  const [editing, setEditing] = useState<RecordData | null | undefined>(undefined);
  const toast = useToast();
  const single = kind === 'categories' ? 'category' : kind === 'departments' ? 'department' : 'location';
  const ReferenceIcon = kind === 'categories' ? Tag : kind === 'departments' ? Building2 : MapPin;
  const fields: Field[] = [
    { name: 'name', label: `${human(single)} name`, required: true, full: true },
    ...(kind === 'categories'
      ? [
          { name: 'description', label: 'Description', type: 'textarea' } as Field,
          {
            name: 'serialRequiredUnique',
            label: 'Require unique serial numbers within this category',
            type: 'checkbox',
            defaultValue: true,
            full: true,
          } as Field,
        ]
      : kind === 'locations'
        ? [{ name: 'address', label: 'Address', type: 'textarea' } as Field]
        : []),
    {
      name: 'active',
      label: 'Active and available for selection',
      type: 'checkbox',
      defaultValue: true,
      full: true,
    },
  ];
  return (
    <>
      <PageHeader
        eyebrow="ORGANIZATION"
        title={human(kind)}
        description={
          kind === 'categories'
            ? 'Organize your inventory into useful groups.'
            : kind === 'departments'
              ? 'Connect your assets and people to the teams they support.'
              : 'Keep a clear map of where your equipment belongs.'
        }
        actions={
          <button className="btn primary" onClick={() => setEditing(null)}>
            <Plus size={17} />
            Add {single}
          </button>
        }
      />
      <section className="panel table-panel">
        <div className="table-toolbar">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder={`Search ${kind}…`}
          />
          {resource.meta && (
            <span className="subtle-tag">
              <ReferenceIcon size={13} />
              {resource.meta.total} {kind}
            </span>
          )}
        </div>
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
              label: human(single),
              render: (r) => (
                <span className="reference-name">
                  <span>
                    <ReferenceIcon size={17} />
                  </span>
                  <strong>{r.name}</strong>
                </span>
              ),
            },
            ...(kind === 'categories'
              ? [
                  { key: 'description', label: 'Description' },
                  {
                    key: 'serialRequiredUnique',
                    label: 'Serial number policy',
                    render: (r: RecordData) =>
                      r.serialRequiredUnique ? 'Unique per category' : 'Duplicates allowed',
                  },
                ]
              : kind === 'locations'
                ? [{ key: 'address', label: 'Address' }]
                : []),
            { key: 'assets', label: 'Assets', render: (r) => r._count?.assets ?? r.assetCount ?? '—' },
            {
              key: 'active',
              label: 'Status',
              render: (r) => <Badge value={r.active ? 'ACTIVE' : 'INACTIVE'} />,
            },
            { key: 'createdAt', label: 'Created', render: (r) => date(r.createdAt) },
            {
              key: 'actions',
              label: '',
              render: (r) => (
                <button className="btn secondary small-btn" onClick={() => setEditing(r)}>
                  <Edit3 size={14} />
                  Edit
                </button>
              ),
            },
          ]}
        />
      </section>
      {editing !== undefined && (
        <Modal title={`${editing ? 'Edit' : 'Add'} ${single}`} onClose={() => setEditing(undefined)}>
          <RecordForm
            fields={fields}
            initial={editing ?? undefined}
            onCancel={() => setEditing(undefined)}
            submitLabel={`Save ${single}`}
            onSubmit={async (values) => {
              await request(
                editing ? 'PUT' : 'POST',
                editing ? `/${kind}/${editing.id}` : `/${kind}`,
                clean(values),
              );
              toast(`${human(single)} saved.`);
              setEditing(undefined);
              resource.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}
export function UsersPage() {
  const [editing, setEditing] = useState<RecordData | null | undefined>(undefined);
  const [reset, setReset] = useState<RecordData | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const query = useDebounce(search);
  const resource = useResource<RecordData[]>('/users', { page, pageSize: 12, search: query });
  const lookups = useResource<Lookups>('/lookups');
  const toast = useToast();
  const fields: Field[] = [
    { name: 'name', label: 'Full name', required: true },
    { name: 'email', label: 'Work email', type: 'email', required: true, disabled: Boolean(editing) },
    {
      name: 'role',
      label: 'Role',
      type: 'select',
      required: true,
      options: choices(['ADMIN', 'ASSET_MANAGER', 'EMPLOYEE']),
      defaultValue: 'EMPLOYEE',
    },
    {
      name: 'employeeId',
      label: 'Linked employee',
      type: 'select',
      options: options(lookups.data?.employees),
      help: 'Employee users must be linked to an employee record.',
    },
    ...(!editing
      ? [
          {
            name: 'password',
            label: 'Temporary password',
            type: 'password',
            required: true,
            minLength: 10,
            full: true,
            help: 'At least 10 characters with upper/lowercase letters, a number and a symbol.',
          } as Field,
        ]
      : []),
    { name: 'active', label: 'Account is active', type: 'checkbox', defaultValue: true, full: true },
  ];
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="User management"
        description="The right access, for the right people."
        actions={
          <button className="btn primary" onClick={() => setEditing(null)}>
            <Plus size={17} />
            Create user
          </button>
        }
      />
      <section className="panel table-panel">
        <div className="table-toolbar">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search user name or email…"
          />
          <span className="subtle-tag">
            <ShieldCheck size={13} />
            Administrator access
          </span>
        </div>
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
              label: 'User',
              render: (r) => (
                <span>
                  <strong>{r.name}</strong>
                  <small className="cell-subtitle">{r.email}</small>
                </span>
              ),
            },
            { key: 'role', label: 'Role', render: (r) => <Badge value={r.role} /> },
            { key: 'employee', label: 'Employee', render: (r) => r.employee?.name ?? '—' },
            {
              key: 'active',
              label: 'Account',
              render: (r) => <Badge value={r.active ? 'ACTIVE' : 'INACTIVE'} />,
            },
            { key: 'createdAt', label: 'Created on', render: (r) => date(r.createdAt) },
            {
              key: 'actions',
              label: '',
              render: (r) => (
                <div className="row-actions">
                  <button className="btn secondary small-btn" onClick={() => setEditing(r)}>
                    <Edit3 size={14} />
                    Edit
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Reset password for ${r.name}`}
                    onClick={() => setReset(r)}
                  >
                    <KeyRound size={17} />
                  </button>
                </div>
              ),
            },
          ]}
        />
      </section>
      {editing !== undefined && (
        <Modal title={editing ? 'Edit user' : 'Create user'} onClose={() => setEditing(undefined)}>
          <RecordForm
            fields={fields}
            initial={editing ?? undefined}
            onCancel={() => setEditing(undefined)}
            submitLabel={editing ? 'Save user' : 'Create user'}
            onSubmit={async (values) => {
              const body = clean(values);
              if (editing) delete body.email;
              await request(editing ? 'PUT' : 'POST', editing ? `/users/${editing.id}` : '/users', body);
              toast('User saved.');
              setEditing(undefined);
              resource.reload();
            }}
          />
        </Modal>
      )}
      {reset && (
        <Modal title="Reset user password" description={reset.email} onClose={() => setReset(null)}>
          <RecordForm
            fields={[
              {
                name: 'password',
                label: 'Temporary password',
                type: 'password',
                required: true,
                minLength: 10,
                full: true,
                help: 'The user will be asked to change this password at sign in.',
              },
            ]}
            submitLabel="Reset password"
            onCancel={() => setReset(null)}
            onSubmit={async (values) => {
              await request('POST', `/users/${reset.id}/reset-password`, values);
              toast('Password reset successfully.');
              setReset(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}
export function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const query = useDebounce(search);
  const [detail, setDetail] = useState<RecordData | null>(null);
  const resource = useResource<RecordData[]>('/audit-logs', { page, pageSize: 15, search: query });
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Audit log"
        description="An immutable record of important activity across your workspace."
      />
      <section className="panel table-panel">
        <div className="table-toolbar">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search action, user or entity…"
          />
          <span className="subtle-tag">
            <ShieldCheck size={13} />
            Read-only history
          </span>
        </div>
        <DataTable
          rows={resource.data}
          loading={resource.loading}
          error={resource.error}
          retry={resource.reload}
          meta={resource.meta}
          page={page}
          onPage={setPage}
          columns={[
            { key: 'timestamp', label: 'Timestamp', render: (r) => date(r.timestamp, true) },
            { key: 'userName', label: 'Performed by', render: (r) => r.userName ?? 'System' },
            {
              key: 'action',
              label: 'Action',
              render: (r) => <span className="audit-action">{human(r.action)}</span>,
            },
            { key: 'entityType', label: 'Entity', render: (r) => human(r.entityType) },
            { key: 'ip', label: 'IP address', render: (r) => <span className="mono">{r.ip ?? '—'}</span> },
            {
              key: 'details',
              label: '',
              render: (r) => (
                <button className="btn secondary small-btn" onClick={() => setDetail(r)}>
                  View details
                </button>
              ),
            },
          ]}
        />
      </section>
      {detail && (
        <SlideOver
          title={human(detail.action)}
          description={`${date(detail.timestamp, true)} · ${detail.userName ?? 'System'}`}
          onClose={() => setDetail(null)}
        >
          <Details
            items={[
              ['Entity', detail.entityType],
              ['Entity ID', detail.entityId],
              ['User ID', detail.userId],
              ['IP address', detail.ip],
            ]}
          />
          <pre className="audit-json">{JSON.stringify(detail.details ?? {}, null, 2)}</pre>
        </SlideOver>
      )}
    </>
  );
}
export function SettingsPage() {
  const resource = useResource<RecordData>('/settings');
  const toast = useToast();
  if (resource.loading) return <Loading />;
  if (resource.error) return <ErrorState message={resource.error} retry={resource.reload} />;
  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRATION"
        title="Workspace settings"
        description="The essentials for your asset management workspace."
      />
      <section className="panel narrow-panel">
        <div className="panel-heading">
          <div>
            <h2>Organization preferences</h2>
            <p>Changes apply across your workspace.</p>
          </div>
        </div>
        <RecordForm
          initial={resource.data}
          fields={[
            {
              name: 'organizationName',
              label: 'Organization name',
              required: true,
              full: true,
              defaultValue: 'Company workspace',
            },
            {
              name: 'warrantyAlertDays',
              label: 'Warranty alert window (days)',
              type: 'number',
              required: true,
              min: 1,
              max: 365,
              defaultValue: 30,
              full: true,
              help: 'Show alerts for warranties expiring within this many days.',
            },
          ]}
          submitLabel="Save settings"
          onSubmit={async (values) => {
            await request('PUT', '/settings', clean(values, [], ['warrantyAlertDays']));
            toast('Workspace settings saved.');
            resource.reload();
          }}
        />
      </section>
    </>
  );
}
