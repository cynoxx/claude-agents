import type { Area, Block, Capture, Deadline, LogEntry, Origin, Prefs, Project, Recurrence, Task, Video } from './types';
import { DEFAULT_TZ } from './time';

let counter = 0;
/** Identifiant stable, triable dans le temps, sans dépendance. */
export function newId(prefix = ''): string {
  counter = (counter + 1) % 1679616;
  const t = Date.now().toString(36).padStart(9, '0');
  const r = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
  return `${prefix}${t}${counter.toString(36).padStart(4, '0')}${r}`;
}

function meta(nowIso: string, origin: Origin = 'user', id?: string) {
  return { id: id ?? newId(), createdAt: nowIso, updatedAt: nowIso, version: 1, origin };
}

export function makeTask(nowIso: string, p: Partial<Task> & { title: string }): Task {
  return { ...meta(nowIso, p.origin, p.id), status: 'open', spentMin: 0, priority: 0, steps: [], dependsOn: [], sessions: [], ...p };
}
export function makeDeadline(nowIso: string, p: Partial<Deadline> & { title: string; date: string }): Deadline {
  return { ...meta(nowIso, p.origin, p.id), kind: 'controle', tz: DEFAULT_TZ, importance: 'haute', status: 'announced', dateConfirmed: true, ...p };
}
export function makeBlock(nowIso: string, p: Partial<Block> & { title: string; start: string; end: string }): Block {
  return { ...meta(nowIso, p.origin, p.id), tz: DEFAULT_TZ, kind: 'fixed', category: 'autre', protection: 'locked', status: 'accepted', ...p };
}
export function makeRecurrence(nowIso: string, p: Partial<Recurrence> & { title: string; weekdays: number[]; startTime: string; endTime: string; from: string }): Recurrence {
  return { ...meta(nowIso, p.origin, p.id), category: 'cours', kind: 'fixed', protection: 'locked', tz: DEFAULT_TZ, exceptions: [], ...p };
}
export function makeArea(nowIso: string, p: Partial<Area> & { name: string }): Area {
  return { ...meta(nowIso, p.origin, p.id), status: 'active', ...p };
}
export function makeProject(nowIso: string, p: Partial<Project> & { name: string }): Project {
  return { ...meta(nowIso, p.origin, p.id), kind: 'general', status: 'active', notes: [], ...p };
}
export function makeCapture(nowIso: string, text: string, id?: string): Capture {
  return { ...meta(nowIso, 'user', id), text, status: 'new', applied: {} };
}
export function makeVideo(nowIso: string, p: Partial<Video> & { title: string }): Video {
  return { ...meta(nowIso, p.origin, p.id), workState: 'idee', platforms: {}, metrics: [], ...p };
}
export function makeLog(nowIso: string, p: Partial<LogEntry> & { kind: LogEntry['kind']; date: string }): LogEntry {
  return { ...meta(nowIso, p.origin, p.id), ...p };
}

export function defaultPrefs(nowIso: string): Prefs {
  return {
    id: 'prefs',
    version: 1,
    updatedAt: nowIso,
    tz: DEFAULT_TZ,
    sleep: { bed: '22:00', wake: '06:00', protect: true, confirmed: false },
    bufferMin: 10,
    minUsefulMin: 10,
    defaultChunkMin: 25,
    maxChunkMin: 90,
    travel: [{ label: 'Corte ↔ Bastia' }],
    quietHours: { from: '22:00', to: '07:00' },
    onboardingDone: false,
    assistantEnabled: false,
    remindersEnabled: false,
    dismissedQuestions: [],
    maxPriorities: 3,
  };
}
