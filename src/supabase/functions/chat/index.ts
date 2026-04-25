import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ════════════════════════════════════════════════════════════════════
// ██  SECURITY CONFIG
// ════════════════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
].filter(Boolean);

const MAX_MESSAGE_LENGTH = 1000;   // chars per message
const MAX_MESSAGES_PER_CONVO = 100;    // hard cap per conversation
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 20;     // requests per IP per window
const AI_TIMEOUT_MS = 10_000; // 10 s before aborting
const MAX_RETRY_ATTEMPTS = 2;      // retry count on transient errors

// In-memory rate limiter (per Edge Function instance — fast, zero cost)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_STATUSES = new Set(["HOT", "WARM", "COLD"]);
const STATUS_PRIORITY: Record<string, number> = { COLD: 0, WARM: 1, HOT: 2 };

// ════════════════════════════════════════════════════════════════════
// ██  SECURITY HELPERS
// ════════════════════════════════════════════════════════════════════

/** Only allow requests from your own domain */
function getCorsHeaders(origin: string | null): HeadersInit {
  const allowed =
    origin && ALLOWED_ORIGINS.length > 0
      ? ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
      : "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

/** Token bucket rate limiter — prevents spam and abuse */
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false; // not limited
  }
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) return true; // limited
  entry.count++;
  return false;
}

/** Strip control characters and enforce length */
function sanitizeMessage(input: string): string {
  return input
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/** Validate every input field before touching the DB */
function validateRequest(body: unknown): {
  ok: true;
  message: string;
  userId: string;
  conversationId: string | null;
  stream: boolean;
} | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request body" };

  const { message, userId, conversationId, stream } = body as Record<string, unknown>;

  if (typeof message !== "string" || !message.trim())
    return { ok: false, error: "message is required and must be a non-empty string" };

  if (typeof userId !== "string" || !UUID_REGEX.test(userId))
    return { ok: false, error: "userId must be a valid UUID" };

  if (conversationId !== undefined && conversationId !== null) {
    if (typeof conversationId !== "string" || !UUID_REGEX.test(conversationId))
      return { ok: false, error: "conversationId must be a valid UUID or null" };
  }

  return {
    ok: true,
    message: sanitizeMessage(message),
    userId,
    conversationId: typeof conversationId === "string" ? conversationId : null,
    stream: stream === true,
  };
}

// ════════════════════════════════════════════════════════════════════
// ██  STEP 2 — SYSTEM PROMPT (Full Arabic + Objections + Qualification)
// ════════════════════════════════════════════════════════════════════

function buildSystemPrompt(plansData: string, tone: string): string {
  const toneLabel =
    tone === "friendly"
      ? "ودود ومحفز — بتتكلم زي صاحب حميم بيساعد"
      : tone === "sales"
        ? "مبيعاتي ومقنع — بتركز على القيمة والنتيجة"
        : "محايد ومهني — واضح ومباشر";

  return `أنت مساعد مبيعات لياقة بدنية اسمك Agent X.
بتكلم بالعامية المصرية بشكل طبيعي تماماً — مش فصحى خالص.

== هدفك ==
١. افهم هدف الزائر أول حاجة
٢. اسأل عن: وزنه، مستواه الحالي، وقته المتاح
٣. وصّيه بالخطة المناسبة بعد ما تفهمه
٤. تعامل مع أي اعتراض بذكاء وهدوء
٥. وجّهه لطريقة الاشتراك

== تسلسل المحادثة (مهم — اتبعه بالترتيب) ==
المرحلة ١ — افهم الهدف أول:
  اسأل: "إيه اللي بتحاول توصله؟ تخسيس، تضخيم، أو لياقة عامة؟"

المرحلة ٢ — افهم الوضع الحالي:
  اسأل: "بتتمرن دلوقتي ولا بتبدأ من الصفر؟"

المرحلة ٣ — اقترح الخطة المناسبة:
  بناءً على إجاباته، وصّيه بخطة محددة واشرحها بإيجاز

المرحلة ٤ — عالج أي اعتراض:
  غالي        → "فاهمك — خليني أوريلك القيمة الحقيقية اللي هتحس بيها من أول أسبوع"
  تقسيط       → "أيوه متاح — تقدر تبدأ بدفعة أولى صغيرة والباقي على دفعتين"
  مش قادر أكمل → "ده طبيعي جداً في الأول — الكوتش بيكون جنبك خطوة بخطوة مش هتحس إنك لوحدك"
  محتاج أفكر  → "طبعاً — إيه السؤال اللي بيخليك مش متأكد؟ نتكلم فيه"
  عندي إصابة  → "مش مشكلة خالص — البرنامج بيتعدل على حسب حالتك من أول يوم"
  مش عندي وقت → "البرنامج مرن — في أوبشن ٣ أيام في الأسبوع بس تديك نتيجة"

المرحلة ٥ — الإغلاق:
  "خليني أشوفلك أنسب خطة — إيه ميزانيتك تقريباً؟"

لا تتخطى مرحلة من غير ما تاخد إجابة واضحة.

== الخطط المتاحة ==
${plansData}

== قواعد الرد (لازم تتبعها دايماً) ==
- لو المستخدم بيتكلم عربي → رد بالعامية المصرية فقط
- لو بيتكلم إنجليزي → رد بالإنجليزية فقط
- ردودك قصيرة: ٢-٣ جمل بحد أقصى
- اسأل سؤال واحد بس في كل رسالة
- لا تقول إنك AI أو روبوت إلا لو سُئلت صراحة
- لو سأل عن التقسيط أو الدفع → وضح الخيارات المتاحة من الخطط فوراً
- لو سأل حاجة مش عندك إجابة عنها → "اللي بتسأل عنه ده بيرجع للكوتش مباشرة، هوريك ازاي تتواصل معاه"
- أسلوبك: ${toneLabel}

== تصنيف الـ Lead (مهم جداً للكوتش) ==
HOT  → سأل عن السعر أو طريقة الدفع أو التقسيط أو قال "عايز أبدأ" أو "مشترك"
WARM → مهتم وبيسأل ولكن عنده تردد أو سؤال
COLD → بيستكشف بس أو مش متأكد أو بدأ المحادثة للتو

== مهم جداً — شكل الرد ==
ردك لازم يكون JSON فقط، من غير أي نص قبله أو بعده، ومن غير markdown:
{
  "reply": "نص ردك بالعامية هنا",
  "status": "HOT",
  "goal": "هدف الزائر المستنتج أو null",
  "plan": "اسم الخطة الموصى بها أو null"
}`;
}

// ════════════════════════════════════════════════════════════════════
// ██  CUSTOM PROMPT INJECTION
// ════════════════════════════════════════════════════════════════════

function injectPlans(customPrompt: string, plansText: string): string {
  // Coach writes {{PLANS}} as a placeholder in their custom prompt
  return customPrompt.replace("{{PLANS}}", plansText);
}

// ════════════════════════════════════════════════════════════════════
// ██  STEP 3 — FLOW: Robust JSON Parser
// ════════════════════════════════════════════════════════════════════

interface AIResult {
  reply: string;
  status: string;
  goal: string | null;
  plan: string | null;
}

const FALLBACK_REPLY =
  "معلش، في مشكلة بسيطة. ممكن تعيد السؤال تاني؟";

function parseAIResponse(raw: string): AIResult {
  const fallback: AIResult = {
    reply: FALLBACK_REPLY,
    status: "COLD",
    goal: null,
    plan: null,
  };

  if (!raw?.trim()) return fallback;

  try {
    // Remove markdown fences Gemini sometimes adds
    const clean = raw.replace(/```json\s*|```\s*/g, "").trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      reply: typeof parsed.reply === "string" && parsed.reply.trim()
        ? parsed.reply.trim()
        : fallback.reply,
      status: VALID_STATUSES.has(parsed.status) ? parsed.status : "COLD",
      goal: typeof parsed.goal === "string" && parsed.goal !== "null"
        ? parsed.goal
        : null,
      plan: typeof parsed.plan === "string" && parsed.plan !== "null"
        ? parsed.plan
        : null,
    };
  } catch {
    // Last resort: try to extract just the reply field with regex
    const replyMatch = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (replyMatch?.[1]) {
      return { ...fallback, reply: replyMatch[1] };
    }
    return fallback;
  }
}

// ════════════════════════════════════════════════════════════════════
// ██  STEP 4 — RELIABILITY: AI call with retry + timeout
// ════════════════════════════════════════════════════════════════════

async function callAIWithRetry(
  apiKey: string,
  systemPrompt: string,
  messageHistory: Array<{ role: string; content: string }>,
  userMessage: string,
): Promise<string> {
  let lastError: Error = new Error("Unknown");

  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gemini-2.5-flash",
            temperature: 0.65,
            max_tokens: 512,
            messages: [
              { role: "system", content: systemPrompt },
              ...messageHistory,
              { role: "user", content: userMessage },
            ],
          }),
        },
      );

      clearTimeout(timer);

      // Non-retriable errors — throw immediately
      if (res.status === 402) throw Object.assign(new Error("QUOTA_EXCEEDED"), { fatal: true });
      if (res.status === 401) throw Object.assign(new Error("AUTH_ERROR"), { fatal: true });
      if (res.status === 429) throw Object.assign(new Error("AI_RATE_LIMITED"), { fatal: true });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error(`AI error ${res.status}:`, body);
        throw new Error(`AI_HTTP_${res.status}`);
      }

      const data = await res.json();
      return data?.choices?.[0]?.message?.content ?? "";
    } catch (err: any) {
      clearTimeout(timer);
      lastError = err;

      if (err.name === "AbortError") {
        lastError = Object.assign(new Error("AI_TIMEOUT"), { fatal: true });
        break; // no point retrying a timeout
      }
      if (err.fatal) break;

      if (attempt < MAX_RETRY_ATTEMPTS) {
        // Exponential back-off: 500ms, 1000ms
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError;
}

// ════════════════════════════════════════════════════════════════════
// ██  STEP 1 — SPEED: SSE Streaming helper
// ════════════════════════════════════════════════════════════════════

/**
 * Streams the reply word-by-word via Server-Sent Events, then sends a
 * final [DONE] event with the full metadata so the client can update
 * lead status without a second request.
 *
 * The AI response is fetched in full first (needed for JSON parsing),
 * then the reply text is streamed to give users the live-typing feel.
 */
function buildStreamResponse(
  result: AIResult,
  conversationId: string,
  corsHeaders: HeadersInit,
): Response {
  const encoder = new TextEncoder();
  const words = result.reply.split(" ");

  const body = new ReadableStream({
    async start(controller) {
      // Stream each word with a small delay for natural feel
      for (const word of words) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ text: word + " " })}\n\n`),
        );
        // ~40ms per word = roughly 150 wpm — feels natural
        await new Promise((r) => setTimeout(r, 40));
      }

      // Final event carries full metadata
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            done: true,
            status: result.status,
            goal: result.goal,
            plan: result.plan,
            conversationId,
          })}\n\n`,
        ),
      );

      controller.close();
    },
  });

  return new Response(body, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no", // Disable nginx buffering if present
    },
  });
}

// ════════════════════════════════════════════════════════════════════
// ██  MAIN HANDLER
// ════════════════════════════════════════════════════════════════════

serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  // ── Pre-flight ──────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Rate limiting (by client IP) ────────────────────────────────
  const clientIP =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (checkRateLimit(clientIP)) {
    return new Response(
      JSON.stringify({
        reply: "عدد الطلبات كتير — استنى دقيقة وحاول تاني",
        error: "RATE_LIMITED",
      }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Request size guard ──────────────────────────────────────────
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > 8_000) {
    return new Response(JSON.stringify({ error: "Request body too large" }), {
      status: 413,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // ── Parse + validate body ──────────────────────────────────────
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validation = validateRequest(rawBody);
    if (validation.ok === false) {
      return new Response(JSON.stringify({ error: validation.error }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { message, userId, conversationId, stream } = validation;

    if (!message) {
      return new Response(JSON.stringify({ error: "Message cannot be empty after sanitization" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Env guards ─────────────────────────────────────────────────
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.error("Missing required environment variables");
      throw new Error("SERVER_CONFIG_ERROR");
    }

    // ── Supabase client (service role — never exposed to client) ───
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // ── Verify userId is a real coach (prevents userId spoofing) ───
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("coach_name, business_name, chatbot_tone, system_prompt_override")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: "Coach account not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tone = profile.chatbot_tone ?? "friendly";

    // ── Fetch active plans (capped at 10 for safety) ───────────────
    const { data: plans } = await supabase
      .from("plans")
      .select("name, price, currency, description, features, payment_options")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(10);

    const plansText =
      plans && plans.length > 0
        ? plans
          .map((p: any) => {
            const features = Array.isArray(p.features)
              ? p.features.join("، ")
              : "";
            const payments = Array.isArray(p.payment_options)
              ? p.payment_options
                .map((o: string) =>
                  o === "cash" ? "نقدي"
                    : o === "installment" ? "تقسيط"
                      : "تحويل بنكي",
                )
                .join("، ")
              : "";
            return (
              `- ${p.name}: ${p.price} ${p.currency ?? "EGP"}\n` +
              `  الوصف: ${p.description ?? "—"}\n` +
              `  المميزات: ${features || "—"}\n` +
              `  طرق الدفع: ${payments || "—"}`
            );
          })
          .join("\n\n")
        : "لا توجد خطط متاحة حالياً — سيتم إضافتها قريباً";

    // ── Get or create conversation ─────────────────────────────────
    let convId = conversationId;

    if (convId) {
      // Security: verify this conversation belongs to the correct coach
      const { data: existingConv } = await supabase
        .from("conversations")
        .select("id, user_id")
        .eq("id", convId)
        .single();

      if (!existingConv || existingConv.user_id !== userId) {
        return new Response(
          JSON.stringify({ error: "Conversation not found or access denied" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Prevent conversation flooding (hard message cap)
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", convId);

      if ((count ?? 0) >= MAX_MESSAGES_PER_CONVO) {
        return new Response(
          JSON.stringify({
            reply: "المحادثة دي وصلت للحد الأقصى — ابدأ محادثة جديدة.",
            conversationId: convId,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      const { data: newConv, error: convError } = await supabase
        .from("conversations")
        .insert({ user_id: userId, visitor_name: "زائر", channel: "web" })
        .select("id")
        .single();

      if (convError || !newConv) throw new Error("Failed to create conversation");
      convId = newConv.id;
    }

    // ── Fetch last 12 messages for conversation memory ─────────────
    const { data: prevMessages } = await supabase
      .from("messages")
      .select("sender, content")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true })
      .limit(12);

    const messageHistory = (prevMessages ?? []).map((m: any) => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.content,
    }));

    // ── Save user message BEFORE calling AI ───────────────────────
    // (so the message is never lost if AI fails)
    await supabase.from("messages").insert({
      conversation_id: convId,
      sender: "user",
      content: message,
    });

    // ── Call AI with retry + timeout ───────────────────────────────
    const systemPrompt = profile.system_prompt_override
      ? injectPlans(profile.system_prompt_override, plansText)
      : buildSystemPrompt(plansText, tone);

    let rawAIResponse = "";
    try {
      rawAIResponse = await callAIWithRetry(
        GEMINI_API_KEY,
        systemPrompt,
        messageHistory,
        message,
      );
    } catch (err: any) {
      const msg = err?.message ?? "";
      let clientMsg = "معلش، في مشكلة بسيطة. حاول تاني بعد شوية 🙏";
      let statusCode = 500;

      if (msg === "AI_RATE_LIMITED") { clientMsg = "الـ AI مشغول دلوقتي، استنى شوية وحاول"; statusCode = 503; }
      if (msg === "QUOTA_EXCEEDED") { clientMsg = "خدمة الـ AI مش متاحة دلوقتي"; statusCode = 503; }
      if (msg === "AI_TIMEOUT") { clientMsg = "الرد بياخد وقت أكتر من المعتاد، حاول تاني"; statusCode = 504; }
      if (msg === "AUTH_ERROR") { clientMsg = "في مشكلة في الإعداد، تواصل مع الدعم"; statusCode = 500; }

      return new Response(
        JSON.stringify({ reply: clientMsg, conversationId: convId }),
        { status: statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Parse AI JSON response ─────────────────────────────────────
    const aiResult = parseAIResponse(rawAIResponse);

    // ── Save AI reply to DB ────────────────────────────────────────
    await supabase.from("messages").insert({
      conversation_id: convId,
      sender: "ai",
      content: aiResult.reply,
    });

    // ── Upsert lead (never downgrade an already-hot lead) ──────────
    const { data: existingLead } = await supabase
      .from("leads")
      .select("id, status")
      .eq("conversation_id", convId)
      .single();

    const incomingPriority = STATUS_PRIORITY[aiResult.status] ?? 0;
    const currentPriority = STATUS_PRIORITY[existingLead?.status ?? "COLD"] ?? 0;
    const shouldUpgrade = incomingPriority >= currentPriority;

    if (existingLead) {
      if (shouldUpgrade) {
        await supabase
          .from("leads")
          .update({
            status: aiResult.status,
            ...(aiResult.goal && { goal: aiResult.goal }),
            ...(aiResult.plan && { interested_plan: aiResult.plan }),
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingLead.id);
      }
    } else {
      await supabase.from("leads").insert({
        conversation_id: convId,
        user_id: userId,
        status: aiResult.status,
        goal: aiResult.goal ?? null,
        interested_plan: aiResult.plan ?? null,
      });
    }

    // ── Update conversation timestamp ──────────────────────────────
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", convId);

    // ── Return response (streaming or JSON) ────────────────────────
    if (stream) {
      return buildStreamResponse(aiResult, convId, corsHeaders);
    }

    return new Response(
      JSON.stringify({
        reply: aiResult.reply,
        status: aiResult.status,
        goal: aiResult.goal,
        plan: aiResult.plan,
        conversationId: convId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err: any) {
    // Catch-all — log internally, return safe message to client
    console.error("Unhandled chat error:", err?.message ?? err);

    return new Response(
      JSON.stringify({
        reply: "معلش، في مشكلة بسيطة. حاول تاني بعد شوية 🙏",
        error: true,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});