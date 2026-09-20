import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  History,
  AlertTriangle,
  LayoutGrid,
  List,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import { useResource, useDebounce } from '../hooks/useResource';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Lookups, RecordData } from '../types';
import { Badge, DataTable, EmptyState, ErrorState, Loading, PageHeader, SearchInput } from '../components/ui';
import type { Column } from '../components/ui';
import { AssetEditor, AssetOperation, AssetOperationPicker } from '../components/AssetForms';
import type { Operation } from '../components/AssetForms';
import { AssetPreview } from '../components/RecordPreview';
import {
  AssetActionMenu,
  AssetCsvImport,
  AssetFilters,
  AssetTypeIcon,
  BulkAssetAction,
  assetFilterKeys,
  filterLabel,
  statusTargets,
} from '../components/AssetConsoleTools';
import { date, holder, human, initials, warranty } from '../utils/format';
import { downloadReport, errorMessage, request } from '../services/api';
import '../components/assets-console.css';
import { commonAssetActions } from '../components/assetCapabilities';
export { AssetDetailPage } from '../components/AssetRecordPage';
const defaultColumns = [
  'assetTag',
  'category',
  'serialNumber',
  'status',
  'holder',
  'location',
  'warrantyExpiry',
  'actions',
];
function readPreference(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
export function AssetsPage() {
  const { user } = useAuth();
  const manager = user?.role !== 'EMPLOYEE';
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(
    assetFilterKeys.filter((k) => params.get(k)).map((k) => [k, params.get(k)!]),
  );
  const filterKey = JSON.stringify(filters);
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounce(search);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [view, setView] = useState(() =>
    window.matchMedia('(max-width: 760px)').matches ? 'cards' : readPreference('asset-console-view', 'table'),
  );
  const [showFilters, setShowFilters] = useState(false);
  const [visible, setVisible] = useState(defaultColumns);
  const [sort, setSort] = useState({ sortBy: 'createdAt', sortOrder: 'desc' });
  const [selected, setSelected] = useState<string[]>([]);
  const records = useRef(new Map<string, RecordData>());
  const [editing, setEditing] = useState<RecordData | null | undefined>(undefined);
  const [operation, setOperation] = useState<{
    asset?: RecordData;
    type: Operation;
    requestType?: string;
    initialStatus?: string;
  } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [bulk, setBulk] = useState<{ kind: 'assign' | 'status' | 'move'; assets: RecordData[] } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const resource = useResource<RecordData[]>('/assets', {
    page,
    pageSize,
    search: debounced,
    ...filters,
    ...sort,
  });
  const lookups = useResource<Lookups>('/lookups');
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => setView(query.matches ? 'cards' : readPreference('asset-console-view', 'table'));
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    setPage(1);
    setSelected([]);
    records.current.clear();
  }, [debounced, filterKey]);
  useEffect(() => {
    for (const row of resource.data ?? []) records.current.set(row.id, row);
  }, [resource.data]);
  useEffect(() => {
    const newAsset = params.get('new'),
      op = params.get('operation');
    if (manager && (newAsset || op)) {
      if (newAsset) setEditing(null);
      if (op && ['assign', 'transfer', 'return'].includes(op)) setOperation({ type: op as Operation });
      const next = new URLSearchParams(params);
      next.delete('new');
      next.delete('operation');
      setParams(next, { replace: true });
    }
  }, [params, manager, setParams]);
  function applyFilters(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    assetFilterKeys.forEach((k) => next.delete(k));
    Object.entries(values)
      .filter(([, v]) => v)
      .forEach(([k, v]) => next.set(k, v));
    setParams(next, { replace: true });
  }
  function changeView(value: string) {
    setView(value);
    try {
      localStorage.setItem('asset-console-view', value);
    } catch {}
  }
  async function restore(asset: RecordData) {
    try {
      await request('POST', `/assets/${asset.id}/restore`);
      resource.reload();
      toast('Asset restored.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
  async function exportData(format: string) {
    setExporting(true);
    try {
      await downloadReport(
        'inventory',
        format,
        selected.length
          ? { ids: selected.join(','), ...(filters.deleted ? { deleted: filters.deleted } : {}) }
          : { ...filters, search: debounced },
      );
      toast('Your export is ready.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setExporting(false);
    }
  }
  const actions = (asset: RecordData) => [
    { label: 'View asset', icon: Eye, onSelect: () => navigate(`/assets/${asset.id}`) },
    { label: 'View history', icon: History, onSelect: () => navigate(`/assets/${asset.id}?tab=history`) },
    ...(manager
      ? [
          {
            label: 'Export asset',
            icon: Download,
            onSelect: async () => {
              try {
                await downloadReport('inventory', 'csv', {
                  ids: asset.id,
                  ...(asset.deletedAt ? { deleted: 'true' } : {}),
                });
              } catch (error) {
                toast(errorMessage(error), 'error');
              }
            },
          },
        ]
      : []),
    ...(manager && !asset.deletedAt
      ? [
          { label: 'Edit asset', icon: Edit3, onSelect: () => setEditing(asset) },
          ...(asset.status === 'AVAILABLE'
            ? [
                {
                  label: 'Assign asset',
                  icon: UserRound,
                  onSelect: () => setOperation({ asset, type: 'assign' }),
                },
              ]
            : []),
          ...(holder(asset)
            ? [
                ...(asset.status === 'ASSIGNED'
                  ? [
                      {
                        label: 'Transfer asset',
                        icon: ArrowLeftRight,
                        onSelect: () => setOperation({ asset, type: 'transfer' as Operation }),
                      },
                    ]
                  : []),
                {
                  label: 'Return asset',
                  icon: RotateCcw,
                  onSelect: () => setOperation({ asset, type: 'return' }),
                },
              ]
            : []),
          { label: 'Move location', icon: MapPin, onSelect: () => setOperation({ asset, type: 'move' }) },
          ...(statusTargets(asset, user?.role).length
            ? [
                {
                  label: 'Change status',
                  icon: RefreshCw,
                  onSelect: () => setOperation({ asset, type: 'status' }),
                },
              ]
            : []),
          ...['DAMAGED', 'LOST']
            .filter((status) => statusTargets(asset, user?.role).includes(status))
            .map((status) => ({
              label: status === 'DAMAGED' ? 'Report damage' : 'Report lost',
              icon: AlertTriangle,
              onSelect: () => setOperation({ asset, type: 'status', initialStatus: status }),
            })),
        ]
      : []),
    ...(user?.role === 'ADMIN' && asset.deletedAt
      ? [{ label: 'Restore asset', icon: RotateCcw, onSelect: () => void restore(asset) }]
      : []),
    ...(!manager && holder(asset)
      ? [
          { label: 'Make a request', icon: Plus, onSelect: () => setOperation({ asset, type: 'request' }) },
          ...['DAMAGE', 'LOST'].map((requestType) => ({
            label: requestType === 'DAMAGE' ? 'Report damage' : 'Report lost',
            icon: AlertTriangle,
            onSelect: () => setOperation({ asset, type: 'request' as Operation, requestType }),
          })),
        ]
      : []),
  ];
  const allColumns: Column[] = [
    {
      key: 'assetTag',
      label: 'Asset / tag',
      sortable: true,
      render: (r) => (
        <Link className="asset-cell" to={`/assets/${r.id}`}>
          <span className="table-asset-icon">
            <AssetTypeIcon asset={r} />
          </span>
          <span>
            <strong>{r.assetTag}</strong>
            <small>
              {r.manufacturer} {r.model}
            </small>
          </span>
        </Link>
      ),
    },
    { key: 'assetType', label: 'Type', sortable: true },
    { key: 'category', label: 'Category', render: (r) => r.category?.name ?? '—' },
    { key: 'manufacturer', label: 'Manufacturer', sortable: true },
    { key: 'model', label: 'Model', sortable: true },
    {
      key: 'serialNumber',
      label: 'Serial number',
      render: (r) => <span className="mono">{r.serialNumber ?? '—'}</span>,
    },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <Badge value={r.status} /> },
    {
      key: 'holder',
      label: 'Assigned to',
      render: (r) => {
        const current = holder(r);
        return current ? (
          <Link className="person-cell" to={manager ? `/employees/${current.employeeId}` : '/profile'}>
            <span className="mini-avatar">{initials(current.employee?.name ?? '?')}</span>
            <span>
              {current.employee?.name ?? 'Assigned'}
              <small>{current.employee?.employeeId}</small>
            </span>
          </Link>
        ) : (
          <span className="asset-unassigned">Unassigned</span>
        );
      },
    },
    { key: 'department', label: 'Department', render: (r) => r.department?.name ?? '—' },
    {
      key: 'location',
      label: 'Location',
      render: (r) => (
        <span className="location-cell">
          <MapPin size={13} />
          {r.location?.name ?? '—'}
        </span>
      ),
    },
    { key: 'condition', label: 'Condition', sortable: true, render: (r) => human(r.condition) },
    { key: 'purchaseDate', label: 'Purchased', sortable: true, render: (r) => date(r.purchaseDate) },
    {
      key: 'warrantyExpiry',
      label: 'Warranty',
      sortable: true,
      render: (r) => (
        <span
          className={`asset-warranty ${warranty(r.warrantyExpiry) === 'Expired' ? 'expired' : warranty(r.warrantyExpiry) === 'Expiring soon' ? 'expiring' : ''}`}
        >
          {date(r.warrantyExpiry)}
          <small>{warranty(r.warrantyExpiry)}</small>
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => (
        <div className="row-actions asset-row-actions">
          <button
            onClick={() => setPreviewId(r.id)}
            className="icon-button"
            aria-label={`Quick view ${r.assetTag}`}
            title="Quick view asset"
          >
            <Eye size={16} />
          </button>
          {manager && !r.deletedAt && r.status === 'AVAILABLE' && (
            <button
              className="icon-button"
              aria-label={`Assign ${r.assetTag}`}
              title="Assign asset"
              onClick={() => setOperation({ asset: r, type: 'assign' })}
            >
              <UserRound size={16} />
            </button>
          )}
          {manager && !r.deletedAt && holder(r) && (
            <button
              className="icon-button"
              aria-label={`Return ${r.assetTag}`}
              title="Return asset"
              onClick={() => setOperation({ asset: r, type: 'return' })}
            >
              <RotateCcw size={16} />
            </button>
          )}
          <AssetActionMenu label={`Actions for ${r.assetTag}`} items={actions(r)} />
        </div>
      ),
    },
  ];
  const activeFilters = Object.entries(filters);
  const refresh = () => {
    resource.reload();
    lookups.reload();
  };
  const selectedAssets = selected.map((id) => records.current.get(id)).filter(Boolean) as RecordData[];
  const bulkActions = commonAssetActions(selectedAssets, user?.role ?? 'EMPLOYEE');
  return (
    <div className="asset-console">
      <PageHeader
        eyebrow="ASSET OPERATIONS"
        title={manager ? 'All assets' : 'My assets'}
        description={
          manager
            ? 'Search inventory, review custody, and take action from one workspace.'
            : 'Equipment currently in your care, with a complete record of every handover.'
        }
        actions={
          manager && (
            <>
              <button className="btn secondary" onClick={() => setImportOpen(true)}>
                <Upload size={16} />
                Import
              </button>
              <button className="btn secondary" disabled={exporting} onClick={() => void exportData('csv')}>
                <Download size={16} />
                {exporting ? 'Exporting…' : 'Export'}
              </button>
              <button className="btn primary" onClick={() => setEditing(null)}>
                <Plus size={17} />
                Register asset
              </button>
            </>
          )
        }
      />
      <div className="asset-console-status">
        <span>
          <Package size={15} />
          <strong>{resource.meta?.total ?? '—'}</strong>{' '}
          {activeFilters.length || search ? 'matching' : 'visible'} assets
        </span>
        <span>
          <ShieldCheck size={15} />
          Lifecycle history retained
        </span>
        <span className="asset-console-sync">
          <i />
          Live inventory
        </span>
      </div>
      {manager && (
        <div className="asset-tabs asset-inventory-tabs">
          {[
            ['', 'All assets'],
            ['AVAILABLE', 'Available'],
            ['ASSIGNED', 'Assigned'],
            ['UNDER_REPAIR', 'Under repair'],
            ['DAMAGED', 'Damaged'],
            ['LOST', 'Lost'],
          ].map(([value, label]) => (
            <button
              key={value}
              className={(filters.status ?? '') === value ? 'active' : ''}
              onClick={() => applyFilters({ ...filters, status: value })}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <section className="panel table-panel asset-inventory-panel">
        <div className="table-toolbar">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search asset tag, serial, model or employee…"
          />
          <div className="toolbar-actions">
            <button
              className={`btn secondary small-btn ${activeFilters.length ? 'selected-btn' : ''}`}
              onClick={() => setShowFilters(true)}
            >
              <SlidersHorizontal size={15} />
              Filters
              {activeFilters.length > 0 && <span className="filter-count">{activeFilters.length}</span>}
            </button>
            <details className="asset-column-options">
              <summary className="btn secondary small-btn">
                <Columns3 size={15} />
                Columns
                <ChevronDown size={13} />
              </summary>
              <div className="asset-columns-popover">
                {allColumns
                  .filter((c) => c.key !== 'actions')
                  .map((c) => (
                    <label key={c.key}>
                      <input
                        type="checkbox"
                        checked={visible.includes(c.key)}
                        disabled={c.key === 'assetTag'}
                        onChange={(e) =>
                          setVisible((v) => (e.target.checked ? [...v, c.key] : v.filter((k) => k !== c.key)))
                        }
                      />
                      {c.label}
                    </label>
                  ))}
              </div>
            </details>
            <div className="asset-view-switch" role="group" aria-label="Asset view">
              <button
                aria-label="Table view"
                aria-pressed={view === 'table'}
                title="Table view"
                onClick={() => changeView('table')}
              >
                <List size={16} />
              </button>
              <button
                aria-label="Card view"
                aria-pressed={view === 'cards'}
                title="Card view"
                onClick={() => changeView('cards')}
              >
                <LayoutGrid size={16} />
              </button>
            </div>
            <button
              className="icon-button"
              aria-label="Refresh asset inventory"
              title="Refresh inventory"
              onClick={refresh}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
        {activeFilters.length > 0 && (
          <div className="asset-filter-chips">
            {activeFilters.map(([key, value]) => (
              <button
                key={key}
                onClick={() => applyFilters({ ...filters, [key]: '' })}
                aria-label={`Remove ${filterLabel(key, value, lookups.data)} filter`}
              >
                {filterLabel(key, value, lookups.data)}
                <X size={12} />
              </button>
            ))}
            <button className="asset-clear-filters" onClick={() => applyFilters({})}>
              Clear all
            </button>
          </div>
        )}
        {selected.length > 0 && (
          <div className="asset-bulk-toolbar" role="region" aria-label="Selected asset actions">
            <span>
              <CheckCircle2 size={16} />
              <strong>{selected.length} selected</strong>
            </span>
            {bulkActions.assign && (
              <button onClick={() => setBulk({ kind: 'assign', assets: selectedAssets })}>
                <UserRound size={14} />
                Assign
              </button>
            )}
            {bulkActions.move && (
              <button onClick={() => setBulk({ kind: 'move', assets: selectedAssets })}>
                <MapPin size={14} />
                Move
              </button>
            )}
            {bulkActions.statuses.length > 0 && (
              <button onClick={() => setBulk({ kind: 'status', assets: selectedAssets })}>
                <RefreshCw size={14} />
                Change status
              </button>
            )}
            <AssetActionMenu
              label="Export selected assets"
              buttonText="Export"
              icon={Download}
              items={['csv', 'xlsx', 'pdf'].map((format) => ({
                label: format === 'xlsx' ? 'Excel' : format.toUpperCase(),
                icon: FileSpreadsheet,
                onSelect: () => void exportData(format),
                disabled: exporting,
              }))}
            />
            <button
              className="asset-clear-selection"
              onClick={() => setSelected([])}
              aria-label="Clear selected assets"
            >
              <X size={15} />
              Clear
            </button>
          </div>
        )}
        {view === 'table' && (
          <DataTable
            columns={allColumns.filter((c) => visible.includes(c.key))}
            rows={resource.data}
            loading={resource.loading}
            error={resource.error}
            retry={resource.reload}
            meta={resource.meta}
            page={page}
            onPage={setPage}
            selected={manager ? selected : undefined}
            onSelect={manager ? setSelected : undefined}
            sort={sort}
            onSort={(key) =>
              setSort((s) => ({
                sortBy: key,
                sortOrder: s.sortBy === key && s.sortOrder === 'asc' ? 'desc' : 'asc',
              }))
            }
          />
        )}
        {view === 'cards' &&
          (resource.loading ? (
            <Loading />
          ) : resource.error ? (
            <ErrorState message={resource.error} retry={resource.reload} />
          ) : !resource.data?.length ? (
            <EmptyState
              title="No matching assets"
              description="Adjust the filters or register a new asset to get started."
            />
          ) : (
            <>
              <div className="asset-card-grid">
                {resource.data.map((asset) => {
                  const current = holder(asset);
                  return (
                    <article
                      key={asset.id}
                      className={`asset-inventory-card ${selected.includes(asset.id) ? 'selected' : ''}`}
                    >
                      <div className="asset-card-top">
                        <span className="asset-card-icon">
                          <AssetTypeIcon asset={asset} size={23} />
                        </span>
                        <Badge value={asset.status} />
                        <AssetActionMenu label={`Actions for ${asset.assetTag}`} items={actions(asset)} />
                      </div>
                      <Link className="asset-card-title" to={`/assets/${asset.id}`}>
                        <strong>
                          {asset.manufacturer} {asset.model}
                        </strong>
                        <span>{asset.assetTag}</span>
                      </Link>
                      <dl>
                        <div>
                          <dt>Serial</dt>
                          <dd className="mono">{asset.serialNumber ?? '—'}</dd>
                        </div>
                        <div>
                          <dt>Current holder</dt>
                          <dd>{current?.employee?.name ?? 'Unassigned'}</dd>
                        </div>
                        <div>
                          <dt>Location</dt>
                          <dd>{asset.location?.name ?? '—'}</dd>
                        </div>
                        <div>
                          <dt>Warranty</dt>
                          <dd>{warranty(asset.warrantyExpiry)}</dd>
                        </div>
                      </dl>
                      <div className="asset-card-bottom">
                        {manager ? (
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`Select ${asset.assetTag}`}
                              checked={selected.includes(asset.id)}
                              onChange={(e) =>
                                setSelected((ids) =>
                                  e.target.checked ? [...ids, asset.id] : ids.filter((id) => id !== asset.id),
                                )
                              }
                            />
                            Select
                          </label>
                        ) : (
                          <span>{human(asset.condition)} condition</span>
                        )}
                        <button
                          className="icon-button"
                          aria-label={`Quick view ${asset.assetTag}`}
                          onClick={() => setPreviewId(asset.id)}
                        >
                          <Eye size={16} />
                        </button>
                        <Link to={`/assets/${asset.id}`}>
                          View asset
                          <ArrowRight size={14} />
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="table-pagination">
                <span>{resource.meta?.total ?? 0} records</span>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Previous page"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span>
                    Page {page} of {resource.meta?.totalPages ?? 1}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Next page"
                    disabled={page >= (resource.meta?.totalPages ?? 1)}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </>
          ))}
        <div className="asset-table-bottom">
          <span>Current filters apply to all export formats.</span>
          <label>
            Rows per page
            <select
              aria-label="Assets per page"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      {showFilters && (
        <AssetFilters
          filters={filters}
          lookups={lookups.data}
          isAdmin={user?.role === 'ADMIN'}
          onApply={applyFilters}
          onClose={() => setShowFilters(false)}
        />
      )}
      {previewId && <AssetPreview id={previewId} onClose={() => setPreviewId(null)} />}
      {editing !== undefined && (
        <AssetEditor
          asset={editing ?? undefined}
          onClose={() => setEditing(undefined)}
          onSaved={resource.reload}
        />
      )}{' '}
      {operation &&
        (operation.asset ? (
          <AssetOperation
            asset={operation.asset}
            operation={operation.type}
            requestType={operation.requestType}
            initialStatus={operation.initialStatus}
            onClose={() => setOperation(null)}
            onSaved={resource.reload}
          />
        ) : (
          <AssetOperationPicker
            operation={operation.type}
            onClose={() => setOperation(null)}
            onSaved={resource.reload}
          />
        ))}
      {importOpen && <AssetCsvImport onClose={() => setImportOpen(false)} onSaved={resource.reload} />}{' '}
      {bulk && (
        <BulkAssetAction
          kind={bulk.kind}
          assets={bulk.assets}
          onClose={() => setBulk(null)}
          onCompleted={(ids) => {
            setSelected((s) => s.filter((id) => !ids.includes(id)));
            resource.reload();
          }}
        />
      )}
    </div>
  );
}
