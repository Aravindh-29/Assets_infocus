import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Download,
  FileBarChart2,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  Package,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  TriangleAlert,
  UserCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useResource } from '../hooks/useResource';
import { useToast } from '../context/ToastContext';
import { DataTable, PageHeader, SlideOver } from '../components/ui';
import { options } from '../components/AssetForms';
import type { Lookups, RecordData } from '../types';
import { CONDITIONS, STATUSES } from '../types';
import { human } from '../utils/format';
import { downloadReport, errorMessage, request } from '../services/api';
import './dashboard-console.css';

type ReportDefinition = {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  group: 'Inventory' | 'Custody' | 'Service';
  tone: string;
};
type ReportData = { columns: { key: string; label: string }[]; rows: RecordData[] };
const reports: ReportDefinition[] = [
  {
    key: 'inventory',
    title: 'Asset inventory',
    description: 'Complete register with status, ownership, location, and purchase details.',
    icon: Package,
    group: 'Inventory',
    tone: 'teal',
  },
  {
    key: 'assigned',
    title: 'Assigned assets',
    description: 'Equipment currently assigned to employees across the organization.',
    icon: UserCheck,
    group: 'Custody',
    tone: 'blue',
  },
  {
    key: 'available',
    title: 'Available assets',
    description: 'Serviceable equipment ready for its next assignment.',
    icon: PackageCheck,
    group: 'Inventory',
    tone: 'teal',
  },
  {
    key: 'employee-assets',
    title: 'Employee asset history',
    description: 'Current and previous custody, with assignment and release dates.',
    icon: Users,
    group: 'Custody',
    tone: 'blue',
  },
  {
    key: 'movements',
    title: 'Asset movements',
    description: 'Assignments, handovers, returns, and location changes.',
    icon: ArrowRightLeft,
    group: 'Custody',
    tone: 'blue',
  },
  {
    key: 'lost',
    title: 'Lost assets',
    description: 'Confirmed losses for investigation and accountability.',
    icon: CircleAlert,
    group: 'Inventory',
    tone: 'rose',
  },
  {
    key: 'damaged',
    title: 'Damaged assets',
    description: 'Equipment with condition issues that need attention.',
    icon: TriangleAlert,
    group: 'Service',
    tone: 'amber',
  },
  {
    key: 'repairs',
    title: 'Repair register',
    description: 'Issues, repair providers, service costs, and resolution status.',
    icon: Wrench,
    group: 'Service',
    tone: 'amber',
  },
  {
    key: 'warranty',
    title: 'Warranty coverage',
    description: 'Expired warranties and coverage due within the alert window.',
    icon: ShieldAlert,
    group: 'Service',
    tone: 'amber',
  },
  {
    key: 'offboarding',
    title: 'Employee exit assets',
    description: 'Asset checklists and resolutions for employee departures.',
    icon: CheckCircle2,
    group: 'Custody',
    tone: 'teal',
  },
];
const fieldLabels: Record<string, string> = {
  categoryId: 'Category',
  departmentId: 'Department',
  locationId: 'Location',
  employeeId: 'Employee',
  status: 'Status',
  condition: 'Condition',
  purchaseFrom: 'Purchased from',
  purchaseTo: 'Purchased until',
  warrantyFrom: 'Warranty from',
  warrantyTo: 'Warranty until',
};

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const type = reports.some((report) => report.key === params.get('type'))
    ? params.get('type')!
    : 'inventory';
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [draftFilters, setDraftFilters] = useState<Record<string, string>>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [page, setPage] = useState(1);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [group, setGroup] = useState('All reports');
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState<Record<string, number | 'error'>>({});
  const [countVersion, setCountVersion] = useState(0);
  const preview = useRef<HTMLElement>(null);
  const effectiveFilters = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(filters).filter(([key]) =>
          type === 'offboarding'
            ? key === 'employeeId'
            : !(key === 'status' && ['assigned', 'available', 'lost', 'damaged'].includes(type)),
        ),
      ),
    [filters, type],
  );
  const resource = useResource<ReportData>(`/reports/${type}`, effectiveFilters);
  const lookups = useResource<Lookups>('/lookups');
  const toast = useToast();
  const report = reports.find((item) => item.key === type)!;
  const filtersActive = Object.entries(effectiveFilters).filter(([, value]) => value);
  const rows = resource.data?.rows ?? [];
  const visibleReports = useMemo(
    () =>
      reports.filter(
        (item) =>
          (group === 'All reports' || item.group === group) &&
          `${item.title} ${item.description}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [group, search],
  );

  useEffect(() => {
    // The existing report API supplies exact dataset sizes. Read two at a time and
    // retain counts only, avoiding an additional report cache or backend change.
    let cancelled = false;
    let next = 0;
    setCounts({});
    async function worker() {
      while (next < reports.length && !cancelled) {
        const item = reports[next++];
        try {
          const result = await request<ReportData>('GET', `/reports/${item.key}`);
          if (!cancelled) setCounts((current) => ({ ...current, [item.key]: result.data.rows.length }));
        } catch {
          if (!cancelled) setCounts((current) => ({ ...current, [item.key]: 'error' }));
        }
      }
    }
    void worker();
    void worker();
    return () => {
      cancelled = true;
    };
  }, [countVersion]);
  useEffect(() => {
    setPage(1);
  }, [type]);

  async function exportData(reportType: string, format: string, reportFilters = effectiveFilters) {
    setBusy(`${reportType}:${format}`);
    try {
      await downloadReport(reportType, format, reportFilters);
      toast('Your report has been downloaded.');
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      setBusy('');
    }
  }
  function selectReport(key: string) {
    setParams({ type: key });
    setPage(1);
    preview.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  }
  const lookupLabel = (key: string, value: string) => {
    const values =
      key === 'categoryId'
        ? lookups.data?.categories
        : key === 'departmentId'
          ? lookups.data?.departments
          : key === 'locationId'
            ? lookups.data?.locations
            : key === 'employeeId'
              ? lookups.data?.employees
              : undefined;
    return (
      values?.find((item) => item.id === value)?.name ??
      (key === 'status' || key === 'condition' ? human(value) : value)
    );
  };
  const selects: { key: string; label: string; options: { value: string; label: string }[] }[] = [
    { key: 'categoryId', label: 'Category', options: options(lookups.data?.categories) },
    { key: 'departmentId', label: 'Department', options: options(lookups.data?.departments) },
    { key: 'locationId', label: 'Location', options: options(lookups.data?.locations) },
    { key: 'employeeId', label: 'Employee', options: options(lookups.data?.employees) },
    { key: 'status', label: 'Status', options: STATUSES.map((value) => ({ value, label: human(value) })) },
    {
      key: 'condition',
      label: 'Condition',
      options: CONDITIONS.map((value) => ({ value, label: human(value) })),
    },
  ];
  return (
    <div className="dc-console dc-reports-console">
      <PageHeader
        eyebrow="INSIGHTS / REPORT LIBRARY"
        title="Reports & insights"
        description="Explore asset records, trace custody, and export the information your team needs."
        actions={
          <button
            className="btn secondary"
            onClick={() => {
              resource.reload();
              setCountVersion((value) => value + 1);
            }}
          >
            <RefreshCw size={15} />
            Refresh data
          </button>
        }
      />
      <section className="dc-panel dc-library">
        <div className="dc-panel-head">
          <div>
            <h2>
              <FileBarChart2 size={18} />
              Report library<span className="dc-counter">{reports.length}</span>
            </h2>
            <p>Live record counts · select a report to preview and filter</p>
          </div>
          <button
            className="btn secondary small-btn"
            aria-expanded={libraryOpen}
            onClick={() => setLibraryOpen(!libraryOpen)}
          >
            {libraryOpen ? 'Collapse library' : 'Browse reports'}
            {libraryOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
        {libraryOpen && (
          <>
            <div className="dc-library-tools">
              <div className="dc-segmented">
                {['All reports', 'Inventory', 'Custody', 'Service'].map((value) => (
                  <button
                    key={value}
                    className={value === group ? 'active' : ''}
                    aria-pressed={value === group}
                    onClick={() => setGroup(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <label className="dc-inline-search">
                <Search size={15} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Find a report…"
                  aria-label="Search report library"
                />
                {search && (
                  <button aria-label="Clear report search" onClick={() => setSearch('')}>
                    <X size={14} />
                  </button>
                )}
              </label>
            </div>
            <div className="dc-report-grid">
              {visibleReports.map((item) => (
                <article key={item.key} className={`dc-report-card ${type === item.key ? 'selected' : ''}`}>
                  <div className="dc-report-card-top">
                    <span className={`dc-report-icon dc-tone-${item.tone}`}>
                      <item.icon size={19} />
                    </span>
                    <span>{item.group}</span>
                    {type === item.key && (
                      <CheckCircle2
                        size={15}
                        className="dc-selected-indicator"
                        aria-label="Selected report"
                      />
                    )}
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <div className="dc-report-card-bottom">
                    <span className="dc-record-count">
                      {counts[item.key] === 'error' ? (
                        <button
                          className="dc-text-link"
                          onClick={() => setCountVersion((value) => value + 1)}
                        >
                          Retry count
                        </button>
                      ) : typeof counts[item.key] === 'number' ? (
                        <>
                          <strong>{counts[item.key].toLocaleString()}</strong> records
                        </>
                      ) : (
                        <>
                          <span className="dc-count-skeleton" aria-label="Loading record count" /> records
                        </>
                      )}
                    </span>
                    <div>
                      <button
                        onClick={() => selectReport(item.key)}
                        className="dc-card-view"
                        aria-label={`View ${item.title}`}
                      >
                        View
                        <ArrowRight size={13} />
                      </button>
                      <button
                        className="dc-card-export"
                        title={`Export all ${item.title.toLowerCase()} as CSV`}
                        aria-label={`Export ${item.title} as CSV`}
                        disabled={Boolean(busy)}
                        onClick={() => void exportData(item.key, 'csv', {})}
                      >
                        {busy === `${item.key}:csv` ? (
                          <Loader2 size={15} className="spin" />
                        ) : (
                          <Download size={15} />
                        )}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {!visibleReports.length && (
              <div className="dc-empty-copy">
                No reports match your search.{' '}
                <button
                  className="dc-text-link"
                  onClick={() => {
                    setSearch('');
                    setGroup('All reports');
                  }}
                >
                  Clear search
                </button>
              </div>
            )}
            <div className="dc-library-caption">
              <CheckCircle2 size={14} />
              Library counts show complete reports. Preview filters below apply to the selected report.
            </div>
          </>
        )}
      </section>
      <section className="dc-panel dc-report-preview" ref={preview} aria-label="Selected report preview">
        <div className="dc-report-preview-head">
          <span className={`dc-report-icon dc-tone-${report.tone}`}>
            <report.icon size={22} />
          </span>
          <div>
            <div className="dc-section-label">REPORT PREVIEW</div>
            <h2>{report.title}</h2>
            <p>{report.description}</p>
          </div>
          <span className="dc-counter">
            {resource.loading
              ? 'Loading…'
              : resource.error
                ? 'Unavailable'
                : `${rows.length.toLocaleString()} records`}
          </span>
          <div className="dc-export-actions">
            {[
              { format: 'csv', label: 'CSV', icon: FileText },
              { format: 'xlsx', label: 'Excel', icon: FileSpreadsheet },
              { format: 'pdf', label: 'PDF', icon: Download },
            ].map((item) => (
              <button
                key={item.format}
                className="btn secondary small-btn"
                disabled={Boolean(busy) || resource.loading || Boolean(resource.error)}
                onClick={() => void exportData(type, item.format)}
              >
                {busy === `${type}:${item.format}` ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <item.icon size={15} />
                )}
                {busy === `${type}:${item.format}` ? 'Exporting…' : item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="dc-preview-toolbar">
          <span>
            <Filter size={14} />
            {filtersActive.length
              ? `${filtersActive.length} active filter${filtersActive.length > 1 ? 's' : ''}`
              : 'Showing all matching records'}
          </span>
          <button
            className="btn secondary small-btn"
            onClick={() => {
              setDraftFilters(effectiveFilters);
              setFilterOpen(true);
            }}
          >
            <SlidersHorizontal size={15} />
            Filters
            {filtersActive.length > 0 && <span className="dc-filter-count">{filtersActive.length}</span>}
          </button>
        </div>
        {filtersActive.length > 0 && (
          <div className="dc-filter-chips">
            {filtersActive.map(([key, value]) => (
              <button
                key={key}
                onClick={() => {
                  setFilters((current) => {
                    const next = { ...current };
                    delete next[key];
                    return next;
                  });
                  setPage(1);
                }}
                aria-label={`Remove ${fieldLabels[key]} filter`}
              >
                {fieldLabels[key]}: {lookupLabel(key, value)}
                <X size={12} />
              </button>
            ))}
            <button
              className="dc-clear-chips"
              onClick={() => {
                setFilters({});
                setPage(1);
              }}
            >
              Clear all
            </button>
          </div>
        )}
        <DataTable
          columns={(resource.data?.columns ?? []).map((column) => ({
            ...column,
            render: (row: RecordData) =>
              row[column.key] == null || row[column.key] === ''
                ? '—'
                : typeof row[column.key] === 'object'
                  ? JSON.stringify(row[column.key])
                  : String(row[column.key]),
          }))}
          rows={rows
            .slice((page - 1) * 15, page * 15)
            .map((row, index) => ({ ...row, id: `${type}-${(page - 1) * 15 + index}` }))}
          loading={resource.loading}
          error={resource.error}
          retry={resource.reload}
          page={page}
          onPage={setPage}
          meta={{ page, pageSize: 15, total: rows.length, totalPages: Math.ceil(rows.length / 15) }}
          emptyTitle="No records match this report"
        />
        <div className="dc-panel-footer">
          <span>
            <ArrowDownToLine size={14} />
            Exports include the complete filtered dataset.
          </span>
          <span>CSV · Excel · PDF</span>
        </div>
      </section>
      {filterOpen && (
        <SlideOver
          title="Filter report"
          description={`Narrow the ${report.title.toLowerCase()} before previewing or exporting.`}
          onClose={() => setFilterOpen(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setFilters(Object.fromEntries(Object.entries(draftFilters).filter(([, value]) => value)));
              setPage(1);
              setFilterOpen(false);
            }}
          >
            <div className="dc-report-filter-fields">
              {selects
                .filter((field) =>
                  type === 'offboarding'
                    ? field.key === 'employeeId'
                    : !(
                        field.key === 'status' && ['assigned', 'available', 'lost', 'damaged'].includes(type)
                      ),
                )
                .map((field) => (
                  <label className="field" key={field.key}>
                    {field.label}
                    <select
                      aria-label={field.label}
                      value={draftFilters[field.key] ?? ''}
                      onChange={(event) =>
                        setDraftFilters((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                    >
                      <option value="">Any {field.label.toLowerCase()}</option>
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              {type !== 'offboarding' &&
                [
                  ['purchaseFrom', 'Purchased from'],
                  ['purchaseTo', 'Purchased until'],
                  ['warrantyFrom', 'Warranty from'],
                  ['warrantyTo', 'Warranty until'],
                ].map(([key, label]) => (
                  <label className="field" key={key}>
                    {label}
                    <input
                      type="date"
                      aria-label={label}
                      value={draftFilters[key] ?? ''}
                      onChange={(event) =>
                        setDraftFilters((current) => ({ ...current, [key]: event.target.value }))
                      }
                    />
                  </label>
                ))}
            </div>
            <div className="form-actions">
              <button type="button" className="btn secondary" onClick={() => setDraftFilters({})}>
                Clear filters
              </button>
              <button type="submit" className="btn primary">
                <CheckCircle2 size={15} />
                Apply filters
              </button>
            </div>
          </form>
        </SlideOver>
      )}
    </div>
  );
}
