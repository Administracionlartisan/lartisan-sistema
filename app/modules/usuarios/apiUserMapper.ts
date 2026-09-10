import { defaultActionPermissions } from "../shared/constants";
import type { ApiUser, ManagedUser } from "../shared/types";

const parseStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

export function managedUserFromApi(profile: ApiUser): ManagedUser {
  const name = profile.fullName || profile.full_name || profile.username;
  const parsedLocations = typeof profile.assigned_locations === "string"
    ? (() => {
        try {
          const parsed = JSON.parse(profile.assigned_locations);
          return Array.isArray(parsed) ? parsed.filter((site): site is string => typeof site === "string") : [];
        } catch {
          return [];
        }
      })()
    : [];
  const accessAllLocations = Boolean(profile.accessAllLocations ?? profile.access_all_locations);
  return {
    id: String(profile.id),
    name,
    username: profile.username,
    password: "",
    role: profile.role,
    location: profile.assignedLocation || profile.assigned_location || undefined,
    locations: Array.isArray(profile.assignedLocations)
      ? profile.assignedLocations
      : parsedLocations.length
        ? parsedLocations
        : profile.assigned_location
          ? [profile.assigned_location]
          : profile.assignedLocation
            ? [profile.assignedLocation]
            : [],
    accessAllLocations,
    active: profile.active === undefined ? true : Boolean(profile.active),
    mfaRequired: Boolean(profile.mfaRequired ?? profile.mfa_required),
    reportPermissions: profile.reportPermissions != null || profile.report_permissions != null
      ? parseStringArray(profile.reportPermissions ?? profile.report_permissions)
      : [],
    actionPermissions: profile.actionPermissions != null || profile.action_permissions != null
      ? parseStringArray(profile.actionPermissions ?? profile.action_permissions)
      : defaultActionPermissions(profile.role),
    primary: Boolean(profile.primary),
    mustChangePassword: Boolean(profile.mustChangePassword ?? profile.must_change_password),
  };
}
