import express from "express";
import { paymentMiddleware } from "x402-express";
import { facilitator } from "@coinbase/x402";
import { extractPdfToMarkdown, getPageCount } from "./extractor.js";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const NETWORK = process.env.NETWORK || "base";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

if (!WALLET_ADDRESS) {
  console.error("❌ WALLET_ADDRESS env var is required");
  process.exit(1);
}

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

// ── x402 middleware applied globally to /extract (both GET and POST) ───────
// Must run BEFORE any request validation so empty/probe requests get 402
const extractPaymentMiddleware = paymentMiddleware(
  WALLET_ADDRESS,
  {
    "GET /extract": {
      price: "$0.001",
      network: NETWORK,
      config: {
        description: "PDF to Markdown extraction. POST {url} to extract any PDF. $0.001 per page.",
        mimeType: "application/json",
      },
    },
    "POST /extract": {
      price: "$0.001",
      network: NETWORK,
      config: {
        description: "PDF to Markdown extraction. POST {url} to extract any PDF. $0.001 per page.",
        mimeType: "application/json",
      },
    },
  },
  facilitator
);

app.use("/extract", extractPaymentMiddleware);

// ── GET /extract — info endpoint (requires payment, enables Bazaar probing) 
app.get("/extract", (_req, res) => {
  res.json({
    info: "POST to /extract with {url} in the body to extract a PDF to markdown.",
    pricing: "$0.001 USDC per page",
    probe: "GET /probe?url=<pdf_url> for free page count and cost estimate",
  });
});

// ── POST /extract — actual extraction ─────────────────────────────────────
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
  console.log(`   Facilitator: CDP (Bazaar-enabled)`);
});
