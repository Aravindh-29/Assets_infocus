import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Clock3,
  FileBarChart2,
  Layers3,
  Package,
  PackageCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  TriangleAlert,
  UserCheck,
  UserPlus,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import { useResource } from '../hooks/useResource';
import { EmptyState, ErrorState, Loading, PageHeader } from '../components/ui';
import type { Lookups } from '../types';
import { date, human } from '../utils/format';
import './dashboard-console.css';

type Distribution = { name: string; value: number };
type ActivityRecord = {
  id: string;
  assetId: string;
  eventType: string;
  timestamp: string;
  notes?: string;
  performedByName?: string;
  asset?: { assetTag: string; model?: string };
};
type Summary = {
  totalAssets: number;
  assignedAssets: number;
  availableAssets: number;
  underRepairAssets: number;
  lostAssets: number;
  damagedAssets: number;
  retiredAssets: number;
  disposedAssets: number;
  pendingActions: number;
  warrantiesExpiring: number;
  totalEmployees: number;
  statusDistribution: Distribution[];
  categoryDistribution: Distribution[];
  departmentDistribution: Distribution[];
  assignmentTrend: { month: string; assigned: number; returned: number }[];
  recentActivity: ActivityRecord[];
};
const colors: Record<string, string> = {
  AVAILABLE: '#36877b',
  ASSIGNED: '#4f78a4',
  UNDER_REPAIR: '#c09232',
  DAMAGED: '#c77541',
  LOST: '#c45861',
  RETIRED: '#87939d',
  DISPOSED: '#b5bdc5',
};
const activityIcon = (type: string): LucideIcon =>
  type.includes('TRANSFER')
    ? ArrowRightLeft
    : type.includes('RETURN')
      ? RotateCcw
      : type.includes('ASSIGNED')
        ? UserCheck
        : type.includes('REPAIR')
          ? Wrench
          : type.includes('LOST') || type.includes('DAMAG')
            ? CircleAlert
            : type.includes('REGISTER')
              ? Plus
              : Activity;
function ago(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1
    ? 'Just now'
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
}
const percentage = (part: number, total: number) => (total ? `${((part / total) * 100).toFixed(1)}%` : '0%');
function DistributionRow({ to, title, children }: { to: string | null; title: string; children: ReactNode }) {
  return to ? (
    <Link to={to} title={title}>
      {children}
    </Link>
  ) : (
    <div className="dc-distribution-static">{children}</div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const employee = user?.role === 'EMPLOYEE';
  const navigate = useNavigate();
  const resource = useResource<Summary>('/dashboard/summary');
  const lookups = useResource<Lookups>('/lookups');
  const [trend, setTrend] = useState<'both' | 'assigned' | 'returned'>('both');
  const data = resource.data;
  if (resource.loading && !data)
    return (
      <div className="dc-console">
        <Loading />
      </div>
    );
  if (resource.error || !data)
    return <ErrorState message={resource.error || 'The overview is unavailable.'} retry={resource.reload} />;
  const total = data.totalAssets;
  const issued = data.assignmentTrend.reduce((sum, row) => sum + row.assigned, 0);
  const received = data.assignmentTrend.reduce((sum, row) => sum + row.returned, 0);
  const cards: {
    label: string;
    value: number;
    icon: LucideIcon;
    tone: string;
    detail: string;
    to: string;
  }[] = [
    {
      label: employee ? 'My assets' : 'Total assets',
      value: total,
      icon: Package,
      tone: 'teal',
      detail: employee
        ? 'Currently in your custody'
        : `${data.totalEmployees.toLocaleString()} employees in workforce`,
      to: '/assets',
    },
    {
      label: 'Assigned',
      value: data.assignedAssets,
      icon: UserCheck,
      tone: 'blue',
      detail: `${percentage(data.assignedAssets, total)} of ${employee ? 'your assets' : 'inventory'}`,
      to: '/assets?status=ASSIGNED',
    },
    {
      label: 'Available',
      value: data.availableAssets,
      icon: PackageCheck,
      tone: 'teal',
      detail: `${percentage(data.availableAssets, total)} ready for assignment`,
      to: '/assets?status=AVAILABLE',
    },
    {
      label: 'Under repair',
      value: data.underRepairAssets,
      icon: Wrench,
      tone: 'amber',
      detail: `${percentage(data.underRepairAssets, total)} in repair`,
      to: '/assets?status=UNDER_REPAIR',
    },
    {
      label: 'Lost',
      value: data.lostAssets,
      icon: CircleAlert,
      tone: 'rose',
      detail: `${percentage(data.lostAssets, total)} confirmed lost`,
      to: '/assets?status=LOST',
    },
    {
      label: 'Warranty expiring',
      value: data.warrantiesExpiring,
      icon: ShieldAlert,
      tone: 'amber',
      detail: 'Configured alert window',
      to: employee ? '/assets' : '/reports?type=warranty',
    },
  ];
  const quickActions: { label: string; icon: LucideIcon; to: string; description: string }[] = [
    ...(!employee
      ? [
          {
            label: 'Register asset',
            icon: Plus,
            to: '/assets?new=1',
            description: 'Add equipment to the asset register',
          },
          {
            label: 'Assign',
            icon: UserCheck,
            to: '/assets?operation=assign',
            description: 'Assign an available asset to an employee',
          },
          {
            label: 'Transfer',
            icon: ArrowRightLeft,
            to: '/assets?operation=transfer',
            description: 'Transfer custody between employees',
          },
          {
            label: 'Return',
            icon: RotateCcw,
            to: '/assets?operation=return',
            description: 'Receive an assigned asset back into inventory',
          },
          {
            label: 'Add employee',
            icon: UserPlus,
            to: '/employees?new=1',
            description: 'Create an employee record',
          },
        ]
      : [
          {
            label: 'My equipment',
            icon: Package,
            to: '/assets',
            description: 'Review assets currently assigned to you',
          },
        ]),
    {
      label: 'Report lost',
      icon: CircleAlert,
      to: '/requests?new=1&type=LOST',
      description: 'Submit a lost asset report for review',
    },
    {
      label: 'Report damage',
      icon: TriangleAlert,
      to: '/requests?new=1&type=DAMAGE',
      description: 'Report an issue with an assigned asset',
    },
  ];
  const distributionLink = (kind: 'category' | 'department', name: string) => {
    const source = kind === 'category' ? lookups.data?.categories : lookups.data?.departments;
    const id = source?.find((item) => item.name === name)?.id;
    return id
      ? `/assets?${kind}Id=${encodeURIComponent(id)}${kind === 'department' ? '&assigned=true' : ''}`
      : null;
  };
  return (
    <div className="dc-console" aria-busy={resource.loading}>
      <PageHeader
        eyebrow={employee ? 'INFOCUS / MY WORKSPACE' : 'INFOCUS / OPERATIONS OVERVIEW'}
        title={employee ? 'My asset overview' : 'Asset operations'}
        description={
          employee
            ? 'Your equipment, open requests, and recent handovers.'
            : 'Monitor inventory, manage custody, and keep every asset accounted for.'
        }
        actions={
          <>
            <button
              className="btn secondary"
              onClick={resource.reload}
              disabled={resource.loading}
              title="Refresh live dashboard data"
            >
              <RefreshCw size={15} className={resource.loading ? 'spin' : ''} />
              Refresh
            </button>
            {!employee && (
              <Link className="btn secondary" to="/reports">
                <FileBarChart2 size={15} />
                Reports
              </Link>
            )}
          </>
        }
      />
      <div className="dc-scope-strip">
        <span>
          <span className="dc-live-dot" />
          {employee ? 'Your assigned assets' : 'Organization inventory'}
        </span>
        <span>
          <Clock3 size={13} />
          Live database snapshot
        </span>
      </div>
      <section className="dc-kpi-grid" aria-label="Asset key performance indicators">
        {cards.map((card) => (
          <Link
            className={`dc-kpi dc-tone-${card.tone}`}
            to={card.to}
            key={card.label}
            title={`View ${card.label.toLowerCase()}`}
          >
            <div className="dc-kpi-top">
              <span>{card.label}</span>
              <card.icon size={18} aria-hidden="true" />
            </div>
            <strong>{card.value.toLocaleString()}</strong>
            <div className="dc-kpi-detail">
              <span>{card.detail}</span>
              <ArrowUpRight size={14} />
            </div>
          </Link>
        ))}
      </section>
      <section className="dc-action-bar" aria-label="Quick actions">
        <span className="dc-section-label">QUICK ACTIONS</span>
        <div>
          {quickActions.map((action) => (
            <Link key={action.label} to={action.to} title={action.description}>
              <action.icon size={15} />
              <span>{action.label}</span>
            </Link>
          ))}
        </div>
      </section>
      <div className="dc-dashboard-grid">
        <section className="dc-panel dc-trend-panel">
          <div className="dc-panel-head">
            <div>
              <h2>
                <Activity size={17} />
                Asset activity
              </h2>
              <p>Monthly assignments and returns · last six months</p>
            </div>
            <div className="dc-segmented" aria-label="Activity series">
              {(['both', 'assigned', 'returned'] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={trend === value}
                  className={trend === value ? 'active' : ''}
                  onClick={() => setTrend(value)}
                >
                  {value === 'both' ? 'All' : value === 'assigned' ? 'Assignments' : 'Returns'}
                </button>
              ))}
            </div>
          </div>
          <div className="dc-trend-totals">
            <Link to={employee ? '/profile' : '/assignments'}>
              <i style={{ background: '#36877b' }} />
              <strong>{issued.toLocaleString()}</strong> assignments
              <ArrowUpRight size={12} />
            </Link>
            <Link to={employee ? '/profile' : '/returns'}>
              <i style={{ background: '#6483a8' }} />
              <strong>{received.toLocaleString()}</strong> returns
              <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="dc-chart" aria-label="Six-month asset assignment and return trend">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.assignmentTrend} margin={{ top: 10, right: 18, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#e7edf0" />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#627483', fontSize: 11 }}
                  tickMargin={12}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#627483', fontSize: 11 }}
                />
                <Tooltip contentStyle={{ border: '1px solid #dbe3e8', borderRadius: 5, fontSize: 12 }} />
                {trend !== 'returned' && (
                  <Area
                    isAnimationActive={false}
                    name="Assignments"
                    type="monotone"
                    dataKey="assigned"
                    stroke="#36877b"
                    strokeWidth={2}
                    fill="#36877b"
                    fillOpacity={0.09}
                  />
                )}
                {trend !== 'assigned' && (
                  <Area
                    isAnimationActive={false}
                    name="Returns"
                    type="monotone"
                    dataKey="returned"
                    stroke="#6483a8"
                    strokeWidth={2}
                    fill="#6483a8"
                    fillOpacity={0.03}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="dc-panel-footer">
            <span>Custody changes are retained in asset history.</span>
            <Link to={employee ? '/profile' : '/movements'}>
              Explore activity
              <ArrowRight size={13} />
            </Link>
          </div>
        </section>
        <section className="dc-panel dc-status-panel">
          <div className="dc-panel-head">
            <div>
              <h2>
                <Layers3 size={17} />
                Status distribution
              </h2>
              <p>Select a status to inspect its assets</p>
            </div>
          </div>
          {total ? (
            <div className="dc-status-content">
              <div className="dc-donut">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.statusDistribution}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={65}
                      paddingAngle={2}
                      stroke="none"
                      isAnimationActive={false}
                      onClick={(entry) => {
                        if (typeof entry.name === 'string')
                          navigate(`/assets?status=${encodeURIComponent(entry.name)}`);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      {data.statusDistribution.map((status) => (
                        <Cell key={status.name} fill={colors[status.name] ?? '#87939d'} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, label) => [value, human(label)]}
                      contentStyle={{ border: '1px solid #dbe3e8', borderRadius: 5, fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dc-donut-label">
                  <strong>{total.toLocaleString()}</strong>
                  <span>assets</span>
                </div>
              </div>
              <div className="dc-status-legend">
                {data.statusDistribution.map((status) => (
                  <Link key={status.name} to={`/assets?status=${status.name}`}>
                    <span>
                      <i style={{ background: colors[status.name] ?? '#87939d' }} />
                      {human(status.name)}
                    </span>
                    <strong>{status.value}</strong>
                    <small>{percentage(status.value, total)}</small>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              title="No assets yet"
              description={
                employee
                  ? 'Equipment assigned to you will appear here.'
                  : 'Register your first asset to start tracking inventory.'
              }
            />
          )}
          <div className="dc-panel-footer">
            <span>
              {data.damagedAssets} damaged · {data.retiredAssets + data.disposedAssets} retired or disposed
            </span>
            <Link to="/assets">
              Inventory
              <ArrowRight size={13} />
            </Link>
          </div>
        </section>
        <section className="dc-panel dc-activity-panel">
          <div className="dc-panel-head">
            <div>
              <h2>
                <Clock3 size={17} />
                Recent activity
              </h2>
              <p>Latest recorded changes to {employee ? 'your assets' : 'company assets'}</p>
            </div>
            <Link to={employee ? '/profile' : '/movements'} className="dc-text-link">
              View history
              <ChevronRight size={14} />
            </Link>
          </div>
          {data.recentActivity.length ? (
            <ol className="dc-activity-list">
              {data.recentActivity.slice(0, 6).map((event) => {
                const Icon = activityIcon(event.eventType);
                return (
                  <li key={event.id}>
                    <span
                      className={`dc-event-icon ${event.eventType.includes('LOST') || event.eventType.includes('DAMAG') ? 'dc-tone-rose' : ''}`}
                    >
                      <Icon size={16} />
                    </span>
                    <div className="dc-event-copy">
                      <div>
                        <Link to={employee ? '/profile' : `/assets/${event.assetId}`}>
                          {human(event.eventType.replace(/^ASSET_/, ''))}
                        </Link>
                        <time dateTime={event.timestamp} title={date(event.timestamp, true)}>
                          {ago(event.timestamp)}
                        </time>
                      </div>
                      <p>
                        <strong>{event.asset?.assetTag ?? 'Asset'}</strong>
                        {event.notes
                          ? ` · ${event.notes}`
                          : event.asset?.model
                            ? ` · ${event.asset.model}`
                            : ''}
                      </p>
                      <small>
                        {event.performedByName ? `By ${event.performedByName}` : 'Recorded in asset history'}
                      </small>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState
              title="No activity recorded"
              description="Assignments, returns, and asset updates will appear here."
            />
          )}
        </section>
        <section className="dc-panel dc-attention-panel">
          <div className="dc-panel-head">
            <div>
              <h2>
                <ClipboardList size={17} />
                Work queue
              </h2>
              <p>Follow up on the items that need action</p>
            </div>
          </div>
          <div className="dc-queue-list">
            <Link to="/requests">
              <span className="dc-queue-icon dc-tone-blue">
                <ClipboardList size={19} />
              </span>
              <div>
                <strong>Pending actions</strong>
                <small>
                  {employee ? 'Your requests awaiting completion' : 'Requests and employee offboarding'}
                </small>
              </div>
              <b>{data.pendingActions}</b>
              <ChevronRight size={15} />
            </Link>
            <Link to="/assets?status=DAMAGED">
              <span className="dc-queue-icon dc-tone-rose">
                <TriangleAlert size={19} />
              </span>
              <div>
                <strong>Damaged equipment</strong>
                <small>Review condition and next steps</small>
              </div>
              <b>{data.damagedAssets}</b>
              <ChevronRight size={15} />
            </Link>
            <Link to={employee ? '/assets' : '/reports?type=warranty'}>
              <span className="dc-queue-icon dc-tone-amber">
                <ShieldAlert size={19} />
              </span>
              <div>
                <strong>Warranty attention</strong>
                <small>Expiring in the configured window</small>
              </div>
              <b>{data.warrantiesExpiring}</b>
              <ChevronRight size={15} />
            </Link>
            {!employee && (
              <Link to="/offboarding">
                <span className="dc-queue-icon dc-tone-teal">
                  <CheckCircle2 size={19} />
                </span>
                <div>
                  <strong>Employee offboarding</strong>
                  <small>Review asset return checklists</small>
                </div>
                <ChevronRight size={15} />
              </Link>
            )}
          </div>
          <div className="dc-integrity-note">
            <CheckCircle2 size={15} />
            <span>Every handover keeps its complete history.</span>
          </div>
        </section>
        <section className="dc-panel dc-distribution-panel">
          <div className="dc-panel-head">
            <div>
              <h2>
                <Package size={17} />
                Assets by category
              </h2>
              <p>Composition of {employee ? 'your equipment' : 'the asset register'}</p>
            </div>
            <span className="dc-counter">{data.categoryDistribution.length} categories</span>
          </div>
          <div className="dc-distribution-list">
            {data.categoryDistribution.length ? (
              [...data.categoryDistribution]
                .sort((a, b) => b.value - a.value)
                .map((category) => (
                  <DistributionRow
                    key={category.name}
                    to={distributionLink('category', category.name)}
                    title={`View ${category.name} assets`}
                  >
                    <div>
                      <span>{category.name}</span>
                      <strong>
                        {category.value}
                        <small>{percentage(category.value, total)}</small>
                      </strong>
                    </div>
                    <span className="dc-proportion-track">
                      <i style={{ width: `${total ? (category.value / total) * 100 : 0}%` }} />
                    </span>
                  </DistributionRow>
                ))
            ) : (
              <p className="dc-empty-copy">Category totals appear when assets are registered.</p>
            )}
          </div>
        </section>
        {!employee && (
          <section className="dc-panel dc-distribution-panel">
            <div className="dc-panel-head">
              <div>
                <h2>
                  <Building2 size={17} />
                  Department custody
                </h2>
                <p>Currently assigned assets by department</p>
              </div>
              <Link className="dc-text-link" to="/employees">
                Employees
                <ChevronRight size={14} />
              </Link>
            </div>
            <div className="dc-distribution-list">
              {data.departmentDistribution.length ? (
                [...data.departmentDistribution]
                  .sort((a, b) => b.value - a.value)
                  .map((department) => {
                    const custodyTotal = data.departmentDistribution.reduce((sum, row) => sum + row.value, 0);
                    return (
                      <DistributionRow
                        key={department.name}
                        to={distributionLink('department', department.name)}
                        title={`View assets assigned in ${department.name}`}
                      >
                        <div>
                          <span>{department.name}</span>
                          <strong>
                            {department.value}
                            <small>{percentage(department.value, custodyTotal)}</small>
                          </strong>
                        </div>
                        <span className="dc-proportion-track dc-blue-track">
                          <i
                            style={{
                              width: `${custodyTotal ? (department.value / custodyTotal) * 100 : 0}%`,
                            }}
                          />
                        </span>
                      </DistributionRow>
                    );
                  })
              ) : (
                <p className="dc-empty-copy">Department totals appear after the first assignment.</p>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
