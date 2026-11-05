-- ============================================
-- Verdikt — money all the way to the freelancer
-- payouts (PayPal Payouts after the capture), partial releases, hold renewal,
-- appeals with a second opinion, and PayPal disputes answered by the agent.
-- ============================================

-- ---- Milestones: the hold's lifetime, what was released, what reached the freelancer ----
alter table public.milestones
  add column if not exists authorized_at           timestamptz,
  add column if not exists hold_expires_at         timestamptz,
  add column if not exists reauthorized_at         timestamptz,
  add column if not exists released_cents          int,
  add column if not exists voided_cents            int,
  add column if not exists fee_cents               int,
  add column if not exists payout_cents            int,
  add column if not exists payout_email            text,
  add column if not exists payout_status           text,
  add column if not exists paypal_payout_batch_id  text,
  add column if not exists paypal_payout_item_id   text,
  add column if not exists paid_out_at             timestamptz;

-- ---- Appeals: a second, independent review of the checks that failed ----
create table if not exists public.appeals (
  id              uuid primary key default gen_random_uuid(),
  milestone_id    uuid not null references public.milestones (id) on delete cascade,
  submission_id   uuid references public.submissions (id) on delete set null,
  filed_by        text not null check (filed_by in ('client', 'freelancer')),
  reason          text not null,
  status          text not null default 'reviewing'
                  check (status in ('reviewing', 'decided', 'accepted', 'declined', 'error')),
  recommendation  text check (recommendation in ('release', 'partial', 'uphold')),
  release_cents   int,
  summary         text,
  findings        jsonb not null default '[]',
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  closed_at       timestamptz
);

-- ---- PayPal disputes on a released milestone, and the agent's answer ----
create table if not exists public.disputes (
  id                 uuid primary key default gen_random_uuid(),
  milestone_id       uuid references public.milestones (id) on delete set null,
  contract_id        uuid references public.contracts (id) on delete cascade,
  paypal_dispute_id  text not null unique,
  reason             text,
  paypal_status      text,
  amount_cents       int,
  stance             text check (stance in ('contest', 'accept')),
  response           text,
  key_points         jsonb not null default '[]',
  state              text not null default 'new' check (state in ('new', 'drafting', 'submitted', 'needs_review', 'error')),
  error              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.appeals enable row level security;
alter table public.disputes enable row level security;

create policy "parties read appeals" on public.appeals
  for select to authenticated
  using (exists (select 1 from public.milestones m where m.id = milestone_id and public.is_party(m.contract_id)));

create policy "parties read disputes" on public.disputes
  for select to authenticated using (public.is_party(contract_id));

alter publication supabase_realtime add table public.appeals, public.disputes;
