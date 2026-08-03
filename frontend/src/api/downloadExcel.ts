import { api } from "./client";

/** Download an Excel file from an API path (blob response). Long timeout for full reports. */
export async function downloadExcel(path: string, fallbackFilename: string) {
  const res = await api.get(path, { responseType: "blob", timeout: 300_000 });
  const blob = new Blob([res.data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const disposition = res.headers["content-disposition"] as string | undefined;
  const match = disposition?.match(/filename="?([^"]+)"?/);
  a.download = match?.[1] || fallbackFilename;
  a.click();
  URL.revokeObjectURL(url);
}
