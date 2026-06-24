-- Accumn API order tracking
-- Supports BSA, INSIGHTS, and ITR_GST product lines
create table if not exists accumn_api_orders (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references credit_cases(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  ff_order_id     text,
  product_type    text not null check (product_type in ('INSIGHTS', 'BSA', 'ITR_GST')),
  order_status    text not null default 'pending'
                  check (order_status in ('pending', 'submitting', 'in_progress', 'completed', 'cancelled', 'failed')),
  consent_link    text,
  identifier      text,
  files_metadata  jsonb not null default '[]',
  report_data     jsonb not null default '{}',
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table accumn_api_orders enable row level security;

drop policy if exists "accumn_orders_select" on accumn_api_orders;
drop policy if exists "accumn_orders_insert" on accumn_api_orders;
drop policy if exists "accumn_orders_delete" on accumn_api_orders;

create policy "accumn_orders_select" on accumn_api_orders
  for select to authenticated using (true);

create policy "accumn_orders_insert" on accumn_api_orders
  for insert to authenticated with check (auth.uid() = user_id);

create policy "accumn_orders_delete" on accumn_api_orders
  for delete to authenticated using (auth.uid() = user_id);

create index if not exists accumn_api_orders_case_idx on accumn_api_orders (case_id);
create index if not exists accumn_api_orders_ff_order_idx on accumn_api_orders (ff_order_id)
  where ff_order_id is not null;
