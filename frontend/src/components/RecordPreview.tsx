import { ArrowRight, History, MapPin, Package, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useResource } from '../hooks/useResource';
import type { RecordData } from '../types';
import { date, holder, human, initials, warranty } from '../utils/format';
import { Badge, Details, ErrorState, Loading, SlideOver } from './ui';
import './record-preview.css';

type PreviewProps = { id: string; onClose: () => void };

export function AssetPreview({ id, onClose }: PreviewProps) {
  const resource = useResource<RecordData>(`/assets/${id}`);
  const asset = resource.data;
  const assignment = asset ? holder(asset) : undefined;
  return (
    <SlideOver
      title="Asset quick view"
      description="Equipment details and current accountability."
      onClose={onClose}
    >
      <div className="record-preview">
        {resource.loading ? (
          <Loading />
        ) : resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : (
          asset && (
            <>
              <div className="record-preview-identity">
                <span className="record-preview-symbol">
                  <Package size={27} aria-hidden="true" />
                </span>
                <div>
                  <span className="record-preview-kicker">{asset.category?.name ?? asset.assetType}</span>
                  <h3>{asset.assetTag}</h3>
                  <p>
                    {asset.manufacturer} {asset.model}
                  </p>
                </div>
                <Badge value={asset.status} />
              </div>
              <section className="record-preview-section" aria-label="Asset details">
                <h3>
                  <Package size={16} aria-hidden="true" />
                  Equipment
                </h3>
                <Details
                  items={[
                    ['Serial number', asset.serialNumber],
                    ['Asset type', asset.assetType],
                    ['Condition', human(asset.condition)],
                    ['Location', asset.location?.name],
                    ['Department', asset.department?.name],
                    ['Purchased', date(asset.purchaseDate)],
                    ['Warranty expires', date(asset.warrantyExpiry)],
                    ['Warranty coverage', warranty(asset.warrantyExpiry)],
                  ]}
                />
              </section>
              <section className="record-preview-section" aria-label="Current assignment">
                <h3>
                  <UserRound size={16} aria-hidden="true" />
                  Current accountability
                </h3>
                {assignment ? (
                  <>
                    <div className="record-preview-person">
                      <span className="avatar">{initials(assignment.employee?.name ?? '')}</span>
                      <div>
                        <strong>{assignment.employee?.name ?? 'Assigned employee'}</strong>
                        <small>{assignment.employee?.employeeId}</small>
                      </div>
                    </div>
                    <Details
                      items={[
                        ['Assigned on', date(assignment.assignedAt)],
                        ['Expected return', date(assignment.expectedReturnAt)],
                        ['Issue condition', human(assignment.conditionAtAssignment)],
                        ['Employee department', assignment.employee?.department?.name],
                      ]}
                    />
                  </>
                ) : (
                  <p className="record-preview-empty">
                    No active employee assignment. The full record preserves previous custody and service
                    history.
                  </p>
                )}
              </section>
              <div className="record-preview-footer">
                <Link className="btn primary" to={`/assets/${id}`} onClick={onClose}>
                  Open full record
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
            </>
          )
        )}
      </div>
    </SlideOver>
  );
}

export function EmployeePreview({ id, onClose }: PreviewProps) {
  const resource = useResource<RecordData>(`/employees/${id}`);
  const employee = resource.data;
  const assignments: RecordData[] = employee?.assignments ?? [];
  const current = assignments.filter((assignment) => !assignment.returnedAt);
  const previous = assignments.filter((assignment) => assignment.returnedAt);
  return (
    <SlideOver
      title="Employee quick view"
      description="Employee details and equipment in their care."
      onClose={onClose}
    >
      <div className="record-preview">
        {resource.loading ? (
          <Loading />
        ) : resource.error ? (
          <ErrorState message={resource.error} retry={resource.reload} />
        ) : (
          employee && (
            <>
              <div className="record-preview-identity">
                <span className="avatar record-preview-avatar">{initials(employee.name)}</span>
                <div>
                  <span className="record-preview-kicker">{employee.employeeId}</span>
                  <h3>{employee.name}</h3>
                  <p>{employee.designation ?? employee.department?.name ?? 'Team member'}</p>
                </div>
                <Badge value={employee.status} />
              </div>
              <div className="record-preview-counts" aria-label="Employee custody summary">
                <div>
                  <Package size={18} aria-hidden="true" />
                  <strong>{current.length}</strong>
                  <span>Current assets</span>
                </div>
                <div>
                  <History size={18} aria-hidden="true" />
                  <strong>{previous.length}</strong>
                  <span>Previous assignments</span>
                </div>
              </div>
              <section className="record-preview-section" aria-label="Employee details">
                <h3>
                  <UserRound size={16} aria-hidden="true" />
                  Employee information
                </h3>
                <Details
                  items={[
                    ['Email', <a href={`mailto:${employee.email}`}>{employee.email}</a>],
                    ['Department', employee.department?.name],
                    ['Location', employee.location?.name],
                    ['Reporting manager', employee.manager?.name],
                    ['Joined', date(employee.joinedAt)],
                  ]}
                />
              </section>
              <section className="record-preview-section" aria-label="Current employee assets">
                <h3>
                  <Package size={16} aria-hidden="true" />
                  Currently assigned assets<span className="count-pill">{current.length}</span>
                </h3>
                {current.length ? (
                  <ul className="record-preview-assets">
                    {current.slice(0, 4).map((assignment) => (
                      <li key={assignment.id}>
                        <span className="record-preview-asset-icon">
                          <Package size={19} aria-hidden="true" />
                        </span>
                        <div>
                          <strong>{assignment.asset?.assetTag}</strong>
                          <span>
                            {assignment.asset?.manufacturer} {assignment.asset?.model}
                          </span>
                          <small>
                            <MapPin size={12} aria-hidden="true" />
                            {assignment.asset?.location?.name ?? 'Location not recorded'}
                          </small>
                        </div>
                        <Badge value={assignment.asset?.status} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="record-preview-empty">No equipment is currently assigned to this employee.</p>
                )}
                {current.length > 4 && (
                  <p className="record-preview-more">
                    Showing 4 of {current.length} assets. Open the full record for the complete list.
                  </p>
                )}
              </section>
              <div className="record-preview-footer">
                <Link className="btn primary" to={`/employees/${id}`} onClick={onClose}>
                  Open full record
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
            </>
          )
        )}
      </div>
    </SlideOver>
  );
}
