import { prisma } from "../config/db";

const TEXT_THRESHOLD = 70;

export function normalizeGithubUrl(url: string): string {
  const raw = url.trim().toLowerCase();
  if (!raw) return "";
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    let path = u.pathname.replace(/\/+$/, "");
    if (path.endsWith(".git")) path = path.slice(0, -4);
    return `${u.hostname}${path}`;
  } catch {
    return raw.replace(/\/+$/, "").replace(/\.git$/, "");
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

export function textSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : Math.round((inter / union) * 100);
}

function curriculumKey(task: { id: string; sourceLibraryId: string | null }) {
  return task.sourceLibraryId || task.id;
}

export type PlagiarismMatch = {
  internId: string;
  fullName: string;
  email: string;
  assignmentId: string;
  similarity: number;
  matchType: "GITHUB_URL" | "PROJECT_TEXT" | "BOTH";
  githubUrl: string;
};

export type PlagiarismFlag = {
  assignmentId: string;
  taskTitle: string;
  dayNumber: number;
  taskNumber: number;
  forDate: string;
  githubUrl: string;
  projectDetailsPreview: string;
  matches: PlagiarismMatch[];
  maxSimilarity: number;
};

export async function checkInternPlagiarism(internId: string, page = 1, limit = 20) {
  const myAssignments = await prisma.taskAssignment.findMany({
    where: { internId, submission: { isNot: null } },
    include: {
      submission: true,
      task: { select: { id: true, title: true, sourceLibraryId: true } },
    },
    orderBy: [{ forDate: "desc" }, { taskNumber: "asc" }],
  });

  if (!myAssignments.length) {
    return {
      summary: { totalFlags: 0, checkedSubmissions: 0 },
      flags: [] as PlagiarismFlag[],
      pagination: { page, limit, total: 0, totalPages: 0 },
    };
  }

  const curriculumIds = [...new Set(myAssignments.map((a) => curriculumKey(a.task)))];

  const peers = await prisma.taskAssignment.findMany({
    where: {
      internId: { not: internId },
      submission: { isNot: null },
      OR: [{ task: { sourceLibraryId: { in: curriculumIds } } }, { task: { id: { in: curriculumIds } } }],
    },
    include: {
      submission: true,
      task: { select: { id: true, title: true, sourceLibraryId: true } },
      intern: { include: { user: { select: { fullName: true, email: true } } } },
    },
  });

  const peersByCurriculum = new Map<string, typeof peers>();
  for (const p of peers) {
    const key = curriculumKey(p.task);
    const list = peersByCurriculum.get(key) || [];
    list.push(p);
    peersByCurriculum.set(key, list);
  }

  const allFlags: PlagiarismFlag[] = [];

  for (const mine of myAssignments) {
    if (!mine.submission) continue;
    const key = curriculumKey(mine.task);
    const candidates = peersByCurriculum.get(key) || [];
    const myGh = normalizeGithubUrl(mine.submission.githubUrl);
    const matches: PlagiarismMatch[] = [];

    for (const peer of candidates) {
      if (!peer.submission) continue;
      const peerGh = normalizeGithubUrl(peer.submission.githubUrl);
      const ghMatch = myGh.length > 0 && peerGh.length > 0 && myGh === peerGh;
      const textSim = textSimilarity(mine.submission.projectDetails, peer.submission.projectDetails);
      const textMatch = textSim >= TEXT_THRESHOLD;

      if (!ghMatch && !textMatch) continue;

      let matchType: PlagiarismMatch["matchType"] = "PROJECT_TEXT";
      let similarity = textSim;
      if (ghMatch && textMatch) {
        matchType = "BOTH";
        similarity = 100;
      } else if (ghMatch) {
        matchType = "GITHUB_URL";
        similarity = 100;
      }

      matches.push({
        internId: peer.internId,
        fullName: peer.intern.user.fullName,
        email: peer.intern.user.email,
        assignmentId: peer.id,
        similarity,
        matchType,
        githubUrl: peer.submission.githubUrl,
      });
    }

    if (matches.length === 0) continue;

    matches.sort((a, b) => b.similarity - a.similarity);
    const preview = mine.submission.projectDetails.trim().slice(0, 160);
    allFlags.push({
      assignmentId: mine.id,
      taskTitle: mine.task.title,
      dayNumber: mine.dayNumber,
      taskNumber: mine.taskNumber,
      forDate: mine.forDate.toISOString().slice(0, 10),
      githubUrl: mine.submission.githubUrl,
      projectDetailsPreview: preview + (mine.submission.projectDetails.length > 160 ? "…" : ""),
      matches,
      maxSimilarity: matches[0]?.similarity ?? 0,
    });
  }

  allFlags.sort((a, b) => b.maxSimilarity - a.maxSimilarity);
  const total = allFlags.length;
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  const start = (page - 1) * limit;
  const flags = allFlags.slice(start, start + limit);

  return {
    summary: { totalFlags: total, checkedSubmissions: myAssignments.length },
    flags,
    pagination: { page, limit, total, totalPages },
  };
}
