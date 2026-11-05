-- ============================================
-- Verdikt — the full contract flow
-- onboarding fields, invitations, signatures, drafting status,
-- milestone descriptions, live verification progress, attempts.
-- ============================================

-- ---- Profiles: onboarding ----
alter table public.profiles
  add column if not exists intent text not null default 'client' check (intent in ('client', 'freelancer', 'both')),
  add column if not exists onboarded_at timestamptz;

-- ---- Contracts: invitations, signatures, drafting ----
alter table public.contracts
  add column if not exists invite_email text,
  add column if not exists client_signed_at timestamptz,
  add column if not exists freelancer_signed_at timestamptz;

alter table public.contracts drop constraint if exists contracts_status_check;
alter table public.contracts add constraint contracts_status_check
  check (status in ('drafting', 'negotiating', 'active', 'completed', 'cancelled'));

-- ---- Milestones: what's delivered, live verification progress ----
alter table public.milestones
  add column if not exists description text not null default '',
  add column if not exists progress jsonb;

-- ---- Criteria: how the agent checks it ----
alter table public.criteria
  add column if not exists method text not null default '';

-- ---- Submissions: attempt number ----
alter table public.submissions
  add column if not exists attempt int not null default 1;

-- Invitations are matched by email: let a signed-in user read contracts addressed to them
create policy "invitees read their invitation" on public.contracts
  for select to authenticated using (lower(invite_email) = lower(auth.jwt() ->> 'email'));

-- Realtime for signatures and drafting status
alter publication supabase_realtime add table public.contracts;

-- Screenshots of public sites: readable by link so both parties' browsers can show them
update storage.buckets set public = true where id = 'evidence';
