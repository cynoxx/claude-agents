// États dérivés à l'affichage : le passé reste passé, sans réécrire les données.
import { DateTime } from 'luxon';
import type { Block, Deadline, DeadlineStatus, Task } from './types';
import { localDate } from './time';

export function effectiveDeadlineStatus(d: Deadline, now: DateTime): DeadlineStatus {
  const today = localDate(now);
  if ((d.status === 'announced' || d.status === 'to_confirm') && d.date < today) return 'to_fill';
  return d.status;
}

export const DEADLINE_STATUS_LABEL: Record<DeadlineStatus, string> = {
  to_confirm: 'à confirmer',
  announced: 'annoncé',
  to_fill: 'passé · à renseigner',
  done: 'terminé',
  cancelled: 'annulé',
  history: 'historique',
};

export function isMissed(b: Block, tasks: Map<string, Task>, now: DateTime): boolean {
  if (b.kind !== 'planned' || b.status !== 'accepted') return false;
  const t = b.taskId ? tasks.get(b.taskId) : undefined;
  return DateTime.fromISO(b.end) <= now && !!t && t.status !== 'done';
}

export interface AbsenceReview {
  daysAway: number;
  deadlinesToFill: Deadline[];
  missedBlocks: Block[];
}
export function absenceReview(lastOpenAt: string | undefined, now: DateTime, deadlines: Deadline[], blocks: Block[], tasks: Task[]): AbsenceReview {
  const daysAway = lastOpenAt ? Math.floor(now.diff(DateTime.fromISO(lastOpenAt), 'days').days) : 0;
  const tmap = new Map(tasks.map((t) => [t.id, t]));
  return {
    daysAway,
    deadlinesToFill: deadlines.filter((d) => !d.deletedAt && effectiveDeadlineStatus(d, now) === 'to_fill'),
    missedBlocks: blocks.filter((b) => !b.deletedAt && isMissed(b, tmap, now)),
  };
}
