import { prisma } from "../config/db";

export async function computeInternPerformance(internId: string) {
  const [attendance, assignments] = await Promise.all([
    prisma.attendance.findMany({ where: { internId } }),
    prisma.taskAssignment.findMany({ where: { internId } }),
  ]);

  const present = attendance.filter((a) => a.status === "PRESENT").length;
  const counted = attendance.filter((a) => a.status !== "WEEK_OFF").length;
  const attendanceRate = counted === 0 ? 0 : (present / counted) * 100;

  const totalTasks = assignments.length;
  const done = assignments.filter((a) => a.status === "DONE").length;
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
    submittedTasks: assignments.filter((a) => a.status === "SUBMITTED").length,
    needsImprovement: assignments.filter((a) => a.status === "NEEDS_IMPROVEMENT").length,
  };
}
