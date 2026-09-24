// Starting configuration for a newly registered school.
import { SchoolSettings, Section, Subject } from '../types';
import { DEFAULT_SCALES, todayISO } from './utils';

export const SCHOOL_TYPES: Record<Section, { label: string; levels: string; detail: string }> = {
  primary: { label: 'Primary school', levels: 'ECD A – Grade 7', detail: 'Infant and junior classes, primary grading scale, Grade 7 results.' },
  secondary: { label: 'Secondary school', levels: 'Form 1 – Form 6', detail: 'O-Level and A-Level classes with ZIMSEC grading and points.' },
};

function termsFor(year: number) {
  return [
    { id: `${year}-T1`, name: `Term 1 ${year}`, year, number: 1, start: `${year}-01-13`, end: `${year}-04-09` },
    { id: `${year}-T2`, name: `Term 2 ${year}`, year, number: 2, start: `${year}-05-12`, end: `${year}-08-06` },
    { id: `${year}-T3`, name: `Term 3 ${year}`, year, number: 3, start: `${year}-09-08`, end: `${year}-12-03` },
  ];
}

export function newSchoolSettings(name: string, type: Section): SchoolSettings {
  const today = todayISO();
  const terms = termsFor(Number(today.slice(0, 4)));
  const current = terms.find((t) => today <= t.end) ?? terms[terms.length - 1]!;
  const primary = type === 'primary';
  return {
    id: 'main', name, schoolType: type,
    motto: '', address: '', phone: '', email: '', website: '', headName: '',
    currency: 'USD', currentTermId: current.id, terms, scales: DEFAULT_SCALES,
    periodsPerDay: primary ? 7 : 8,
    periodTimes: primary
      ? ['07:30–08:05', '08:05–08:40', '08:40–09:15', '09:35–10:10', '10:10–10:45', '10:45–11:20', '11:40–12:15']
      : ['07:30–08:10', '08:10–08:50', '08:50–09:30', '09:50–10:30', '10:30–11:10', '11:10–11:50', '12:30–13:10', '13:10–13:50'],
    passMark: 50,
  };
}

type S = [id: string, name: string, code: string, department: string];
const PRIMARY: S[] = [
  ['sub-peng', 'English', 'P-ENG', 'Languages'],
  ['sub-pmat', 'Mathematics', 'P-MAT', 'Mathematics'],
  ['sub-pind', 'Indigenous Language', 'P-IND', 'Languages'],
  ['sub-psct', 'Science & Technology', 'P-SCT', 'Sciences'],
  ['sub-phss', 'Heritage–Social Studies', 'P-HSS', 'Humanities'],
  ['sub-pvpa', 'Visual & Performing Arts', 'P-VPA', 'Arts'],
  ['sub-ppe', 'Physical Education', 'P-PE', 'Sport'],
  ['sub-pfrm', 'Family, Religion & Moral Education', 'P-FRM', 'Humanities'],
  ['sub-pagr', 'Agriculture', 'P-AGR', 'Practicals'],
  ['sub-pict', 'ICT', 'P-ICT', 'ICT'],
];
const SECONDARY: S[] = [
  ['sub-eng', 'English Language', '1122', 'Languages'],
  ['sub-mat', 'Mathematics', '4004', 'Mathematics'],
  ['sub-sho', 'Shona', '3159', 'Languages'],
  ['sub-nde', 'Ndebele', '3155', 'Languages'],
  ['sub-csc', 'Combined Science', '4003', 'Sciences'],
  ['sub-bio', 'Biology', '4025', 'Sciences'],
  ['sub-his', 'History', '4044', 'Humanities'],
  ['sub-geo', 'Geography', '4022', 'Humanities'],
  ['sub-her', 'Heritage Studies', '4006', 'Humanities'],
  ['sub-acc', 'Principles of Accounts', '7112', 'Commercials'],
  ['sub-bus', 'Business Enterprise Skills', '4048', 'Commercials'],
  ['sub-cs', 'Computer Science', '4021', 'ICT'],
  ['sub-agr', 'Agriculture', '4001', 'Practicals'],
  ['sub-lit', 'Literature in English', '2013', 'Languages'],
  ['sub-pmt', 'Pure Mathematics', '6042', 'Mathematics'],
  ['sub-phy', 'Physics', '6032', 'Sciences'],
  ['sub-che', 'Chemistry', '6031', 'Sciences'],
];

/** ZIMSEC subjects a school usually offers, so the gradebook and timetable work on day one. */
export function starterSubjects(type: Section): Subject[] {
  const now = Date.now();
  return (type === 'primary' ? PRIMARY : SECONDARY).map(([id, name, code, department]) => ({ id, name, code, department, section: type, createdAt: now }));
}

/** Short, easy-to-read code (no 0/O, 1/I) that people type to ask to join a school. */
export function makeJoinCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => A[n % A.length]).join('');
}
