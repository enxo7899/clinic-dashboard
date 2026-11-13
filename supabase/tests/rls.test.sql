-- Database-side proof of the rules. Run against a THROWAWAY local Postgres (see README, `npm run test:db`):
-- it creates a minimal stand-in for Supabase's auth schema, applies the migration and seed, then tries to break each rule.
\set ON_ERROR_STOP on
do $$ begin if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
\ir ../migrations/20260101000000_schema.sql
\ir ../seed.sql

insert into auth.users (id) select gen_random_uuid() from staff;
update staff s set auth_user_id = u.id from (select id, row_number() over (order by id) rn from auth.users) u
  join (select id, row_number() over (order by id) rn from staff) st on st.rn = u.rn where s.id = st.id;

create function as_user(staff_id text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', (select auth_user_id::text from staff where id = staff_id), false);
  set role authenticated;
end $$;
create function reset_user() returns void language plpgsql as $$ begin reset role; perform set_config('request.jwt.claim.sub', '', false); end $$;
create function expect_error(stmt text, expected text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || expected || '%' then return; end if;
    raise exception 'wrong error for [%]: got "%", wanted "%"', stmt, sqlerrm, expected;
  end;
  raise exception 'expected a failure but the statement succeeded: %', stmt;
end $$;
grant execute on all functions in schema public to authenticated;
grant usage on schema auth to authenticated;
grant select on auth.users to authenticated;

-- an appointment starting in about 3 hours, inserted as the table owner so the rule under test is only the cancellation one
set app.seeding = 'on';
delete from appointments where starts_at between now() - interval '1 day' and now() + interval '2 days';
insert into appointments (id, patient_id, dentist_id, chair_id, treatment_id, starts_at)
  values ('a-soon', 'p-005', 's-elira', 'c2', 't-checkup', (now() at time zone 'Europe/Tirane') + interval '3 hours');
reset app.seeding;

-- a clean future Thursday, nothing booked there by the seed relative to next week
create temp table t_day as select (date_trunc('week', now() at time zone 'Europe/Tirane')::date + 7 + 3) as d;
grant select on t_day to authenticated;

do $$
declare n int; d date := (select d from t_day);
  other text := (select id from patients where dentist_id <> 's-elira' and not exists (select 1 from appointments a where a.patient_id = patients.id and a.dentist_id = 's-elira') limit 1);
begin
  -- 1. receptionist sees zero clinical notes
  perform as_user('s-gerta');
  select count(*) into n from notes;
  assert n = 0, 'receptionist must see no notes';
  perform expect_error('insert into notes (patient_id, author_id, text) values (''p-001'', ''s-gerta'', ''hello'')', 'row-level security');
  perform reset_user();

  -- 2. admin sees no notes either, but sees everything else
  perform as_user('s-ilir');
  select count(*) into n from notes; assert n = 0, 'admin must see no notes';
  select count(*) into n from appointments; assert n > 50, 'admin sees all appointments';
  perform reset_user();

  -- 3. dentist sees only own appointments and own patients
  perform as_user('s-elira');
  select count(*) into n from appointments where dentist_id <> 's-elira'; assert n = 0, 'dentist sees only own appointments';
  select count(*) into n from notes; assert n > 0, 'dentist sees own patients notes';
  select count(*) into n from notes where patient_id in (select id from patients where dentist_id <> 's-elira' and not exists (select 1 from appointments a where a.patient_id = patients.id and a.dentist_id = 's-elira'));
  assert n = 0, 'no notes of other dentists patients';
  perform expect_error(format('insert into notes (patient_id, author_id, text) values (%L, ''s-elira'', ''not my patient'')', other), 'row-level security');
  perform reset_user();

  -- 4. reception can book; overlaps and hours are refused by the database
  perform as_user('s-gerta');
  insert into appointments (patient_id, dentist_id, chair_id, treatment_id, starts_at) values ('p-001', 's-arben', 'c1', 't-checkup', d + time '10:00');
  perform expect_error(format('insert into appointments (patient_id, dentist_id, chair_id, treatment_id, starts_at) values (''p-002'', ''s-arben'', ''c1'', ''t-checkup'', %L)', d + time '10:15'), 'no_dentist_overlap');
  perform expect_error(format('insert into appointments (patient_id, dentist_id, chair_id, treatment_id, starts_at) values (''p-003'', ''s-elira'', ''c1'', ''t-checkup'', %L)', d + time '10:15'), 'no_chair_overlap');
  perform expect_error(format('insert into appointments (patient_id, dentist_id, chair_id, treatment_id, starts_at) values (''p-001'', ''s-elira'', ''c2'', ''t-checkup'', %L)', d + time '10:00'), 'no_patient_overlap');
  perform expect_error(format('insert into appointments (patient_id, dentist_id, chair_id, treatment_id, starts_at) values (''p-004'', ''s-elira'', ''c2'', ''t-checkup'', %L)', d + time '07:00'), 'working hours');
  perform expect_error(format('insert into appointments (patient_id, dentist_id, chair_id, treatment_id, starts_at) values (''p-004'', ''s-elira'', ''c2'', ''t-checkup'', %L)', d + 3 + time '10:00'), 'does not work');
  perform expect_error(format('insert into appointments (patient_id, dentist_id, chair_id, treatment_id, starts_at) values (''p-004'', ''s-arben'', ''c2'', ''t-clean'', %L)', d + time '12:00'), 'not done by');
  perform expect_error('insert into appointments (patient_id, dentist_id, chair_id, treatment_id, starts_at) values (''p-004'', ''s-elira'', ''c2'', ''t-checkup'', now() - interval ''1 year'')', 'passed');

  -- 5. cancellation within 24h needs a reason; later cancellations do not
  perform expect_error('update appointments set status = ''cancelled'' where id = ''a-soon''', 'needs a reason');
  update appointments set status = 'cancelled', cancel_reason = 'Patient called, flu' where id = 'a-soon';
  update appointments set status = 'cancelled' where patient_id = 'p-001' and starts_at = d + time '10:00';
  perform reset_user();

  -- 6. dentists cannot create, move or cancel; only record an outcome
  perform as_user('s-arben');
  perform expect_error(format('insert into appointments (patient_id, dentist_id, chair_id, treatment_id, starts_at) values (''p-004'', ''s-arben'', ''c1'', ''t-checkup'', %L)', d + time '12:00'), 'cannot create');
  perform expect_error('update appointments set status = ''cancelled'', cancel_reason = ''because'' where dentist_id = ''s-arben'' and status = ''booked''', 'only record');
  perform reset_user();

  -- 7. only admin manages staff; a dentist with upcoming work cannot be switched off
  perform as_user('s-gerta');
  update staff set name = 'X' where id = 's-anila';
  get diagnostics n = row_count; assert n = 0, 'receptionist cannot edit staff';
  perform reset_user();
  insert into appointments (patient_id, dentist_id, chair_id, treatment_id, starts_at) values ('p-006', 's-arben', 'c1', 't-checkup', d + time '15:00');
  perform as_user('s-ilir');
  perform expect_error('update staff set active = false where id = ''s-arben''', 'upcoming');
  perform reset_user();
  raise notice 'all database rule checks passed';
end $$;
