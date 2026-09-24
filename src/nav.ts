import {Rocket, LayoutDashboard, Users, UserSquare2, School, CalendarClock, ClipboardCheck, BookOpenCheck, FileText, PenLine, Wallet, Megaphone, CalendarDays, Library, ShieldCheck, Settings, Receipt} from 'lucide-react';
import { Role } from './types';

export interface NavItem { to: string; label: string; icon: any; roles: Role[]; badge?: string }
export interface NavGroup { label: string; items: NavItem[] }

const STAFF: Role[] = ['admin', 'teacher', 'bursar'];
const ALL: Role[] = ['admin', 'teacher', 'bursar', 'parent', 'student'];

export const NAV: NavGroup[] = [
  { label: 'Overview', items: [{ to: '/setup', label: 'Get started', icon: Rocket, roles: ['admin'] }, { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ALL }] },
  {
    label: 'People',
    items: [
      { to: '/students', label: 'Students', icon: Users, roles: STAFF },
      { to: '/staff', label: 'Staff', icon: UserSquare2, roles: ['admin'] },
    ],
  },
  {
    label: 'Academics',
    items: [
      { to: '/classes', label: 'Classes & Subjects', icon: School, roles: ['admin', 'teacher'] },
      { to: '/timetable', label: 'Timetable', icon: CalendarClock, roles: ALL },
      { to: '/attendance', label: 'Attendance', icon: ClipboardCheck, roles: ['admin', 'teacher'] },
      { to: '/gradebook', label: 'Gradebook', icon: BookOpenCheck, roles: ['admin', 'teacher'] },
      { to: '/reports', label: 'Report Cards', icon: FileText, roles: ALL },
      { to: '/acegrader', label: 'AceGrader', icon: PenLine, roles: ['admin', 'teacher'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/finance', label: 'Fees & Billing', icon: Wallet, roles: ['admin', 'bursar'] },
      { to: '/fees', label: 'Fees', icon: Receipt, roles: ['parent', 'student'] },
    ],
  },
  {
    label: 'Community',
    items: [
      { to: '/announcements', label: 'Announcements', icon: Megaphone, roles: ALL },
      { to: '/calendar', label: 'Calendar', icon: CalendarDays, roles: ALL },
      { to: '/library', label: 'Library', icon: Library, roles: ['admin', 'teacher'] },
      { to: '/conduct', label: 'Conduct', icon: ShieldCheck, roles: ['admin', 'teacher'] },
    ],
  },
  { label: 'System', items: [{ to: '/settings', label: 'Settings', icon: Settings, roles: ['admin'] }] },
];

export const navFor = (role: Role) =>
  NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(role)) })).filter((g) => g.items.length);

export const canVisit = (role: Role, path: string) => {
  const base = '/' + (path.split('/')[1] ?? '');
  if (base === '/') return true;
  if (base === '/students') return true; // profile pages are scoped by data rules; parents/students see their own
  const item = NAV.flatMap((g) => g.items).find((i) => i.to === base);
  return item ? item.roles.includes(role) : true;
};
