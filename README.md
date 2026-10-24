# Versy receipts

Hosted **Artwork Purchase Receipt** (Versy / paperworks) for Ark’s Coffee Shop launcher.

## URLs

- GitHub Pages (static): https://arkoriginmacau.github.io/versy-receipts/
- Editor: https://arkoriginmacau.github.io/versy-receipts/receipt.html
- Coffee Shop tile: **Versy receipts** (Paperworks)

## Features (v0.26)

- **Regular** purchase receipt (A/B finished vs custom, bilingual, one-page view)
- **Paid in full / 已全額支付** — same wrapper/layout/ends; settlement body (final payment, deposits hidden); Gallery sold red `#a53a2a`
- **Default merchant signature** on every kind (full, one-page, paid-in-full). Placeholder script signature until you upload your own (⋯ → Default signature, or ✎ on the sign line). Stored in `localStorage` key `versy-merchant-sig`
- **Save PDF** via html2pdf from jsDelivr CDN (not inlined)
- **Storage drag & drop** — drop a PDF or drag the current receipt onto the Storage drop zone; lands under `receipts/{no}/…` on Blob
- **Same-serial siblings** — from Storage: **＋ Full**, **＋ One-page**, **＋ Paid in full** copy all details and keep the same receipt number
- **Storage tab** — browse archived PDFs by receipt number (full / one-page / paid-in-full share one folder). Opens from top-bar **Storage** or hub link

## Vercel Blob archive

Save PDF still downloads locally, then best-effort uploads to Vercel Blob:

`receipts/{receiptNo}/{full|one-page}-{regular|paid-in-full}-{timestamp}.pdf`

### Setup

1. Import this GitHub repo into a Vercel project (or `vercel link`).
2. Vercel → Storage → Create Blob store → connect to the project (sets `BLOB_READ_WRITE_TOKEN`).
3. Deploy. API routes: `/api/upload-receipt`, `/api/list-receipts`.
4. If the UI is still on GitHub Pages, point it at the Vercel origin once in the browser console:

```js
localStorage.setItem('versy-api-base', 'https://YOUR-VERCEL-APP.vercel.app')
```

Do **not** commit secrets. GitHub Pages keeps serving static HTML without the API.

## Local / host notes

- Template version shown in the top bar (`v0.26 · 26.10.24`)
- Host shell `0.2` — per-id localStorage + index; `?kind=paid-in-full` for settlement receipts
