import { useAuth } from "./AuthProvider";

export interface Permissions {
  canViewCase: boolean;
  canCreateCase: boolean;
  canEditCase: boolean;
  canDeleteCase: boolean;
  canCreateMaster: boolean;
  canAssignCase: boolean;
  canManageUsers: boolean;
  canRecommendIC: boolean;
  canApproveIC: boolean;
}

const ROLE_PERMISSIONS: Record<string, Permissions> = {
  admin: {
    canViewCase: true,
    canCreateCase: true,
    canEditCase: true,
    canDeleteCase: true,
    canCreateMaster: true,
    canAssignCase: true,
    canManageUsers: true,
    canRecommendIC: true,
    canApproveIC: true,
  },
  analyst: {
    canViewCase: true,
    canCreateCase: true,
    canEditCase: true,
    canDeleteCase: false,
    canCreateMaster: true,
    canAssignCase: false,
    canManageUsers: false,
    canRecommendIC: true,
    canApproveIC: false,
  },
  business_development: {
    canViewCase: true,
    canCreateCase: true,
    canEditCase: false,
    canDeleteCase: false,
    canCreateMaster: true,
    canAssignCase: false,
    canManageUsers: false,
    canRecommendIC: false,
    canApproveIC: false,
  },
  ic_member: {
    canViewCase: true,
    canCreateCase: false,
    canEditCase: false,
    canDeleteCase: false,
    canCreateMaster: false,
    canAssignCase: false,
    canManageUsers: false,
    canRecommendIC: false,
    canApproveIC: false,
  },
  credit_committee: {
    canViewCase: true,
    canCreateCase: false,
    canEditCase: false,
    canDeleteCase: false,
    canCreateMaster: false,
    canAssignCase: false,
    canManageUsers: false,
    canRecommendIC: false,
    canApproveIC: true,
  },
  operations: {
    canViewCase: true,
    canCreateCase: false,
    canEditCase: false,
    canDeleteCase: false,
    canCreateMaster: false,
    canAssignCase: false,
    canManageUsers: false,
    canRecommendIC: false,
    canApproveIC: false,
  },
};

const NO_PERMISSIONS: Permissions = {
  canViewCase: false,
  canCreateCase: false,
  canEditCase: false,
  canDeleteCase: false,
  canCreateMaster: false,
  canAssignCase: false,
  canManageUsers: false,
  canRecommendIC: false,
  canApproveIC: false,
};

export function usePermissions(): Permissions {
  const { role } = useAuth();
  return role ? (ROLE_PERMISSIONS[role] ?? NO_PERMISSIONS) : NO_PERMISSIONS;
}
