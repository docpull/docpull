# docpull

A minimal microservice for AI agents that accepts any PDF URL and returns clean Markdown text, with **per-page billing via [x402](https://x402.org/)** ($0.001 USDC per page).

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Service health check |
| `GET` | `/probe?url=<pdf_url>` | None | Returns page count + cost preview |
| `POST` | `/extract` | x402 payment | Download PDF → Markdown |
| `POST` | `/facilitator` | None | x402 protocol facilitator |

---

## Usage

### 1. Probe (free – get cost before paying)

```bash
curl "https://your-service.up.railway.app/probe?url=https://example.com/doc.pdf"
```

```json
{
  "pageCount": 12,
  "costUSDC": "0.012000",
  "pricePerPage": "0.001 USDC"
}
```

### 2. Extract (paid)

```bash
curl -X POST https://your-service.up.railway.app/extract \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/doc.pdf"}'
```

Without payment headers the server returns a standard **402 Payment Required** response:

```json
{
  "x402Version": 1,
  "error": "Payment required",
  "accepts": [{ "scheme": "exact", "network": "base", "maxAmountRequired": "12000", "resource": "...", ... }]
}
```

Use any x402-compatible client (e.g. `x402-fetch`) to attach payment automatically:

```js
import { wrapFetchWithPayment } from "x402-fetch";
import { createWalletClient } from "viem";

const wallet = createWalletClient({ ... }); // your Base wallet
const fetch402 = wrapFetchWithPayment(fetch, wallet);

const res = await fetch402("https://your-service.up.railway.app/extract", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: "https://example.com/doc.pdf" }),
});

const { markdown, pageCount } = await res.json();
```

Response:

```json
{
  "success": true,
  "pageCount": 12,
  "charCount": 18432,
  "markdown": "# Title\n\n## Section 1\n\nBody text..."
}
```

---

## Deployment on Railway

### Prerequisites

- Railway account + CLI (`npm i -g @railway/cli`)
- A Base wallet address to receive payments
- (Optional) Base Sepolia for testing

### Steps

```bash
# 1. Clone / init
git init docpull && cd docpull
# copy all files here

# 2. Login and create project
railway login
railway init

# 3. Set environment variables
railway variables set WALLET_ADDRESS=0xYourAddressHere
railway variables set BASE_URL=https://$(railway domain)
railway variables set NETWORK=base          # or base-sepolia for testnet

# 4. Deploy
railway up
```

Railway auto-detects the `Dockerfile` and runs health checks on `/health`.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WALLET_ADDRESS` | ✅ | — | USDC receiver on Base |
| `BASE_URL` | ✅ | — | Public HTTPS URL of this service |
| `NETWORK` | ❌ | `base` | `base` or `base-sepolia` |
| `PORT` | ❌ | `3000` | Set automatically by Railway |

---

## Pricing

| Pages | Cost |
|-------|------|
| 1 | $0.001 |
| 10 | $0.010 |
| 50 | $0.050 |
| 100 | $0.100 |

Payment is in USDC on Base (or Base Sepolia for testnet). The `/probe` endpoint lets callers check cost before committing.

---

## Architecture

```
Client
  │
  ├─ GET /probe          → fetch PDF, count pages, return cost estimate (free)
  │
  └─ POST /extract
       │
       ├─ 1. Fetch PDF & count pages  → compute price
       ├─ 2. x402 middleware          → verify / settle USDC payment
       ├─ 3. extractPdfToMarkdown()   → pdfjs-dist structural extraction
       │      ├─ heading detection (font size heuristics)
       │      ├─ bullet / numbered list detection
       │      └─ per-page page separators
       └─ 4. Return JSON { markdown, pageCount, charCount }
```

## Local Development

```bash
cp .env.example .env
# fill in WALLET_ADDRESS and BASE_URL=http://localhost:3000

npm install
npm run dev
```
