import { STATUS_LABEL, statusClass } from "../../lib/format";

export function Badge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusClass(status)}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}
