import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type AniList from "@yuna0x0/anilist-node";
import type { ConfigSchema } from "../utils/schemas.js";
import { requireAuth } from "../utils/auth.js";
import { getMediaDirect } from "../utils/anilistGraphql.js";
import { MediaIncludeSchema, type MediaGroup } from "../utils/mediaSelection.js";

export function registerMediaTools(
  server: McpServer,
  anilist: AniList,
  anilistAuthed: AniList,
  config: z.infer<typeof ConfigSchema>,
) {
  server.tool(
    "get_anime",
    "Get information about anime by AniList ID(s). Returns core fields by " +
      "default; use `include` to request extra field groups.",
    {
      ids: z
        .union([z.number(), z.array(z.number()).min(1).max(50)])
        .describe("The AniList ID or array of IDs of the anime (max 50)"),
      include: MediaIncludeSchema,
    },
    {
      title: "Get Anime Details",
      readOnlyHint: true,
      openWorldHint: true,
    },
    async ({ ids, include }) => {
      try {
        if (include?.includes("viewer")) {
          const auth = requireAuth(config.anilistToken);
          if (!auth.isAuthorized) {
            return auth.errorResponse;
          }
        }

        const idArray = Array.isArray(ids) ? ids : [ids];
        const result = await getMediaDirect(
          "ANIME",
          idArray,
          (include ?? []) as MediaGroup[],
          config.anilistToken,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    },
  );

  // anilist.media.favouriteAnime()
  server.tool(
    "favourite_anime",
    "[Requires Login] Favourite or unfavourite an anime by its ID",
    {
      id: z
        .number()
        .describe("The AniList ID of the anime to favourite/unfavourite"),
    },
    {
      title: "Favourite/Unfavourite Anime",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ id }) => {
      try {
        const auth = requireAuth(config.anilistToken);
        if (!auth.isAuthorized) {
          return auth.errorResponse;
        }

        const result = await anilistAuthed.media.favouriteAnime(id);
        return {
          content: [
            {
              type: "text",
              text: result
                ? `Successfully added anime with ID ${id} to favourites.`
                : `Anime with ID ${id} was removed from favourites or operation failed.`,
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

  // anilist.media.favouriteManga()
  server.tool(
    "favourite_manga",
    "[Requires Login] Favourite or unfavourite a manga by its ID",
    {
      id: z
        .number()
        .describe("The AniList ID of the manga to favourite/unfavourite"),
    },
    {
      title: "Favourite/Unfavourite Manga",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ id }) => {
      try {
        const auth = requireAuth(config.anilistToken);
        if (!auth.isAuthorized) {
          return auth.errorResponse;
        }

        const result = await anilistAuthed.media.favouriteManga(id);
        return {
          content: [
            {
              type: "text",
              text: result
                ? `Successfully added manga with ID ${id} to favourites.`
                : `Manga with ID ${id} was removed from favourites or operation failed.`,
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

  server.tool(
    "get_manga",
    "Get information about manga by AniList ID(s). Returns core fields by " +
      "default; use `include` to request extra field groups.",
    {
      ids: z
        .union([z.number(), z.array(z.number()).min(1).max(50)])
        .describe("The AniList ID or array of IDs of the manga (max 50)"),
      include: MediaIncludeSchema,
    },
    {
      title: "Get Manga Details",
      readOnlyHint: true,
      openWorldHint: true,
    },
    async ({ ids, include }) => {
      try {
        if (include?.includes("viewer")) {
          const auth = requireAuth(config.anilistToken);
          if (!auth.isAuthorized) {
            return auth.errorResponse;
          }
        }

        const idArray = Array.isArray(ids) ? ids : [ids];
        const result = await getMediaDirect(
          "MANGA",
          idArray,
          (include ?? []) as MediaGroup[],
          config.anilistToken,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
