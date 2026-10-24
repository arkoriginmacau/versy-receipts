const { put, list, del } = require('@vercel/blob');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function safeNo(no) {
  return String(no || 'receipt')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'receipt';
}

function formatPrefix(receiptNo, view, kind) {
  return `receipts/${receiptNo}/${view}-${kind}`;
}

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return res.status(503).json({ error: 'BLOB_READ_WRITE_TOKEN not set' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const receiptNo = safeNo(body.receiptNo);
    const kind = body.kind === 'paid-in-full' ? 'paid-in-full' : 'regular';
    const view = body.view === 'one-page' ? 'one-page' : 'full';
    const pdfBase64 = body.pdfBase64;
    if (!pdfBase64) return res.status(400).json({ error: 'pdfBase64 required' });

    const buf = Buffer.from(pdfBase64, 'base64');
    if (buf.length < 20) return res.status(400).json({ error: 'empty pdf' });
    if (buf.length > 8 * 1024 * 1024) return res.status(413).json({ error: 'pdf too large' });

    // One file per number+format: stable name, overwrite; remove legacy timestamped copies
    const pathname = `receipts/${receiptNo}/${view}-${kind}.pdf`;
    const prefix = formatPrefix(receiptNo, view, kind);
    try {
      const existing = await list({ prefix, token });
      const toDel = (existing.blobs || [])
        .map((b) => b.url)
        .filter(Boolean);
      if (toDel.length) {
        await del(toDel, { token });
      }
    } catch (e) {
      console.warn('cleanup prior blobs failed', e);
    }

    const blob = await put(pathname, buf, {
      access: 'public',
      contentType: 'application/pdf',
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    const filename = `${view}-${kind}-${receiptNo}.pdf`;
    return res.status(200).json({
      ok: true,
      url: blob.url,
      pathname,
      filename,
      receiptNo,
      kind,
      view,
      size: buf.length,
      replaced: true,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
};
