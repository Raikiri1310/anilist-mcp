#!/usr/bin/env node

import express, { Request, Response } from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import AniList from "@yuna0x0/anilist-node";
import dotenv from "dotenv";
import { z } from "zod";
import { registerAllTools } from "./tools/index.js";
import { ConfigSchema } from "./utils/schemas.js";
import { ANILIST_TOKEN_HEADER } from "./utils/constants.js";

dotenv.config({ quiet: true });

const app = express();
const PORT = process.env.PORT || 8081;

// CORS configuration for browser-based MCP clients
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",") || "*",
    exposedHeaders: ["Mcp-Session-Id", ANILIST_TOKEN_HEADER],
    allowedHeaders: ["Content-Type", "mcp-session-id", ANILIST_TOKEN_HEADER],
  }),
);

app.use(express.json());

// Opt-in DNS-rebinding / Origin validation. The MCP spec expects locally bound
// HTTP servers to validate Origin: without it a web page the user visits can
// drive this server, and when ANILIST_TOKEN is set server-side it does so as
// the operator's AniList account. Left off unless configured so existing
// deployments (Smithery and friends) are unaffected.
const allowedHosts = splitEnvList(process.env.ALLOWED_HOSTS);
const allowedOrigins = splitEnvList(process.env.ALLOWED_ORIGINS);
const enableDnsRebindingProtection =
  allowedHosts.length > 0 || allowedOrigins.length > 0;

function splitEnvList(value: string | undefined): string[] {
  return (
    value
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? []
  );
}

// Parse configuration from header or query parameters (for Smithery)
function parseConfig(req: Request) {
  const anilistTokenHeader = req.headers[ANILIST_TOKEN_HEADER.toLowerCase()];
  if (
    typeof anilistTokenHeader === "string" &&
    anilistTokenHeader.trim().length > 0
  ) {
    return { anilistToken: anilistTokenHeader };
  }

  // Smithery passes config as base64-encoded JSON in query parameters
  const configParam = req.query.config;
  if (typeof configParam === "string" && configParam.trim().length > 0) {
    return JSON.parse(Buffer.from(configParam, "base64").toString());
  }

  return {};
}

// Create MCP server with AniList integration
function createServer({ config }: { config: z.infer<typeof ConfigSchema> }) {
  const server = new McpServer({
    name: "anilist-mcp",
    version: "2.0.0",
  });

  // Two clients on purpose. anilist-node sends Authorization on every request
  // once constructed with a token, and AniList rejects the whole request with
  // 400 "Invalid token" when that token is stale — which took out every public
  // read tool, not just the authenticated ones. Public reads therefore go
  // through an anonymous client and cannot be broken by a bad token; only the
  // [Requires Login] tools use the authenticated one, and they already gate on
  // requireAuth(). get_anime/get_manga bypass both clients — they call
  // getMediaDirect with config.anilistToken directly, which is only sent to
  // AniList when `include` contains "viewer", so a stale token can't break
  // them either.
  const anilist = new AniList();
  const anilistAuthed = config.anilistToken
    ? new AniList(config.anilistToken)
    : anilist;

  // Register all tools
  registerAllTools(server, anilist, anilistAuthed, config);

  return server;
}

// Handle MCP requests at /mcp endpoint
app.post("/mcp", async (req: Request, res: Response) => {
  try {
    // Parse configuration
    const rawConfig = parseConfig(req);

    // Validate and parse configuration
    const config = ConfigSchema.parse({
      anilistToken: rawConfig.anilistToken || process.env.ANILIST_TOKEN,
    });

    const server = createServer({ config });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      ...(enableDnsRebindingProtection
        ? {
            enableDnsRebindingProtection: true,
            ...(allowedHosts.length ? { allowedHosts } : {}),
            ...(allowedOrigins.length ? { allowedOrigins } : {}),
          }
        : {}),
    });

    // Clean up on request close
    res.on("close", () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// SSE notifications not supported in stateless mode
app.get("/mcp", async (req: Request, res: Response) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    }),
  );
});

// Session termination not needed in stateless mode
app.delete("/mcp", async (req: Request, res: Response) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed.",
      },
      id: null,
    }),
  );
});

// Main function to start the server in the appropriate mode
async function main() {
  const transport = process.env.TRANSPORT || "stdio";

  if (transport === "http") {
    // Run in HTTP mode
    app.listen(PORT, () => {
      console.log(`MCP HTTP Server listening on port ${PORT}`);
    });
  } else {
    if (transport !== "stdio") {
      console.warn(
        `Unknown TRANSPORT "${transport}", defaulting to "stdio" mode.`,
      );
    }

    // Run in STDIO mode for backward compatibility
    const config = ConfigSchema.parse({
      anilistToken: process.env.ANILIST_TOKEN,
    });

    // Create server with configuration
    const server = createServer({ config });

    // Start receiving messages on stdin and sending messages on stdout
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    console.error("MCP Server running in stdio mode");
  }
}

// Start the server
main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
