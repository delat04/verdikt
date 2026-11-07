-- ============================================
-- Verdikt — spending limits: a person approves one PayPal hold, once, and their AI agent hires within it
-- ============================================

-- ---- a spending limit is one PayPal authorization for the whole amount. Funding a milestone from it places
-- no new hold: the milestone points at this authorization and its share is earmarked. A passing verdict
-- captures that share (final_capture=false, so the hold stays open for the next job); a failed one frees it.
-- When the limit ends, whatever was never captured is voided — the person is charged only for verified work.
create table if not exists public.spend_limits (
  id                       uuid primary key default gen_random_uuid(),
  client_id                uuid not null references public.profiles (id) on delete cascade,
  status                   text not null default 'awaiting_approval'
                             check (status in ('awaiting_approval', 'active', 'closing', 'closed')),
  cap_cents                int not null check (cap_cents >= 100),
  per_job_cents            int not null check (per_job_cents >= 100),
  currency                 text not null default 'USD',
  note                     text not null default '',      -- what it's for, in the person's words; the agent reads it
  ends_at                  timestamptz not null,
  paypal_order_id          text,
  paypal_authorization_id  text,
  authorized_at            timestamptz,
  hold_expires_at          timestamptz,
  voided_cents             int,                            -- never charged: voided when the limit closed
  closed_at                timestamptz,
  closed_reason            text,
  created_at               timestamptz not null default now(),
  check (per_job_cents <= cap_cents)
);
create index if not exists spend_limits_client on public.spend_limits (client_id, created_at desc);
-- one open limit at a time: the agent never has to choose which hold to spend from
create unique index if not exists spend_limits_one_open on public.spend_limits (client_id) where status in ('awaiting_approval', 'active', 'closing');

alter table public.spend_limits enable row level security;
create policy "owner reads spend limits" on public.spend_limits
  for select to authenticated using (client_id = auth.uid());
alter publication supabase_realtime add table public.spend_limits;

-- ---- a milestone funded from a limit shares its authorization: it never voids it on its own
alter table public.milestones add column if not exists spend_limit_id uuid references public.spend_limits (id) on delete set null;
create index if not exists milestones_spend_limit on public.milestones (spend_limit_id) where spend_limit_id is not null;
