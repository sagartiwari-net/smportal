# SMM Internship Portal

Multi-role internship MIS (HR, Trainer, Intern, College) — TypeScript, React, Express, MySQL.

Track progress: [task.md](task.md) · Tech log: [docs/TECH_AND_APPROACH.md](docs/TECH_AND_APPROACH.md)

## Local setup

### 1. MySQL (local)

Machine pe agar `:3306` busy/locked ho to yeh script **port 3307** pe isolated MySQL start karti hai:

```bash
bash scripts/start-local-mysql.sh
```

Company / phpMyAdmin pe baad mein normal `3306` + apna password `.env` mein set karna.

### 2. Backend

```bash
cd backend
cp .env.example .env   # already tuned for 3307 locally if needed
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

API: http://localhost:4000

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:5173 → **Login** (single page) → role dashboard

### Demo logins (password: `password123`)

| Email | Role |
|-------|------|
| hr@smm.local | HR |
| trainer@smm.local | TRAINER |
| intern@smm.local | INTERN |
| college@smm.local | COLLEGE |

## Stack

TypeScript · React (Vite) · Express · Prisma · MySQL


## Data persistence

All creates/edits (users, tasks, attendance, etc.) are stored in **MySQL**.  
App restart (`npm run dev`) does **not** wipe data.

Local MySQL data lives at `~/.smm-portal/mysql-data` (survives Mac reboot).  
Start with: `bash scripts/start-local-mysql.sh`

### Demo logins (password: `password123`)

| Email | Role |
|-------|------|
| admin@smm.local | Trusted Admin |
| hr@smm.local | HR |
| trainer@smm.local | Trainer |
| intern@smm.local | Intern |
| college@smm.local | College |
