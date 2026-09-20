import type { RecordData, Role } from '../types';
import { holder } from '../utils/format';

/** Mirror the supported server transitions; the API remains authoritative. */
export function statusTargets(asset: RecordData, role: Role = 'ADMIN') {
  if (asset.deletedAt || role === 'EMPLOYEE') return [];
  const transitions: Record<string, string[]> = {
    AVAILABLE: ['DAMAGED', 'LOST', 'RETIRED'],
    ASSIGNED: ['DAMAGED', 'LOST'],
    DAMAGED: holder(asset) ? ['LOST'] : ['AVAILABLE', 'LOST', 'RETIRED'],
    LOST: ['AVAILABLE', 'DISPOSED'],
    RETIRED: ['DISPOSED'],
    UNDER_REPAIR: [],
    DISPOSED: [],
  };
  return (transitions[asset.status] ?? []).filter(
    (target) => role === 'ADMIN' || (asset.status !== 'LOST' && target !== 'DISPOSED'),
  );
}

export function commonAssetActions(assets: RecordData[], role: Role) {
  const editable = role !== 'EMPLOYEE' && assets.length > 0 && assets.every((asset) => !asset.deletedAt);
  return {
    assign: editable && assets.every((asset) => asset.status === 'AVAILABLE' && !holder(asset)),
    move: editable,
    statuses: editable
      ? statusTargets(assets[0], role).filter((target) =>
          assets.every((asset) => statusTargets(asset, role).includes(target)),
        )
      : [],
  };
}
