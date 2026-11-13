#!/usr/bin/env node
/**
 * Cindy Local — zero-dependency mock OpenAI-compatible server.
 *
 * Purpose: let the desktop app complete a real conversation with NO network,
 * NO account and NO API key. Used by the acceptance script.
 *
 * Endpoints:
 *   GET  /v1/models                 -> model list
 *   POST /v1/chat/completions       -> OpenAI chat completions (stream + non-stream)
 *   POST /v1/responses              -> minimal OpenAI Responses API (stream + non-stream)
 *   GET  /healthz                   -> liveness probe
 *
 * Every request is appended to mock-requests.jsonl next to this file so the
 * acceptance script can prove the app actually talked to the local model.
 *
 * Usage:
 *   node mock-openai-server.mjs [--port 11435] [--host 127.0.0.1]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE = path.join(HERE, 'mock-requests.jsonl');

function parseArgs(argv) {
  const out = { port: 11435, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port') out.port = Number(argv[++i]);
    else if (a === '--host') out.host = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const MODEL_ID = 'cindy-local-mock';
const MODEL_ALIASES = [MODEL_ID, 'mock-local', 'mock'];
const MARKER = '[cindy-local-mock]';

function logEvent(entry) {
  try {
    fs.appendFileSync(LOG_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    /* logging must never break the mock */
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8 * 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

// The host prepends hidden notes (UI language, recovery, handoff…) to the
// *same* user-role message as the real body, separated by a blank line. Strip
// only those leading note paragraphs; never drop the whole message, or the
// real human text disappears with the note.
const INJECTED_PREFIXES = ['[UI language]', '<system-reminder>', '[System note]'];

function stripInjectedNotes(text) {
  const paragraphs = String(text ?? '').split(/\n{2,}/);
  while (
    paragraphs.length > 0 &&
    INJECTED_PREFIXES.some((prefix) => paragraphs[0].trimStart().startsWith(prefix))
  ) {
    paragraphs.shift();
  }
  return paragraphs.join('\n\n').trim();
}

function messageText(m) {
  const content = m?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text ?? part?.input_text ?? ''))
      .join('');
  }
  return '';
}

/** Pull the last real user text out of either chat-completions or Responses payloads. */
function lastUserText(body) {
  const messages = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
      ? body.input
      : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || typeof m !== 'object') continue;
    const role = m.role ?? m.type;
    if (role && role !== 'user') continue;
    const text = stripInjectedNotes(messageText(m));
    if (!text) continue;
    return text;
  }
  return '';
}

function buildAnswer(userText) {
  const trimmed = String(userText ?? '').trim();
  if (/^ping$/i.test(trimmed)) return 'pong';
  // Acceptance phrase from ACCEPTANCE.md: reply with the four characters the
  // script expects, instead of echoing the whole prompt.
  if (trimmed.includes('本地模式成功')) return '本地模式成功';
  if (/^\/status$/i.test(trimmed)) return `${MARKER} ok model=${MODEL_ID} offline=true`;
  const hint = trimmed.length > 160 ? `${trimmed.slice(0, 160)}…` : trimmed;
  return `${MARKER} 你好，我是本地离线 Mock 模型。我收到了你的消息：「${hint}」。这条回复完全来自本机 127.0.0.1，没有联网、没有账号、没有 API Key。`;
}

/** Compact view of the incoming message list, for diagnosing protocol shape. */
function summarizeMessages(body) {
  const arr = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
      ? body.input
      : [];
  return arr.slice(-6).map((m) => ({
    role: m?.role ?? m?.type ?? null,
    ctype: typeof m?.content,
    partTypes: Array.isArray(m?.content)
      ? m.content.map((p) => (typeof p === 'string' ? 'string' : p?.type)).slice(0, 6)
      : undefined,
    text: stripInjectedNotes(messageText(m)).slice(0, 80),
  }));
}

function sseHead(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

function chunkText(text, size = 12) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function handleChatCompletions(req, res, body, rawBody) {
  try {
    fs.writeFileSync(path.join(HERE, 'mock-last-request.json'), rawBody);
  } catch {
    /* diagnostics must never break the mock */
  }
  const userText = lastUserText(body);
  const answer = buildAnswer(userText);
  const id = `chatcmpl-mock-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const model = typeof body.model === 'string' ? body.model : MODEL_ID;

  logEvent({
    kind: 'chat.completions',
    model,
    stream: body.stream === true,
    userText: userText.slice(0, 400),
    auth: req.headers.authorization ? 'present' : 'none',
    bodyBytes: rawBody.length,
    bodyKeys: Object.keys(body),
    shape: summarizeMessages(body),
  });

  if (body.stream !== true) {
    return json(res, 200, {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: answer },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 32, completion_tokens: answer.length, total_tokens: 32 + answer.length },
    });
  }

  sseHead(res);
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
  });
  for (const piece of chunkText(answer)) {
    send({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
    });
  }
  send({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 32, completion_tokens: answer.length, total_tokens: 32 + answer.length },
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

function handleResponses(req, res, body, rawBody) {
  const userText = lastUserText(body);
  const answer = buildAnswer(userText);
  const id = `resp_mock_${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const model = typeof body.model === 'string' ? body.model : MODEL_ID;

  logEvent({
    kind: 'responses',
    model,
    stream: body.stream === true,
    userText: userText.slice(0, 400),
    auth: req.headers.authorization ? 'present' : 'none',
    bodyBytes: rawBody.length,
    shape: summarizeMessages(body),
  });

  if (body.stream !== true) {
    return json(res, 200, {
      id,
      object: 'response',
      created_at: created,
      status: 'completed',
      model,
      output: [
        {
          type: 'message',
          id: `msg_${id}`,
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: answer, annotations: [] }],
        },
      ],
      output_text: answer,
      usage: { input_tokens: 32, output_tokens: answer.length, total_tokens: 32 + answer.length },
    });
  }

  sseHead(res);
  const send = (type, payload) => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  };
  send('response.created', {
    response: { id, object: 'response', created_at: created, status: 'in_progress', model, output: [] },
  });
  send('response.output_item.added', {
    output_index: 0,
    item: { type: 'message', id: `msg_${id}`, role: 'assistant', status: 'in_progress', content: [] },
  });
  send('response.content_part.added', {
    output_index: 0,
    item_id: `msg_${id}`,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  });
  for (const piece of chunkText(answer)) {
    send('response.output_text.delta', {
      output_index: 0,
      item_id: `msg_${id}`,
      content_index: 0,
      delta: piece,
    });
  }
  send('response.output_text.done', {
    output_index: 0,
    item_id: `msg_${id}`,
    content_index: 0,
    text: answer,
  });
  send('response.completed', {
    response: {
      id,
      object: 'response',
      created_at: created,
      status: 'completed',
      model,
      output: [
        {
          type: 'message',
          id: `msg_${id}`,
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: answer, annotations: [] }],
        },
      ],
      output_text: answer,
      usage: { input_tokens: 32, output_tokens: answer.length, total_tokens: 32 + answer.length },
    },
  });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && (pathname === '/healthz' || pathname === '/')) {
    return json(res, 200, { ok: true, service: 'cindy-local-mock', model: MODEL_ID });
  }

  if (req.method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
    logEvent({ kind: 'models.list', auth: req.headers.authorization ? 'present' : 'none' });
    return json(res, 200, {
      object: 'list',
      data: MODEL_ALIASES.map((id) => ({
        id,
        object: 'model',
        created: 0,
        owned_by: 'cindy-local',
      })),
    });
  }

  if (req.method === 'POST' && (pathname === '/v1/chat/completions' || pathname === '/chat/completions')) {
    const raw = await readBody(req);
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return json(res, 400, { error: { message: 'invalid json', type: 'invalid_request_error' } });
    }
    return handleChatCompletions(req, res, body, raw);
  }

  if (req.method === 'POST' && (pathname === '/v1/responses' || pathname === '/responses')) {
    const raw = await readBody(req);
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return json(res, 400, { error: { message: 'invalid json', type: 'invalid_request_error' } });
    }
    return handleResponses(req, res, body, raw);
  }

  logEvent({ kind: 'unhandled', method: req.method, path: pathname });
  return json(res, 404, { error: { message: `no route ${req.method} ${pathname}`, type: 'not_found' } });
});

server.on('error', (err) => {
  console.error(`[cindy-local-mock] ${err.code === 'EADDRINUSE' ? `port ${args.port} already in use` : err.message}`);
  process.exit(1);
});

server.listen(args.port, args.host, () => {
  console.log(`[cindy-local-mock] listening on http://${args.host}:${args.port}/v1  model=${MODEL_ID}`);
  console.log(`[cindy-local-mock] request log: ${LOG_FILE}`);
  console.log('[cindy-local-mock] Ctrl+C to stop');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
