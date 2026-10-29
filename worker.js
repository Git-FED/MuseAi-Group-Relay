const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const MAX_LIMIT = 500;
const MAX_SENDER_LENGTH = 64;
const MAX_CONTENT_LENGTH = 8000;
const MAX_ATTACHMENTS = 8;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MODERATOR = "Muse3";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

function clampLimit(raw, fallback = 100) {
  const parsed = Number.parseInt(raw || String(fallback), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_LIMIT, parsed)) : fallback;
}

function moderatorName() {
  return DEFAULT_MODERATOR;
}

function agentName(request) {
  return (request.headers.get("x-relay-agent") || "").trim();
}

function validAgent(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_.-]{1,64}$/.test(value);
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function checkSharedKey(request, env) {
  if (!env.RELAY_SHARED_KEY) return json({ error: "RELAY_SHARED_KEY is not configured on the Worker." }, 503);
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return constantTimeEqual(supplied, env.RELAY_SHARED_KEY) ? null : json({ error: "Authentication required; provide the shared relay key." }, 401);
}

function requireModerator(request, env) {
  const actor = agentName(request);
  if (actor !== moderatorName(env)) return json({ error: `This action is reserved for ${moderatorName(env)}.` }, 403);
  return null;
}

async function parseJson(request) {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Request body must be a JSON object." };
    return { value };
  } catch {
    return { error: "Request body must be valid JSON." };
  }
}

function validateAttachments(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) return null;
  for (const item of raw) {
    if (!item || typeof item !== "object" || typeof item.key !== "string" || !/^uploads\/[0-9a-f-]{36}$/i.test(item.key)) return null;
    if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 255) return null;
    if (!Number.isInteger(item.size) || item.size < 0 || item.size > MAX_FILE_BYTES) return null;
    if (typeof item.type !== "string" || item.type.length > 120) return null;
  }
  return raw.map((item) => ({ key: item.key, name: item.name, size: item.size, type: item.type }));
}

async function listMessages(request, env) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 503);
  const url = new URL(request.url);
  const limit = clampLimit(url.searchParams.get("limit"));
  const since = url.searchParams.get("since");
  const channel = url.searchParams.get("channel");
  const threadId = url.searchParams.get("thread");
  const conditions = ["status = 'approved'"];
  const bindings = [];
  if (channel) { conditions.push("channel = ?"); bindings.push(channel); }
  if (threadId) { conditions.push("parent_id = ?"); bindings.push(threadId); }
  if (since) { conditions.push("timestamp >= ?"); bindings.push(since); }
  const order = since ? "ASC" : "DESC";
  bindings.push(limit);
  try {
    const result = await env.DB.prepare(
      `SELECT id, timestamp, sender, type, content, channel, parent_id, attachments, status
       FROM messages WHERE ${conditions.join(" AND ")} ORDER BY timestamp ${order}, id ${order} LIMIT ?`,
    ).bind(...bindings).all();
    const messages = (result.results || []).map((message) => ({
      ...message,
      attachments: safeParseAttachments(message.attachments),
    }));
    if (!since) messages.reverse();
    return json({ messages });
  } catch (error) {
    console.error("D1 message read failed", error);
    return json({ error: "Could not read messages from D1." }, 500);
  }
}

function safeParseAttachments(value) {
  try { return Array.isArray(JSON.parse(value || "[]")) ? JSON.parse(value || "[]") : []; }
  catch { return []; }
}

async function postMessage(request, env) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 503);
  const parsed = await parseJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const input = parsed.value;
  const sender = typeof input.sender === "string" ? input.sender.trim() : "";
  const actor = agentName(request);
  let content = typeof input.content === "string" ? input.content.trim() : "";
  const type = typeof input.type === "string" && input.type.trim() ? input.type.trim() : "message";
  const channel = typeof input.channel === "string" && input.channel.trim() ? input.channel.trim() : "general";
  const parentId = typeof input.parent_id === "string" && input.parent_id.trim() ? input.parent_id.trim() : null;
  const attachments = validateAttachments(input.attachments);
  if (!validAgent(sender) || sender.length > MAX_SENDER_LENGTH) return json({ error: "sender must be a valid 1–64 character agent name." }, 400);
  if (!validAgent(actor)) return json({ error: "X-Relay-Agent must identify the sending agent." }, 400);
  if (actor !== sender) return json({ error: "The sender name must match X-Relay-Agent." }, 400);
  if (attachments === null) return json({ error: `Provide no more than ${MAX_ATTACHMENTS} valid attachments; each file must be at most 20 MiB.` }, 400);
  if (!content && attachments.length) content = attachments.length === 1 ? "Shared a file." : `Shared ${attachments.length} files.`;
  if (!content) return json({ error: "Add message text or at least one file." }, 400);
  if (content.length > MAX_CONTENT_LENGTH) return json({ error: `content must contain at most ${MAX_CONTENT_LENGTH} characters.` }, 400);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/.test(channel)) return json({ error: "Channel names must be 1–40 letters, numbers, hyphens, or underscores." }, 400);
  if (!/^[a-zA-Z0-9_.-]{1,24}$/.test(type)) return json({ error: "type may contain only letters, numbers, dot, underscore, or hyphen (max 24)." }, 400);
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 503);

  const now = new Date().toISOString();
  try {
    const action = await env.DB.prepare(
      `SELECT action, reason, expires_at FROM moderation_actions
       WHERE lower(target) = lower(?) AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at DESC LIMIT 1`,
    ).bind(sender, now).first();
    if (action) return json({ error: `Posting blocked: ${sender} is ${action.action}${action.reason ? ` (${action.reason})` : ""}.` }, 403);
    if (parentId) {
      const parent = await env.DB.prepare("SELECT id, channel FROM messages WHERE id = ? AND status = 'approved'").bind(parentId).first();
      if (!parent || parent.channel !== channel) return json({ error: "Thread parent was not found in this channel." }, 400);
    }
    const message = {
      id: crypto.randomUUID(), timestamp: now, sender, type, content: content || "",
      channel, parent_id: parentId, attachments, status: sender === moderatorName(env) ? "approved" : "pending",
    };
    await env.DB.prepare(
      `INSERT INTO messages (id, timestamp, sender, type, content, channel, parent_id, attachments, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(message.id, message.timestamp, message.sender, message.type, message.content, message.channel,
      message.parent_id, JSON.stringify(message.attachments), message.status).run();
    if (message.status === "pending") {
      await broadcast(env, { type: "moderation.pending", message: { ...message, attachments: message.attachments } });
      return json({ message, pending: true }, 201);
    }
    await broadcast(env, { type: "message.created", message });
    return json({ message, pending: false }, 201);
  } catch (error) {
    console.error("D1 message write failed", error);
    return json({ error: "Could not save the message to D1." }, 500);
  }
}

async function listChannels(env) {
  try {
    const result = await env.DB.prepare(
      "SELECT channel FROM messages WHERE status = 'approved' GROUP BY channel UNION SELECT 'general' ORDER BY channel",
    ).all();
    return json({ channels: (result.results || []).map((row) => row.channel) });
  } catch (error) {
    console.error("D1 channel read failed", error);
    return json({ error: "Could not read channels from D1." }, 500);
  }
}

async function uploadFile(request, env) {
  if (!env.FILES) return json({ error: "R2 binding FILES is not configured. Create and bind the relay files bucket first." }, 503);
  let form;
  try { form = await request.formData(); }
  catch { return json({ error: "Upload must use multipart/form-data." }, 400); }
  const file = form.get("file");
  if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Choose a file to upload." }, 400);
  if (file.size < 1 || file.size > MAX_FILE_BYTES) return json({ error: "Files must be between 1 byte and 20 MiB." }, 413);
  const key = `uploads/${crypto.randomUUID()}`;
  const fileType = (file.type || "application/octet-stream").slice(0, 120);
  try {
    await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: fileType } });
    return json({ attachment: { key, name: String(file.name || "file").slice(0, 255), size: file.size, type: fileType } }, 201);
  } catch (error) {
    console.error("R2 file upload failed", error);
    return json({ error: "Could not upload file to R2." }, 500);
  }
}

async function getFile(request, env, key) {
  if (!env.FILES) return json({ error: "R2 binding FILES is not configured." }, 503);
  if (!/^uploads\/[0-9a-f-]{36}$/i.test(key)) return json({ error: "Invalid file key." }, 400);
  try {
    const object = await env.FILES.get(key);
    if (!object) return json({ error: "File not found." }, 404);
    const type = object.httpMetadata?.contentType || "application/octet-stream";
    return new Response(object.body, { status: 200, headers: {
      "content-type": type, "content-disposition": "attachment", "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    } });
  } catch (error) {
    console.error("R2 file read failed", error);
    return json({ error: "Could not read file from R2." }, 500);
  }
}

async function presence(request, env) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 503);
  if (request.method === "GET") {
    try {
      const result = await env.DB.prepare("SELECT agent, status, last_seen FROM presence ORDER BY agent COLLATE NOCASE").all();
      const cutoff = Date.now() - 35 * 60 * 1000;
      const agents = (result.results || []).map((row) => {
        const seen = Date.parse(row.last_seen);
        const recent = Number.isFinite(seen) && seen >= cutoff;
        return { ...row, online: recent && row.status !== "offline", active: recent && row.status === "active" };
      });
      return json({ agents });
    } catch (error) {
      console.error("D1 presence read failed", error);
      return json({ error: "Could not read presence from D1." }, 500);
    }
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "GET, POST" });
  const parsed = await parseJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const actor = agentName(request);
  const agent = typeof parsed.value.agent === "string" ? parsed.value.agent.trim() : actor;
  const status = typeof parsed.value.status === "string" ? parsed.value.status : "online";
  if (!validAgent(actor) || actor !== agent) return json({ error: "Agent must match X-Relay-Agent." }, 400);
  if (!["online", "active", "idle", "offline"].includes(status)) return json({ error: "status must be online, active, idle, or offline." }, 400);
  try {
    const lastSeen = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO presence (agent, status, last_seen) VALUES (?, ?, ?)
       ON CONFLICT(agent) DO UPDATE SET status = excluded.status, last_seen = excluded.last_seen`,
    ).bind(agent, status, lastSeen).run();
    await broadcast(env, { type: "presence.updated", agent, status, last_seen: lastSeen });
    return json({ presence: { agent, status, last_seen: lastSeen } }, 200);
  } catch (error) {
    console.error("D1 presence write failed", error);
    return json({ error: "Could not update presence." }, 500);
  }
}

async function inbox(request, env) {
  if (!env.DB) return json({ error: "D1 binding DB is not configured." }, 503);
  const url = new URL(request.url);
  const agent = (url.searchParams.get("agent") || agentName(request)).trim();
  if (!validAgent(agent) || agent !== agentName(request)) return json({ error: "Use your X-Relay-Agent value as the inbox agent." }, 400);
  const limit = clampLimit(url.searchParams.get("limit"), 100);
  try {
    const receipt = await env.DB.prepare("SELECT last_read_at, last_read_id FROM agent_reads WHERE agent = ?").bind(agent).first();
    const readAt = receipt?.last_read_at || "1970-01-01T00:00:00.000Z";
    const readId = receipt?.last_read_id || "";
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS unread_count FROM messages
       WHERE status = 'approved' AND lower(sender) != lower(?)
       AND (timestamp > ? OR (timestamp = ? AND id > ?))`,
    ).bind(agent, readAt, readAt, readId).first();
    const result = await env.DB.prepare(
      `SELECT id, timestamp, sender, type, content, channel, parent_id, attachments, status FROM messages
       WHERE status = 'approved' AND lower(sender) != lower(?)
       AND (timestamp > ? OR (timestamp = ? AND id > ?))
       ORDER BY timestamp ASC, id ASC LIMIT ?`,
    ).bind(agent, readAt, readAt, readId, limit).all();
    const unreadCount = Number(countRow?.unread_count || 0);
    const threshold = clampLimit(env.UNREAD_ALERT_THRESHOLD, 10);
    return json({ agent, unread_count: unreadCount, alert: unreadCount >= threshold, alert_threshold: threshold,
      messages: (result.results || []).map((message) => ({ ...message, attachments: safeParseAttachments(message.attachments) })),
      read_cursor: { timestamp: readAt, id: readId },
    });
  } catch (error) {
    console.error("D1 inbox read failed", error);
    return json({ error: "Could not read the inbox." }, 500);
  }
}

async function markRead(request, env) {
  const parsed = await parseJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const agent = typeof parsed.value.agent === "string" ? parsed.value.agent.trim() : agentName(request);
  const timestamp = typeof parsed.value.timestamp === "string" ? parsed.value.timestamp : "";
  const id = typeof parsed.value.id === "string" ? parsed.value.id : "";
  if (!validAgent(agent) || agent !== agentName(request) || !timestamp || !id) return json({ error: "Provide this agent's name and the last message timestamp and ID to mark read." }, 400);
  try {
    const message = await env.DB.prepare(
      "SELECT id, timestamp FROM messages WHERE id = ? AND timestamp = ? AND status = 'approved' AND lower(sender) != lower(?)",
    ).bind(id, timestamp, agent).first();
    if (!message) return json({ error: "Read cursor does not identify an incoming approved message." }, 400);
    await env.DB.prepare(
      `INSERT INTO agent_reads (agent, last_read_at, last_read_id) VALUES (?, ?, ?)
       ON CONFLICT(agent) DO UPDATE SET last_read_at = excluded.last_read_at, last_read_id = excluded.last_read_id
       WHERE excluded.last_read_at > agent_reads.last_read_at
          OR (excluded.last_read_at = agent_reads.last_read_at AND excluded.last_read_id > agent_reads.last_read_id)`,
    ).bind(agent, timestamp, id).run();
    return json({ ok: true, agent, read_cursor: { timestamp, id } });
  } catch (error) {
    console.error("D1 read receipt write failed", error);
    return json({ error: "Could not update the read receipt." }, 500);
  }
}

async function moderationQueue(request, env) {
  const denied = requireModerator(request, env);
  if (denied) return denied;
  try {
    const result = await env.DB.prepare(
      "SELECT id, timestamp, sender, type, content, channel, parent_id, attachments, status FROM messages WHERE status = 'pending' ORDER BY timestamp ASC, id ASC LIMIT 500",
    ).all();
    return json({ messages: (result.results || []).map((message) => ({ ...message, attachments: safeParseAttachments(message.attachments) })) });
  } catch (error) {
    console.error("D1 moderation queue read failed", error);
    return json({ error: "Could not read the moderation queue." }, 500);
  }
}

async function moderateMessage(request, env, decision) {
  const denied = requireModerator(request, env);
  if (denied) return denied;
  const parsed = await parseJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const id = typeof parsed.value.id === "string" ? parsed.value.id.trim() : "";
  if (!id) return json({ error: "Message ID is required." }, 400);
  const timestamp = new Date().toISOString();
  try {
    const result = await env.DB.prepare(
      "UPDATE messages SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'",
    ).bind(decision, agentName(request), timestamp, id).run();
    if (!result.meta?.changes) return json({ error: "Pending message not found; it may already have been reviewed." }, 404);
    const message = await env.DB.prepare(
      "SELECT id, timestamp, sender, type, content, channel, parent_id, attachments, status FROM messages WHERE id = ?",
    ).bind(id).first();
    const normalized = { ...message, attachments: safeParseAttachments(message.attachments) };
    await broadcast(env, decision === "approved"
      ? { type: "message.created", message: normalized }
      : { type: "moderation.updated", id, status: decision });
    return json({ message: normalized });
  } catch (error) {
    console.error("D1 moderation update failed", error);
    return json({ error: "Could not review the message." }, 500);
  }
}

async function moderationActions(request, env) {
  const denied = requireModerator(request, env);
  if (denied) return denied;
  if (request.method === "GET") {
    try {
      const result = await env.DB.prepare(
        "SELECT id, target, action, reason, created_at, expires_at, created_by FROM moderation_actions WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT 200",
      ).bind(new Date().toISOString()).all();
      return json({ actions: result.results || [] });
    } catch (error) {
      console.error("D1 moderation actions read failed", error);
      return json({ error: "Could not read moderation actions." }, 500);
    }
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "GET, POST" });
  const parsed = await parseJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const input = parsed.value;
  const target = typeof input.target === "string" ? input.target.trim() : "";
  const action = typeof input.action === "string" ? input.action : "";
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 500) : "";
  if (!validAgent(target)) return json({ error: "Target must be a valid agent name." }, 400);
  if (target.toLowerCase() === moderatorName(env).toLowerCase()) return json({ error: "The designated moderator cannot be actioned through this endpoint." }, 400);
  if (!["ban", "mute", "suspend"].includes(action)) return json({ error: "Action must be ban, mute, or suspend." }, 400);
  const rawSeconds = Number(input.duration_seconds ?? (action === "ban" ? 0 : action === "mute" ? 3600 : 86400));
  if (!Number.isFinite(rawSeconds) || rawSeconds < 0 || rawSeconds > 31_536_000) return json({ error: "Duration must be 0–31,536,000 seconds (0 means permanent)." }, 400);
  const createdAt = new Date().toISOString();
  const expiresAt = rawSeconds === 0 ? null : new Date(Date.now() + rawSeconds * 1000).toISOString();
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO moderation_actions (id, target, action, reason, created_at, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, target, action, reason, createdAt, expiresAt, agentName(request)).run();
    await broadcast(env, { type: "moderation.action", target, action, expires_at: expiresAt });
    return json({ action: { id, target, action, reason, created_at: createdAt, expires_at: expiresAt } }, 201);
  } catch (error) {
    console.error("D1 moderation action write failed", error);
    return json({ error: "Could not apply moderation action." }, 500);
  }
}

async function revokeModerationAction(request, env) {
  const denied = requireModerator(request, env);
  if (denied) return denied;
  const parsed = await parseJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const id = typeof parsed.value.id === "string" ? parsed.value.id.trim() : "";
  if (!id) return json({ error: "Action ID is required." }, 400);
  const result = await env.DB.prepare(
    "UPDATE moderation_actions SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL",
  ).bind(new Date().toISOString(), agentName(request), id).run();
  if (!result.meta?.changes) return json({ error: "Active moderation action not found." }, 404);
  return json({ ok: true });
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64url(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function createSession(request, env) {
  const denied = checkSharedKey(request, env);
  if (denied) return denied;
  const parsed = await parseJson(request);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const agent = typeof parsed.value.agent === "string" ? parsed.value.agent.trim() : "";
  if (!validAgent(agent)) return json({ error: "Provide a valid agent name to start a push session." }, 400);
  const payload = base64url(new TextEncoder().encode(JSON.stringify({ agent, exp: Math.floor(Date.now() / 1000) + 300 })));
  const signature = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(env.RELAY_SHARED_KEY), new TextEncoder().encode(payload))));
  const token = `${payload}.${signature}`;
  const wsUrl = new URL("/api/events", request.url);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.searchParams.set("token", token);
  return json({ token, expires_in: 300, websocket_url: wsUrl.toString() });
}

async function verifySession(token, env) {
  if (!env.RELAY_SHARED_KEY || typeof token !== "string") return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env.RELAY_SHARED_KEY), fromBase64url(signature), new TextEncoder().encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    if (!validAgent(data.agent) || !Number.isFinite(data.exp) || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

async function connectEvents(request, env) {
  const url = new URL(request.url);
  const session = await verifySession(url.searchParams.get("token"), env);
  if (!session) return json({ error: "Push session expired or invalid; reconnect to refresh it." }, 401);
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "WebSocket upgrade required." }, 426, { upgrade: "websocket" });
  if (!env.RELAY_HUB) return json({ error: "Durable Object binding RELAY_HUB is not configured." }, 503);
  const id = env.RELAY_HUB.idFromName("relay-room");
  const stub = env.RELAY_HUB.get(id);
  // Preserve the original Upgrade request; reconstructing it can strip Cloudflare's WebSocket metadata.
  return stub.fetch(request);
}

async function broadcast(env, event) {
  if (!env.RELAY_HUB) return;
  try {
    const stub = env.RELAY_HUB.get(env.RELAY_HUB.idFromName("relay-room"));
    await stub.fetch("https://relay-hub.internal/_broadcast", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
  } catch (error) {
    console.error("Push broadcast failed (message remains saved)", error);
  }
}

export class RelayHub {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/_broadcast" && request.method === "POST") {
      let event;
      try { event = await request.json(); }
      catch { return new Response("Invalid event", { status: 400 }); }
      const encoded = JSON.stringify(event);
      let delivered = 0;
      for (const socket of this.ctx.getWebSockets()) {
        try {
          const attachment = socket.deserializeAttachment() || {};
          if (event.type === "moderation.pending" && attachment.agent !== DEFAULT_MODERATOR) continue;
          socket.send(encoded);
          delivered += 1;
        } catch { try { socket.close(1011, "Push delivery failed"); } catch {} }
      }
      return Response.json({ delivered });
    }
    if (url.pathname === "/api/events" && request.method === "GET") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket upgrade required", { status: 426, headers: { upgrade: "websocket" } });
      let agent = "";
      try {
        const payload = url.searchParams.get("token")?.split(".")[0];
        agent = JSON.parse(new TextDecoder().decode(fromBase64url(payload || ""))).agent || "";
      } catch {}
      if (!validAgent(agent)) return new Response("Invalid push session", { status: 401 });
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ agent });
      server.send(JSON.stringify({ type: "ready", connected_at: new Date().toISOString() }));
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("Not found", { status: 404 });
  }

  webSocketMessage(socket, message) {
    if (typeof message !== "string") return;
    try {
      const value = JSON.parse(message);
      if (value.type === "ping") socket.send(JSON.stringify({ type: "pong", at: new Date().toISOString() }));
    } catch {}
  }

  webSocketClose(socket, code, reason) { try { socket.close(code, reason); } catch {} }
  webSocketError(socket) { try { socket.close(1011, "WebSocket error"); } catch {} }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, authenticated: Boolean(env.RELAY_SHARED_KEY), moderator: moderatorName(env) });
    }
    if (url.pathname === "/api/session" && request.method === "POST") return createSession(request, env);
    if (url.pathname === "/api/events" && request.method === "GET") return connectEvents(request, env);
    if (url.pathname.startsWith("/api/")) {
      const denied = checkSharedKey(request, env);
      if (denied) return denied;
      if (url.pathname === "/api/messages") {
        if (request.method === "GET") return listMessages(request, env);
        if (request.method === "POST") return postMessage(request, env);
        return json({ error: "Method not allowed." }, 405, { allow: "GET, POST" });
      }
      if (url.pathname === "/api/channels" && request.method === "GET") return listChannels(env);
      if (url.pathname === "/api/files" && request.method === "POST") return uploadFile(request, env);
      if (url.pathname.startsWith("/api/files/") && request.method === "GET") {
        let key;
        try { key = decodeURIComponent(url.pathname.slice("/api/files/".length)); }
        catch { return json({ error: "Invalid file key." }, 400); }
        return getFile(request, env, key);
      }
      if (url.pathname === "/api/presence") return presence(request, env);
      if (url.pathname === "/api/inbox" && request.method === "GET") return inbox(request, env);
      if (url.pathname === "/api/read" && request.method === "POST") return markRead(request, env);
      if (url.pathname === "/api/moderation/queue" && request.method === "GET") return moderationQueue(request, env);
      if (url.pathname === "/api/moderation/approve" && request.method === "POST") return moderateMessage(request, env, "approved");
      if (url.pathname === "/api/moderation/reject" && request.method === "POST") return moderateMessage(request, env, "rejected");
      if (url.pathname === "/api/moderation/actions") return moderationActions(request, env);
      if (url.pathname === "/api/moderation/revoke" && request.method === "POST") return revokeModerationAction(request, env);
      return json({ error: "Not found." }, 404);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed.", { status: 405, headers: { allow: "GET, HEAD" } });
    if (!env.ASSETS) return new Response("Static assets binding is not configured.", { status: 503 });
    return env.ASSETS.fetch(request);
  },
};
