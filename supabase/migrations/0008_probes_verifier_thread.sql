-- ============================================
-- Verdikt — deterministic probes, and talking to the verifier
-- ============================================

-- ---- each check's result says what decided it: a deterministic probe, OCR of the screenshots, the model,
-- or an earlier model answer reused because the evidence it judged hasn't changed (fingerprint)
alter table public.criterion_results
  add column if not exists layer        text not null default 'model' check (layer in ('probe', 'ocr', 'model', 'reused')),
  add column if not exists probes       jsonb not null default '[]',
  -- [{ type, label, status, hard, observed, via }]
  add column if not exists fingerprint  text;

-- ---- the verifier thread: pre-checks (dry runs of the probes, nothing moves) and questions either side —
-- or their agent — asks about the checks. Both parties read all of it; the verifier that decides never does.
create table if not exists public.verifier_thread (
  id            uuid primary key default gen_random_uuid(),
  milestone_id  uuid not null references public.milestones (id) on delete cascade,
  contract_id   uuid not null references public.contracts (id) on delete cascade,
  author        text not null check (author in ('client', 'freelancer', 'verifier')),
  via_agent     boolean not null default false,
  kind          text not null check (kind in ('question', 'answer', 'precheck')),
  body          text not null default '',
  data          jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists verifier_thread_milestone on public.verifier_thread (milestone_id, created_at);
alter table public.verifier_thread enable row level security;
create policy "parties read the verifier thread" on public.verifier_thread
  for select to authenticated using (public.is_party(contract_id));
alter publication supabase_realtime add table public.verifier_thread;
