-- ============================================
-- Verdikt — moving a due date: one side proposes, the other accepts or declines
-- ============================================

-- ---- { dueAt, from, by, reason, viaAgent, at }: a pending proposal to move this milestone's due date (e.g. by
-- dragging its bar on the timeline). The date changes only when the other side accepts; declining clears it.
alter table public.milestones add column if not exists due_proposal jsonb;
