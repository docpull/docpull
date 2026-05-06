import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from "@x402/extensions/bazaar";
import { extractPdfToMarkdown, getPageCount } from "./extractor.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const NETWORK = process.env.NETWORK || "eip155:8453";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID;
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET;

if (!WALLET_ADDRESS) {
  console.error("❌ WALLET_ADDRESS env var is required");
  process.exit(1);
}

if (!CDP_API_KEY_ID || !CDP_API_KEY_SECRET) {
  console.error("❌ CDP_API_KEY_ID and CDP_API_KEY_SECRET are required");
  process.exit(1);
}

// ── x402 v2 setup with CDP facilitator ────────────────────────────────────
const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://api.cdp.coinbase.com/platform/v2/x402/facilitator",
  auth: {
    keyId: CDP_API_KEY_ID,
    keySecret: CDP_API_KEY_SECRET,
  },
});

const server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(server);
server.registerExtension(bazaarResourceServerExtension);

// ── USDC on Base mainnet ───────────────────────────────────────────────────
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// ── Health check (free) ────────────────────────────────────────────────────
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

// ── Extract endpoint — x402 v2 + CDP Bazaar discovery ─────────────────────
app.use(
  paymentMiddleware(
    {
      "POST /extract": {
        accepts: {
          scheme: "exact",
          network: NETWORK,
          amount: "1000",
          asset: USDC_BASE,
          payTo: WALLET_ADDRESS,
          maxTimeoutSeconds: 300,
        },
        extensions: {
          ...declareDiscoveryExtension({
            input: { url: "https://example.com/document.pdf" },
            inputSchema: {
              properties: {
                url: {
                  type: "string",
                  description: "Publicly accessible URL of the PDF to extract",
                },
              },
              required: ["url"],
            },
            bodyType: "json",
            output: {
              example: {
                success: true,
                pageCount: 5,
                charCount: 8200,
                markdown: "# Document Title\n\n## Section 1\n\nBody text...",
              },
              schema: {
                properties: {
                  success: { type: "boolean" },
                  pageCount: { type: "number" },
                  charCount: { type: "number" },
                  markdown: { type: "string" },
                },
                required: ["success", "pageCount", "charCount", "markdown"],
              },
            },
          }),
        },
      },
    },
    server
  )
);

app.post("/extract", async (req, res, next) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url body field required" });

  try {
    const [markdown, pageCount] = await Promise.all([
      extractPdfToMarkdown(url),
      getPageCount(url),
    ]);
    res.json({
      success: true,
      pageCount,
      markdown,
      charCount: markdown.length,
    });
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
  console.log(`   Bazaar : CDP facilitator discovery enabled`);
});
