# SMM Portal — Tech & Approach Log

> Living document. Har naya package / feature add hote hi yahan update karo: **kya**, **kyun**, **kahan**, **kaise**.

Last updated: 2026-07-23 (Phases 1–5 complete)

---

## 1. Stack overview

| Layer | Technology | Why |
|-------|------------|-----|
| Language | **TypeScript** | FE + BE ek language; roles/status enums type-safe; company handoff clear |
| Frontend | React 19 + Vite + Tailwind v4 + React Router | Fast SPA dashboards; role-based route trees |
| Backend | Node.js + Express 5 (TypeScript) | REST APIs; JWT + RBAC middleware |
| Database | **MySQL 8** + **Prisma 7** + `@prisma/adapter-mariadb` | Relational data; phpMyAdmin-compatible; company-friendly |
| Auth | JWT in httpOnly cookie + `role` claim | Single login; token not in localStorage |
| Charts | **Apache ECharts** + `echarts-for-react` | Interactive analytics (gauge, donut, radar, heatmap, zoom) |
| Export | CSV + print CSS (Phase 5) | College reports |

### MongoDB vs MySQL (decision record)

- **Locked: MySQL + Prisma** for company delivery (joins, reports, phpMyAdmin, familiar skill).
- App language remains TypeScript/Node — not PHP.

### Local MySQL note

Machine pe pehle se system MySQL `:3306` chal raha tha (root password locked). Local SMM DB:

- Script: `scripts/start-local-mysql.sh`
- Datadir: `/tmp/smm-mysql-data`
- Port: **3307**
- User: `root` (empty password)
- DB: `smm_portal`

Production/company pe normal `3306` + phpMyAdmin use hoga; sirf `.env` badlega.

---

## 2. Packages & modules

### Backend

| Package | Why | Where | How |
|---------|-----|-------|-----|
| `express` | HTTP API | `backend/src/app.ts`, `routes/` | REST `/api/*` |
| `prisma` / `@prisma/client` | ORM + migrate/push | `prisma/schema.prisma`, `src/generated/prisma` | `db:generate`, `db:push`, `db:seed` |
| `@prisma/adapter-mariadb` + `mariadb` | Prisma 7 MySQL driver adapter | `src/config/db.ts` | `new PrismaMariaDb(DATABASE_URL)` |
| `bcryptjs` | Password hashing | `src/utils/password.ts`, seed | cost 10 hash/compare |
| `jsonwebtoken` | Session JWT | `src/utils/jwt.ts` | `{ userId, role }` signed |
| `cookie-parser` | Read auth cookie | `app.ts` | `COOKIE_NAME` (default `smm_token`) |
| `cors` | FE credentials | `app.ts` | `origin: FRONTEND_URL`, `credentials: true` |
| `dotenv` | Env load | `env.ts`, `prisma.config.ts` | `.env` |
| `zod` | Env + login body validation | `config/env.ts`, `auth.routes.ts` | parse before use |
| `tsx` | TS run/watch | `npm run dev`, seed | no build step in dev |

### Frontend

| Package | Why | Where | How |
|---------|-----|-------|-----|
| `react` / `react-dom` | UI | `frontend/src` | Components |
| `react-router-dom` | Client routes | `App.tsx` | `/login`, role trees |
| `axios` | API + cookies | `src/api/client.ts` | `withCredentials: true`, base `/api` |
| `tailwindcss` + `@tailwindcss/vite` | Styling | `index.css`, components | Utility classes |
| `lucide-react` | Icons | login, sidebar | Mail, Lock, LayoutGrid, LogOut |
| Vite proxy | Avoid CORS in dev | `vite.config.ts` | `/api` → `localhost:4000` |

---

## 3. Feature approaches

### 3.1 Single login + RBAC

**Approach:** Ek hi `/login`. Alag role login pages nahi.

1. `POST /api/auth/login` → verify password → set httpOnly cookie  
2. JWT payload: `{ userId, role }`  
3. Frontend redirect via `ROLE_HOME[role]`  
4. Backend: `requireAuth` + `requireRole(...)`  
5. Frontend: `<ProtectedRoute roles={[…]}>`  

**Files:**  
`backend/src/routes/auth.routes.ts`, `middleware/auth.ts`  
`frontend/src/pages/login/LoginPage.tsx`, `auth/ProtectedRoute.tsx`, `lib/roles.ts`

**Status:** Done (Phase 1)

---

### 3.2 Users & roles

**Approach:** `User.role` enum (`HR|TRAINER|INTERN|COLLEGE`). Profiles: `InternProfile`, `TrainerProfile`, `CollegeProfile`. `College` entity linked to intern + college-login profiles.

**Files:** `backend/prisma/schema.prisma`, `prisma/seed.ts`

**Status:** Schema + seed done; HR create-user API = Phase 2

---

### 3.3 Groups (training cohorts)

**Status:** Done (Phase 2)

---

### 3.4 Tasks + submission + review

**Status:** Done (Phase 3)

---

### 3.5 Attendance

**Status:** Done (Phase 4)

---

### 3.6 College analytics & auto performance

**Status:** Done (Phase 5)  
Score v1: `0.5 * attendanceRate + 0.5 * taskCompletionRate`

---

## 4. Folder map

```
SmmPortal/
  frontend/src/
    pages/login|hr|trainer|intern|college/
    components/layout/DashboardLayout.tsx
    api/client.ts
    auth/AuthContext.tsx, ProtectedRoute.tsx
    lib/roles.ts
  backend/src/
    config/env.ts, db.ts
    middleware/auth.ts
    routes/auth.routes.ts, health.routes.ts
    utils/jwt.ts, password.ts
    generated/prisma/   # prisma generate output (gitignored)
  scripts/start-local-mysql.sh
  docs/TECH_AND_APPROACH.md
  task.md
```

---

## 5. Update checklist (har phase ke baad)

- [x] Phase 1 packages listed
- [ ] Phase 2 groups approach
- [ ] Phase 3 tasks approach
- [ ] Phase 4 attendance approach
- [ ] Phase 5 analytics packages (recharts, etc.)

---

## 6. Change log

| Date | Change |
|------|--------|
| 2026-07-23 | Initial plan lock |
| 2026-07-23 | Phase 1: scaffold, MySQL/Prisma, single login RBAC, seed, local MySQL :3307 |


---

## 7. Phase 2–5 implementation notes (2026-07-23)

### Groups
- Models: `TrainingGroup`, `GroupMember` (`isActive` + `leftAt` for history)
- One active group: before add, previous active memberships closed
- Routes: `GET/POST /api/groups`, `POST /api/groups/:id/members`
- UI: `frontend/src/pages/shared/GroupsPage.tsx`

### Users & colleges
- `POST /api/users` (HR) creates role + profile
- `POST /api/colleges` (HR)
- UI: `HrUsersPage`, `HrCollegesPage`

### Tasks & review
- Models: `Task`, `TaskAssignment`, `Submission`, `Feedback`
- Status enum: ASSIGNED → SUBMITTED → DONE | NEEDS_IMPROVEMENT
- Routes: `/api/tasks`, submit, review
- UI: `TasksPage` (shared across roles)

### Attendance
- Model: `Attendance` unique `(internId, date)`
- `POST /api/attendance/mark` batch upsert
- UI: `AttendancePage`

### Analytics
- Service: `src/services/performance.ts`
- Score: `0.5 * attendanceRate + 0.5 * taskCompletionRate`
- `GET /api/analytics/interns` role-scoped
- `GET /api/analytics/dashboard` — chart aggregates (task status, attendance trend, by college/group, top interns)
- UI: ECharts interactive dashboard + CSV + print (`AnalyticsPage`)
- Packages: `echarts`, `echarts-for-react`
- Demo data: `npm run db:seed-demo` → `prisma/seed-demo.ts` (16 interns, ~18 days attendance, 5 tasks × assignments)

### Prisma MySQL adapter note
- Use **connection string** `new PrismaMariaDb(DATABASE_URL)` — object config with empty password caused pool timeouts locally.

| 2026-07-23 | Phases 2–5: groups, tasks/review, attendance, analytics |
| 2026-07-23 | Analytics: ECharts dashboard + rich `db:seed-demo` fake data |


### Admin role + CRUD + mobile-first (2026-07-23)
- Role `ADMIN` (Trusted Admin): manage HR + other admins + full system
- HR: edit Intern/Trainer/College/HR; delete Intern/Trainer/College (not Admin/HR delete)
- Soft delete users via `isActive: false`
- College PATCH/DELETE APIs
- Mobile-first shell: hamburger drawer (`DashboardLayout`)
- MySQL datadir: `~/.smm-portal/mysql-data` (persistent across reboot)


### Dynamic Day / Task numbering (locked)

**Problem:** Manual titles like “Day 2 Task 1” break when batches start on different weeks.

**Approach (intern-wise):**
1. Task content = plain `title` + `description` only (library-style).
2. On assign, set `forDate` (calendar date of the work).
3. Per intern, system stores:
   - `dayNumber` = index of that date among the intern’s distinct assignment dates (sorted)
   - `taskNumber` = 1, 2, 3… within the same `forDate`
4. UI shows `Day {n} · Task {m}: {title}` via `displayLabel`.

**Example:** Intern already has Day 3 Task 1 on date D. Assign another task on D → Day 3 Task 2.  
New later date with no prior tasks that day → Day 4 Task 1.

**Tip:** Prefer assigning dates chronologically forward for clean Day sequences.
