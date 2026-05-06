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

// Serve landing page
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const NETWORK = process.env.NETWORK || "eip155:8453"; // Base mainnet
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

if (!WALLET_ADDRESS) {
  console.error("❌ WALLET_ADDRESS env var is required");
  process.exit(1);
}

// ── x402 v2 setup ──────────────────────────────────────────────────────────
const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://api.cdp.coinbase.com/platform/v2/x402/facilitator",
});

const server = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(server);
server.registerExtension(bazaarResourceServerExtension);

// ── USDC contract address on Base mainnet ──────────────────────────────────
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// ── Health check (free) ────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "docpull", version: "1.0.0" });
});

// ── Page-count probe (free) ─────────────────────────────────────────────────
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

// ── Extract endpoint — x402 v2 with Bazaar discovery ───────────────────────
// Uses a fixed minimum price of $0.001 (1 page) for the 402 response.
// Actual charge is computed after payment clears based on real page count.
app.use(
  paymentMiddleware(
    {
      "POST /extract": {
        accepts: {
          scheme: "exact",
          network: NETWORK,
          amount: "1000", // minimum: $0.001 in USDC atomic units
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

// ── Error handler ───────────────────────────────────────────────────────────
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
