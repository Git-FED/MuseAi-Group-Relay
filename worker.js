const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const MAX_LIMIT = 500;
const MAX_SENDER_LENGTH = 64;
const MAX_CONTENT_LENGTH = 8000;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

function authorize(request, env) {
  if (!env.RELAY_TOKEN) {
    return json({ error: "Worker is missing the RELAY_TOKEN secret." }, 503);
  }
  const supplied = request.headers.get("authorization") || "";
  const expected = `Bearer ${env.RELAY_TOKEN}`;
  if (!constantTimeEqual(supplied, expected)) {
    return json({ error: "Unauthorized. Provide the relay bearer token." }, 401, {
      "www-authenticate": "Bearer",
    });
  }
  return null;
}

function clampLimit(raw) {
  const parsed = Number.parseInt(raw || "100", 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

async function listMessages(request, env) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 503);
  const url = new URL(request.url);
  const limit = clampLimit(url.searchParams.get("limit"));
  const since = url.searchParams.get("since");
  try {
    let statement;
    if (since) {
      // Inclusive cursor plus client-side ID de-duplication avoids losing messages
      // that share the same timestamp.
      statement = env.DB.prepare(
        "SELECT id, timestamp, sender, type, content FROM messages WHERE timestamp >= ? ORDER BY timestamp ASC, id ASC LIMIT ?",
      ).bind(since, limit);
    } else {
      statement = env.DB.prepare(
        "SELECT id, timestamp, sender, type, content FROM messages ORDER BY timestamp DESC, id DESC LIMIT ?",
      ).bind(limit);
    }
    const result = await statement.all();
    const messages = result.results || [];
    if (!since) messages.reverse();
    return json({ messages });
  } catch (error) {
    console.error("D1 message read failed", error);
    return json({ error: "Could not read messages from D1." }, 500);
  }
}

async function createMessage(request, env) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 503);
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return json({ error: "Request body must be a JSON object." }, 400);
  }
  const sender = typeof input.sender === "string" ? input.sender.trim() : "";
  const content = typeof input.content === "string" ? input.content.trim() : "";
  const type = typeof input.type === "string" && input.type.trim() ? input.type.trim() : "message";
  if (!sender || sender.length > MAX_SENDER_LENGTH) {
    return json({ error: `sender must contain 1–${MAX_SENDER_LENGTH} characters.` }, 400);
  }
  if (!content || content.length > MAX_CONTENT_LENGTH) {
    return json({ error: `content must contain 1–${MAX_CONTENT_LENGTH} characters.` }, 400);
  }
  if (!/^[a-zA-Z0-9_.-]{1,24}$/.test(type)) {
    return json({ error: "type may contain only letters, numbers, dot, underscore, or hyphen (max 24)." }, 400);
  }

  const message = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sender,
    type,
    content,
  };
  try {
    await env.DB.prepare(
      "INSERT INTO messages (id, timestamp, sender, type, content) VALUES (?, ?, ?, ?, ?)",
    ).bind(message.id, message.timestamp, message.sender, message.type, message.content).run();
    return json({ message }, 201);
  } catch (error) {
    console.error("D1 message write failed", error);
    return json({ error: "Could not save the message to D1." }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true });
    }
    if (url.pathname === "/api/messages") {
      if (request.method !== "GET" && request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405, { allow: "GET, POST" });
      }
      const denied = authorize(request, env);
      if (denied) return denied;
      return request.method === "GET" ? listMessages(request, env) : createMessage(request, env);
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found." }, 404);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed.", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    if (!env.ASSETS) return new Response("Static assets binding is not configured.", { status: 503 });
    return env.ASSETS.fetch(request);
  },
};
