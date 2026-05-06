import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { extractPdfToMarkdown, getPageCount } from "./extractor.js";

// ── Factory: create a fresh MCP server per request (stateless) ────────────
export function createMcpServer() {
  const server = new McpServer({
    name: "docpull",
    version: "1.0.0",
    instructions: "docpull converts PDF URLs to clean structured Markdown. Use probe_pdf first to check page count and cost ($0.001 USDC per page via x402 on Base mainnet). Then use extract_pdf to extract. health_check verifies the service is running.",
  });

  // ── Tool: probe_pdf ──────────────────────────────────────────────────────
  server.tool(
    "probe_pdf",
    "Check the page count and exact cost for a PDF before extracting. Free — no payment required.",
    {
      url: z.string().url().describe("Publicly accessible HTTPS URL of the PDF to probe"),
    },
    async ({ url }) => {
      try {
        const pageCount = await getPageCount(url);
        const costUSDC = (pageCount * 0.001).toFixed(6);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ pageCount, costUSDC, pricePerPage: "0.001 USDC", url }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ── Tool: extract_pdf ────────────────────────────────────────────────────
  server.tool(
    "extract_pdf",
    "Extract a PDF from a URL and return clean structured Markdown text. Costs $0.001 USDC per page via x402 v2 on Base mainnet. Call probe_pdf first to check cost.",
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
          content: [{
            type: "text",
            text: JSON.stringify({ success: true, pageCount, charCount: markdown.length, markdown }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ── Tool: health_check ───────────────────────────────────────────────────
  server.tool(
    "health_check",
    "Check if the docpull service is running and available.",
    {},
    async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({ status: "ok", service: "docpull", version: "1.0.0" }),
      }],
    })
  );

  return server;
}

// ── Create transport (stateless) ───────────────────────────────────────────
export function createMcpTransport() {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
}
