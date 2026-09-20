import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Loader2, Package, ShieldCheck } from 'lucide-react';
import type { Lookups, RecordData } from '../types';
import { RecordForm } from './RecordForm';
import type { Field } from './RecordForm';
import { Details, ErrorState, Loading, SlideOver } from './ui';
import { AssetTypeIcon } from './AssetConsoleTools';
import { date, holder, human, initials } from '../utils/format';
import { errorMessage } from '../services/api';

export function AssetCustodyFlow({
  asset,
  operation,
  fields,
  lookups,
  loading,
  error,
  reload,
  onClose,
  onCommit,
}: {
  asset: RecordData;
  operation: 'assign' | 'transfer' | 'return';
  fields: Field[];
  lookups?: Lookups;
  loading: boolean;
  error: string;
  reload: () => void;
  onClose: () => void;
  onCommit: (values: RecordData) => Promise<void>;
}) {
  const [step, setStep] = useState(operation === 'assign' ? 'recipient' : 'details');
  const [draft, setDraft] = useState<RecordData>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [accessories, setAccessories] = useState<string[]>([]);
  const current = holder(asset);
  const recipient = lookups?.employees.find((e) => e.id === draft.employeeId);
  const title =
    operation === 'assign' ? 'Assign asset' : operation === 'transfer' ? 'Transfer asset' : 'Return asset';
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setFailure('');
    try {
      await onCommit(draft);
    } catch (e) {
      setFailure(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const steps =
    operation === 'assign'
      ? ['Asset', 'Employee', 'Details', 'Confirm']
      : operation === 'transfer'
        ? ['Asset', 'Transfer details', 'Confirm']
        : ['Asset', 'Return details'];
  const activeStep =
    operation === 'assign'
      ? step === 'recipient'
        ? 1
        : step === 'details'
          ? 2
          : 3
      : step === 'details'
        ? 1
        : 2;
  return (
    <SlideOver
      title={title}
      description={`${asset.assetTag} · ${asset.manufacturer} ${asset.model}`}
      busy={busy}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="asset-custody-flow">
        <div className="asset-stepper" aria-label={`Workflow step ${activeStep + 1} of ${steps.length}`}>
          {steps.map((label, index) => (
            <span className={index < activeStep ? 'done' : index === activeStep ? 'active' : ''} key={label}>
              <i>{index < activeStep ? <Check size={12} /> : index + 1}</i>
              {label}
            </span>
          ))}
        </div>
        <div className="asset-operation-card">
          <span>
            <AssetTypeIcon asset={asset} size={22} />
          </span>
          <div>
            <strong>{asset.assetTag}</strong>
            <small>
              {asset.manufacturer} {asset.model} · {asset.serialNumber ?? 'No serial number'}
            </small>
          </div>
        </div>
        {current && step !== 'review' && (
          <div className="context-strip">
            <span>Current holder</span>
            <strong>{current.employee?.name ?? 'Assigned employee'}</strong>
          </div>
        )}
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} retry={reload} />
        ) : step === 'review' ? (
          <div className="asset-custody-review">
            <h3>Confirm the handover</h3>
            <div className="asset-handover-flow">
              <div className="asset-handover-person">
                <small>{operation === 'assign' ? 'From inventory' : 'Current holder'}</small>
                <span className="avatar">
                  {operation === 'assign' ? <Package size={19} /> : initials(current?.employee?.name ?? '?')}
                </span>
                <strong>
                  {operation === 'assign'
                    ? (asset.location?.name ?? 'Available inventory')
                    : (current?.employee?.name ?? 'Current employee')}
                </strong>
                <span>{operation === 'assign' ? asset.assetTag : current?.employee?.employeeId}</span>
              </div>
              <ArrowRight size={23} />
              <div className="asset-handover-person">
                <small>New holder</small>
                <span className="avatar">{initials(recipient?.name ?? '?')}</span>
                <strong>{recipient?.name}</strong>
                <span>{recipient?.employeeId}</span>
              </div>
            </div>
            <Details
              items={[
                ['Asset', asset.assetTag],
                ['New holder', recipient?.name],
                [
                  'Handover date',
                  draft.assignedAt || draft.transferredAt
                    ? date(draft.assignedAt ?? draft.transferredAt, true)
                    : 'Current time',
                ],
                ...(operation === 'assign'
                  ? ([
                      ['Expected return', date(draft.expectedReturnAt)],
                      ['Condition', human(draft.condition ?? asset.condition)],
                    ] as [string, React.ReactNode][])
                  : ([['Reason', draft.reason]] as [string, React.ReactNode][])),
                ['Notes', draft.notes],
              ]}
            />
            <div className="asset-callout">
              <ShieldCheck size={18} />
              <p>
                {operation === 'assign'
                  ? 'A new assignment will be created and the asset will be marked assigned.'
                  : 'The current assignment will be closed and a new assignment created. Previous custody remains in the timeline.'}
              </p>
            </div>
            {failure && (
              <div className="inline-error" role="alert">
                {failure}
              </div>
            )}
            <div className="form-actions">
              <button className="btn secondary" disabled={busy} onClick={() => setStep('details')}>
                <ArrowLeft size={15} />
                Back
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void confirm()}>
                {busy ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} {title}
              </button>
            </div>
          </div>
        ) : (
          <>
            <RecordForm
              key={step}
              initial={draft}
              fields={
                operation === 'assign'
                  ? step === 'recipient'
                    ? fields.filter((f) => f.name === 'employeeId')
                    : fields.filter((f) => f.name !== 'employeeId')
                  : fields
              }
              onCancel={() => {
                if (!busy) onClose();
              }}
              submitLabel={
                operation === 'assign'
                  ? step === 'recipient'
                    ? 'Continue to details'
                    : 'Review assignment'
                  : operation === 'transfer'
                    ? 'Review transfer'
                    : 'Return asset'
              }
              onSubmit={async (values) => {
                const next = { ...draft, ...values };
                if (operation === 'return') {
                  const entered = String(values.accessories ?? '')
                    .split(',')
                    .map((v) => v.trim())
                    .filter(Boolean);
                  next.accessories = Array.from(new Set([...accessories, ...entered])).join(',');
                  setBusy(true);
                  try {
                    await onCommit(next);
                  } finally {
                    setBusy(false);
                  }
                  return;
                }
                setDraft(next);
                setFailure('');
                setStep(operation === 'assign' && step === 'recipient' ? 'details' : 'review');
              }}
            >
              {operation === 'assign' && step === 'details' && (
                <button type="button" className="text-link" onClick={() => setStep('recipient')}>
                  <ArrowLeft size={14} />
                  Change employee
                </button>
              )}
              {operation === 'return' && (
                <div className="asset-accessories">
                  <strong>Common accessories</strong>
                  <div>
                    {['Charger', 'Laptop bag', 'Mouse', 'Keyboard', 'Dock'].map((label) => (
                      <label key={label}>
                        <input
                          type="checkbox"
                          checked={accessories.includes(label)}
                          onChange={(e) =>
                            setAccessories((items) =>
                              e.target.checked ? [...items, label] : items.filter((i) => i !== label),
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </RecordForm>
            {operation === 'return' && (
              <p className="dialog-footnote">
                Returning the asset closes its current assignment. Damaged or unusable equipment is marked
                damaged for follow-up; other returned assets become available.
              </p>
            )}
            {operation === 'assign' && step === 'recipient' && (
              <p className="dialog-footnote">
                Only active employees are available for assignment. Existing asset history will remain
                unchanged.
              </p>
            )}
          </>
        )}
      </div>
    </SlideOver>
  );
}
