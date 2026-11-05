-- ============================================
-- Verdikt — the contract room
-- Client and freelancer shape the terms together in a conversation; the AI mediator keeps a
-- versioned terms sheet current from what they say. When both accept the same version, the terms
-- lock into milestones and the checks are drafted.
-- ============================================

alter table public.contracts drop constraint if exists contracts_status_check;
alter table public.contracts add constraint contracts_status_check
  check (status in ('scoping', 'drafting', 'negotiating', 'active', 'completed', 'cancelled'));

alter table public.contracts
  add column if not exists terms               jsonb,
  add column if not exists terms_client_v      int,
  add column if not exists terms_freelancer_v  int,
  add column if not exists mediator_busy       boolean not null default false;

create table if not exists public.room_messages (
  id           uuid primary key default gen_random_uuid(),
  contract_id  uuid not null references public.contracts (id) on delete cascade,
  author       text not null check (author in ('client', 'freelancer', 'agent', 'system')),
  body         text not null default '',
  suggestions  jsonb not null default '[]',
  changes      jsonb not null default '[]',
  version      int,
  created_at   timestamptz not null default now()
);
create index if not exists room_messages_contract on public.room_messages (contract_id, created_at);

alter table public.room_messages enable row level security;
create policy "parties read the room" on public.room_messages
  for select to authenticated using (public.is_party(contract_id));

alter publication supabase_realtime add table public.room_messages;
