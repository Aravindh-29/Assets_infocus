import { useState } from 'react';
import { useResource } from '../hooks/useResource';
import { SlideOver, Loading, ErrorState } from './ui';
import { AssetCustodyFlow } from './AssetCustodyFlow';
import './assets-console.css';
import { RecordForm } from './RecordForm';
import type { Field } from './RecordForm';
import type { Lookups, RecordData, Lookup } from '../types';
import { CONDITIONS } from '../types';
import { useAuth } from '../context/AuthContext';
import { statusTargets } from './assetCapabilities';
import { human, clean, holder } from '../utils/format';
import { request } from '../services/api';
import { useToast } from '../context/ToastContext';
export const options = (items?: Lookup[]) =>
  items
    ?.filter((x) => x.active !== false)
    .map((x) => ({ value: x.id, label: `${x.name}${x.employeeId ? ` · ${x.employeeId}` : ''}` })) ?? [];
export const choices = (items: string[]) => items.map((value) => ({ value, label: human(value) }));
export function AssetEditor({
  asset,
  onClose,
  onSaved,
}: {
  asset?: RecordData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const lookups = useResource<Lookups>('/lookups');
  const toast = useToast();
  const fields: Field[] = [
    {
      name: 'assetTag',
      label: 'Asset tag',
      required: true,
      placeholder: 'LAP-0021',
      section: 'Basic information',
    },
    { name: 'assetType', label: 'Asset type', required: true, placeholder: 'Laptop' },
    {
      name: 'categoryId',
      label: 'Category',
      type: 'select',
      required: true,
      options: options(lookups.data?.categories),
    },
    { name: 'manufacturer', label: 'Manufacturer', required: true, placeholder: 'Dell' },
    { name: 'model', label: 'Model', required: true, placeholder: 'Latitude 5440' },
    { name: 'serialNumber', label: 'Serial number' },
    { name: 'purchaseDate', label: 'Purchase date', type: 'date', section: 'Purchase & warranty' },
    { name: 'purchaseCost', label: 'Purchase cost', type: 'number', min: 0 },
    { name: 'vendor', label: 'Vendor' },
    { name: 'invoiceNumber', label: 'Invoice number' },
    { name: 'warrantyStart', label: 'Warranty start', type: 'date' },
    { name: 'warrantyExpiry', label: 'Warranty expiry', type: 'date' },
    {
      name: 'condition',
      label: 'Condition',
      type: 'select',
      required: true,
      options: choices(CONDITIONS),
      defaultValue: 'GOOD',
      section: 'Physical information',
    },
    { name: 'locationId', label: 'Location', type: 'select', options: options(lookups.data?.locations) },
    {
      name: 'departmentId',
      label: 'Department',
      type: 'select',
      options: options(lookups.data?.departments),
    },
    { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
  return (
    <SlideOver
      title={asset ? 'Edit asset' : 'Register a new asset'}
      description="Give every asset a clear identity from day one."
      onClose={onClose}
      wide
    >
      {lookups.loading ? (
        <Loading />
      ) : lookups.error ? (
        <ErrorState message={lookups.error} retry={lookups.reload} />
      ) : (
        <RecordForm
          fields={fields}
          initial={asset}
          onCancel={onClose}
          submitLabel={asset ? 'Save asset' : 'Register asset'}
          onSubmit={async (values) => {
            await request(
              asset ? 'PUT' : 'POST',
              asset ? `/assets/${asset.id}` : '/assets',
              clean(
                values,
                ['purchaseDate', 'warrantyStart', 'warrantyExpiry'],
                ['purchaseCost'],
                Boolean(asset),
              ),
            );
            toast(asset ? 'Asset updated.' : 'Asset registered successfully.');
            onSaved();
            onClose();
          }}
        />
      )}
    </SlideOver>
  );
}
export type Operation = 'assign' | 'transfer' | 'return' | 'move' | 'status' | 'repair' | 'request';
const titles: Record<Operation, string> = {
  assign: 'Assign asset',
  transfer: 'Transfer asset',
  return: 'Return asset',
  move: 'Move asset',
  status: 'Change asset status',
  repair: 'Send for repair',
  request: 'Submit a request',
};
export function AssetOperation({
  asset,
  operation,
  onClose,
  onSaved,
  requestType,
  initialStatus,
}: {
  asset: RecordData;
  operation: Operation;
  onClose: () => void;
  onSaved: () => void;
  requestType?: string;
  initialStatus?: string;
}) {
  const { user } = useAuth();
  const lookups = useResource<Lookups>('/lookups');
  const toast = useToast();
  const assignment = holder(asset);
  const employeeOptions = options(
    lookups.data?.employees.filter((e) => e.status === 'ACTIVE' || !e.status),
  ).filter((e) => operation !== 'transfer' || e.value !== assignment?.employeeId);
  let fields: Field[] = [];
  if (operation === 'assign')
    fields = [
      {
        name: 'employeeId',
        label: 'Employee',
        type: 'select',
        required: true,
        options: employeeOptions,
        full: true,
      },
      {
        name: 'assignedAt',
        label: 'Assignment date',
        type: 'datetime-local',
        help: 'Leave blank to use the current time.',
      },
      { name: 'expectedReturnAt', label: 'Expected return date', type: 'date' },
      {
        name: 'condition',
        label: 'Condition at assignment',
        type: 'select',
        options: choices(CONDITIONS),
        defaultValue: asset.condition,
        required: true,
      },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ];
  if (operation === 'transfer')
    fields = [
      {
        name: 'employeeId',
        label: 'Transfer to employee',
        type: 'select',
        required: true,
        options: employeeOptions,
        full: true,
      },
      {
        name: 'transferredAt',
        label: 'Transfer date',
        type: 'datetime-local',
        help: 'Leave blank to use the current time.',
        full: true,
      },
      { name: 'reason', label: 'Reason for transfer', required: true, full: true },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ];
  if (operation === 'return')
    fields = [
      {
        name: 'returnedAt',
        label: 'Return date',
        type: 'datetime-local',
        help: 'Leave blank to use the current time.',
      },
      {
        name: 'condition',
        label: 'Condition on return',
        type: 'select',
        required: true,
        options: choices(CONDITIONS),
        defaultValue: 'GOOD',
      },
      {
        name: 'accessories',
        label: 'Accessories returned',
        placeholder: 'Charger, mouse, laptop bag',
        help: 'Separate accessories with commas.',
        full: true,
      },
      { name: 'damage', label: 'Damage description', type: 'textarea' },
      { name: 'notes', label: 'Return notes', type: 'textarea' },
    ];
  if (operation === 'move')
    fields = [
      {
        name: 'locationId',
        label: 'New location',
        type: 'select',
        required: true,
        options: options(lookups.data?.locations).filter((l) => l.value !== asset.locationId),
        full: true,
      },
      { name: 'notes', label: 'Movement notes', type: 'textarea' },
    ];
  if (operation === 'status') {
    const targets = statusTargets(asset, user?.role);
    fields = [
      {
        name: 'status',
        label: 'New status',
        type: 'select',
        required: true,
        options: choices(targets),
        defaultValue: initialStatus && targets.includes(initialStatus) ? initialStatus : '',
        full: true,
      },
      { name: 'notes', label: 'Reason for change', type: 'textarea', required: true },
    ];
  }
  if (operation === 'repair')
    fields = [
      { name: 'issue', label: 'Issue description', required: true, type: 'textarea' },
      { name: 'vendor', label: 'Repair vendor' },
      { name: 'cost', label: 'Estimated repair cost', type: 'number', min: 0 },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ];
  if (operation === 'request')
    fields = [
      {
        name: 'type',
        label: 'Request type',
        type: 'select',
        required: true,
        options: choices(['DAMAGE', 'LOST', 'RETURN', 'TRANSFER']),
        defaultValue:
          requestType && ['DAMAGE', 'LOST', 'RETURN', 'TRANSFER'].includes(requestType) ? requestType : '',
        full: true,
      },
      { name: 'description', label: 'Description', type: 'textarea', required: true },
      { name: 'location', label: 'Incident location', full: true },
      {
        name: 'targetEmployeeId',
        label: 'Requested transfer recipient (optional)',
        type: 'select',
        options: employeeOptions,
        full: true,
      },
    ];
  const commit = async (values: RecordData) => {
    const body = clean(values, ['assignedAt', 'expectedReturnAt', 'transferredAt', 'returnedAt'], ['cost']);
    if (operation === 'return')
      body.accessories = String(values.accessories ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    if (operation === 'repair' || operation === 'request') body.assetId = asset.id;
    await request(
      operation === 'status' ? 'PATCH' : 'POST',
      operation === 'repair'
        ? '/repairs'
        : operation === 'request'
          ? '/requests'
          : `/assets/${asset.id}/${operation}`,
      body,
    );
    toast(`${titles[operation]} completed.`);
    onSaved();
    onClose();
  };
  if (operation === 'assign' || operation === 'transfer' || operation === 'return')
    return (
      <AssetCustodyFlow
        asset={asset}
        operation={operation}
        fields={fields}
        lookups={lookups.data}
        loading={lookups.loading}
        error={lookups.error}
        reload={lookups.reload}
        onClose={onClose}
        onCommit={commit}
      />
    );
  return (
    <SlideOver
      title={titles[operation]}
      description={`${asset.assetTag} · ${asset.manufacturer} ${asset.model}`}
      onClose={onClose}
    >
      {assignment && (
        <div className="context-strip">
          <span>Current holder</span>
          <strong>{assignment.employee?.name ?? 'Assigned employee'}</strong>
        </div>
      )}
      {lookups.loading ? (
        <Loading />
      ) : lookups.error ? (
        <ErrorState message={lookups.error} retry={lookups.reload} />
      ) : (
        <RecordForm fields={fields} onCancel={onClose} submitLabel={titles[operation]} onSubmit={commit} />
      )}
      {operation === 'repair' && (
        <p className="dialog-footnote">
          Receiving an asset for repair closes its current assignment. Its full assignment history is
          preserved.
        </p>
      )}
    </SlideOver>
  );
}
export function AssetOperationPicker({
  operation,
  onClose,
  onSaved,
  requestType,
}: {
  operation: Operation;
  onClose: () => void;
  onSaved: () => void;
  requestType?: string;
}) {
  const [chosen, setChosen] = useState<RecordData | null>(null);
  const [search, setSearch] = useState('');
  const resource = useResource<RecordData[]>('/assets', {
    pageSize: 100,
    search,
    ...(operation === 'assign'
      ? { status: 'AVAILABLE' }
      : operation === 'transfer' || operation === 'return'
        ? { assigned: 'true' }
        : {}),
  });
  if (chosen)
    return (
      <AssetOperation
        asset={chosen}
        operation={operation}
        onClose={onClose}
        onSaved={onSaved}
        requestType={requestType}
      />
    );
  return (
    <SlideOver title={titles[operation]} description="Choose an asset to continue." onClose={onClose}>
      <div className="field">
        <label htmlFor="choose-asset-search">Find an asset</label>
        <input
          id="choose-asset-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Asset tag, model or serial number"
        />
      </div>
      {resource.loading ? (
        <Loading />
      ) : resource.error ? (
        <ErrorState message={resource.error} retry={resource.reload} />
      ) : (
        <div className="picker-list">
          {resource.data?.map((asset) => (
            <button key={asset.id} onClick={() => setChosen(asset)}>
              <div>
                <strong>{asset.assetTag}</strong>
                <span>
                  {asset.manufacturer} {asset.model}
                </span>
              </div>
              <span>{human(asset.status)} →</span>
            </button>
          ))}
          {!resource.data?.length && <p>No eligible assets found.</p>}
        </div>
      )}
    </SlideOver>
  );
}
