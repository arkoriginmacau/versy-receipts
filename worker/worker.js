/**
 * Versy receipts Storage API (Cloudflare Worker + R2)
 * Paths: receipts/{receiptNo}/{FriendlyName}.pdf
 * Routes mirror the old Vercel Blob handlers so receipt.html keeps working:
 *   POST /api/upload-receipt
 *   GET  /api/list-receipts[?no=]
 *   GET  /api/file?key=...   (or GET /file/{key})
 *   DELETE|POST /api/delete-receipt  { key } or { no }
 *   GET  /api/health
 */

const CORS_METHODS = 'GET, POST, DELETE, OPTIONS';
const CORS_HEADERS = 'Content-Type, Authorization';

function allowedOrigins(env) {
  const raw = (env && env.ALLOWED_ORIGIN) || '*';
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allow = allowedOrigins(env);
  let acao = '*';
  if (allow.includes('*')) acao = origin || '*';
  else if (origin && allow.includes(origin)) acao = origin;
  else if (allow.length === 1) acao = allow[0];
  return {
    'Access-Control-Allow-Origin': acao,
    'Access-Control-Allow-Methods': CORS_METHODS,
    'Access-Control-Allow-Headers': CORS_HEADERS,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request, env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env),
    },
  });
}

function safeNo(no) {
  return (
    String(no || 'receipt')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'receipt'
  );
}

function normalizeView(view) {
  return view === 'one-page' || view === 'small' ? 'one-page' : 'full';
}

function normalizeKind(kind) {
  return kind === 'paid-in-full' ? 'paid-in-full' : 'regular';
}

/** Friendly filename matching the UI toggle labels */
function friendlyName(receiptNo, view, kind) {
  const v = normalizeView(view);
  const k = normalizeKind(kind);
  let typeLabel;
  if (k === 'paid-in-full') typeLabel = v === 'one-page' ? 'Paid-in-full-one-page' : 'Paid-in-full';
  else typeLabel = v === 'one-page' ? 'One-page-receipt' : 'Full-receipt';
  return `${typeLabel}-${receiptNo}.pdf`;
}

function objectKey(receiptNo, view, kind) {
  return `receipts/${receiptNo}/${friendlyName(receiptNo, view, kind)}`;
}

/** Parse friendly or legacy keys back to meta */
function parseKey(key) {
  const parts = String(key || '').split('/');
  const receiptNo = parts[1] || '';
  const file = parts[2] || '';
  const base = file.replace(/\.pdf$/i, '');
  let view = 'full';
  let kind = 'regular';
  if (/^Paid-in-full-one-page-/i.test(base) || /^one-page-paid-in-full$/i.test(base) || /^one-page-paid-in-full-/i.test(base)) {
    view = 'one-page';
    kind = 'paid-in-full';
  } else if (/^Paid-in-full-/i.test(base) || /^full-paid-in-full$/i.test(base) || /^full-paid-in-full-/i.test(base)) {
    view = 'full';
    kind = 'paid-in-full';
  } else if (/^One-page-receipt-/i.test(base) || /^one-page-regular$/i.test(base) || /^one-page-regular-/i.test(base)) {
    view = 'one-page';
    kind = 'regular';
  } else if (/^Full-receipt-/i.test(base) || /^full-regular$/i.test(base) || /^full-regular-/i.test(base)) {
    view = 'full';
    kind = 'regular';
  } else if (base.startsWith('one-page-')) {
    view = 'one-page';
    kind = base.includes('paid-in-full') ? 'paid-in-full' : 'regular';
  } else if (base.startsWith('full-')) {
    view = 'full';
    kind = base.includes('paid-in-full') ? 'paid-in-full' : 'regular';
  }
  return { receiptNo, view, kind, filename: friendlyName(receiptNo || 'receipt', view, kind), pathname: key };
}

function b64ToUint8(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function listPrefix(bucket, prefix) {
  const objects = [];
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 500 });
    for (const o of page.objects || []) objects.push(o);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

function dedupeByFormat(files) {
  const best = new Map();
  for (const f of files) {
    const k = `${f.view || 'full'}|${f.kind || 'regular'}`;
    const prev = best.get(k);
    const ts = f.uploadedAt ? new Date(f.uploadedAt).getTime() : 0;
    const prevTs = prev && prev.uploadedAt ? new Date(prev.uploadedAt).getTime() : 0;
    if (!prev || ts >= prevTs) best.set(k, f);
  }
  return [...best.values()];
}

function publicFileUrl(request, key) {
  const u = new URL(request.url);
  return `${u.origin}/api/file?key=${encodeURIComponent(key)}`;
}

async function handleUpload(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(request, env, 400, { error: 'Invalid JSON' });
  }
  const receiptNo = safeNo(body.receiptNo);
  const kind = normalizeKind(body.kind);
  const view = normalizeView(body.view);
  const pdfBase64 = body.pdfBase64;
  if (!pdfBase64) return json(request, env, 400, { error: 'pdfBase64 required' });
  if (!env.RECEIPTS) return json(request, env, 503, { error: 'R2 binding RECEIPTS missing' });

  let bytes;
  try {
    bytes = b64ToUint8(pdfBase64);
  } catch {
    return json(request, env, 400, { error: 'invalid pdfBase64' });
  }
  if (bytes.length < 20) return json(request, env, 400, { error: 'empty pdf' });
  if (bytes.length > 8 * 1024 * 1024) return json(request, env, 413, { error: 'pdf too large' });

  const filename = friendlyName(receiptNo, view, kind);
  const key = objectKey(receiptNo, view, kind);

  // Remove other keys for same format (legacy names) under this receipt folder
  const prefix = `receipts/${receiptNo}/`;
  const existing = await listPrefix(env.RECEIPTS, prefix);
  for (const o of existing) {
    const meta = parseKey(o.key);
    if (meta.view === view && meta.kind === kind && o.key !== key) {
      try {
        await env.RECEIPTS.delete(o.key);
      } catch (_) {}
    }
  }

  await env.RECEIPTS.put(key, bytes, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: { receiptNo, kind, view, filename },
  });

  return json(request, env, 200, {
    ok: true,
    url: publicFileUrl(request, key),
    pathname: key,
    filename,
    receiptNo,
    kind,
    view,
    size: bytes.length,
    replaced: true,
    storage: 'r2',
  });
}

async function handleList(request, env) {
  if (!env.RECEIPTS) return json(request, env, 503, { error: 'R2 binding RECEIPTS missing' });
  const u = new URL(request.url);
  const no = safeNo(u.searchParams.get('no') || '');
  const hasNo = !!(u.searchParams.get('no') || '').trim();

  if (hasNo) {
    const prefix = `receipts/${no}/`;
    const objects = await listPrefix(env.RECEIPTS, prefix);
    const files = dedupeByFormat(
      objects.map((o) => {
        const meta = parseKey(o.key);
        return {
          url: publicFileUrl(request, o.key),
          pathname: o.key,
          filename: meta.filename,
          uploadedAt: o.uploaded ? new Date(o.uploaded).toISOString() : null,
          size: o.size,
          view: meta.view,
          kind: meta.kind,
          receiptNo: meta.receiptNo || no,
        };
      })
    );
    files.sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
    return json(request, env, 200, { ok: true, receiptNo: no, files, storage: 'r2' });
  }

  const objects = await listPrefix(env.RECEIPTS, 'receipts/');
  const map = new Map();
  for (const o of objects) {
    const meta = parseKey(o.key);
    if (!meta.receiptNo) continue;
    const row = map.get(meta.receiptNo) || { receiptNo: meta.receiptNo, count: 0, latest: null };
    row.count += 1;
    const ts = o.uploaded ? new Date(o.uploaded).getTime() : 0;
    if (!row.latest || ts > row.latest) row.latest = ts;
    map.set(meta.receiptNo, row);
  }
  const folders = [...map.values()].sort((a, b) => (b.latest || 0) - (a.latest || 0));
  return json(request, env, 200, { ok: true, folders, storage: 'r2' });
}

async function handleFile(request, env) {
  if (!env.RECEIPTS) return json(request, env, 503, { error: 'R2 binding RECEIPTS missing' });
  const u = new URL(request.url);
  let key = u.searchParams.get('key') || '';
  if (!key && u.pathname.startsWith('/file/')) key = decodeURIComponent(u.pathname.slice('/file/'.length));
  if (!key && u.pathname.startsWith('/api/file/')) key = decodeURIComponent(u.pathname.slice('/api/file/'.length));
  key = String(key || '').replace(/^\/+/, '');
  if (!key.startsWith('receipts/') || key.includes('..')) {
    return json(request, env, 400, { error: 'invalid key' });
  }
  const obj = await env.RECEIPTS.get(key);
  if (!obj) return json(request, env, 404, { error: 'not found' });
  const headers = {
    'Content-Type': obj.httpMetadata?.contentType || 'application/pdf',
    'Content-Disposition': `inline; filename="${(key.split('/').pop() || 'receipt.pdf').replace(/"/g, '')}"`,
    'Cache-Control': 'private, max-age=60',
    ...corsHeaders(request, env),
  };
  return new Response(obj.body, { status: 200, headers });
}


async function handleDelete(request, env) {
  if (!env.RECEIPTS) return json(request, env, 503, { error: 'R2 binding RECEIPTS missing' });

  let body = {};
  const u = new URL(request.url);
  // Accept JSON body and/or query params
  if (request.method === 'POST' || request.method === 'DELETE') {
    const ct = (request.headers.get('Content-Type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      try {
        body = await request.json();
      } catch {
        body = {};
      }
    }
  }
  let key = String((body && body.key) || u.searchParams.get('key') || '').replace(/^\/+/, '');
  let noRaw = (body && (body.no || body.receiptNo)) || u.searchParams.get('no') || u.searchParams.get('receiptNo') || '';
  const hasNo = !!String(noRaw || '').trim();

  if (key) {
    if (!key.startsWith('receipts/') || key.includes('..')) {
      return json(request, env, 400, { error: 'invalid key' });
    }
    await env.RECEIPTS.delete(key);
    return json(request, env, 200, { ok: true, deleted: [key], count: 1, storage: 'r2' });
  }

  if (hasNo) {
    const no = safeNo(noRaw);
    const prefix = `receipts/${no}/`;
    if (prefix.includes('..')) {
      return json(request, env, 400, { error: 'invalid no' });
    }
    const objects = await listPrefix(env.RECEIPTS, prefix);
    const deleted = [];
    for (const o of objects) {
      if (!o.key.startsWith('receipts/') || o.key.includes('..')) continue;
      await env.RECEIPTS.delete(o.key);
      deleted.push(o.key);
    }
    return json(request, env, 200, { ok: true, deleted, count: deleted.length, receiptNo: no, storage: 'r2' });
  }

  return json(request, env, 400, { error: 'key or no required' });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    const u = new URL(request.url);
    const path = u.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/api/health' || path === '/health') {
        return json(request, env, 200, {
          ok: true,
          service: 'versy-receipts',
          r2: !!env.RECEIPTS,
          storage: 'cloudflare-r2',
        });
      }
      if (path === '/api/upload-receipt' && request.method === 'POST') {
        return await handleUpload(request, env);
      }
      if (path === '/api/list-receipts' && request.method === 'GET') {
        return await handleList(request, env);
      }
      if ((path === '/api/file' || path.startsWith('/api/file/') || path.startsWith('/file/')) && request.method === 'GET') {
        return await handleFile(request, env);
      }
      if (path === '/api/delete-receipt' && (request.method === 'DELETE' || request.method === 'POST')) {
        return await handleDelete(request, env);
      }
      return json(request, env, 404, { error: 'not found', path });
    } catch (err) {
      return json(request, env, 500, { error: String(err && err.message ? err.message : err) });
    }
  },
};
