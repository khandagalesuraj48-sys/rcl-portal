-- =====================================================================
-- RCL ERP – PORTAL, step 1: everything the Portal keeps (run ONCE in the Portal's own Supabase project – rcl-portal)
-- Supabase → SQL Editor → New query → paste → Run. It can be run again safely; it never deletes or changes data.
--
--   companies   Rachana, Sketchline … (name, address, GSTIN, PAN, logo)
--   sites       VTR NH 848, Kolhapur 18B … (code, name, company)
--   modules     Mechanical (live), later Engineering, Store, Billing (name, link, on/off)
--   users       everybody who signs in: email, name, kept password (scrypt – the same form as in Mechanical, so passwords
--               move over unchanged), active, Super Admin mark, the Super Admin's recovery code (kept as a hash)
--   access      who may open which module on which site, and as what (admin / user)
--   sessions    sign-ins (only a fingerprint of each sign-in is kept, never the sign-in itself)
--   audit       who changed what, when
--   counters    sign-in limits (5 wrong passwords → 15 minutes; 60 sign-ins a minute)
--   signing_keys the Portal's key for the module "tickets" (its secret half is kept LOCKED with a key only Vercel has)
-- Every table is for the server only: row level security on, no policy, nothing for anon / authenticated.
-- =====================================================================
create table if not exists public.companies (
  id text primary key, name text not null, address text, gstin text, pan text, logo text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.sites (
  code text primary key check (code ~ '^[A-Z0-9]{1,12}$'), name text not null, company_id text references public.companies (id),
  status text not null default 'active' check (status in ('active', 'closed')), sort int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.modules (
  key text primary key check (key ~ '^[a-z]{2,20}$'), name text not null, url text, status text not null default 'off' check (status in ('live', 'off')),
  sort int not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.users (
  email text primary key check (email = lower(email)), name text not null, password_hash text, active boolean not null default true,
  is_super boolean not null default false, recovery_hash text, last_login_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- there is ONE Super Admin: a second one is refused by the database itself
create unique index if not exists users_one_super on public.users ((is_super)) where is_super;
create table if not exists public.access (
  email text not null references public.users (email) on update cascade, site text not null references public.sites (code),
  module text not null references public.modules (key), role text not null check (role in ('admin', 'user')),
  granted_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (email, site, module)
);
create index if not exists access_site on public.access (site, module);
create table if not exists public.sessions (
  id_hash text primary key, email text not null references public.users (email) on update cascade on delete cascade,
  created_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), expires_at timestamptz not null,
  user_agent text
);
create index if not exists sessions_email on public.sessions (email);
create table if not exists public.audit (
  id bigserial primary key, at timestamptz not null default now(), actor text, action text not null, target text, detail jsonb
);
create index if not exists audit_at on public.audit (at desc);
create table if not exists public.counters (
  key text primary key, n int not null default 0, expires_at timestamptz not null
);
create table if not exists public.signing_keys (
  kid text primary key, public_jwk jsonb not null, private_sealed text not null, active boolean not null default true,
  created_at timestamptz not null default now()
);

-- one count, done inside the database (two sign-ins at the same moment can never both slip under the limit)
create or replace function public.portal_hit(p_key text, p_ttl int) returns int language plpgsql security definer set search_path = '' as $$
declare v int;
begin
  insert into public.counters as c (key, n, expires_at) values (p_key, 1, now() + make_interval(secs => p_ttl))
  on conflict (key) do update set
    n = case when c.expires_at < now() then 1 else c.n + 1 end,
    expires_at = case when c.expires_at < now() then now() + make_interval(secs => p_ttl) else c.expires_at end
  returning n into v;
  if random() < 0.01 then delete from public.counters where expires_at < now() - interval '1 hour'; end if;
  return v;
end $$;
create or replace function public.portal_unhit(p_key text) returns void language sql security definer set search_path = '' as $$
  delete from public.counters where key = p_key;
$$;
create or replace function public.portal_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['companies', 'sites', 'modules', 'users', 'access'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.portal_touch()', t || '_touch', t);
  end loop;
  foreach t in array array['companies', 'sites', 'modules', 'users', 'access', 'sessions', 'audit', 'counters', 'signing_keys'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on sequence public.audit_id_seq to service_role;
revoke all on function public.portal_hit(text, int) from public, anon, authenticated;
revoke all on function public.portal_unhit(text) from public, anon, authenticated;
revoke all on function public.portal_touch() from public, anon, authenticated;
grant execute on function public.portal_hit(text, int) to service_role;
grant execute on function public.portal_unhit(text) to service_role;

-- the first module: Mechanical (its link is set by the Super Admin in the Portal)
insert into public.modules (key, name, status, sort) values ('mechanical', 'Mechanical', 'live', 1) on conflict (key) do nothing;

-- the database's web layer learns the new tables at once
notify pgrst, 'reload schema';

select 'Portal step 1 done · companies ' || (select count(*) from public.companies) || ' · sites ' || (select count(*) from public.sites)
       || ' · users ' || (select count(*) from public.users) || ' · modules ' || (select count(*) from public.modules) as done;
