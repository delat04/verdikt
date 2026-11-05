-- Which PayPal MCP tools the dispute agent used, shown next to its answer
alter table public.disputes
  add column if not exists agent_trace jsonb not null default '[]';
