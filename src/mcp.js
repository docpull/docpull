import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { extractPdfToMarkdown, getPageCount } from "./extractor.js";

// ── Create MCP server ──────────────────────────────────────────────────────
export const mcpServer = new McpServer({
  name: "docpull",
  version: "1.0.0",
  instructions: "docpull converts PDF URLs to clean structured Markdown. Use probe_pdf first to check page count and cost ($0.001 USDC per page). Then call extract_pdf with an x402-compatible client to pay and receive the markdown. Free endpoints: probe_pdf. Paid endpoints: extract_pdf (requires USDC on Base mainnet via x402 v2).",
});

// ── Tool: probe_pdf ────────────────────────────────────────────────────────
mcpServer.tool(
  "probe_pdf",
  "Check the page count and exact cost for a PDF before extracting. Free — no payment required. Returns pageCount, costUSDC, and pricePerPage.",
  {
    url: z.string().url().describe("Publicly accessible HTTPS URL of the PDF to probe"),
  },
  async ({ url }) => {
    try {
      const pageCount = await getPageCount(url);
      const costUSDC = (pageCount * 0.001).toFixed(6);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ pageCount, costUSDC, pricePerPage: "0.001 USDC", url }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: extract_pdf ──────────────────────────────────────────────────────
mcpServer.tool(
  "extract_pdf",
  "Extract a PDF from a URL and return clean structured Markdown text. Costs $0.001 USDC per page, paid automatically via x402 v2 on Base mainnet. Call probe_pdf first to check cost. Returns markdown, pageCount, and charCount.",
  {
    url: z.string().url().describe("Publicly accessible HTTPS URL of the PDF to extract"),
  },
  async ({ url }) => {
    try {
      const [markdown, pageCount] = await Promise.all([
        extractPdfToMarkdown(url),
        getPageCount(url),
      ]);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              pageCount,
              charCount: markdown.length,
              markdown,
            }, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// ── Tool: health_check ─────────────────────────────────────────────────────
mcpServer.tool(
  "health_check",
  "Check if the docpull service is running and available.",
  {},
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({ status: "ok", service: "docpull", version: "1.0.0" }),
      },
    ],
  })
);

// ── Create transport factory ───────────────────────────────────────────────
export function createMcpTransport() {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
}
