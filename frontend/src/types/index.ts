export type Role = 'ADMIN' | 'ASSET_MANAGER' | 'EMPLOYEE';
export type RecordData = Record<string, any>;
export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  employeeId?: string;
  employee?: RecordData;
  mustChangePassword?: boolean;
};
export type Meta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  unreadCount?: number;
};
export type ApiResponse<T> = { success: boolean; data: T; message?: string; meta?: Meta };
export type Lookup = { id: string; name: string; employeeId?: string; status?: string; active?: boolean };
export type Lookups = {
  categories: Lookup[];
  departments: Lookup[];
  locations: Lookup[];
  employees: Lookup[];
};
export const STATUSES = ['AVAILABLE', 'ASSIGNED', 'UNDER_REPAIR', 'DAMAGED', 'LOST', 'RETIRED', 'DISPOSED'];
export const CONDITIONS = ['NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'DAMAGED', 'UNUSABLE'];
export const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED', 'INACTIVE'];
