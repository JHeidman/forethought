-- Invite requests from the public landing page.
-- No policies on purpose: only the server (service role) reads or writes this table.

create table if not exists invite_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  handicap_range text,
  wants text,
  source text,
  status text not null default 'pending',
  invite_code text,
  created_at timestamptz not null default now()
);

create index if not exists invite_requests_created_at_idx on invite_requests (created_at desc);

alter table invite_requests enable row level security;

grant all on invite_requests to service_role;
