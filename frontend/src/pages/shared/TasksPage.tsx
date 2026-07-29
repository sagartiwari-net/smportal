import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2, X } from "lucide-react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { Badge } from "../../components/ui/Badge";
import { PageHeader } from "../../components/ui/PageHeader";
import { formatDate } from "../../lib/format";

type Assignment = {
  id: string;
  status: string;
  forDate?: string;
  dayNumber?: number;
  taskNumber?: number;
  displayLabel?: string;
  task: { id: string; title: string; description: string; dueDate?: string | null };
  intern?: { id: string; user: { fullName: string; email: string } };
  submission?: {
    projectDetails: string;
    githubUrl: string;
    liveUrl?: string | null;
    feedbacks?: { comment: string; newStatus: string; reviewer?: { fullName: string } }[];
  } | null;
};

type LibraryTask = {
  id: string;
  title: string;
  description: string;
  _count?: { assignments: number };
};

export function TasksPage() {
  const { user } = useAuth();
  const isIntern = user?.role === "INTERN";
  const canAssign = user?.role === "ADMIN" || user?.role === "HR" || user?.role === "TRAINER";
  const canReview = canAssign;
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [library, setLibrary] = useState<LibraryTask[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [mode, setMode] = useState<"assign" | "save">("assign");
  const [libraryTaskId, setLibraryTaskId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [forDate, setForDate] = useState(new Date().toISOString().slice(0, 10));
  const [groupId, setGroupId] = useState("");
  const [alsoSave, setAlsoSave] = useState(false);
  const [formMsg, setFormMsg] = useState("");
  const [formErr, setFormErr] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [marking, setMarking] = useState<Record<string, boolean>>({});
  const [submitErr, setSubmitErr] = useState<Record<string, string>>({});
  const [submitForms, setSubmitForms] = useState<Record<string, { projectDetails: string; githubUrl: string; liveUrl: string }>>({});
  const [reviewForms, setReviewForms] = useState<Record<string, { comment: string; status: string }>>({});
  const [editingTask, setEditingTask] = useState<Assignment | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");

  async function load() {
    const { data } = await api.get("/tasks");
    setAssignments(data.assignments);
    if (canAssign) {
      const [g, lib] = await Promise.all([api.get("/groups"), api.get("/tasks/library")]);
      setGroups(g.data.groups);
      setLibrary(lib.data.tasks);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function label(a: Assignment) {
    if (a.displayLabel) return a.displayLabel;
    if (a.dayNumber && a.taskNumber) return `Day ${a.dayNumber} · Task ${a.taskNumber}: ${a.task.title}`;
    return a.task.title;
  }

  async function onStaffSubmit(e: FormEvent) {
    e.preventDefault();
    setFormMsg("");
    setFormErr("");
    try {
      if (mode === "save") {
        await api.post("/tasks/library", { title, description });
        setFormMsg("Saved to library — assign anytime to any group/date");
        setTitle("");
        setDescription("");
      } else if (libraryTaskId) {
        await api.post(`/tasks/${libraryTaskId}/assign`, { forDate, groupId: groupId || undefined });
        setFormMsg("Assigned from library");
      } else {
        await api.post("/tasks", {
          title,
          description,
          forDate,
          groupId: groupId || undefined,
          alsoSaveToLibrary: alsoSave,
        });
        setFormMsg("Task assigned");
        setTitle("");
        setDescription("");
      }
      await load();
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setFormErr(ax.response?.data?.message || "Failed");
    }
  }

  async function submitWork(id: string) {
    const form = submitForms[id];
    if (!form) {
      setSubmitErr((e) => ({ ...e, [id]: "Fill project details and GitHub URL" }));
      return;
    }
    setSubmitErr((e) => ({ ...e, [id]: "" }));
    try {
      await api.post(`/tasks/assignments/${id}/submit`, {
        projectDetails: form.projectDetails?.trim(),
        githubUrl: form.githubUrl?.trim(),
        liveUrl: form.liveUrl?.trim() || "",
      });
      setMarking((m) => ({ ...m, [id]: false }));
      await load();
    } catch (ex: unknown) {
      const ax = ex as { response?: { data?: { message?: string } } };
      setSubmitErr((e) => ({ ...e, [id]: ax.response?.data?.message || "Submit failed" }));
    }
  }

  async function review(id: string) {
    const form = reviewForms[id];
    if (!form?.comment) return;
    await api.post(`/tasks/assignments/${id}/review`, form);
    await load();
  }

  async function saveTaskEdit(e: FormEvent) {
    e.preventDefault();
    if (!editingTask) return;
    await api.patch(`/tasks/${editingTask.task.id}`, { title: editTitle, description: editDesc });
    setEditingTask(null);
    await load();
  }

  async function deleteTask(taskId: string) {
    if (!confirm("Delete this task for all assigned interns?")) return;
    await api.delete(`/tasks/${taskId}`);
    await load();
  }

  async function deleteAssignment(id: string) {
    if (!confirm("Remove this assignment for this intern only?")) return;
    await api.delete(`/tasks/assignments/${id}`);
    await load();
  }

  async function deleteLibrary(id: string) {
    if (!confirm("Delete this saved task from library?")) return;
    await api.delete(`/tasks/${id}`);
    await load();
  }

  return (
    <div>
      <PageHeader
        title={isIntern ? "My Tasks" : "Tasks"}
        subtitle={
          isIntern
            ? "Tap a task for details. Use Mark Task to submit."
            : "Save tasks to library, then assign to any group on any start date"
        }
      />

      {canAssign && (
        <form onSubmit={onStaffSubmit} className="mb-6 space-y-3 rounded-xl border bg-white p-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode("assign")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "assign" ? "bg-green-600 text-white" : "border bg-white"}`}
            >
              Assign now
            </button>
            <button
              type="button"
              onClick={() => setMode("save")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "save" ? "bg-green-600 text-white" : "border bg-white"}`}
            >
              Save to library
            </button>
          </div>

          {mode === "assign" && library.length > 0 && (
            <label className="block text-sm text-slate-600">
              From library (optional)
              <select
                className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"
                value={libraryTaskId}
                onChange={(e) => setLibraryTaskId(e.target.value)}
              >
                <option value="">— New task (fill title below) —</option>
                {library.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!libraryTaskId && (
            <>
              <input
                className="w-full rounded-lg border px-3 py-2.5 text-sm"
                placeholder="Task title (e.g. Landing Page)"
                required={mode === "save" || !libraryTaskId}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                className="w-full rounded-lg border px-3 py-2.5 text-sm"
                rows={3}
                placeholder="Description / requirements"
                required={mode === "save" || !libraryTaskId}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </>
          )}

          {mode === "assign" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-600">
                Assign for date
                <input
                  type="date"
                  required
                  className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"
                  value={forDate}
                  onChange={(e) => setForDate(e.target.value)}
                />
              </label>
              <label className="text-sm text-slate-600">
                Group
                <select
                  className="mt-1 w-full rounded-lg border px-3 py-2.5 text-sm"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  required
                >
                  <option value="">Select group…</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {mode === "assign" && !libraryTaskId && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={alsoSave} onChange={(e) => setAlsoSave(e.target.checked)} />
              Also save to library for reuse
            </label>
          )}

          <button className="w-full rounded-lg bg-green-600 px-4 py-2.5 text-sm text-white sm:w-auto">
            {mode === "save" ? "Save to library" : libraryTaskId ? "Assign from library" : "Assign task"}
          </button>
          {formMsg && <p className="text-sm text-green-700">{formMsg}</p>}
          {formErr && <p className="text-sm text-red-600">{formErr}</p>}
        </form>
      )}

      {canAssign && library.length > 0 && (
        <div className="mb-6 rounded-xl border bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Task library</h3>
          <ul className="space-y-2">
            {library.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-2 text-sm">
                <div>
                  <p className="font-medium">{t.title}</p>
                  <p className="line-clamp-1 text-xs text-slate-500">{t.description}</p>
                  <p className="text-xs text-slate-400">Assigned {t._count?.assignments ?? 0} time(s)</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className="rounded-lg border px-2 py-1 text-xs"
                    onClick={() => {
                      setMode("assign");
                      setLibraryTaskId(t.id);
                    }}
                  >
                    Assign
                  </button>
                  <button type="button" className="rounded-lg p-1 text-red-600 hover:bg-red-50" onClick={() => void deleteLibrary(t.id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {assignments.map((a) => {
          const open = !!expanded[a.id];
          const showMark = !!marking[a.id];
          return (
            <div key={a.id} className="rounded-xl border bg-white">
              <button
                type="button"
                className="flex w-full items-start justify-between gap-2 p-4 text-left"
                onClick={() => setExpanded((e) => ({ ...e, [a.id]: !e[a.id] }))}
              >
                <div className="flex min-w-0 items-start gap-2">
                  {open ? (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  ) : (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  )}
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900">{label(a)}</h3>
                    {!isIntern && a.intern && (
                      <p className="text-xs text-slate-500">
                        {a.intern.user.fullName} · {formatDate(a.forDate)}
                      </p>
                    )}
                    {isIntern && <p className="text-xs text-slate-400">For: {formatDate(a.forDate)}</p>}
                  </div>
                </div>
                <Badge status={a.status} />
              </button>

              {open && (
                <div className="space-y-3 border-t px-4 pb-4 pt-3">
                  <p className="whitespace-pre-wrap text-sm text-slate-600">{a.task.description}</p>
                  <p className="text-xs text-slate-400">Due: {formatDate(a.task.dueDate || a.forDate)}</p>

                  {canAssign && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium"
                        onClick={() => {
                          setEditingTask(a);
                          setEditTitle(a.task.title);
                          setEditDesc(a.task.description);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit task
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600"
                        onClick={() => void deleteAssignment(a.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove for intern
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600"
                        onClick={() => void deleteTask(a.task.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete task (all)
                      </button>
                    </div>
                  )}

                  {a.submission && (
                    <div className="rounded-lg bg-slate-50 p-3 text-sm">
                      <p className="font-medium">Submission</p>
                      <p className="mt-1 whitespace-pre-wrap text-slate-600">{a.submission.projectDetails}</p>
                      <p className="mt-2">
                        <a className="text-green-700 underline" href={a.submission.githubUrl} target="_blank" rel="noreferrer">
                          GitHub
                        </a>
                        {a.submission.liveUrl ? (
                          <>
                            {" "}
                            ·{" "}
                            <a className="text-green-700 underline" href={a.submission.liveUrl} target="_blank" rel="noreferrer">
                              Live
                            </a>
                          </>
                        ) : null}
                      </p>
                      {(a.submission.feedbacks || []).map((f, i) => (
                        <p key={i} className="mt-2 border-t pt-2 text-xs text-slate-600">
                          Feedback ({f.reviewer?.fullName || "Reviewer"}): {f.comment}
                        </p>
                      ))}
                    </div>
                  )}

                  {isIntern && a.status !== "DONE" && !showMark && (
                    <button
                      type="button"
                      className="rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMarking((m) => ({ ...m, [a.id]: true }));
                      }}
                    >
                      Mark Task
                    </button>
                  )}

                  {isIntern && a.status !== "DONE" && showMark && (
                    <div className="space-y-2 rounded-lg border border-green-100 bg-green-50/50 p-3" onClick={(e) => e.stopPropagation()}>
                      <p className="text-sm font-medium text-green-800">Submit your work</p>
                      <textarea
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        rows={3}
                        placeholder="Project details (min 5 characters)"
                        value={submitForms[a.id]?.projectDetails || ""}
                        onChange={(e) =>
                          setSubmitForms({
                            ...submitForms,
                            [a.id]: { ...(submitForms[a.id] || { githubUrl: "", liveUrl: "" }), projectDetails: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        placeholder="GitHub URL (https://github.com/...)"
                        value={submitForms[a.id]?.githubUrl || ""}
                        onChange={(e) =>
                          setSubmitForms({
                            ...submitForms,
                            [a.id]: { ...(submitForms[a.id] || { projectDetails: "", liveUrl: "" }), githubUrl: e.target.value },
                          })
                        }
                      />
                      <input
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        placeholder="Live URL (optional)"
                        value={submitForms[a.id]?.liveUrl || ""}
                        onChange={(e) =>
                          setSubmitForms({
                            ...submitForms,
                            [a.id]: { ...(submitForms[a.id] || { projectDetails: "", githubUrl: "" }), liveUrl: e.target.value },
                          })
                        }
                      />
                      {submitErr[a.id] && <p className="text-sm text-red-600">{submitErr[a.id]}</p>}
                      <div className="flex gap-2">
                        <button type="button" onClick={() => void submitWork(a.id)} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white">
                          Submit
                        </button>
                        <button type="button" onClick={() => setMarking((m) => ({ ...m, [a.id]: false }))} className="rounded-lg border px-4 py-2 text-sm">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {canReview && a.status === "SUBMITTED" && (
                    <div className="space-y-2 border-t pt-3">
                      <textarea
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        rows={2}
                        placeholder="Feedback / suggestions"
                        value={reviewForms[a.id]?.comment || ""}
                        onChange={(e) =>
                          setReviewForms({
                            ...reviewForms,
                            [a.id]: { ...(reviewForms[a.id] || { status: "DONE" }), comment: e.target.value },
                          })
                        }
                      />
                      <div className="flex flex-wrap gap-2">
                        <select
                          className="rounded-lg border px-3 py-2 text-sm"
                          value={reviewForms[a.id]?.status || "DONE"}
                          onChange={(e) =>
                            setReviewForms({
                              ...reviewForms,
                              [a.id]: { ...(reviewForms[a.id] || { comment: "" }), status: e.target.value },
                            })
                          }
                        >
                          <option value="DONE">Mark Done</option>
                          <option value="NEEDS_IMPROVEMENT">Needs improvement</option>
                        </select>
                        <button type="button" onClick={() => void review(a.id)} className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white">
                          Submit review
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {assignments.length === 0 && <p className="text-sm text-slate-500">No tasks yet.</p>}
      </div>

      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <form onSubmit={saveTaskEdit} className="w-full rounded-t-2xl bg-white p-5 sm:max-w-lg sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Edit task</h2>
              <button type="button" onClick={() => setEditingTask(null)} className="rounded-lg p-1 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <input className="mb-3 w-full rounded-lg border px-3 py-2.5 text-sm" required value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            <textarea className="mb-4 w-full rounded-lg border px-3 py-2.5 text-sm" rows={4} required value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
            <button type="submit" className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white">
              Save
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
