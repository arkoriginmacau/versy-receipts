# Versy receipts

Hosted **Artwork Purchase Receipt** (Versy / paperworks) for Ark’s Coffee Shop launcher.

## URLs

- GitHub Pages (static): https://arkoriginmacau.github.io/versy-receipts/
- Editor: https://arkoriginmacau.github.io/versy-receipts/receipt.html
- Storage API (Cloudflare Worker + R2): https://versy-receipts.arkoriginmacau.workers.dev
- Coffee Shop tile: **Versy receipts** (Paperworks)

## Features (v0.38)

- **Regular** purchase receipt (A/B finished vs custom, bilingual, one-page view)
- **Paid in full / 已全額支付** — same wrapper/layout/ends; settlement body; Gallery sold red `#a53a2a`
- **Default merchant signature** on every kind (⋯ → Default signature). Stored in `localStorage` key `versy-merchant-sig`
- **Save PDF** via html2pdf from jsDelivr CDN
- **Storage** — dropped PDFs are classified by page count as regular One-page or Full receipts under the open ARK serial; click to expand files
- **Mode toggle** — one sold-red bar button flips **New receipt** ↔ **Pay in full · split** (separate New receipt / ＋ One-page bar buttons removed)
- **Pay in full · split** — from a Storage row, auto-adds a stamped Paid-in-full PDF under the same number
- **Cloud archive** on **Cloudflare R2** (Worker API). IndexedDB stays as offline fallback when cloud fails
- **Hold 3s to delete** — sold-red blink on a Storage file line (or number line for the whole folder); releases early cancel

## Cloudflare R2 archive

UI defaults to the Worker at `https://versy-receipts.arkoriginmacau.workers.dev`.

Object keys:

`receipts/{receiptNo}/{Full-receipt|One-page-receipt|Paid-in-full}-{receiptNo}.pdf`

(one file per number+format; overwrite)

### API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Worker + R2 binding check |
| `POST` | `/api/upload-receipt` | JSON `{ receiptNo, kind, view, pdfBase64 }` |
| `GET` | `/api/list-receipts` | Folders (or `?no=` for files) |
| `GET` | `/api/file?key=…` | Serve a PDF (inline) |
| `DELETE`/`POST` | `/api/delete-receipt` | JSON `{ key }` one object, or `{ no }` whole folder |

CORS allows `https://arkoriginmacau.github.io` (and localhost). Override the API base anytime:

```js
localStorage.setItem('versy-api-base', 'https://versy-receipts.arkoriginmacau.workers.dev')
// or clear to use the built-in default:
localStorage.removeItem('versy-api-base')
```

### Deploy Worker (from `worker/`)

Needs a Cloudflare API token with **Workers Scripts Edit** and **Workers R2 Storage Edit** (plus Account read), and `CLOUDFLARE_ACCOUNT_ID=a4e86fb12c365f27eff0fbf2ca98eb5b`:

```bash
cd worker
npx wrangler r2 bucket create versy-receipts   # once
npx wrangler deploy
curl -s https://versy-receipts.arkoriginmacau.workers.dev/api/health
```

Do **not** commit secrets. GitHub Pages keeps serving static HTML; the Worker holds the PDFs.

### Legacy Vercel Blob

`api/upload-receipt.js` and `api/list-receipts.js` remain for an optional Vercel deploy. Prefer the Cloudflare Worker going forward.

## Local / host notes

- Template version shown in the top bar (`v0.38 · 26.10.25`)
- Host shell — per-id localStorage + index; `?kind=paid-in-full` for settlement receipts
