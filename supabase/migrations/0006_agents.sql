-- ============================================
-- Verdikt — negotiating agents and agent access
-- A party can hand the contract room to an agent with a private mandate (their limit on price and
-- time, their must-haves). The agent speaks for them in the room and accepts only inside the mandate.
-- The other side never sees the mandate. Agent tokens let outside AI agents use Verdikt over MCP.
-- ============================================

alter table public.room_messages
  add column if not exists via_agent boolean not null default false;

create table if not exists public.room_mandates (
  contract_id    uuid not null references public.contracts (id) on delete cascade,
  role           text not null check (role in ('client', 'freelancer')),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  limit_cents    int,                        -- client: the most they'll pay · freelancer: the least they'll take
  deadline_days  int,                        -- client: the latest launch · freelancer: the time they need
  must_haves     text[] not null default '{}',
  notes          text not null default '',
  auto_accept    boolean not null default true,
  active         boolean not null default true,
  status         text not null default 'negotiating' check (status in ('negotiating', 'accepted', 'handed_back', 'paused')),
  status_note    text not null default '',
  turns          int not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (contract_id, role)
);

alter table public.room_mandates enable row level security;
-- private to its owner: the other party can't read your limit, not even through realtime
create policy "owners read their mandate" on public.room_mandates
  for select to authenticated using (user_id = auth.uid());

alter publication supabase_realtime add table public.room_mandates;

-- personal tokens for AI agents that use Verdikt over MCP (only a hash is stored)
create table if not exists public.agent_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  label         text not null default 'AI agent',
  token_hash    text not null unique,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
alter table public.agent_tokens enable row level security;
create policy "owners read their tokens" on public.agent_tokens
  for select to authenticated using (user_id = auth.uid());
