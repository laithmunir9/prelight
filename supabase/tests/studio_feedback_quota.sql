begin;
do $$
declare
  student uuid := gen_random_uuid();
  other_student uuid := gen_random_uuid();
  result jsonb;
  i integer;
begin
  insert into public.students(id,name,email) values
    (student,'Quota test',student::text||'@example.invalid'),
    (other_student,'Isolation test',other_student::text||'@example.invalid');
  for i in 1..5 loop
    result := public.reserve_studio_feedback(student,lpad(i::text,64,'0'));
    assert result->>'status'='reserved', 'Reservation failed';
    assert (result->>'remaining')::int=5-i, 'Incorrect allowance';
  end loop;
  result := public.reserve_studio_feedback(student,lpad('6',64,'0'));
  assert result->>'status'='limit', 'Sixth request allowed';
  result := public.reserve_studio_feedback(student,lpad('1',64,'0'));
  assert result->>'status'='pending', 'Duplicate not reused';
  assert (select count(*) from public.studio_feedback_requests where student_id=student)=5, 'Duplicate charged';
  result := public.reserve_studio_feedback(other_student,lpad('1',64,'0'));
  assert result->>'status'='reserved' and (result->>'remaining')::int=4, 'Accounts not isolated';
  update public.studio_feedback_requests set status='completed',feedback='{"observation":"test","exercise":"test"}' where student_id=student and request_key=lpad('1',64,'0');
  result := public.reserve_studio_feedback(student,lpad('1',64,'0'));
  assert result->>'status'='completed' and result->'feedback'->>'observation'='test', 'Cache missing';
  update public.studio_feedback_requests set usage_date=usage_date-1 where student_id=student;
  result := public.reserve_studio_feedback(student,lpad('6',64,'0'));
  assert (result->>'remaining')::int=4, 'Daily reset failed';
  assert (select bool_and(relrowsecurity) from pg_class where oid in ('public.students'::regclass,'public.practice_sessions'::regclass,'public.studio_feedback_requests'::regclass)), 'RLS missing';
  assert not has_table_privilege('anon','public.studio_feedback_requests','SELECT,INSERT,UPDATE,DELETE'), 'Anon table access';
  assert not has_table_privilege('authenticated','public.studio_feedback_requests','SELECT,INSERT,UPDATE,DELETE'), 'Client table access';
  assert not has_function_privilege('anon','public.reserve_studio_feedback(uuid,text)','EXECUTE'), 'Anon RPC access';
  assert not has_function_privilege('authenticated','public.reserve_studio_feedback(uuid,text)','EXECUTE'), 'Client RPC access';
  assert has_function_privilege('service_role','public.reserve_studio_feedback(uuid,text)','EXECUTE'), 'Server RPC blocked';
end $$;
set local role service_role;
select public.studio_feedback_quota(gen_random_uuid())->>'remaining' = '5' as service_role_quota_ok;
rollback;
