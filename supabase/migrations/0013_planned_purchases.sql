-- ============================================
-- Verdikt — planned purchases: products pinned to a milestone's expense budget from live listings (Channel3)
-- ============================================

-- ---- each entry is a listing as it was when pinned: { id, title, brand, image, priceCents, currency, domain, url,
-- plannedBy, viaAgent, at }. A receipt from the same store near the listed price is a planned purchase and is
-- reimbursed on its own; anything off the plan waits for the client.
alter table public.milestones add column if not exists expense_products jsonb not null default '[]'::jsonb;
