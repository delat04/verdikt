-- ============================================
-- Verdikt — expense budgets, reimbursed against receipts
-- ============================================

-- ---- a milestone may carry an expense budget (a domain, hosting, fonts, API credits…): agreed with the terms,
-- held in the same PayPal authorization as the work, reimbursed one receipt at a time by partial captures.
-- Whatever isn't spent goes back to the client when the milestone settles.
alter table public.milestones
  add column if not exists expense_budget_cents int not null default 0 check (expense_budget_cents >= 0),
  add column if not exists expense_covers       text[] not null default '{}';

-- ---- one claim per receipt. Deterministic checks read it (PDF text, or OCR for a photo): the amount is on the
-- receipt, it fits the budget, it's dated inside the contract, it wasn't claimed before, it's something the
-- budget covers. All pass → reimbursed now; one fails → rejected with the reason; one can't be read → the client decides.
create table if not exists public.expenses (
  id                uuid primary key default gen_random_uuid(),
  milestone_id      uuid not null references public.milestones (id) on delete cascade,
  contract_id       uuid not null references public.contracts (id) on delete cascade,
  via_agent         boolean not null default false,
  amount_cents      int not null check (amount_cents > 0),
  merchant          text not null default '',
  purpose           text not null default '',
  receipt_path      text,
  receipt_name      text not null default '',
  receipt_type      text not null default '',
  receipt_sha256    text not null,
  receipt_text      text not null default '',
  extracted         jsonb not null default '{}',
  -- { via: 'pdf'|'ocr', total, amounts[], dates[], refs[], merchant }
  checks            jsonb not null default '[]',
  -- [{ key, label, status: 'pass'|'fail'|'unknown', observed, fix, by: 'rules'|'claude' }]
  status            text not null default 'checking'
                    check (status in ('checking', 'needs_client', 'approved', 'rejected', 'declined', 'expired', 'error')),
  decided_by        text check (decided_by in ('rules', 'claude', 'client')),
  note              text not null default '',
  tokens            int not null default 0,
  paypal_capture_id text,
  payout_batch_id   text,
  payout_status     text,
  payout_email      text,
  paid_out_at       timestamptz,
  created_at        timestamptz not null default now(),
  decided_at        timestamptz
);
create index if not exists expenses_milestone on public.expenses (milestone_id, created_at);
create index if not exists expenses_receipt on public.expenses (receipt_sha256);
create index if not exists expenses_payout on public.expenses (payout_batch_id);
alter table public.expenses enable row level security;
create policy "parties read expenses" on public.expenses
  for select to authenticated using (public.is_party(contract_id));
alter publication supabase_realtime add table public.expenses;

-- receipts are private: both parties open them through short-lived signed links from the API
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
  on conflict (id) do nothing;
