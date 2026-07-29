export type Role = "ADMIN" | "HR" | "TRAINER" | "INTERN" | "COLLEGE";

export const ROLE_HOME: Record<Role, string> = {
  ADMIN: "/admin/dashboard",
  HR: "/hr/dashboard",
  TRAINER: "/trainer/dashboard",
  INTERN: "/intern/dashboard",
  COLLEGE: "/college/dashboard",
};

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin Panel",
  HR: "HR Panel",
  TRAINER: "Trainer Panel",
  INTERN: "Intern Panel",
  COLLEGE: "College Panel",
};
