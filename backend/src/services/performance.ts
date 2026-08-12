import { prisma } from "../config/db";
import { dedupeAssignmentsByIdentity } from "./groupTaskSync";

export async function computeInternPerformance(internId: string) {
  const [attendance, assignments] = await Promise.all([
    prisma.attendance.findMany({ where: { internId } }),
    prisma.taskAssignment.findMany({
      where: { internId },
      include: {
        task: { select: { id: true, title: true, sourceLibraryId: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const present = attendance.filter((a) => a.status === "PRESENT").length;
  const counted = attendance.filter((a) => a.status !== "WEEK_OFF").length;
  const attendanceRate = counted === 0 ? 0 : (present / counted) * 100;

  // Same curriculum task in multiple groups counts once for overall score
  const unique = dedupeAssignmentsByIdentity(assignments);
  const totalTasks = unique.length;
  const done = unique.filter((a) => a.status === "DONE").length;
  const taskCompletionRate = totalTasks === 0 ? 0 : (done / totalTasks) * 100;

  const score = Math.round(0.5 * attendanceRate + 0.5 * taskCompletionRate);

  return {
    internId,
    attendanceRate: Math.round(attendanceRate),
    taskCompletionRate: Math.round(taskCompletionRate),
    score,
    present,
    absent: attendance.filter((a) => a.status === "ABSENT").length,
    leave: attendance.filter((a) => a.status === "LEAVE").length,
    totalTasks,
    doneTasks: done,
    submittedTasks: unique.filter((a) => a.status === "SUBMITTED").length,
    needsImprovement: unique.filter((a) => a.status === "NEEDS_IMPROVEMENT").length,
  };
}
