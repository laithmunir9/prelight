import express from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import { aiOpenAIJson } from "./openaiChatClient.js";
import { PERSONA_OPENAI_VOICES, synthesizeOpenAISpeech } from "./openaiSpeechClient.js";
import { PRACTICE_TEMPLATES, TEMPLATE_IDS, findPersona } from "./practiceTemplates.js";
import { buildScenarioKeywordSet, classifyStudentMessage, scenarioFollowUpPolicy, selectResponders, summarizeDelivery, summarizeEngagement } from "./practiceClassifier.js";
import { applyLikelyAsrCorrections } from "./transcriptAsrCorrections.js";
import { transcribeAudioBuffer } from "./openaiTranscriptionClient.js";
import { resolveCurtainCall } from "./curtainCall.js";
import { normalizeTurnAnalysis } from "./turnAnalysis.js";
import { aggregateSpeakingProfile } from "./speakingProfile.js";
import { buildPracticeMemory, practiceMemoryPrompt } from "./practiceMemory.js";
import { normalizePracticeContext, contextPrompt } from "./practiceContext.js";
import {
  MAX_SESSION_EVENTS,
  normalizePracticeSession,
  putPracticeSessionLocal,
  getPracticeSessionLocal,
  listPracticeSessionsLocal,
} from "./sessionStorage.js";
import {
  getStudentByEmailRemote,
  getStudentByIdRemote,
  getStudentBySessionTokenRemote,
  getPracticeSessionRemote,
  listPracticeSessionsRemote,
  putPracticeSessionRemote,
  putStudentRemote,
  supabaseConfigured,
} from "./supabaseStorage.js";

async function aiJsonWithRetry(opts, retries = 1) {
  try {
    return await aiOpenAIJson(opts);
  } catch (e) {
    if (retries <= 0) throw e;
    return aiJsonWithRetry(opts, retries - 1);
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, ".env");

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const configuredDataDir = process.env.PRELIGHT_DATA_DIR || process.env.GREEN_ROOM_DATA_DIR;
const dataDir = configuredDataDir
  ? resolve(configuredDataDir)
  : join(__dirname, "data");
const dbPath = join(dataDir, "students.json");
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

const USE_SUPABASE = supabaseConfigured();

const PORT = Number(process.env.PORT || 3848);
const INVITE_CODE = (process.env.PRELIGHT_INVITE_CODE || process.env.GREEN_ROOM_INVITE_CODE || "").trim();
const CHALLENGE_MODIFIER_PROMPTS = {
  skeptical_audience: "The audience is skeptical. Ask for evidence, specifics, or a concrete example when the student's answer needs it.",
  follow_up_questions: "Ask one concise follow up question after each student answer so they practice extending an idea.",
  short_answer: "Keep the exchange focused on concise answers. Prompt the student to make one clear point in no more than two sentences when appropriate.",
  explain_beginner: "Act like an intelligent beginner. Ask the student to replace jargon with plain language or an example when useful.",
  recover_and_continue: "Occasionally introduce a challenging question or interruption, then give the student room to recover and continue their thought.",
};
const AUDIO_MAX_BYTES = Number(process.env.AUDIO_MAX_BYTES || 6 * 1024 * 1024);
const AUDIO_MAX_SECONDS = Number(process.env.AUDIO_MAX_SECONDS || 45);
const DAILY_LIMITS = {
  scenarioInference: Number(process.env.DAILY_SCENARIO_INFERENCE_LIMIT || 20),
  messages: Number(process.env.DAILY_MESSAGE_LIMIT || 60),
  transcriptPolish: Number(process.env.DAILY_TRANSCRIPT_POLISH_LIMIT || 80),
  transcriptions: Number(process.env.DAILY_TRANSCRIPTION_LIMIT || 12),
  sessionReviews: Number(process.env.DAILY_SESSION_REVIEW_LIMIT || 12),
  tts: Number(process.env.DAILY_TTS_LIMIT || 40),
};
const IP_LIMITS = [
  { path: "/api/practice/transcribe-audio", windowMs: 60 * 60 * 1000, max: Number(process.env.IP_AUDIO_HOURLY_LIMIT || 20) },
  { path: "/api/practice/speak", windowMs: 60 * 60 * 1000, max: Number(process.env.IP_TTS_HOURLY_LIMIT || 80) },
  { path: "/api/practice/message", windowMs: 60 * 60 * 1000, max: Number(process.env.IP_MESSAGE_HOURLY_LIMIT || 120) },
  { path: "/api/practice/end", windowMs: 60 * 60 * 1000, max: Number(process.env.IP_REVIEW_HOURLY_LIMIT || 40) },
  { path: "/api/practice/infer-scenario", windowMs: 60 * 60 * 1000, max: Number(process.env.IP_INFERENCE_HOURLY_LIMIT || 60) },
  { path: "/api/auth/", windowMs: 15 * 60 * 1000, max: Number(process.env.IP_AUTH_15M_LIMIT || 25) },
];
const ipBuckets = new Map();

function loadDb() {
  if (!existsSync(dbPath)) return { students: {} };
  try {
    return JSON.parse(readFileSync(dbPath, "utf8"));
  } catch {
    return { students: {} };
  }
}
function saveDb(db) {
  writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

const PASSWORD_KEYLEN = 64;
const PASSWORD_SALT_BYTES = 16;
const SESSION_TOKEN_BYTES = 32;

function hashPassword(password) {
  const salt = randomBytes(PASSWORD_SALT_BYTES).toString("base64url");
  const hash = scryptSync(String(password), salt, PASSWORD_KEYLEN).toString("base64url");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(s, password) {
  if (!s.passwordHash && !s.password) return false;
  if (s.passwordHash) {
    const [scheme, salt, expected] = String(s.passwordHash).split(":");
    if (scheme !== "scrypt" || !salt || !expected) return false;
    const actual = scryptSync(String(password), salt, PASSWORD_KEYLEN);
    const expectedBuffer = Buffer.from(expected, "base64url");
    return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
  }
  return s.password === password;
}

function requiresPasswordMigration(s) {
  return Boolean(s.password && !s.passwordHash);
}

function issueSessionToken(s) {
  s.sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  return s.sessionToken;
}

function resetDailyUsageIfNeeded(s) {
  const date = todayKey();
  if (!s.usage || s.usage.date !== date) s.usage = { date };
}

function consumeDailyUsage(s, key) {
  resetDailyUsageIfNeeded(s);
  const limit = DAILY_LIMITS[key];
  const used = Number(s.usage[key] || 0);
  if (Number.isFinite(limit) && limit >= 0 && used >= limit) {
    const err = new Error(`Daily limit reached for this feature. Try again tomorrow.`);
    err.status = 429;
    err.limitKey = key;
    throw err;
  }
  s.usage[key] = used + 1;
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function rateLimitFor(path) {
  return IP_LIMITS.find((rule) => path.startsWith(rule.path));
}

function errorStatus(e, fallback = 500) {
  return Number.isInteger(e?.status) ? e.status : fallback;
}

function bearerToken(req) {
  const value = String(req.get("authorization") || "");
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function getStudentById(id) {
  const db = loadDb();
  return db.students[id] || null;
}

function getStudentBySessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const db = loadDb();
  return Object.values(db.students).find((s) => s.sessionToken === token) || null;
}

function putStudent(s) {
  const db = loadDb();
  db.students[s.id] = s;
  saveDb(db);
  return s;
}

async function findStudentByEmail(email) {
  if (USE_SUPABASE) return getStudentByEmailRemote(email);
  const db = loadDb();
  return Object.values(db.students).find((s) => (s.email || "").toLowerCase() === email) || null;
}

async function getStudent(id) {
  if (USE_SUPABASE) return getStudentByIdRemote(id);
  return getStudentById(id);
}

async function getStudentByToken(token) {
  if (USE_SUPABASE) return getStudentBySessionTokenRemote(token);
  return getStudentBySessionToken(token);
}

async function persistStudent(s) {
  if (USE_SUPABASE) return putStudentRemote(s);
  return putStudent(s);
}

function practiceSessionRecord(studentId, practice, status = "active", review = practice.review) {
  return normalizePracticeSession({
    id: practice.sessionId,
    studentId,
    templateId: practice.templateId,
    templateName: practice.templateName,
    scenarioDescription: practice.description,
    scenarioContext: {
      setupAnswer: practice.setupAnswer,
      questId: practice.questId,
      challengeModifier: practice.challengeModifier,
      ...practice.context,
    },
    status,
    startedAt: practice.startedAt,
    endedAt: practice.endedAt,
    events: practice.events,
    review,
    createdAt: practice.startedAt,
    updatedAt: new Date().toISOString(),
  });
}

async function persistPracticeSession(studentId, practice, status = "active", review = practice.review) {
  const session = practiceSessionRecord(studentId, practice, status, review);
  if (!session.id) return null;
  try {
    if (USE_SUPABASE) await putPracticeSessionRemote(session);
    else putPracticeSessionLocal(session);
    return session;
  } catch (e) {
    // Session persistence is additive during migration. Keep the active
    // student record and browser history working if the new table is absent
    // or temporarily unavailable.
    console.error("[session] persistence failed:", e.message || e);
    return null;
  }
}

async function listPracticeSessions(studentId, limit) {
  if (USE_SUPABASE) return (await listPracticeSessionsRemote(studentId, limit)).map(normalizePracticeSession);
  return listPracticeSessionsLocal(studentId, limit);
}

async function getPracticeSession(studentId, id) {
  if (USE_SUPABASE) {
    const session = await getPracticeSessionRemote(studentId, id);
    return session ? normalizePracticeSession(session) : null;
  }
  return getPracticeSessionLocal(studentId, id);
}

function publicPracticeSession(session) {
  if (!session) return null;
  const { studentId, ...publicSession } = normalizePracticeSession(session);
  return publicSession;
}

function newStudent(name, email) {
  return {
    id: randomUUID(),
    name: (name || "Learner").slice(0, 48),
    email: (email || "").trim().toLowerCase().slice(0, 254),
    createdAt: new Date().toISOString(),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanStudentText(s) {
  return String(s ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^\w])\*([^*\n]+)\*(?!\w)/g, "$1$2")
    .replace(/`+/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, (m) => m.replace(/\$/g, ""))
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\r/g, "")
    .trim();
}

function publicStudent(s) {
  return { id: s.id, name: s.name };
}

function cleanPasswordInput(password) {
  return String(password || "");
}

function localFallbackReply(persona, signals) {
  if (signals.stuck) return "Take a breath and try that again from the main point.";
  if (signals.offTopic) return "I may have lost the connection to the question. Could you bring that back to the role?";
  if (signals.selfContradictory) return "Could you clarify that? I heard a couple of ideas that seem to point in different directions.";
  if (signals.vague) return "Could you give me one concrete example of that?";
  if (persona?.id === "impressed") return "That's a clear start. Could you add one specific example to make it stronger?";
  return "Could you say a little more about that?";
}

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.set({
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  next();
});
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  const rule = rateLimitFor(req.path);
  if (!rule) return next();

  const now = Date.now();
  const key = `${req.method}:${rule.path}:${clientIp(req)}`;
  const bucket = ipBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    ipBuckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return next();
  }
  if (bucket.count >= rule.max) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({ error: "Too many requests. Please wait a bit and try again." });
  }
  bucket.count += 1;
  next();
});
app.use(express.static(join(__dirname, "public")));
app.get("/studio", (_req, res) => res.sendFile(join(__dirname, "public", "index.html")));
app.get("/sessionHistory.js", (_req, res) => res.sendFile(join(__dirname, "sessionHistory.js")));
app.get("/sessionReplay.js", (_req, res) => res.sendFile(join(__dirname, "sessionReplay.js")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", async (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 48);
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 254);
  if (!name) return res.status(400).json({ error: "Name required" });
  if (!email) return res.status(400).json({ error: "Email required" });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email" });
  if (INVITE_CODE && String(req.body?.inviteCode || "").trim() !== INVITE_CODE) {
    return res.status(403).json({ error: "Invite code required" });
  }
  const exists = await findStudentByEmail(email);
  if (exists) return res.status(409).json({ error: "An account with that email already exists" });
  const s = newStudent(name, email);
  const pass = cleanPasswordInput(req.body?.password);
  if (pass.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
  s.passwordHash = hashPassword(pass);
  const token = issueSessionToken(s);
  await persistStudent(s);
  res.json({ student: publicStudent(s), token });
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const pass = cleanPasswordInput(req.body?.password);
  const found = await findStudentByEmail(email);
  if (found && !verifyPassword(found, pass)) return res.status(401).json({ error: "No matching account (check email/password)" });
  if (!found) return res.status(401).json({ error: "No matching account (check email/password)" });
  if (requiresPasswordMigration(found)) {
    found.passwordHash = hashPassword(pass);
    delete found.password;
  }
  const token = issueSessionToken(found);
  await persistStudent(found);
  res.json({ student: publicStudent(found), token });
});

app.get("/api/student/me", async (req, res) => {
  const token = bearerToken(req);
  if (!token) {
    res.set("WWW-Authenticate", "Bearer");
    return res.status(401).json({ error: "Authentication required" });
  }
  const s = await getStudentByToken(token);
  if (!s) return res.status(401).json({ error: "Invalid session" });
  res.json({ student: publicStudent(s) });
});

app.get("/api/sessions", async (req, res) => {
  try {
    const token = bearerToken(req);
    if (!token) {
      res.set("WWW-Authenticate", "Bearer");
      return res.status(401).json({ error: "Authentication required" });
    }
    const s = await getStudentByToken(token);
    if (!s) return res.status(401).json({ error: "Invalid session" });
    const sessions = await listPracticeSessions(s.id, req.query?.limit);
    res.json({ sessions: sessions.map(publicPracticeSession) });
  } catch (e) {
    res.status(errorStatus(e)).json({ error: String(e.message || e) });
  }
});

app.get("/api/profile", async (req, res) => {
  try {
    const token = bearerToken(req);
    if (!token) {
      res.set("WWW-Authenticate", "Bearer");
      return res.status(401).json({ error: "Authentication required" });
    }
    const s = await getStudentByToken(token);
    if (!s) return res.status(401).json({ error: "Invalid session" });
    const sessions = await listPracticeSessions(s.id, 50);
    res.json({ profile: aggregateSpeakingProfile(sessions, { maxSessions: 50 }) });
  } catch (e) {
    res.status(errorStatus(e)).json({ error: String(e.message || e) });
  }
});

app.get("/api/sessions/:id", async (req, res) => {
  try {
    const token = bearerToken(req);
    if (!token) {
      res.set("WWW-Authenticate", "Bearer");
      return res.status(401).json({ error: "Authentication required" });
    }
    const s = await getStudentByToken(token);
    if (!s) return res.status(401).json({ error: "Invalid session" });
    const session = await getPracticeSession(s.id, String(req.params.id || "").slice(0, 80));
    // Return 404 for another student's session too, so IDs cannot be used to
    // probe whether private practice content exists.
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({ session: publicPracticeSession(session) });
  } catch (e) {
    res.status(errorStatus(e)).json({ error: String(e.message || e) });
  }
});

// ── Scenario practice sessions ──

app.post("/api/practice/infer-scenario", async (req, res) => {
  try {
    const s = await getStudentByToken(req.body?.studentId);
    if (!s) return res.status(404).json({ error: "Student not found" });
    const description = cleanStudentText(req.body?.description || "").slice(0, 2000);
    if (!description) return res.status(400).json({ error: "Scenario description required" });
    consumeDailyUsage(s, "scenarioInference");
    await persistStudent(s);

    const templateSummaries = TEMPLATE_IDS.map(
      (id) => `- "${id}": ${PRACTICE_TEMPLATES[id].description}`
    ).join("\n");

    const system =
      "You classify a student's free-text scenario description into exactly one practice-session template. " +
      "Choose the single best match from this fixed list, never invent a new one:\n" +
      templateSummaries +
      "\n\nRespond with JSON only: " +
      '{"templateId":"...","confidence":"high"|"medium"|"low","reason":"..."} ' +
      "reason is one short sentence explaining the match. Plain text only, no markdown.";

    let parsed;
    try {
      parsed = await aiJsonWithRetry({ system, user: description, max_tokens: 800, temperature: 0.2 });
    } catch (e) {
      console.error("[ai] scenario inference failed:", e.message || e);
      return res.status(503).json({ error: "Couldn't classify that scenario right now - please try again." });
    }

    let templateId = parsed.templateId;
    let confidence = ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium";
    let reason = cleanStudentText(parsed.reason || "");
    if (!TEMPLATE_IDS.includes(templateId)) {
      templateId = "casual";
      confidence = "low";
      reason = "Couldn't confidently match a specific template - defaulting to casual conversation practice.";
    }

    const template = PRACTICE_TEMPLATES[templateId];
    res.json({
      templateId,
      templateName: template.name,
      confidence,
      reason,
      personas: template.personas.map((p) => ({ id: p.id, name: p.name, trait: p.trait })),
    });
  } catch (e) {
    res.status(errorStatus(e)).json({ error: String(e.message || e) });
  }
});

app.post("/api/practice/start", async (req, res) => {
  try {
    const s = await getStudentByToken(req.body?.studentId);
    if (!s) return res.status(404).json({ error: "Student not found" });
    const { templateId } = req.body || {};
    const template = PRACTICE_TEMPLATES[templateId];
    if (!template) return res.status(400).json({ error: "Unknown template" });
    const description = cleanStudentText(req.body?.description || "").slice(0, 2000);
    if (!description) return res.status(400).json({ error: "Scenario description required" });
    const setupAnswer = cleanStudentText(req.body?.setupAnswer || "").slice(0, 300);
    const context = normalizePracticeContext(req.body?.context, template.id);
    const questId = typeof req.body?.questId === "string" ? req.body.questId.slice(0, 64) : null;
    const challengeModifier = Object.hasOwn(CHALLENGE_MODIFIER_PROMPTS, req.body?.challengeModifier)
      ? req.body.challengeModifier
      : null;

    const keywordSet = buildScenarioKeywordSet(description);
    let practiceMemory = { observations: [] };
    try {
      const completedSessions = await listPracticeSessions(s.id, 50);
      const profile = aggregateSpeakingProfile(completedSessions, { maxSessions: 50 });
      practiceMemory = buildPracticeMemory(profile, template.id);
    } catch (e) {
      // Memory is optional. A profile or persistence failure must not block practice.
      console.error("[profile] memory unavailable:", e.message || e);
    }
    // exam_viva and interview are AI-led: a specific setup answer (topic/role)
    // grounds a real first question instead of waiting on the student to
    // start explaining unprompted. The other templates stay student-led.
    let opener;
    if (templateId === "exam_viva" && setupAnswer) {
      opener = `Alright ${s.name}, let's begin. Walk me through ${setupAnswer} - start wherever makes the most sense to you.`;
    } else if (templateId === "interview" && setupAnswer) {
      opener = `Thanks for coming in, ${s.name}. Let's start here: what draws you to the ${setupAnswer} role, and what relevant experience do you bring?`;
    } else {
      opener = `Alright ${s.name}, whenever you're ready - go ahead.`;
    }

    const startedAt = new Date().toISOString();
    const sessionId = randomUUID();
    s.practice = {
      sessionId,
      templateId: template.id,
      templateName: template.name,
      description,
      setupAnswer,
      keywords: [...keywordSet],
      history: [{ role: "agent", personaId: "facilitator", text: opener }],
      studentTurns: [],
      voiceTurns: [],
      events: [{ type: "facilitator", sequence: 1, occurredAt: startedAt, personaId: "facilitator", text: opener }],
      startedAt,
      endedAt: null,
      questId,
      challengeModifier,
      memory: practiceMemory,
      context,
    };
    await persistStudent(s);
    await persistPracticeSession(s.id, s.practice);

    res.json({
      practice: {
        templateId: template.id,
        templateName: template.name,
        sessionId,
        questId,
        challengeModifier,
        personas: template.personas.map((p) => ({ id: p.id, name: p.name, trait: p.trait })),
      },
      opener,
    });
  } catch (e) {
    res.status(errorStatus(e)).json({ error: String(e.message || e) });
  }
});

app.post("/api/practice/message", async (req, res) => {
  try {
    const s = await getStudentByToken(req.body?.studentId);
    if (!s) return res.status(404).json({ error: "Student not found" });
    if (!s.practice) return res.status(400).json({ error: "No active practice session - call /api/practice/start first" });

    const text = cleanStudentText(req.body?.text || "").slice(0, 2000);
    if (!text) return res.status(400).json({ error: "Message required" });
    consumeDailyUsage(s, "messages");

    // Only trust durationSec when it's a real spoken turn (Web Speech API reports
    // elapsed time) - long enough to rule out browser start/stop timing noise.
    const durationSec = Number(req.body?.durationSec);
    const hasSpokenDuration = Number.isFinite(durationSec) && durationSec >= 0.5;

    const practice = s.practice;
    const template = PRACTICE_TEMPLATES[practice.templateId];
    if (!template) return res.status(500).json({ error: "Unknown template for this session" });

    const keywordSet = new Set(practice.keywords || []);
    const recentStudentMessages = practice.history
      .filter((m) => m.role === "student")
      .slice(-3)
      .map((m) => m.text);
    const previousQuestion = practice.history
      .filter((m) => m.role === "agent")
      .slice(-1)
      .map((m) => m.text)[0] || "";

    const followUpPolicy = scenarioFollowUpPolicy(practice.templateId, practice.description);
    const signals = classifyStudentMessage(text, {
      keywordSet,
      recentStudentMessages,
      scenarioId: practice.templateId,
      scenarioDescription: practice.description,
      previousQuestion,
    });
    const responderIds = selectResponders(signals, Math.random, practice.templateId);

    const personas = responderIds.map((id) => findPersona(practice.templateId, id)).filter(Boolean);
    if (!personas.length) return res.status(500).json({ error: "Could not select a responder" });
    const preparationContextPrompt = contextPrompt(practice.context);
    const memoryPrompt = practiceMemoryPrompt(practice.memory);

    const recentTurns = practice.history.slice(-8).map((m) => {
      const who = m.role === "student" ? "Student" : (findPersona(practice.templateId, m.personaId)?.name || m.personaId);
      return `${who}: ${m.text}`;
    });

    const system =
      "You are running a short scenario role-play. " + template.description + " " +
      (practice.challengeModifier ? CHALLENGE_MODIFIER_PROMPTS[practice.challengeModifier] + " " : "") +
      "Multiple distinct characters respond to the student in character. Stay strictly in character for each " +
      "persona listed below - do not blend their voices together. Keep every reply short (1-3 sentences), plain text, no markdown.\n\n" +
      `Deterministic signals for this student turn: ${JSON.stringify(signals)}\n` +
      `Scenario follow-up policy: ${JSON.stringify(followUpPolicy)}\n` +
      "Use these as hints, not commands. Consider asking for evidence, specificity, clarification, or recovery when it fits " +
      "the scenario and conversation. Do not interrogate a clear answer, and keep casual conversation natural.\n\n" +
      (preparationContextPrompt ? `${preparationContextPrompt}\n\n` : "") +
      (memoryPrompt ? `${memoryPrompt}\n\n` : "") +
      (recentTurns.length ? `Recent conversation:\n${recentTurns.join("\n")}\n\n` : "\n") +
      "Characters responding this turn:\n" +
      personas.map((p) => `- ${p.name} (id: "${p.id}"): ${p.systemPrompt}`).join("\n") +
      "\n\nRespond with JSON only: " +
      '{"replies":[{"personaId":"...","reply":"..."}],"turnAnalysis":{"followUpType":"evidence"|"specificity"|"contradiction"|"clarification"|"recovery"|"none","reason":"..."|null,"claim":"..."|null,"answered":true|false|null,"importance":"low"|"medium"|"high"}} ' +
      "one reply entry per character above, in the same order. turnAnalysis is compact metadata for later review, not user-facing prose.";

    let parsed;
    try {
      parsed = await aiJsonWithRetry({
        system,
        user: text,
        max_tokens: 220 * personas.length + 300,
        temperature: 0.45,
      });
    } catch (e) {
      console.error("[ai] OpenAI practice message generation failed:", e.message || e);
      parsed = {
        replies: personas.map((p) => ({
          personaId: p.id,
          reply: localFallbackReply(p, signals),
        })),
        turnAnalysis: { followUpType: "none" },
      };
    }

    const repliesById = new Map((Array.isArray(parsed.replies) ? parsed.replies : []).map((r) => [r?.personaId, r]));
    const responses = personas
      .map((p) => {
        const r = repliesById.get(p.id);
        const reply = cleanStudentText(r?.reply || "");
        return reply ? { personaId: p.id, name: p.name, reply } : null;
      })
      .filter(Boolean);
    const turnAnalysis = normalizeTurnAnalysis(parsed.turnAnalysis, signals);

    practice.history.push({ role: "student", text });
    practice.studentTurns.push(text);
    practice.turnEvents = practice.turnEvents || [];
    practice.turnEvents.push({
      sequence: (practice.turnEvents.at(-1)?.sequence || 0) + 1,
      occurredAt: new Date().toISOString(),
      studentText: text,
      signals,
      analysis: turnAnalysis,
      responsePersonaIds: responses.map((r) => r.personaId),
    });
    practice.turnEvents = practice.turnEvents.slice(-40);
    if (hasSpokenDuration) {
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      practice.voiceTurns = practice.voiceTurns || [];
      practice.voiceTurns.push({ wordCount, durationSec });
    }
    for (const r of responses) {
      practice.history.push({ role: "agent", personaId: r.personaId, text: r.reply });
    }
    practice.history = practice.history.slice(-40);
    const priorEvent = practice.events?.at(-1);
    practice.events = Array.isArray(practice.events) ? practice.events : [];
    practice.events.push({
      type: "turn",
      sequence: (priorEvent?.sequence || 0) + 1,
      occurredAt: new Date().toISOString(),
      studentText: text,
      facilitator: responses.map((r) => ({ personaId: r.personaId, text: r.reply })),
      signals,
      turnAnalysis,
    });
    practice.events = practice.events.slice(-MAX_SESSION_EVENTS);

    await persistStudent(s);
    await persistPracticeSession(s.id, practice);
    res.json({
      responses,
      turnAnalysis,
      student: publicStudent(s),
    });
  } catch (e) {
    res.status(errorStatus(e)).json({ error: String(e.message || e) });
  }
});

app.post("/api/practice/polish-transcript", async (req, res) => {
  try {
    const s = await getStudentByToken(req.body?.studentId);
    if (!s) return res.status(404).json({ error: "Student not found" });

    const rawTranscript = applyLikelyAsrCorrections(cleanStudentText(req.body?.text || "")).slice(0, 2000);
    if (!rawTranscript) return res.status(400).json({ error: "Transcript required" });
    consumeDailyUsage(s, "transcriptPolish");
    await persistStudent(s);
    res.json({ text: rawTranscript });
  } catch (e) {
    res.status(errorStatus(e)).json({ error: String(e.message || e) });
  }
});

app.post(
  "/api/practice/transcribe-audio",
  express.raw({ type: ["audio/webm", "audio/mp4", "audio/wav", "application/octet-stream"], limit: AUDIO_MAX_BYTES }),
  async (req, res) => {
    try {
      const s = await getStudentByToken(bearerToken(req));
      if (!s) return res.status(404).json({ error: "Student not found" });
      if (!Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: "Audio required" });
      if (req.body.length > AUDIO_MAX_BYTES) return res.status(413).json({ error: "That recording is too large. Try a shorter response." });
      const durationSec = Number(req.query?.durationSec || req.get("x-prelight-duration-sec") || req.get("x-green-room-duration-sec"));
      if (Number.isFinite(durationSec) && durationSec > AUDIO_MAX_SECONDS + 2) {
        return res.status(413).json({ error: `Recordings are limited to ${AUDIO_MAX_SECONDS} seconds. Try a shorter response.` });
      }
      consumeDailyUsage(s, "transcriptions");
      await persistStudent(s);

      const practice = s.practice;
      const prompt = [
        "Prelight speaking practice transcript.",
        practice?.templateName ? `Scenario: ${practice.templateName}.` : "",
        practice?.description ? `Context: ${practice.description}.` : "",
        "Produce a verbatim transcript for coaching, not a polished rewrite.",
        "Preserve filler words and disfluencies exactly when audible, including um, uh, like, you know, repeated words, restarts, and false starts.",
        "The speaker may have an accent or speak casually. Preserve their actual wording.",
        "Likely phrases include police officer, policeman, firefighter, fireman, public speaking, I used to be, and I am very strong.",
      ].filter(Boolean).join(" ");

      const transcribed = await transcribeAudioBuffer(req.body, {
        mimeType: req.get("content-type") || "audio/webm",
        prompt,
      });
      const text = applyLikelyAsrCorrections(cleanStudentText(transcribed)).slice(0, 2000);
      if (!text) return res.status(422).json({ error: "No speech detected" });
      console.log(`[audio] transcribed ${req.body.length} bytes into ${text.split(/\s+/).filter(Boolean).length} words`);
      res.json({ text });
    } catch (e) {
      console.error("[audio] transcription failed:", e.message || e);
      const status = errorStatus(e, /Missing OPENAI_API_KEY/.test(String(e.message || e)) ? 503 : 500);
      const detail = String(e.message || "").replace(/sk-[A-Za-z0-9_-]+/g, "sk-...");
      res.status(status).json({ error: detail || "Couldn't transcribe that audio right now." });
    }
  }
);

app.post("/api/practice/end", async (req, res) => {
  try {
    const s = await getStudentByToken(req.body?.studentId);
    if (!s) return res.status(404).json({ error: "Student not found" });
    if (!s.practice) return res.status(400).json({ error: "No active practice session" });

    const practice = s.practice;
    if (practice.status === "completed" && practice.review) {
      const review = practice.review;
      return res.json({
        rubric: review.rubric,
        bestLine: review.bestLine,
        whyItLanded: review.whyItLanded,
        raw: { delivery: review.delivery, engagement: review.engagement },
        sessionId: practice.sessionId,
        session: publicPracticeSession(practiceSessionRecord(s.id, practice, "completed", review)),
      });
    }
    const studentTexts = practice.studentTurns || [];
    if (!studentTexts.length) {
      return res.status(400).json({ error: "Nothing to review yet - send at least one message first" });
    }
    consumeDailyUsage(s, "sessionReviews");
    await persistStudent(s);

    const delivery = summarizeDelivery(studentTexts, practice.voiceTurns || []);
    const engagement = summarizeEngagement(studentTexts);

    const transcript = practice.history
      .map((m) => {
        const who = m.role === "student" ? "Student" : (findPersona(practice.templateId, m.personaId)?.name || m.personaId);
        return `${who}: ${m.text}`;
      })
      .join("\n");

    const system =
      "You are a warm, encouraging speaking/communication coach reviewing a completed practice session. " +
      `Scenario the student described: "${practice.description}". ` +
      "You will be given the full transcript and two measured signal summaries. Write short (2-4 sentence), " +
      "specific, encouraging coaching feedback for each of three dimensions. Never output a numeric score or grade. " +
      "For articulation, the delivery signals include avgWpm - a real words-per-minute figure measured from the " +
      "student's actual speaking pace (only present when they used the microphone, null otherwise). When it's " +
      "present, weigh in on their pace for this kind of scenario (roughly 120-160 wpm reads as clear and " +
      "conversational for most spoken scenarios; noticeably faster can read as rushed, noticeably slower can read " +
      "as hesitant) - but don't invent a pace comment when avgWpm is null. " +
      "For content correspondence, judge whether what the student actually said stayed relevant and accurate to " +
      "their stated scenario - you are the only one checking this, read the transcript carefully.\n\n" +
      `Measured delivery signals (informational - use as context, don't just restate the numbers): ${JSON.stringify(delivery)}\n` +
      `Measured engagement signals (informational - use as context, don't just restate the numbers): ${JSON.stringify(engagement)}\n\n` +
      "Also pick the single strongest sentence the student actually said and copy it into bestLine " +
      "EXACTLY as it appears in the transcript - character for character. Do not paraphrase it, tidy it, " +
      "fix its grammar, merge two sentences, or compose a new one. If you cannot copy a sentence exactly, " +
      "set bestLine to null. In whyItLanded, write one sentence on what made that line work. " +
      "If the student said too little for any sentence to stand out, set both bestLine and whyItLanded to null.\n\n" +
      "Respond with JSON only: " +
      '{"articulation":"...","engagement":"...","contentCorrespondence":"...","bestLine":"...","whyItLanded":"..."} ' +
      "Plain text only, no markdown.";

    let parsed;
    try {
      parsed = await aiJsonWithRetry({
        system,
        user: transcript,
        max_tokens: 900 + Math.floor(transcript.length / 4),
        temperature: 0.35,
      });
    } catch (e) {
      console.error("[ai] practice end-of-session rubric failed:", e.message || e);
      return res.status(503).json({ error: "Couldn't put together your feedback right now - please try again." });
    }

    practice.endedAt = new Date().toISOString();
    await persistStudent(s);

    const curtain = resolveCurtainCall({
      bestLine: parsed.bestLine,
      whyItLanded: parsed.whyItLanded,
      studentTexts,
    });
    if (curtain.rejected) {
      console.warn("[ai] curtain call dropped: bestLine was not verbatim from the transcript");
    }

    practice.review = {
      rubric: {
        articulation: cleanStudentText(parsed.articulation || ""),
        engagement: cleanStudentText(parsed.engagement || ""),
        contentCorrespondence: cleanStudentText(parsed.contentCorrespondence || ""),
      },
      bestLine: curtain.bestLine,
      whyItLanded: curtain.whyItLanded,
      delivery,
      engagement,
    };
    practice.status = "completed";
    await persistStudent(s);
    const persistedSession = await persistPracticeSession(s.id, practice, "completed", practice.review);

    res.json({
      rubric: practice.review.rubric,
      bestLine: curtain.bestLine,
      whyItLanded: curtain.whyItLanded,
      raw: { delivery, engagement },
      sessionId: practice.sessionId,
      session: persistedSession ? publicPracticeSession(persistedSession) : null,
    });
  } catch (e) {
    res.status(errorStatus(e)).json({ error: String(e.message || e) });
  }
});

app.post("/api/practice/speak", async (req, res) => {
  try {
    const s = await getStudentByToken(req.body?.studentId);
    if (!s) return res.status(404).json({ error: "Student not found" });
    const text = cleanStudentText(req.body?.text || "").slice(0, 2000);
    if (!text) return res.status(400).json({ error: "Text required" });
    consumeDailyUsage(s, "tts");
    await persistStudent(s);
    const personaId = String(req.body?.personaId || "facilitator");
    const voice = PERSONA_OPENAI_VOICES[personaId] || PERSONA_OPENAI_VOICES.facilitator;
    const audio = await synthesizeOpenAISpeech(text, { voice });
    res.set("Content-Type", "audio/mpeg");
    res.set("Cache-Control", "no-store");
    res.send(audio);
  } catch (e) {
    console.error("[tts] synthesis failed:", e.message || e);
    res.status(errorStatus(e, 503)).json({ error: errorStatus(e) === 429 ? String(e.message || e) : "Couldn't generate audio right now." });
  }
});

app.use((err, _req, res, next) => {
  if (!err) return next();
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "That recording is too large. Try a shorter response." });
  }
  console.error("[express]", err.message || err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Prelight -> http://localhost:${PORT}`);
  });
}

process.on("uncaughtException", (e) => console.error("[uncaught]", e?.message || e));
process.on("unhandledRejection", (e) => console.error("[rejection]", e?.message || e));

export { app, bearerToken, hashPassword, issueSessionToken, publicStudent, verifyPassword };
