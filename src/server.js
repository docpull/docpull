import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { extractPdfToMarkdown, getPageCount } from "./extractor.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const NETWORK = process.env.NETWORK || "eip155:8453"; // Base mainnet CAIP-2
const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID;
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

if (!WALLET_ADDRESS) {
  console.error("❌ WALLET_ADDRESS env var is required");
  process.exit(1);
}

// ── x402 v2 resource server with CDP facilitator ───────────────────────────
const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://api.cdp.coinbase.com/platform/v2/x402/facilitator",
  createAuthHeaders: async () => {
    // CDP uses API key id + secret as Bearer token (base64 encoded)
    const credentials = Buffer.from(`${CDP_API_KEY_ID}:${CDP_API_KEY_SECRET}`).toString("base64");
    return { Authorization: `Basic ${credentials}` };
  },
});

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register("eip155:*", new ExactEvmScheme());

// USDC on Base mainnet
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const routes = {
  "GET /extract": {
    accepts: [{
      scheme: "exact",
      price: "$0.001",
      network: NETWORK,
      payTo: WALLET_ADDRESS,
      asset: USDC_BASE,
      maxTimeoutSeconds: 300,
    }],
    description: "PDF to Markdown extraction API. POST {url} to extract any PDF. $0.001 per page.",
    mimeType: "application/json",
  },
  "POST /extract": {
    accepts: [{
      scheme: "exact",
      price: "$0.001",
      network: NETWORK,
      payTo: WALLET_ADDRESS,
      asset: USDC_BASE,
      maxTimeoutSeconds: 300,
    }],
    description: "PDF to Markdown extraction API. POST {url} to extract any PDF. $0.001 per page.",
    mimeType: "application/json",
  },
};

// Apply x402 middleware BEFORE route handlers
app.use(paymentMiddleware(routes, resourceServer));

// ── Health check (free — not in routes so no payment required) ─────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "docpull", version: "1.0.0" });
});

// ── Page-count probe (free) ────────────────────────────────────────────────
app.get("/probe", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url query param required" });
  try {
    const pageCount = await getPageCount(url);
    const costUSDC = (pageCount * 0.001).toFixed(6);
    res.json({ pageCount, costUSDC, pricePerPage: "0.001 USDC" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /extract — info (gated by x402) ───────────────────────────────────
app.get("/extract", (_req, res) => {
  res.json({
    info: "POST to /extract with {url} in the body to extract a PDF to markdown.",
    pricing: "$0.001 USDC per page",
    probe: "GET /probe?url=<pdf_url> for free page count and cost estimate",
  });
});

// ── POST /extract — extraction (gated by x402) ────────────────────────────
app.post("/extract", async (req, res, next) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url body field required" });
  try {
    const [markdown, pageCount] = await Promise.all([
      extractPdfToMarkdown(url),
      getPageCount(url),
    ]);
    res.json({ success: true, pageCount, markdown, charCount: markdown.length });
  } catch (err) {
    next(err);
  }
});

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`✅ docpull listening on port ${PORT}`);
  console.log(`   Wallet : ${WALLET_ADDRESS}`);
  console.log(`   Network: ${NETWORK}`);
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Facilitator: CDP (Bazaar-enabled)`);
});
