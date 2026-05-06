# docpull

**PDF to Markdown API for AI agents.** Send any PDF URL, get clean structured markdown back. Pay $0.001 USDC per page via [x402 v2](https://x402.org/) — no accounts, no API keys, no subscriptions.

🟢 **Live at [docpull.ai](https://docpull.ai)** · Indexed in the [CDP Bazaar](https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=pdf+extraction) · Base mainnet

---

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Service health check |
| `GET` | `/probe?url=<pdf_url>` | None | Page count + cost estimate (free) |
| `POST` | `/extract` | x402 payment | PDF → Markdown |

---

## Usage

### Probe (free)

Check page count and cost before paying:

```bash
curl "https://docpull.ai/probe?url=https://example.com/doc.pdf"
```

```json
{
  "pageCount": 12,
  "costUSDC": "0.012000",
  "pricePerPage": "0.001 USDC"
}
```

### Extract (paid via x402)

Without a payment header, the server returns a standard 402 with payment instructions in the `PAYMENT-REQUIRED` header (base64-encoded x402 v2 envelope).

Use any x402-compatible client to pay automatically:

```js
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY);
const client = new x402Client()
  .register("eip155:*", new ExactEvmScheme(signer));

const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const res = await fetchWithPayment("https://docpull.ai/extract", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: "https://example.com/doc.pdf" }),
});

const { markdown, pageCount, charCount } = await res.json();
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

## Pricing

| Pages | Cost |
|-------|------|
| 1 | $0.001 USDC |
| 10 | $0.010 USDC |
| 50 | $0.050 USDC |
| 100 | $0.100 USDC |

Payments settle on Base mainnet via USDC. Use `/probe` to check cost before committing.

---

## CDP Bazaar Discovery

docpull is indexed in the [CDP Bazaar](https://docs.cdp.coinbase.com/x402/bazaar) — the discovery layer for x402-enabled APIs. AI agents can find and call docpull autonomously without any pre-configuration:

```bash
curl "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=pdf+markdown"
```

---

## Stack

- **Runtime:** Node.js 20, Express
- **PDF extraction:** pdfjs-dist (heading detection, list parsing, per-page separators)
- **Payments:** x402 v2, CDP facilitator, USDC on Base (`eip155:8453`)
- **Deployment:** Railway + Docker

---

## Self-hosting

```bash
git clone https://github.com/docpull/docpull
cd docpull
npm install

# Set environment variables
railway variables set WALLET_ADDRESS=0xYourAddress
railway variables set BASE_URL=https://your-domain.com
railway variables set CDP_API_KEY_ID=your-cdp-key-id
railway variables set CDP_API_KEY_SECRET=your-cdp-key-secret

railway up
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WALLET_ADDRESS` | ✅ | USDC-receiving wallet on Base |
| `BASE_URL` | ✅ | Public HTTPS URL of this service |
| `CDP_API_KEY_ID` | ✅ | CDP API key ID for x402 facilitator |
| `CDP_API_KEY_SECRET` | ✅ | CDP API key secret |
| `PORT` | ❌ | Port (Railway sets automatically) |

---

## Local Development

```bash
cp .env.example .env
# fill in env vars

npm install
npm run dev
```
