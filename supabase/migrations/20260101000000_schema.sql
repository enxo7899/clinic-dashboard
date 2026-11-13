-- Klinika Dental Lumi: schema, scheduling rules and row level security.
-- Mirrors src/lib/rules.ts. If you change a rule, change it in both places (the tests in
-- supabase/tests/rls.test.sql check the database side).

create extension if not exists btree_gist;

create type staff_role as enum ('admin', 'receptionist', 'dentist');
create type appt_status as enum ('booked', 'completed', 'no_show', 'cancelled');

create table staff (
  id            text primary key default 's-' || substr(gen_random_uuid()::text, 1, 8),
  auth_user_id  uuid unique references auth.users (id) on delete set null,
  name          text not null,
  role          staff_role not null,
  title         text not null,
  email         text not null unique,
  active        boolean not null default true,
  -- seven entries, Sunday first: [openMinute, closeMinute] or null for a day off
  hours         jsonb,
  default_chair text
);

create table chairs (id text primary key, name text not null);
alter table staff add foreign key (default_chair) references chairs (id);

create table treatments (
  id        text primary key,
  name      text not null,
  minutes   int  not null check (minutes between 15 and 240),
  price_all int  not null check (price_all >= 0),
  performed_by text not null check (performed_by in ('Dentist', 'Hygienist', 'Any'))
);

create table patients (
  id         text primary key default 'p-' || substr(gen_random_uuid()::text, 1, 8),
  name       text not null check (length(trim(name)) >= 3),
  phone      text not null default '',
  dob        date,
  dentist_id text not null references staff (id)
);

create table appointments (
  id            text primary key default 'a-' || substr(gen_random_uuid()::text, 1, 8),
  patient_id    text not null references patients (id),
  dentist_id    text not null references staff (id),
  chair_id      text not null references chairs (id),
  treatment_id  text not null references treatments (id),
  starts_at     timestamp not null,
  ends_at       timestamp not null,
  status        appt_status not null default 'booked',
  cancel_reason text,
  created_by    text references staff (id),
  check (ends_at > starts_at),
  -- no overlaps per dentist, per chair, per patient (cancelled appointments free their slot)
  constraint no_dentist_overlap exclude using gist (dentist_id with =, tsrange(starts_at, ends_at) with &&) where (status <> 'cancelled'),
  constraint no_chair_overlap   exclude using gist (chair_id   with =, tsrange(starts_at, ends_at) with &&) where (status <> 'cancelled'),
  constraint no_patient_overlap exclude using gist (patient_id with =, tsrange(starts_at, ends_at) with &&) where (status <> 'cancelled')
);
create index on appointments (starts_at);

create table notes (
  id         text primary key default 'n-' || substr(gen_random_uuid()::text, 1, 8),
  patient_id text not null references patients (id),
  author_id  text not null references staff (id),
  at         timestamp not null default (now() at time zone 'Europe/Tirane'),
  text       text not null check (length(trim(text)) >= 3)
);

-- ---------------------------------------------------------------- helpers
create function current_staff_id() returns text
language sql stable security definer set search_path = public as $$
  select id from staff where auth_user_id = auth.uid() and active
$$;

create function current_staff_role() returns staff_role
language sql stable security definer set search_path = public as $$
  select role from staff where auth_user_id = auth.uid() and active
$$;

-- "own patient": assigned dentist, or someone with a live appointment with them
create function is_my_patient(pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select current_staff_role() = 'dentist' and (
    exists (select 1 from patients p where p.id = pid and p.dentist_id = current_staff_id())
    or exists (select 1 from appointments a where a.patient_id = pid and a.dentist_id = current_staff_id() and a.status <> 'cancelled')
  )
$$;

create function clinic_window(wd int) returns int[]
language sql immutable as $$
  select case wd when 0 then null when 6 then array[540, 780] else array[540, 1080] end
$$;

-- ---------------------------------------------------------------- appointment rules
create function appointments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t treatments%rowtype;
  p staff%rowtype;
  role_now staff_role := current_staff_role();
  local_now timestamp := (now() at time zone 'Europe/Tirane');
  -- the seed script switches the time rules off; API users (authenticator) can never use this
  seeding boolean := coalesce(current_setting('app.seeding', true), '') = 'on' and session_user not in ('authenticator', 'anon', 'authenticated');
  wd int; own jsonb; cw int[]; ws int; we int; s int; e int;
begin
  -- Dentists may only record an outcome on their own appointments, nothing else.
  if role_now = 'dentist' then
    if tg_op <> 'UPDATE' then raise exception 'Dentists cannot create appointments' using errcode = '42501'; end if;
    if (new.patient_id, new.dentist_id, new.chair_id, new.treatment_id, new.starts_at)
       is distinct from (old.patient_id, old.dentist_id, old.chair_id, old.treatment_id, old.starts_at)
       or new.status not in ('completed', 'no_show') then
      raise exception 'Dentists can only record completed or no-show' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'booked' and (new.status is distinct from old.status or new.starts_at is distinct from old.starts_at) then
    raise exception 'Only booked appointments can change (%).', old.status;
  end if;

  select * into t from treatments where id = new.treatment_id;
  select * into p from staff where id = new.dentist_id;
  new.ends_at := new.starts_at + make_interval(mins => t.minutes);

  if new.status = 'cancelled' then
    if tg_op = 'UPDATE' and old.status = 'booked'
       and new.starts_at - local_now < interval '24 hours' and length(trim(coalesce(new.cancel_reason, ''))) < 3 then
      raise exception 'Cancelling within 24 hours needs a reason' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.status in ('completed', 'no_show') and tg_op = 'UPDATE' and old.status = 'booked' and new.starts_at > local_now and not seeding then
    raise exception 'This appointment has not started yet';
  end if;

  if new.status = 'booked' and not seeding and (tg_op = 'INSERT' or new.starts_at is distinct from old.starts_at
       or new.dentist_id is distinct from old.dentist_id or new.treatment_id is distinct from old.treatment_id) then
    if not p.active or p.role <> 'dentist' then raise exception 'Pick an active dentist or hygienist'; end if;
    if t.performed_by <> 'Any' and t.performed_by <> p.title then raise exception '% is not done by a %', t.name, lower(p.title); end if;
    if new.starts_at < local_now then raise exception 'That time has already passed'; end if;

    wd := extract(dow from new.starts_at)::int;
    own := p.hours -> wd;
    cw := clinic_window(wd);
    if cw is null or own is null or jsonb_typeof(own) = 'null' then
      raise exception '% does not work that day', p.name;
    end if;
    ws := greatest(cw[1], (own ->> 0)::int);
    we := least(cw[2], (own ->> 1)::int);
    s := extract(hour from new.starts_at)::int * 60 + extract(minute from new.starts_at)::int;
    e := s + t.minutes;
    if new.starts_at::date <> new.ends_at::date or s < ws or e > we then
      raise exception 'Outside working hours (% works % to %)', p.name, ws, we;
    end if;
  end if;
  return new;
end $$;

create trigger appointments_guard before insert or update on appointments
for each row execute function appointments_guard();

-- ---------------------------------------------------------------- staff rules
create function staff_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.active and not new.active then
    if new.id = current_staff_id() then raise exception 'You cannot deactivate your own account'; end if;
    if exists (select 1 from appointments a where a.dentist_id = new.id and a.status = 'booked'
               and a.starts_at >= (now() at time zone 'Europe/Tirane')) then
      raise exception '% still has upcoming appointments', new.name;
    end if;
  end if;
  return new;
end $$;

create trigger staff_guard before update on staff for each row execute function staff_guard();

-- ---------------------------------------------------------------- row level security
alter table staff        enable row level security;
alter table chairs       enable row level security;
alter table treatments   enable row level security;
alter table patients     enable row level security;
alter table appointments enable row level security;
alter table notes        enable row level security;

-- staff: admin sees and manages everyone; everyone else sees providers and themselves
create policy staff_read on staff for select to authenticated
  using (current_staff_role() = 'admin' or role = 'dentist' or id = current_staff_id());
create policy staff_admin_write on staff for all to authenticated
  using (current_staff_role() = 'admin') with check (current_staff_role() = 'admin');

create policy chairs_read on chairs for select to authenticated using (current_staff_role() is not null);
create policy chairs_admin on chairs for all to authenticated
  using (current_staff_role() = 'admin') with check (current_staff_role() = 'admin');
create policy treatments_read on treatments for select to authenticated using (current_staff_role() is not null);
create policy treatments_admin on treatments for all to authenticated
  using (current_staff_role() = 'admin') with check (current_staff_role() = 'admin');

-- patients: reception and admin see all; dentists only their own
create policy patients_read on patients for select to authenticated
  using (current_staff_role() in ('admin', 'receptionist') or is_my_patient(id));
create policy patients_write on patients for insert to authenticated
  with check (current_staff_role() in ('admin', 'receptionist'));
create policy patients_update on patients for update to authenticated
  using (current_staff_role() in ('admin', 'receptionist')) with check (current_staff_role() in ('admin', 'receptionist'));

-- appointments: reception and admin manage all; dentists see their own and can record the outcome
create policy appts_read on appointments for select to authenticated
  using (current_staff_role() in ('admin', 'receptionist') or dentist_id = current_staff_id());
create policy appts_insert on appointments for insert to authenticated
  with check (current_staff_role() in ('admin', 'receptionist'));
create policy appts_update on appointments for update to authenticated
  using (current_staff_role() in ('admin', 'receptionist') or dentist_id = current_staff_id())
  with check (current_staff_role() in ('admin', 'receptionist') or dentist_id = current_staff_id());
-- no delete policy: appointments are cancelled, never deleted

-- clinical notes: only the treating dentist. Receptionists and admins get zero rows.
create policy notes_read on notes for select to authenticated
  using (current_staff_role() = 'dentist' and is_my_patient(patient_id));
create policy notes_insert on notes for insert to authenticated
  with check (current_staff_role() = 'dentist' and is_my_patient(patient_id) and author_id = current_staff_id());
-- no update or delete policy: notes are append-only

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
