-- ============================================
-- Verdikt — portfolio: past projects a freelancer lists, checked live by the same probes as a delivery
-- ============================================

-- ---- a project is the freelancer's claim (a title, what they built, a live site and maybe a repo). The check
-- is Verdikt's: the deterministic probes open the site at desktop and phone sizes and read the repo, and the
-- result is stored with the project, so a client sees which claims a machine has looked at, and when.
create table if not exists public.portfolio_items (
  id             uuid primary key default gen_random_uuid(),
  freelancer_id  uuid not null references public.profiles (id) on delete cascade,
  title          text not null check (char_length(title) between 2 and 80),
  summary        text not null default '',     -- what they built, in their words (not checked)
  live_url       text not null,
  repo_url       text,
  position       int not null default 0,
  check_result   jsonb,                        -- the last check: counts, each check with what was measured
  checked_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists portfolio_items_freelancer on public.portfolio_items (freelancer_id, position, created_at);

alter table public.portfolio_items enable row level security;
create policy "owner reads portfolio items" on public.portfolio_items
  for select to authenticated using (freelancer_id = auth.uid());
