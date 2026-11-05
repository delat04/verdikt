-- ============================================
-- Verdikt — money check by check, proof of verified work, change orders
-- ============================================

-- ---- pay per check: one PayPal authorization, several partial captures (final_capture=false)
-- as more checks pass, each paid out to the freelancer on its own
alter table public.contracts
  add column if not exists release_mode text not null default 'whole' check (release_mode in ('whole', 'per_check'));

alter table public.milestones
  add column if not exists tranches jsonb not null default '[]';
  -- [{ captureId, cents, passed, total, at, final, feeCents, netCents, payoutBatchId, payoutStatus, paidOutAt }]

-- ---- proof profile: a public page (opt-in) built only from PayPal-settled, AI-verified work
alter table public.profiles
  add column if not exists handle        text unique,
  add column if not exists public_proof  boolean not null default false,
  add column if not exists headline      text not null default '';

-- ---- change orders: a request after signing is checked against the signed terms; if it's new work the
-- agent drafts a priced milestone the other side can accept
create table if not exists public.change_orders (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references public.contracts (id) on delete cascade,
  requested_by  text not null check (requested_by in ('client', 'freelancer')),
  request       text not null,
  status        text not null default 'reviewing' check (status in ('reviewing', 'in_scope', 'proposed', 'accepted', 'declined', 'error')),
  covered_by    text not null default '',     -- the signed check or scope line that already covers it
  reply         text not null default '',
  title         text,
  done_means    text[] not null default '{}',
  amount_cents  int,
  due_days      int,
  priced_by     text check (priced_by in ('agent', 'client', 'freelancer')),
  milestone_id  uuid references public.milestones (id) on delete set null,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create index if not exists change_orders_contract on public.change_orders (contract_id, created_at);
alter table public.change_orders enable row level security;
create policy "parties read change orders" on public.change_orders
  for select to authenticated using (public.is_party(contract_id));
alter publication supabase_realtime add table public.change_orders;
