export const ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "MANAGER",
  "WAREHOUSE_MANAGER",
  "WAREHOUSE_EMPLOYEE",
  "TRUCK_TECH",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MANAGER: "Manager",
  WAREHOUSE_MANAGER: "Warehouse Manager",
  WAREHOUSE_EMPLOYEE: "Warehouse Employee",
  TRUCK_TECH: "Truck Tech",
};

export function canManageUsers(role?: string | null) {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

export function canManageTrucksAndLimits(role?: string | null) {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "MANAGER";
}

export function canReviewJustifications(role?: string | null) {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "MANAGER";
}

export function canRunReports(role?: string | null) {
  return (
    role === "SUPER_ADMIN" ||
    role === "ADMIN" ||
    role === "MANAGER" ||
    role === "WAREHOUSE_MANAGER"
  );
}

// Besides the super admin (always allowed), only MAX_DESIGNATED_RECEIVERS
// people can be flagged to receive warehouse parts at a time. Enforced in
// app/api/users/[id]/route.ts when the flag is toggled on.
export const MAX_DESIGNATED_RECEIVERS = 2;

export function canReceiveWarehouseStock(role?: string | null, canReceiveParts?: boolean | null) {
  return role === "SUPER_ADMIN" || !!canReceiveParts;
}

export function canCheckoutToTruck(role?: string | null) {
  return role === "SUPER_ADMIN" || role === "ADMIN" || role === "TRUCK_TECH";
}

export function canEditParts(role?: string | null) {
  return (
    role === "SUPER_ADMIN" ||
    role === "ADMIN" ||
    role === "MANAGER" ||
    role === "WAREHOUSE_MANAGER"
  );
}

export function isSuperAdmin(role?: string | null) {
  return role === "SUPER_ADMIN";
}
