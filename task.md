# SMM Internship Portal — Task Tracker

> Local pe pehle complete → baad mein server push.  
> Har item complete hone par `[ ]` ko `[x]` karo.

**Last updated:** 2026-07-23

---

## Progress summary

| Phase | Done | Total | Progress |
|-------|------|-------|----------|
| Phase 0 — Docs | 2 | 2 | 100% |
| Phase 1 — Foundation | 13 | 13 | 100% |
| Phase 2 — Groups + Interns | 9 | 9 | 100% |
| Phase 3 — Tasks + Review | 11 | 11 | 100% |
| Phase 4 — Attendance | 6 | 6 | 100% |
| Phase 5 — Analytics | 9 | 9 | 100% |
| Phase 6 — Polish (backlog) | 0 | 6 | 0% |
| **Overall** | **50** | **56** | **~89%** |

---

## Phase 0 — Docs

- [x] `docs/TECH_AND_APPROACH.md` create
- [x] `task.md` create — ticks + % tracking

---

## Phase 1 — Foundation (local)

- [x] Repo scaffold: `frontend/` (Vite + React + TS + Tailwind)
- [x] Repo scaffold: `backend/` (Express + TS)
- [x] Prisma + MySQL schema (User, Role enum, profiles, College); `.env.example`
- [x] Root `README.md` (local run steps)
- [x] Auth API: login, logout, me
- [x] JWT httpOnly cookie
- [x] RBAC middleware (`requireAuth`, `requireRole`)
- [x] Single `/login` page
- [x] Role redirect after login
- [x] Protected route guards on frontend
- [x] Empty role dashboard shells + shared sidebar layout
- [x] Seed script: demo users
- [x] Update `TECH_AND_APPROACH.md` for Phase 1

---

## Phase 2 — Groups + Interns

- [x] College entity + CRUD (HR)
- [x] Intern profile linked to college
- [x] Trainer / College profiles
- [x] HR: create users with role
- [x] TrainingGroup CRUD
- [x] Group members add/remove (any college)
- [x] One active group rule + membership history
- [x] Trainer: see own groups
- [x] Update `TECH_AND_APPROACH.md`

---

## Phase 3 — Tasks + Review

- [x] Task create (title, description, due date)
- [x] Assign: whole group
- [x] Assign: multi-select interns (API supports `internIds`)
- [x] Assign: single intern (via `internIds`)
- [x] Intern: task list + status badges
- [x] Intern submit: project details + GitHub URL + live URL
- [x] Status flow: Assigned → Submitted → Done / NeedsImprovement
- [x] Trainer/HR review queue
- [x] Feedback / suggestions on review
- [x] Intern resubmit after NeedsImprovement
- [x] Update `TECH_AND_APPROACH.md`

---

## Phase 4 — Attendance

- [x] Attendance mark UI (HR / Trainer)
- [x] Statuses: Present / Absent / Leave / Week off
- [x] Intern: my attendance view + filter
- [x] College: attendance for own college students
- [x] Dashboard attendance summary widgets
- [x] Update `TECH_AND_APPROACH.md`

---

## Phase 5 — Analytics + reports

- [x] Performance score v1 (`0.5*attendance + 0.5*taskCompletion`)
- [x] College: individual + list performance view
- [x] College: college-wide aggregates
- [x] Charts (ECharts interactive dashboard; Recharts replaced)
- [x] HR / Trainer analytics
- [x] CSV export
- [x] Print-friendly report page
- [x] Rich demo seed (`npm run db:seed-demo`) for reports testing
- [x] Update `TECH_AND_APPROACH.md`

---

## Phase 6 — Polish (backlog — aage badhane ke liye)

- [ ] Native worksheets
- [ ] In-app notifications
- [ ] Leave request + approve
- [ ] Internship completion certificate
- [ ] Trainer numeric rubric scoring
- [ ] Server deploy (production MySQL 3306 + phpMyAdmin)

---

## Local run

```bash
bash scripts/start-local-mysql.sh
cd backend && npm run dev
cd frontend && npm run dev
```

- App: http://localhost:5173  
- Demo password: `password123`  
  `admin@smm.local` · `hr@smm.local` · `trainer@smm.local` · `intern@smm.local` · `college@smm.local`  
  Extra interns: `intern1@smm.local` … `intern15@smm.local` (after `npm run db:seed-demo`)
