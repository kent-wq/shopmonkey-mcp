import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools.js";

const PORT = process.env.PORT || 3000;

// Claude's custom-connector UI doesn't let you set auth headers, so we
// protect the endpoint with a secret path segment instead:
//   https://your-app.up.railway.app/mcp/<MCP_PATH_SECRET>
// Set MCP_PATH_SECRET in Railway to a long random string.
const SECRET = process.env.MCP_PATH_SECRET || "";
const MCP_PATH = SECRET ? `/mcp/${SECRET}` : "/mcp";

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

// Stateless mode: a fresh server + transport per request. Simple and
// Railway-restart-proof; fine for a single-shop connector.
app.post(MCP_PATH, async (req, res) => {
  const server = new McpServer({ name: "shopmonkey", version: "1.0.0" });
  registerTools(server);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless transport: GET/DELETE (session management) aren't used.
const methodNotAllowed = (_req, res) =>
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed" },
    id: null,
  });
app.get(MCP_PATH, methodNotAllowed);
app.delete(MCP_PATH, methodNotAllowed);

app.listen(PORT, () => {
  console.log(`Shopmonkey MCP listening on :${PORT}`);
  console.log(`MCP endpoint: POST ${MCP_PATH}`);
  if (!SECRET) {
    console.warn("WARNING: MCP_PATH_SECRET not set — endpoint is unprotected.");
  }
});
