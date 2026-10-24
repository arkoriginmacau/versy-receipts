const { list } = require('@vercel/blob');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function safeNo(no) {
  return String(no || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function parsePath(pathname) {
  // Stable: receipts/{receiptNo}/{view}-{kind}.pdf
  // Legacy: receipts/{receiptNo}/{view}-{kind}-{timestamp}.pdf
  const parts = String(pathname || '').split('/');
  const receiptNo = parts[1] || '';
  const file = (parts[2] || '').replace(/\.pdf$/i, '');
  let view = 'full', kind = 'regular';
  if (file.startsWith('one-page-')) {
    view = 'one-page';
    const rest = file.slice('one-page-'.length);
    kind = rest.startsWith('paid-in-full') ? 'paid-in-full' : 'regular';
  } else if (file.startsWith('full-')) {
    view = 'full';
    const rest = file.slice('full-'.length);
    kind = rest.startsWith('paid-in-full') ? 'paid-in-full' : 'regular';
  }
  return { receiptNo, view, kind, file };
}

function dedupeBlobFiles(files) {
  const best = new Map();
  for (const f of files) {
    const k = `${f.view || 'full'}|${f.kind || 'regular'}`;
    const prev = best.get(k);
    const ts = f.uploadedAt ? new Date(f.uploadedAt).getTime() : 0;
    const prevTs = prev && prev.uploadedAt ? new Date(prev.uploadedAt).getTime() : 0;
    // Prefer stable name (no extra timestamp segment), else newest
    const stable = /\/(full|one-page)-(regular|paid-in-full)\.pdf$/i.test(f.pathname || '');
    const prevStable = prev && /\/(full|one-page)-(regular|paid-in-full)\.pdf$/i.test(prev.pathname || '');
    if (!prev || (stable && !prevStable) || (stable === prevStable && ts >= prevTs)) best.set(k, f);
  }
  return [...best.values()];
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(503).json({ error: 'BLOB_READ_WRITE_TOKEN not set' });

  try {
    const no = safeNo((req.query && req.query.no) || '');
    if (no) {
      const prefix = `receipts/${no}/`;
      const result = await list({ prefix, token });
      const files = dedupeBlobFiles((result.blobs || []).map((b) => {
        const meta = parsePath(b.pathname);
        return {
          url: b.url,
          pathname: b.pathname,
          filename: `${meta.view || 'full'}-${meta.kind || 'regular'}-${meta.receiptNo || no}.pdf`,
          uploadedAt: b.uploadedAt,
          size: b.size,
          view: meta.view,
          kind: meta.kind,
          receiptNo: meta.receiptNo || no,
        };
      }));
      files.sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
      return res.status(200).json({ ok: true, receiptNo: no, files });
    }

    const result = await list({ prefix: 'receipts/', token });
    const map = new Map();
    for (const b of result.blobs || []) {
      const meta = parsePath(b.pathname);
      if (!meta.receiptNo) continue;
      const row = map.get(meta.receiptNo) || { receiptNo: meta.receiptNo, count: 0, latest: null };
      row.count += 1;
      const ts = b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
      if (!row.latest || ts > row.latest) row.latest = ts;
      map.set(meta.receiptNo, row);
    }
    const folders = [...map.values()].sort((a, b) => (b.latest || 0) - (a.latest || 0));
    return res.status(200).json({ ok: true, folders });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};
