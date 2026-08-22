import type { ReactNode } from 'react';
import { Rocket, ClipboardList, AlertTriangle, WifiOff, Keyboard, MessageCircleQuestion } from 'lucide-react';

// Single source of truth for Help content, shared by the desktop header
// popover (HelpMenu.tsx) and the mobile More-sheet Help view
// (MobileHelpSheet.tsx) — so the two surfaces never drift out of sync.

export const SUPPORT_EMAIL = 'tigercell.ptr@jharkhand.gov.in';
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=Smart%20Forester%20—%20Support`;

export type HelpTopic = {
  id: string;
  label: string;
  icon: ReactNode;
  body: ReactNode;
};

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'getting-started',
    label: 'Getting started',
    icon: <Rocket className="w-4 h-4" />,
    body: (
      <>
        <p>The dashboard shows what needs attention today: overdue tasks, work awaiting review, and critical incidents.</p>
        <p>Use the navigation to move between Dashboard, Task registry, Incident reports, Range map and Personnel.</p>
        <p>The search bar (or Ctrl+K on desktop) finds tasks, incidents, people and ranges by name, ID or status.</p>
      </>
    ),
  },
  {
    id: 'using-tasks',
    label: 'Using tasks',
    icon: <ClipboardList className="w-4 h-4" />,
    body: (
      <>
        <p>The Task registry lists every task. Filter by view, status or range, or search by title or assignee.</p>
        <p>Select one or more tasks to Assign, change Status, set a Due date, or Export just that selection.</p>
        <p>Open a task to see its full detail, updates and attachments.</p>
      </>
    ),
  },
  {
    id: 'reporting-incidents',
    label: 'Reporting incidents',
    icon: <AlertTriangle className="w-4 h-4" />,
    body: (
      <>
        <p>Use Report incident to log a human–wildlife conflict or field observation. Choose a type and severity, add a description, and confirm the range/area.</p>
        <p>A GPS location is required and is captured automatically — allow the location prompt if asked. Photos are optional.</p>
        <p>From the Incident registry you can assign an incident to someone, change its severity, create a follow-up task, or mark it resolved.</p>
      </>
    ),
  },
  {
    id: 'offline-sync',
    label: 'Offline and synchronisation help',
    icon: <WifiOff className="w-4 h-4" />,
    body: (
      <>
        <p>You can keep working without a signal. Incident reports and task updates made while offline are saved on your device and queued.</p>
        <p>A status indicator shows "Offline" while disconnected, and "Syncing…" while queued changes are being sent — this happens automatically as soon as a connection is available. You don't need to resend anything yourself.</p>
      </>
    ),
  },
  {
    id: 'shortcuts',
    label: 'Keyboard shortcuts',
    icon: <Keyboard className="w-4 h-4" />,
    body: (
      <ul className="space-y-1.5">
        <li className="flex items-center justify-between gap-3"><span>Focus search</span><kbd className="px-1.5 h-5 rounded border border-n-30 text-xs font-medium text-n-70 inline-flex items-center">Ctrl K</kbd></li>
        <li className="flex items-center justify-between gap-3"><span>Move through search/menu results</span><kbd className="px-1.5 h-5 rounded border border-n-30 text-xs font-medium text-n-70 inline-flex items-center">&uarr; &darr;</kbd></li>
        <li className="flex items-center justify-between gap-3"><span>Open highlighted result / row</span><kbd className="px-1.5 h-5 rounded border border-n-30 text-xs font-medium text-n-70 inline-flex items-center">Enter</kbd></li>
        <li className="flex items-center justify-between gap-3"><span>Close a menu, search or panel</span><kbd className="px-1.5 h-5 rounded border border-n-30 text-xs font-medium text-n-70 inline-flex items-center">Esc</kbd></li>
      </ul>
    ),
  },
  {
    id: 'faq',
    label: 'Frequently asked questions',
    icon: <MessageCircleQuestion className="w-4 h-4" />,
    body: (
      <>
        <p className="font-semibold text-n-100">Why can't I see all incidents or tasks?</p>
        <p>Access is scoped to your role and assigned range(s) — field staff see their own range, officers see their ranges, and directors/Tiger Cell see everything.</p>
        <p className="font-semibold text-n-100 mt-2.5">Why is a toolbar action greyed out?</p>
        <p>Actions like Assign, Change status and Due date need one or more rows selected first — hover the disabled button for a short explanation.</p>
        <p className="font-semibold text-n-100 mt-2.5">How do I export data?</p>
        <p>Use Export in the command bar. With rows selected it exports just your selection; otherwise it exports the current filtered list.</p>
      </>
    ),
  },
];

export const HELP_ABOUT_BODY = (
  <>
    <p className="font-semibold text-n-100">Palamau Tiger Reserve — Smart Forester</p>
    <p>Used by field staff, range officers, Tiger Cell and the Directorate to track patrol and maintenance tasks, and to report and manage human–wildlife conflict incidents across the reserve.</p>
    <p>Government of Jharkhand.</p>
  </>
);
