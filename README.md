# Musa OS — School Management System (with AceGrader AI)

A complete, role-based school management system for **ECD, primary, O-Level and A-Level** schools, built from the AceGrader marking tool. AceGrader is now one module inside the system: it marks scripts with AI and posts the marks straight into the gradebook.

## Modules

| Area | What it does |
|---|---|
| **Dashboards** | Separate home screens for admin, teacher, bursar, parent and student: KPIs, attendance trend, fee collection, what's coming up, notices |
| **Students** | Admissions register, auto admission numbers, guardians, medical info, CSV import/export, bulk class moves. Each profile has tabs for attendance, academics, fees, conduct, library and reports |
| **Staff** | Staff directory, teaching load, class-teacher roles |
| **Classes & subjects** | Classes by level/stream, subjects (ZIMSEC codes), teacher allocations, end-of-year **promotion wizard** |
| **Timetable** | Class and teacher views; admin editing with **teacher clash detection**; printable |
| **Attendance** | Fast P/A/L/E registers (keyboard shortcuts), term reports, chronic-absence watchlist, a "who hasn't marked today" view for the head |
| **Gradebook** | Assessments per class/subject/term, weighted term marks, ZIMSEC grading scales, statistics, CSV |
| **Report cards** | Positions, grades, attendance and remarks (with auto-comments). Prints A4 report cards and **publishes** them to parents |
| **AceGrader AI** | Rubric library, AI rubric import, batch marking linked to a class and assessment, filename→learner matching, marked script with margin notes, teacher overrides that train later marking, one-click post to the gradebook, class **insights** on weak skills |
| **Fees & billing** | Fee structures (day/boarding), bulk invoicing, payments (cash, bank, EcoCash, InnBucks, card), receipts, statements, debtors list with WhatsApp reminders (USD) |
| **Parent / student portal** | Children's results, published reports, attendance, fee balance, timetable, notices |
| **Communication** | Announcements by audience/class, guardian contact lists, school calendar |
| **Library & conduct** | Catalogue, loans, overdue tracking; merit/demerit log, leaderboard, watchlist |
| **Settings** | School profile/letterhead, terms and periods, grading scales, user accounts and roles, backup/restore |

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Musa OS needs a Firebase project for real schools. Without the `VITE_FIREBASE_*` keys the sign-in and sign-up pages show a setup notice.

**Demo.** The landing page offers two ways to look around without an account:

- **Watch how it works** — a 40-second animated walkthrough (create a class, enrol, register, marks, fees, reports).
- **Try the demo** — opens an *empty* practice school (primary or secondary) kept only in the browser's local storage, with a guided tour that ticks off each step as the user does it. No sample data is ever inserted; leaving the demo wipes it.

## Set up Firebase

1. Create a Firebase project and enable **Authentication → Email/Password** and **Cloud Firestore**.
2. Copy `.env.example` to `.env` and fill in the `VITE_FIREBASE_*` values.
3. Deploy the security rules: `firebase deploy --only firestore:rules`.
4. `npm run build && firebase deploy --only hosting`.
5. Open the site and choose **Set up your school** (`/#/signup`). Pick **Primary** (ECD A – Grade 7) or **Secondary** (Form 1 – Form 6), then create the administrator account. The school starts with that type's levels, ZIMSEC subjects, grading and period times; the type can be changed later in **Settings → School**.
6. Add staff, parent and student accounts in **Settings → Users & access**. Everyone else signs in at `/#/signin` — only the head signs up.

Data is stored under `schools/{schoolId}/…` and user profiles under `users/{uid}`. `firestore.rules` enforces the same role permissions as the UI:

- Parents and students can only read their own children's records.
- Teachers cannot see fees.
- The bursar cannot see AI marking data.

## AceGrader AI

Set `VITE_GEMINI_API_KEY` (and optionally `VITE_GEMINI_MODEL`) to switch on Gemini marking. Without a key, AceGrader uses a built-in heuristic "simulated" marker, so the whole workflow can still be demonstrated. Results are clearly labelled as simulated.

> **Production note:** a `VITE_` key is visible in the browser bundle. For a real deployment, move the Gemini call behind a Firebase Cloud Function (or another server) and restrict the key.

## Security notes from the old AceGrader code

The previous repository committed a Firebase config and a Make.com webhook URL with an API key (`webhookService.ts`). These have been removed from the code. **Rotate that webhook key**, and restrict the old Firebase API key to your domains.

## Tech

React 19 · TypeScript · Vite · Tailwind CSS 4 · Firebase 12 · Recharts · @google/genai · lucide-react

Developer conventions: `docs/DEV_CONVENTIONS.md`.

## Sign-in (no emails are sent)

In the Firebase console → Authentication → Sign-in method, turn on:

- **Email/Password** — schools, staff and families sign in with these.
- **Anonymous** — the one-day demo. A visitor types their email and the demo opens at once; the
  email is recorded in `demoEmails` so each email gets one demo. The demo lives in that browser.
  Choosing "Keep this as my real school" adds a password, so the school can be opened anywhere.
- **Google** — the owners' console (`/owner`), for the owner emails in `src/lib/owner.ts`.
