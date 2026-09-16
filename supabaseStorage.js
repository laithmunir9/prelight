function config() {
  const secretKey = (process.env.SUPABASE_SECRET_KEY || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return {
    url: (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, ""),
    key: secretKey || serviceRoleKey,
    serviceRoleKey,
  };
}

export function supabaseConfigured() {
  const { url, key } = config();
  return Boolean(url && key);
}

function headers(extra = {}) {
  const { key, serviceRoleKey } = config();
  const result = {
    apikey: key,
    ...extra,
  };
  if (serviceRoleKey) result.Authorization = `Bearer ${serviceRoleKey}`;
  return result;
}

function rowToStudent(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash || undefined,
    sessionToken: row.session_token || undefined,
    createdAt: row.created_at,
    usage: row.usage || {},
    practice: row.practice || null,
  };
}

function rowToPracticeSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    studentId: row.student_id,
    templateId: row.template_id,
    templateName: row.template_name,
    scenarioDescription: row.scenario_description,
    scenarioContext: row.scenario_context || {},
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    events: row.events || [],
    review: row.review || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function request(path, options = {}) {
  const { url } = config();
  const response = await fetch(`${url}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10000),
    headers: headers(options.headers),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

export async function getStudentByIdRemote(id) {
  const rows = await request(`/rest/v1/students?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  return rowToStudent(rows[0]);
}

export async function getStudentByEmailRemote(email) {
  const rows = await request(`/rest/v1/students?select=*&email=eq.${encodeURIComponent(email)}&limit=1`);
  return rowToStudent(rows[0]);
}

export async function getStudentBySessionTokenRemote(token) {
  const rows = await request(`/rest/v1/students?select=*&session_token=eq.${encodeURIComponent(token)}&limit=1`);
  return rowToStudent(rows[0]);
}

export async function putStudentRemote(student) {
  const row = {
    id: student.id,
    name: student.name,
    email: student.email,
    password_hash: student.passwordHash || null,
    session_token: student.sessionToken || null,
    created_at: student.createdAt,
    usage: student.usage || {},
    practice: student.practice || null,
  };
  await request("/rest/v1/students?on_conflict=id", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  return student;
}

export async function putPracticeSessionRemote(session) {
  const row = {
    id: session.id,
    student_id: session.studentId,
    template_id: session.templateId,
    template_name: session.templateName,
    scenario_description: session.scenarioDescription,
    scenario_context: session.scenarioContext || {},
    status: session.status,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    events: session.events || [],
    review: session.review || null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  };
  await request("/rest/v1/practice_sessions?on_conflict=id", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  return session;
}

export async function listPracticeSessionsRemote(studentId, limit = 20) {
  const boundedLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const rows = await request(
    `/rest/v1/practice_sessions?select=*&student_id=eq.${encodeURIComponent(studentId)}&status=eq.completed&order=started_at.desc&limit=${boundedLimit}`
  );
  return rows.map(rowToPracticeSession);
}

export async function getPracticeSessionRemote(studentId, id) {
  const rows = await request(
    `/rest/v1/practice_sessions?select=*&student_id=eq.${encodeURIComponent(studentId)}&id=eq.${encodeURIComponent(id)}&limit=1`
  );
  return rowToPracticeSession(rows[0]);
}

// All feedback operations are server-only; studentId comes from verified sign-in.
export const studioFeedbackStore = {
  quota: studentId => request('/rest/v1/rpc/studio_feedback_quota', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_student_id:studentId})}),
  reserve: (studentId,key) => request('/rest/v1/rpc/reserve_studio_feedback', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({p_student_id:studentId,p_request_key:key})}),
  complete: async (studentId,key,feedback) => { const rows = await request(`/rest/v1/studio_feedback_requests?student_id=eq.${encodeURIComponent(studentId)}&request_key=eq.${key}&status=eq.pending`, {method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({status:'completed',feedback})}); if(!Array.isArray(rows)||rows.length!==1) throw new Error('Feedback reservation was not completed'); },
  failed: (studentId,key) => request(`/rest/v1/studio_feedback_requests?student_id=eq.${encodeURIComponent(studentId)}&request_key=eq.${key}&status=eq.pending`, {method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({status:'failed'})}),
};
