// ============================================================================
// Musa OS — domain types. Every collection lives under one school.
// ============================================================================

export type Role = 'admin' | 'teacher' | 'bursar' | 'parent' | 'student';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  teacher: 'Teacher',
  bursar: 'Bursar',
  parent: 'Parent / Guardian',
  student: 'Student',
};

export interface BaseDoc {
  id: string;
  createdAt?: number;
  updatedAt?: number;
}

/** App user (login). In Firebase mode stored at top-level users/{uid}. */
export interface UserProfile extends BaseDoc {
  name: string;
  email: string;
  role: Role;
  schoolId: string;
  staffId?: string; // teachers / bursar / admin linked to staff record
  studentIds?: string[]; // parents: children; students: [self]
  classIds?: string[]; // derived: classes of linked students (used for rules)
  disabled?: boolean;
}

// ---------------------------------------------------------------- settings --
export type Section = 'primary' | 'secondary';
export type ScaleKey = 'primary' | 'olevel' | 'alevel';

export interface GradeBand {
  grade: string;
  min: number; // inclusive percentage
  remark: string;
  points?: number;
}

export interface Term {
  id: string; // e.g. 2026-T3
  name: string; // "Term 3 2026"
  year: number;
  number: number;
  start: string; // ISO date
  end: string;
}

export interface SchoolSettings extends BaseDoc {
  name: string;
  /** Which levels the school runs: ECD–Grade 7 or Form 1–6. Older schools without it show every level. */
  schoolType?: Section;
  motto: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  headName: string;
  currency: string; // USD
  currentTermId: string;
  terms: Term[];
  scales: Record<ScaleKey, GradeBand[]>;
  periodsPerDay: number;
  periodTimes: string[]; // "07:30-08:10"
  passMark: number;
}

// ---------------------------------------------------------------- people ----
export type StudentStatus = 'active' | 'graduated' | 'transferred' | 'suspended' | 'withdrawn';
export type Gender = 'M' | 'F';

export interface Guardian {
  name: string;
  relation: string;
  phone: string;
  email?: string;
  occupation?: string;
}

export interface Student extends BaseDoc {
  admissionNo: string;
  firstName: string;
  lastName: string;
  gender: Gender;
  dob: string;
  classId: string;
  status: StudentStatus;
  enrollDate: string;
  guardians: Guardian[];
  address?: string;
  nationalId?: string; // birth cert no.
  medical?: string;
  boarding?: 'day' | 'boarder';
  notes?: string;
}

export type StaffStatus = 'active' | 'on-leave' | 'left';

export interface Staff extends BaseDoc {
  staffNo: string;
  firstName: string;
  lastName: string;
  title: string; // Mr / Mrs / Ms / Dr
  gender: Gender;
  position: string; // Teacher, HOD Sciences, Bursar, Headmaster
  department: string;
  phone: string;
  email: string;
  hireDate: string;
  status: StaffStatus;
  qualifications?: string;
  section?: Section | 'both';
}

// ------------------------------------------------------------ academics -----
export interface SchoolClass extends BaseDoc {
  name: string; // "Form 2A"
  level: string; // "Form 2"
  levelOrder: number; // 0 ECD A, 1 ECD B, 2 Grade 1 ... 8 Grade 7, 9 Form 1 ... 14 Form 6
  section: Section;
  stream: string; // "A"
  classTeacherId?: string;
  room?: string;
  capacity: number;
}

export interface Subject extends BaseDoc {
  name: string;
  code: string;
  section: Section | 'both';
  department: string;
}

/** Teacher teaches subject in class. */
export interface Allocation extends BaseDoc {
  classId: string;
  subjectId: string;
  teacherId: string; // staff id
  periodsPerWeek: number;
}

export type AttendanceMark = 'P' | 'A' | 'L' | 'E'; // present, absent, late, excused

/** One register per class per day. id = `${classId}_${date}` */
export interface AttendanceRegister extends BaseDoc {
  classId: string;
  date: string;
  records: Record<string, AttendanceMark>;
  takenBy?: string;
}

/** id = `${classId}_${day}_${period}` */
export interface TimetableSlot extends BaseDoc {
  classId: string;
  day: number; // 1 Mon .. 5 Fri
  period: number; // 1..periodsPerDay
  subjectId: string;
  teacherId?: string;
  room?: string;
}

export type AssessmentType = 'test' | 'assignment' | 'exam' | 'coursework' | 'project';

export interface Assessment extends BaseDoc {
  name: string;
  type: AssessmentType;
  classId: string;
  subjectId: string;
  termId: string;
  maxMark: number;
  weight: number; // relative weight within the term mark
  date: string;
  rubricId?: string;
  createdBy?: string;
}

/** id = `${assessmentId}_${studentId}` */
export interface Mark extends BaseDoc {
  assessmentId: string;
  studentId: string;
  classId: string;
  subjectId: string;
  termId: string;
  score: number | null;
  comment?: string;
  source?: 'manual' | 'acegrader';
  submissionId?: string;
}

/** Per student per term, teacher/head remarks. id = `${studentId}_${termId}` */
export interface ReportRemark extends BaseDoc {
  studentId: string;
  termId: string;
  classTeacher?: string;
  head?: string;
  conduct?: string;
}

/** Published (frozen) report card snapshot visible to parents/students. id = `${studentId}_${termId}` */
export interface PublishedReport extends BaseDoc {
  studentId: string;
  classId: string;
  className: string;
  termId: string;
  subjects: { subjectId: string; name: string; mark: number | null; grade: string; remark: string; teacher: string; comment?: string }[];
  average: number | null;
  position: number | null;
  classSize: number;
  attendance: { present: number; total: number };
  remarks: { classTeacher?: string; head?: string; conduct?: string };
  publishedAt: number;
}

// ---------------------------------------------------------------- finance ---
export interface FeeItem {
  name: string;
  amount: number;
}

export interface FeeStructure extends BaseDoc {
  name: string;
  termId: string;
  levels: string[]; // class levels this applies to, e.g. ["Form 1","Form 2"]
  boarding?: 'day' | 'boarder' | 'all';
  items: FeeItem[];
}

export interface Invoice extends BaseDoc {
  invoiceNo: string;
  studentId: string;
  termId: string;
  structureId?: string;
  items: FeeItem[];
  total: number;
  discount?: number;
  issuedDate: string;
  dueDate: string;
  note?: string;
}

export type PaymentMethod = 'Cash' | 'Bank transfer' | 'EcoCash' | 'InnBucks' | 'Card' | 'Other';

export interface Payment extends BaseDoc {
  receiptNo: string;
  studentId: string;
  termId: string;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  date: string;
  receivedBy?: string;
  note?: string;
}

// ---------------------------------------------------------- communication ---
export type Audience = 'all' | 'staff' | 'parents' | 'students';

export interface Announcement extends BaseDoc {
  title: string;
  body: string;
  audience: Audience[];
  date: string;
  author: string;
  pinned?: boolean;
  classIds?: string[]; // optional targeting
}

export type EventType = 'academic' | 'exam' | 'holiday' | 'meeting' | 'sports' | 'cultural' | 'other';

export interface SchoolEvent extends BaseDoc {
  title: string;
  date: string;
  endDate?: string;
  type: EventType;
  description?: string;
  location?: string;
}

// ---------------------------------------------------------------- library ---
export interface Book extends BaseDoc {
  title: string;
  author: string;
  isbn?: string;
  category: string;
  copies: number;
  shelf?: string;
}

export interface Loan extends BaseDoc {
  bookId: string;
  studentId: string;
  issued: string;
  due: string;
  returned?: string;
}

// ---------------------------------------------------------------- conduct ---
export interface Incident extends BaseDoc {
  studentId: string;
  date: string;
  kind: 'merit' | 'demerit';
  category: string;
  description: string;
  action?: string;
  points: number;
  recordedBy?: string;
}

// -------------------------------------------------------------- acegrader ---
export interface RubricCriterion {
  name: string;
  maxPoints: number;
  description: string;
}

export interface Rubric extends BaseDoc {
  title: string;
  description: string;
  criteria: RubricCriterion[];
  keyPointers?: string[];
  subjectId?: string;
  level?: string;
  ownerId?: string;
  ownerName?: string;
}

export interface TeacherCorrection extends BaseDoc {
  rubricId: string;
  submissionId: string;
  criterion: string;
  originalScore: number;
  correctedScore: number;
  originalFeedback: string;
  correctedFeedback: string;
  reason: string;
  timestamp: number;
}

export interface GradeCriterionResult {
  name: string;
  pointsEarned: number;
  maxPoints: number;
  justification: string;
}

export interface Annotation {
  originalText: string;
  correction?: string;
  type: 'error' | 'warning' | 'praise' | 'grammar';
  comment: string;
}

export interface GradingResult {
  summary: string;
  thinkingProcess?: string[];
  improvementTips: string[];
  annotations: Annotation[];
  breakdown: GradeCriterionResult[];
  totalScore: number;
  maxTotalScore: number;
  feedback: string;
  fullTranscribedText?: string;
  simulated?: boolean;
}

export interface SubmissionInput {
  type: 'text' | 'file';
  content: string; // text, or base64 for file
  mimeType?: string;
  fileName?: string;
}

export type SubmissionStatus = 'pending-review' | 'approved' | 'returned';

export interface Submission extends BaseDoc {
  rubricId: string;
  rubricTitle: string;
  studentId: string;
  studentName: string;
  classId: string;
  subjectId?: string;
  assessmentId?: string;
  termId: string;
  teacherId?: string;
  status: SubmissionStatus;
  result: GradingResult;
  teacherNotes?: string;
  edited?: boolean;
  fileName?: string;
  textExcerpt?: string; // original text (text submissions), for re-display
  timestamp: number;
}

// ----------------------------------------------------------- collections ----
export interface CollectionMap {
  users: UserProfile;
  students: Student;
  staff: Staff;
  classes: SchoolClass;
  subjects: Subject;
  allocations: Allocation;
  attendance: AttendanceRegister;
  timetable: TimetableSlot;
  assessments: Assessment;
  marks: Mark;
  remarks: ReportRemark;
  reports: PublishedReport;
  feeStructures: FeeStructure;
  invoices: Invoice;
  payments: Payment;
  announcements: Announcement;
  events: SchoolEvent;
  books: Book;
  loans: Loan;
  incidents: Incident;
  rubrics: Rubric;
  submissions: Submission;
  corrections: TeacherCorrection;
  settings: SchoolSettings;
}

export type CollectionName = keyof CollectionMap;

export const ALL_COLLECTIONS: CollectionName[] = [
  'users', 'students', 'staff', 'classes', 'subjects', 'allocations', 'attendance', 'timetable',
  'assessments', 'marks', 'remarks', 'reports', 'feeStructures', 'invoices', 'payments',
  'announcements', 'events', 'books', 'loans', 'incidents', 'rubrics', 'submissions', 'corrections', 'settings',
];
