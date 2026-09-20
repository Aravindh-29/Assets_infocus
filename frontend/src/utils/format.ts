export const human = (value: unknown) =>
  String(value ?? '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
export const date = (value: unknown, includeTime = false) =>
  value
    ? new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
      }).format(new Date(String(value)))
    : '—';
export const money = (value: unknown) =>
  value === undefined || value === null
    ? '—'
    : new Intl.NumberFormat('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        Number(value),
      );
export const initials = (value: string) =>
  value
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
export function warranty(expiry?: string) {
  if (!expiry) return 'Not recorded';
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000);
  return days < 0 ? 'Expired' : days <= 30 ? 'Expiring soon' : 'Active';
}
export function holder(asset: any) {
  return asset.currentAssignment ?? asset.assignments?.find((a: any) => !a.returnedAt);
}
export function clean(
  values: Record<string, any>,
  dateFields: string[] = [],
  numberFields: string[] = [],
  emptyToNull = false,
) {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, v]) => v !== undefined && (v !== '' || emptyToNull))
      .map(([k, v]) => [
        k,
        v === '' && emptyToNull
          ? null
          : dateFields.includes(k) && v
            ? new Date(v).toISOString()
            : numberFields.includes(k) && v !== null
              ? Number(v)
              : v,
      ]),
  );
}
