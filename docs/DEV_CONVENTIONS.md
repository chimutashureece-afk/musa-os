# Musa OS — developer conventions

Stack: React 19 + TypeScript (strict) + Vite 8 + Tailwind CSS v4 (class-based dark mode) + react-router-dom v7 (HashRouter) + Firebase 12 + recharts 3 + lucide-react 1.x + @google/genai 2.x.

## Architecture
- `src/types.ts` — **all domain types**. Read it first. Every collection name is in `CollectionMap`.
- `src/lib/store.ts` — reactive data layer over Cloud Firestore.
  - `useCollection('students')` → `{ data: Student[], loading }` (live).
  - `useIndex('classes')` → `Map<id, SchoolClass>`.
  - Writes: `store.add(col, data)` → id (id auto if omitted), `store.set(col, fullDoc)`, `store.update(col, id, patch)`, `store.remove(col, id)`,
    `store.commit([{op:'set'|'update'|'delete', col, id, data}])` for batches (use for bulk writes: attendance, marks, invoices…). All async; `createdAt/updatedAt` are stamped automatically.
  - `newId()` for client ids. Deterministic ids are used where noted in types (e.g. Mark id = `${assessmentId}_${studentId}`, AttendanceRegister id = `${classId}_${date}`, TimetableSlot id = `${classId}_${day}_${period}`, ReportRemark/PublishedReport id = `${studentId}_${termId}`).
- `src/context/AuthContext.tsx` — `useAuth()` → `{ profile (UserProfile), configured, ... }`, `useSettings()` → SchoolSettings | undefined, `useMyStaff()` → Staff record of signed-in staff.
- `src/lib/hooks.ts` — `useCan(col)` (write permission for current role), `useClasses()`, `useClassStudents(classId)`, `useMyClasses()`, `useClassSubjects(classId)`, `useMyChildren()`.
- `src/lib/permissions.ts` — `canWrite(role, col)`, `isStaffRole(role)`. Parents/students automatically only receive their own children's data from the store (scoped reads), so pages can just filter normally.
- `src/lib/utils.ts` — formatting & domain helpers: `fullName`, `staffName`, `money`, `pct`, `fmtDate`, `todayISO`, `addDays`, `schoolDaysBetween`, `DAYS`, `DAY_NAMES`, `LEVELS`, `gradeFor(percent, cls, settings)`, `gradeColor(grade)`, `termPercent(assessments, marksMap, studentId)`, `rank`, `currentTerm(settings)`, `termById`, `toCSV`, `parseCSV`, `download(filename, text)`, `sum`, `avg`, `classSort`, `nextNumber(existing, prefix)`, `cx(...)`.
- `src/lib/reports.ts` — `computeClassReports(...)` report-card computation (positions, grades, attendance).
- `src/components/ui.tsx` — UI kit. Use these instead of raw markup where possible:
  `Button {variant: primary|secondary|outline|ghost|danger|success, size: sm|md|lg, loading, icon}`, `Card {title, subtitle, actions, className, bodyClass}`,
  `PageHeader {title, subtitle, actions, eyebrow}`, `Field {label, hint, required}`, `Input`, `Select`, `Textarea`, `SearchInput {value,onChange}`,
  `Badge {tone: slate|green|red|amber|blue|violet|sky}`, `StatCard {label,value,sub,icon,tone}`, `EmptyState {title,body,icon,action}`,
  `Modal {open,onClose,title,footer,size: sm|md|lg|xl}`, `Tabs {tabs:[{id,label,count?}], value, onChange}`, `Segmented`, `Avatar {name,size}`, `Spinner`, `Progress {value,tone}`,
  `TableWrap` (wraps `<table>`; use classes `th`, `td`, `tr`, `tr-hover` on cells/rows), `useUI()` → `{ toast(msg, 'success'|'error'|'info'), confirm({title, body, confirmText, danger}) → Promise<boolean> }`.
- CSS utility classes from `src/index.css`: `.input`, `.label`, `.card`, `.th`, `.td`, `.tr`, `.tr-hover`, `.chip`, `.link`, `.no-print`, `.print-only`, `.print-page` (page break after when printing).

## Rules
- Never use `alert()`/`window.confirm()` — use `useUI()`.
- Every page is a default-exported component in its own file and starts with `<PageHeader .../>`.
- Always support dark mode (`dark:` variants) and mobile widths (responsive grids, `TableWrap` for wide tables).
- Hide write actions when `!useCan(col)`.
- Printing: use `window.print()` and mark UI chrome `no-print`; printable documents should look like proper school documents (school name/address from settings at the top).
- Keep money in USD using `money(n)`.
- Headings use the brand style: `font-serif italic` for big titles (PageHeader does this).
- Don't edit shared files (types, store, ui, utils, hooks, Layout, App). If you truly need a helper, define it locally in your file.
- Type-check with `npx tsc --noEmit` from the repo root; your files must have zero errors.
