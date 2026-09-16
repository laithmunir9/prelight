-- Custom account tokens are verified by Express, not Supabase Auth JWTs.
-- Browser roles have no direct access; only the server service role can use these tables.
alter table public.students enable row level security;
alter table public.practice_sessions enable row level security;
revoke all on public.students, public.practice_sessions from public, anon, authenticated;

create table public.studio_feedback_requests (
  student_id uuid not null references public.students(id) on delete cascade,
  request_key text not null check (request_key ~ '^[a-f0-9]{64}$'),
  usage_date date not null default (now() at time zone 'UTC')::date,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','completed','failed')),
  feedback jsonb,
  primary key (student_id, request_key)
);
create index studio_feedback_daily_idx on public.studio_feedback_requests(student_id,usage_date);
alter table public.studio_feedback_requests enable row level security;
revoke all on public.studio_feedback_requests from public, anon, authenticated;
grant select,insert,update,delete on public.students, public.practice_sessions, public.studio_feedback_requests to service_role;

create function public.studio_feedback_quota(p_student_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'limit',5,'used',count(*),'remaining',greatest(0,5-count(*)),
    'resetAt',((now() at time zone 'UTC')::date+1)::timestamp at time zone 'UTC'
  ) from public.studio_feedback_requests
  where student_id=p_student_id and usage_date=(now() at time zone 'UTC')::date;
$$;
revoke all on function public.studio_feedback_quota(uuid) from public,anon,authenticated;
grant execute on function public.studio_feedback_quota(uuid) to service_role;

create function public.reserve_studio_feedback(p_student_id uuid,p_request_key text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  existing public.studio_feedback_requests%rowtype;
  allowance jsonb;
begin
  if p_student_id is null or p_request_key is null or p_request_key !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid feedback request';
  end if;
  -- Serialize all requests for this account, even across multiple server instances.
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text,0));
  allowance := public.studio_feedback_quota(p_student_id);
  select * into existing from public.studio_feedback_requests
    where student_id=p_student_id and request_key=p_request_key;
  if found then
    if existing.status='pending' and existing.created_at < now()-interval '2 minutes' then
      update public.studio_feedback_requests set status='failed'
      where student_id=p_student_id and request_key=p_request_key;
      existing.status := 'failed';
    end if;
    return allowance || jsonb_build_object('status',existing.status,'feedback',existing.feedback);
  end if;
  if (allowance->>'remaining')::integer <= 0 then
    return allowance || jsonb_build_object('status','limit');
  end if;
  insert into public.studio_feedback_requests(student_id,request_key) values(p_student_id,p_request_key);
  return public.studio_feedback_quota(p_student_id) || jsonb_build_object('status','reserved');
end;
$$;
revoke all on function public.reserve_studio_feedback(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_studio_feedback(uuid,text) to service_role;

