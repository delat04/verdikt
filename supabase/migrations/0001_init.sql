-- ============================================
-- Verdikt schema
-- Reads: row-level security, parties of a contract only.
-- Writes: go through the API server (service role), so every money-moving
-- step is validated and logged in one place.
-- ============================================

create extension if not exists pgcrypto;

-- ---- Profiles ----
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default '',
  avatar_url    text,
  paypal_email  text,
  created_at    timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- Contracts ----
create table public.contracts (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  brief          text not null default '',
  client_id      uuid references public.profiles (id),
  freelancer_id  uuid references public.profiles (id),
  created_by     uuid not null references public.profiles (id),
  invite_code    text not null unique default encode(gen_random_bytes(6), 'hex'),
  currency       text not null default 'USD',
  status         text not null default 'draft'
                 check (status in ('draft', 'negotiating', 'active', 'completed', 'cancelled')),
  created_at     timestamptz not null default now()
);

-- ---- Milestones (each one is funded and released on its own) ----
create table public.milestones (
  id                       uuid primary key default gen_random_uuid(),
  contract_id              uuid not null references public.contracts (id) on delete cascade,
  position                 int not null,
  title                    text not null,
  amount_cents             int not null check (amount_cents > 0),
  due_at                   timestamptz,
  status                   text not null default 'draft'
                           check (status in ('draft', 'awaiting_funding', 'funded', 'submitted', 'verifying',
                                             'passed', 'failed', 'released', 'refunded', 'disputed')),
  paypal_order_id          text,
  paypal_authorization_id  text,
  paypal_capture_id        text,
  funded_at                timestamptz,
  released_at              timestamptz,
  unique (contract_id, position)
);

-- ---- Acceptance criteria (agreed by both parties before funding) ----
create table public.criteria (
  id                      uuid primary key default gen_random_uuid(),
  milestone_id            uuid not null references public.milestones (id) on delete cascade,
  position                int not null,
  kind                    text not null check (kind in ('visual', 'functional', 'code', 'performance', 'content')),
  statement               text not null,
  -- machine-checkable spec the verifier runs (selectors, URLs, thresholds…)
  check_spec              jsonb not null default '{}',
  approved_by_client      boolean not null default false,
  approved_by_freelancer  boolean not null default false,
  unique (milestone_id, position)
);

-- ---- Submissions ----
create table public.submissions (
  id            uuid primary key default gen_random_uuid(),
  milestone_id  uuid not null references public.milestones (id) on delete cascade,
  submitted_by  uuid not null references public.profiles (id),
  repo_url      text,
  live_url      text,
  notes         text not null default '',
  created_at    timestamptz not null default now()
);

-- ---- Verdicts ----
create table public.verdicts (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions (id) on delete cascade,
  outcome        text not null check (outcome in ('pass', 'fail', 'inconclusive')),
  confidence     numeric(4, 3) not null check (confidence between 0 and 1),
  summary        text not null,
  model          text not null,
  report         jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

create table public.criterion_results (
  id            uuid primary key default gen_random_uuid(),
  verdict_id    uuid not null references public.verdicts (id) on delete cascade,
  criterion_id  uuid not null references public.criteria (id) on delete cascade,
  passed        boolean not null,
  confidence    numeric(4, 3) not null,
  explanation   text not null,
  -- screenshots (storage paths), test output, code excerpts
  evidence      jsonb not null default '[]'
);

-- ---- Audit log: every agent decision and PayPal event ----
create table public.audit_log (
  id           bigint generated always as identity primary key,
  contract_id  uuid references public.contracts (id) on delete cascade,
  milestone_id uuid references public.milestones (id) on delete cascade,
  actor        text not null check (actor in ('client', 'freelancer', 'agent', 'paypal', 'system')),
  event        text not null,
  payload      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create index on public.milestones (contract_id);
create index on public.criteria (milestone_id);
create index on public.submissions (milestone_id);
create index on public.audit_log (contract_id, created_at desc);

-- ============================================
-- Row-level security
-- ============================================

create function public.is_party(c uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from contracts
    where id = c and auth.uid() in (client_id, freelancer_id, created_by)
  );
$$;

alter table public.profiles          enable row level security;
alter table public.contracts         enable row level security;
alter table public.milestones        enable row level security;
alter table public.criteria          enable row level security;
alter table public.submissions       enable row level security;
alter table public.verdicts          enable row level security;
alter table public.criterion_results enable row level security;
alter table public.audit_log         enable row level security;

create policy "profiles readable by signed-in users" on public.profiles
  for select to authenticated using (true);
create policy "users update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "parties read contract" on public.contracts
  for select to authenticated using (public.is_party(id));

create policy "parties read milestones" on public.milestones
  for select to authenticated using (public.is_party(contract_id));

create policy "parties read criteria" on public.criteria
  for select to authenticated using (
    public.is_party((select contract_id from public.milestones m where m.id = milestone_id))
  );

create policy "parties read submissions" on public.submissions
  for select to authenticated using (
    public.is_party((select contract_id from public.milestones m where m.id = milestone_id))
  );

create policy "parties read verdicts" on public.verdicts
  for select to authenticated using (
    public.is_party((
      select m.contract_id from public.submissions s
      join public.milestones m on m.id = s.milestone_id
      where s.id = submission_id
    ))
  );

create policy "parties read criterion results" on public.criterion_results
  for select to authenticated using (
    public.is_party((
      select m.contract_id from public.verdicts v
      join public.submissions s on s.id = v.submission_id
      join public.milestones m on m.id = s.milestone_id
      where v.id = verdict_id
    ))
  );

create policy "parties read audit log" on public.audit_log
  for select to authenticated using (public.is_party(contract_id));

-- Live status updates in the UI
alter publication supabase_realtime add table public.milestones, public.verdicts, public.audit_log;

-- Verification screenshots
insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false)
  on conflict (id) do nothing;
