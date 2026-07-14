/** Cloudflare Worker entry: vinext app + live quotes API. */
import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  fetchQuotesPayload,
  quotesErrorResponse,
  quotesJsonResponse,
} from "./quotes";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{
          response(): Response;
        }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/quotes") {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        });
      }
      if (request.method !== "GET") {
        return quotesErrorResponse("method not allowed", 405);
      }
      const raw = url.searchParams.get("symbols") ?? "";
      const symbols = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (symbols.length === 0) {
        return quotesErrorResponse("query ?symbols=600519,000333 required");
      }
      if (symbols.length > 40) {
        return quotesErrorResponse("max 40 symbols per request");
      }
      try {
        const payload = await fetchQuotesPayload(symbols);
        return quotesJsonResponse(payload);
      } catch (error) {
        return quotesErrorResponse(
          error instanceof Error ? error.message : String(error),
          502,
        );
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) =>
            env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
