import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type AniList from "@yuna0x0/anilist-node";
import type { ConfigSchema } from "../utils/schemas.js";
import {
  ActivityFilterTypesSchema,
  MediaFilterTypesSchema,
} from "../utils/schemas.js";
import { searchMediaDirect } from "../utils/anilistGraphql.js";

// Filter fields spread directly as top-level params; 'type' and 'search' excluded
// ('type' is enforced by the tool, 'search' is covered by 'term')
const { type: _type, search: _search, ...MediaFilterFields } = MediaFilterTypesSchema.shape;

function buildFilter(fields: Record<string, unknown>): Record<string, unknown> | undefined {
  const filter = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  );
  return Object.keys(filter).length ? filter : undefined;
}

export function registerSearchTools(server: McpServer, anilist: AniList) {
  // anilist.searchEntry.activity()
  server.tool(
    "search_activity",
    "Search for activities on AniList",
    {
      activityID: z
        .number()
        .optional()
        .describe(
          "The activity ID to lookup (leave it as undefined for no specific ID)",
        ),
      filter: ActivityFilterTypesSchema.optional().describe(
        "Filter object for searching activities (leave it as undefined for no specific filter)",
      ),
      page: z
        .number()
        .optional()
        .default(1)
        .describe("Page number for results"),
      perPage: z
        .number()
        .optional()
        .default(5)
        .describe("Results per page (max 25)"),
    },
    {
      title: "AniList Activity Search",
      readOnlyHint: true,
      openWorldHint: true,
    },
    async ({ activityID, filter, page, perPage }) => {
      try {
        const results = await anilist.searchEntry.activity(
          activityID,
          filter,
          page,
          perPage,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // anilist.searchEntry.anime()
  server.tool(
    "search_anime",
    "Search for anime. Pass filter fields directly as top-level parameters — no nested filter object.",
    {
      term: z
        .string()
        .optional()
        .describe("Title search query. Omit when filtering by season/year/etc without a title."),
      ...MediaFilterFields,
      page: z
        .number()
        .optional()
        .default(1)
        .describe("Page number for results"),
      amount: z
        .number()
        .optional()
        .default(5)
        .describe("Results per page (max 25)"),
    },
    {
      title: "AniList Anime Search",
      readOnlyHint: true,
      openWorldHint: true,
    },
    async ({ term, page, amount, ...filterFields }) => {
      try {
        const results = await searchMediaDirect(
          "ANIME",
          term,
          buildFilter(filterFields as Record<string, unknown>),
          page,
          amount,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // anilist.searchEntry.character()
  server.tool(
    "search_character",
    "Search for characters based on a query term",
    {
      term: z.string().describe("Search term for finding characters"),
      page: z
        .number()
        .optional()
        .default(1)
        .describe("Page number for results"),
      amount: z
        .number()
        .optional()
        .default(5)
        .describe("Results per page (max 25)"),
    },
    {
      title: "AniList Character Search",
      readOnlyHint: true,
      openWorldHint: true,
    },
    async ({ term, page, amount }) => {
      try {
        const results = await anilist.searchEntry.character(term, page, amount);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // anilist.searchEntry.manga()
  server.tool(
    "search_manga",
    "Search for manga. Pass filter fields directly as top-level parameters — no nested filter object.",
    {
      term: z
        .string()
        .optional()
        .describe("Title search query. Omit when filtering by season/year/etc without a title."),
      ...MediaFilterFields,
      page: z
        .number()
        .optional()
        .default(1)
        .describe("Page number for results"),
      amount: z
        .number()
        .optional()
        .default(5)
        .describe("Results per page (max 25)"),
    },
    {
      title: "AniList Manga Search",
      readOnlyHint: true,
      openWorldHint: true,
    },
    async ({ term, page, amount, ...filterFields }) => {
      try {
        const results = await searchMediaDirect(
          "MANGA",
          term,
          buildFilter(filterFields as Record<string, unknown>),
          page,
          amount,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // anilist.searchEntry.staff()
  server.tool(
    "search_staff",
    "Search for staff members based on a query term",
    {
      term: z.string().describe("Search term for finding staff members"),
      page: z
        .number()
        .optional()
        .default(1)
        .describe("Page number for results"),
      amount: z
        .number()
        .optional()
        .default(5)
        .describe("Results per page (max 25)"),
    },
    {
      title: "AniList Staff Search",
      readOnlyHint: true,
      openWorldHint: true,
    },
    async ({ term, page, amount }) => {
      try {
        const results = await anilist.searchEntry.staff(term, page, amount);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // anilist.searchEntry.studio()
  server.tool(
    "search_studio",
    "Search for studios based on a query term",
    {
      term: z.string().describe("Search term for finding studios"),
      page: z
        .number()
        .optional()
        .default(1)
        .describe("Page number for results"),
      amount: z
        .number()
        .optional()
        .default(5)
        .describe("Results per page (max 25)"),
    },
    {
      title: "AniList Studio Search",
      readOnlyHint: true,
      openWorldHint: true,
    },
    async ({ term, page, amount }) => {
      try {
        const results = await anilist.searchEntry.studio(term, page, amount);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // anilist.searchEntry.user()
  server.tool(
    "search_user",
    "Search for users on AniList",
    {
      term: z.string().describe("Search term for finding users"),
      page: z
        .number()
        .optional()
        .default(1)
        .describe("Page number for results"),
      amount: z
        .number()
        .optional()
        .default(5)
        .describe("Results per page (max 25)"),
    },
    {
      title: "AniList User Search",
      readOnlyHint: true,
      openWorldHint: true,
    },
    async ({ term, page, amount }) => {
      try {
        const results = await anilist.searchEntry.user(term, page, amount);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );
}
