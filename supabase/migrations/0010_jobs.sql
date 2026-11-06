-- ============================================
-- Verdikt — a job board for people and their agents, priced with live market data
-- ============================================

-- ---- a job: someone (or their agent) needs work done. Freelancers (or their agents) apply with a price;
-- hiring one opens a contract room with both of them in it, and the usual terms → escrow → verify flow follows
create table if not exists public.jobs (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.profiles (id) on delete cascade,
  title             text not null,
  brief             text not null,
  budget_min_cents  int check (budget_min_cents is null or budget_min_cents >= 100),
  budget_max_cents  int check (budget_max_cents is null or budget_max_cents >= 100),
  currency          text not null default 'USD',
  due_days          int check (due_days is null or due_days between 1 and 365),
  skills            text[] not null default '{}',
  status            text not null default 'open' check (status in ('open', 'hired', 'closed')),
  via_agent         boolean not null default false,
  price_check       jsonb,          -- the fair-price estimate the poster saw, if they ran one
  contract_id       uuid references public.contracts (id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists jobs_open on public.jobs (status, created_at desc);

-- ---- an application: a price, a timeline and a pitch. The client sees each one reviewed: Verdikt's own
-- PayPal-settled record of the freelancer (rules), red flags (payment off the platform, budget, timeline),
-- then Claude reads the pitch against the brief
create table if not exists public.job_applications (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid not null references public.jobs (id) on delete cascade,
  freelancer_id  uuid not null references public.profiles (id) on delete cascade,
  pitch          text not null,
  price_cents    int not null check (price_cents >= 100),
  days           int check (days is null or days between 1 and 365),
  via_agent      boolean not null default false,
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  review         jsonb not null default '{}',
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  unique (job_id, freelancer_id)
);
create index if not exists job_applications_job on public.job_applications (job_id, created_at);

alter table public.jobs enable row level security;
alter table public.job_applications enable row level security;
-- open jobs are visible to every member; your own posts always
create policy "members read open jobs" on public.jobs
  for select to authenticated using (status = 'open' or client_id = auth.uid());
-- an application: the applicant and the job's poster
create policy "applicant and poster read applications" on public.job_applications
  for select to authenticated using (
    freelancer_id = auth.uid() or exists (select 1 from public.jobs j where j.id = job_id and j.client_id = auth.uid())
  );
alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.job_applications;

-- ---- price checks are cached by what was asked: the same brief never pays for a second web search
create table if not exists public.price_checks (
  key         text primary key,
  result      jsonb not null,
  tokens      int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.price_checks enable row level security;   -- server only: no policies
