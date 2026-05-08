create table if not exists gst_accumn_reports (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null unique references credit_cases(id) on delete cascade,
  document_id uuid references financial_documents(id) on delete set null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  report_data jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table gst_accumn_reports enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'gst_accumn_reports' and policyname = 'accumn_reports_user_rls'
  ) then
    execute 'create policy "accumn_reports_user_rls" on gst_accumn_reports for all using (auth.uid() = user_id) with check (auth.uid() = user_id)';
  end if;
end $$;
