export function formatDate(value?: string | Date | null) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: "Assigned",
  SUBMITTED: "Submitted",
  NEEDS_IMPROVEMENT: "Needs improvement",
  DONE: "Done",
  PRESENT: "Present",
  ABSENT: "Absent",
  LEAVE: "Leave",
  WEEK_OFF: "Week off",
};

export function statusClass(status: string) {
  switch (status) {
    case "DONE":
    case "PRESENT":
      return "bg-green-100 text-green-800";
    case "SUBMITTED":
      return "bg-blue-100 text-blue-800";
    case "NEEDS_IMPROVEMENT":
    case "ABSENT":
      return "bg-red-100 text-red-800";
    case "ASSIGNED":
    case "LEAVE":
    case "WEEK_OFF":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}
