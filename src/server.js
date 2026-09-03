import crypto from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
const KEYCRM_API_TOKEN = process.env.KEYCRM_API_TOKEN;
const MCP_ACCESS_TOKEN = process.env.MCP_ACCESS_TOKEN;
const KEYCRM_BASE_URL = "https://openapi.keycrm.app/v1";

if (!KEYCRM_API_TOKEN) throw new Error("KEYCRM_API_TOKEN is required");
if (!MCP_ACCESS_TOKEN) throw new Error("MCP_ACCESS_TOKEN is required");

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isAuthorized(req) {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const queryToken = req.query.token;
  return safeEqual(bearer, MCP_ACCESS_TOKEN) || safeEqual(queryToken, MCP_ACCESS_TOKEN);
}

function normalizePath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error("Path must begin with /");
  }
  if (path.includes("..") || path.includes("://") || path.includes("\\")) {
    throw new Error("Unsafe API path");
  }
  return path;
}

async function keycrmRequest(method, path, query = {}, body) {
  const cleanPath = normalizePath(path);
  const url = new URL(KEYCRM_BASE_URL + cleanPath);

  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, String(item)));
    else url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${KEYCRM_API_TOKEN}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000)
  });

  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

  if (!response.ok) {
    throw new Error(`KeyCRM ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function asToolResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function createServer() {
  const server = new McpServer({ name: "keycrm", version: "1.0.0" });

  server.tool(
    "keycrm_read",
    "Read any documented KeyCRM OpenAPI endpoint. Use paths relative to https://openapi.keycrm.app/v1, for example /pipelines, /buyer, /order, or /offer.",
    {
      path: z.string().describe("KeyCRM API path beginning with /"),
      query: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])).optional()
    },
    async ({ path, query }) => asToolResult(await keycrmRequest("GET", path, query))
  );

  server.tool(
    "keycrm_create",
    "Create data through any documented KeyCRM POST endpoint. This changes CRM data and requires explicit confirmation.",
    {
      path: z.string(),
      body: z.record(z.any()),
      confirmation: z.literal("CONFIRM").describe("Must equal CONFIRM after the user explicitly approves this exact write")
    },
    async ({ path, body }) => asToolResult(await keycrmRequest("POST", path, {}, body))
  );

  server.tool(
    "keycrm_update",
    "Update data through any documented KeyCRM PUT endpoint. This changes CRM data and requires explicit confirmation.",
    {
      path: z.string(),
      body: z.record(z.any()),
      confirmation: z.literal("CONFIRM").describe("Must equal CONFIRM after the user explicitly approves this exact write")
    },
    async ({ path, body }) => asToolResult(await keycrmRequest("PUT", path, {}, body))
  );

  server.tool(
    "keycrm_delete",
    "Delete data through any documented KeyCRM DELETE endpoint. This is destructive and requires explicit confirmation.",
    {
      path: z.string(),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
      confirmation: z.literal("CONFIRM DELETE").describe("Must equal CONFIRM DELETE after the user explicitly approves this exact deletion")
    },
    async ({ path, query }) => asToolResult(await keycrmRequest("DELETE", path, query))
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => res.json({ service: "KeyCRM MCP", status: "ok" }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.all("/mcp", async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`KeyCRM MCP listening on port ${PORT}`);
});
