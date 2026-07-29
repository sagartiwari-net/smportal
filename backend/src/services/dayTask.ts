import { prisma } from "../config/db";

/** UTC calendar date (no time) */
export function toDayDate(input: string | Date): Date {
  const d = typeof input === "string" ? new Date(input) : input;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Per-intern Day / Task numbering:
 * - Day N = chronological index of distinct forDates for that intern (1-based)
 * - Task M = order of assignments on that same forDate (1-based)
 *
 * Assumes dates are mostly assigned forward. If you insert an older date later,
 * day numbers for that date are computed from sorted unique dates (may differ
 * from previously stored numbers on other rows until recalculated).
 */
export async function computeDayAndTask(
  internId: string,
  forDate: Date,
): Promise<{ dayNumber: number; taskNumber: number }> {
  const existing = await prisma.taskAssignment.findMany({
    where: { internId },
    select: { forDate: true, dayNumber: true, taskNumber: true },
  });

  const target = dateKey(forDate);
  const onSameDay = existing.filter((e) => dateKey(e.forDate) === target);

  if (onSameDay.length > 0) {
    const dayNumber = onSameDay[0].dayNumber;
    const taskNumber = Math.max(...onSameDay.map((e) => e.taskNumber)) + 1;
    return { dayNumber, taskNumber };
  }

  const uniqueKeys = [...new Set(existing.map((e) => dateKey(e.forDate)))].sort();
  const allKeys = [...uniqueKeys, target].sort();
  const dayNumber = allKeys.indexOf(target) + 1;
  return { dayNumber, taskNumber: 1 };
}

export function displayLabel(dayNumber: number, taskNumber: number, title: string) {
  return `Day ${dayNumber} · Task ${taskNumber}: ${title}`;
}
