import handler from "vinext/server/fetch-handler";
import { BOARD_COOKIE, NAME_COOKIE, readCookie } from "../lib/board-cookies";
import { PAGES_ORIGIN, INVITE_HEADER, NAME_HEADER, CLAIM_HEADER, SESSION_HEADER } from "../lib/pages-origin";
import { DEFAULT_TEAM, TEAM_HEADER, TEAM_NAME_HEADER } from "../lib/teams";
import { registeredTeam } from "../lib/team-invites";
import { browserAccess, teamAccessApi } from "./team-access";
import { drizzle } from "drizzle-orm/d1";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const url = new URL(request.url);
    const linkHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
    const boardApi = url.pathname === "/api/board";
    const teamApi = url.pathname === "/api/team";
    const fromPages = (boardApi || teamApi) && request.headers.get("Origin") === PAGES_ORIGIN;
    const cors = {
      "Access-Control-Allow-Origin": PAGES_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": `Content-Type, ${INVITE_HEADER}, ${NAME_HEADER}, ${CLAIM_HEADER}`,
      "Access-Control-Expose-Headers": `${NAME_HEADER}, ${SESSION_HEADER}`,
      "Vary": "Origin",
    };
    const responseHeaders = { ...linkHeaders, ...(fromPages ? cors : {}) };
    const finish = (response: Response) => {
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(responseHeaders)) headers.set(name, value);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    };
    if (fromPages && request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname.startsWith("/join/") && request.method === "GET") {
      return new Response(null, { status: 303, headers: { ...linkHeaders, Location: "/" } });
    }
    if ((boardApi || teamApi) && !["GET", "HEAD"].includes(request.method) &&
      !fromPages && request.headers.get("Origin") !== url.origin) {
      return finish(Response.json({ error: "Origin does not match." }, { status: 403 }));
    }
    const token = (fromPages ? request.headers.get(INVITE_HEADER) : readCookie(request, BOARD_COOKIE)) ?? "";
    let rememberedName = "";
    if (fromPages) {
      try { rememberedName = decodeURIComponent(request.headers.get(NAME_HEADER) ?? ""); } catch { /* ignore malformed legacy name */ }
    } else {
      rememberedName = readCookie(request, NAME_COOKIE);
    }
    if (rememberedName.length > 50) rememberedName = "";
    const firstAccess = env.DB && (teamApi || boardApi) ? await browserAccess(env.DB, token, fromPages ? rememberedName : "") : undefined;
    const teamCookie = firstAccess?.teamNumber && firstAccess.teamNumber !== DEFAULT_TEAM ? NAME_COOKIE + "-" + firstAccess.teamNumber : NAME_COOKIE;
    if (!fromPages) rememberedName = readCookie(request, teamCookie);
    const access = !fromPages && env.DB && firstAccess?.state === "active" && !firstAccess.current && rememberedName && rememberedName.length <= 50
      ? await browserAccess(env.DB, token, rememberedName) : firstAccess;
    if (teamApi && env.DB && access) return finish(await teamAccessApi(request, env.DB, access, fromPages));
    if (boardApi && access?.state !== "active") {
      return finish(Response.json({ state: access?.state ?? "guest", error: "Request access to your team’s Workshop." },
        { status: access?.state === "suspended" ? 423 : 401 }));
    }
    if (boardApi && url.searchParams.get("share") === "invite") {
      return finish(Response.json({ error: "Use the Team tab to invite a teammate." }, { status: 410 }));
    }
    const team = env.DB && access?.teamNumber && access.state === "active"
      ? await registeredTeam(drizzle(env.DB), access.teamNumber) : undefined;
    if (boardApi && !team) return finish(Response.json({ error: "This team is unavailable." }, { status: 404 }));
    if (teamApi && !env.DB) return finish(Response.json({ error: "Workshop database unavailable." }, { status: 503 }));
    const headers = new Headers(request.headers);
    headers.delete(TEAM_HEADER);
    headers.delete(TEAM_NAME_HEADER);
    headers.delete("X-Board-Member-Internal");
    headers.delete(INVITE_HEADER);
    headers.delete(NAME_HEADER);
    headers.delete(CLAIM_HEADER);
    if (team) {
      headers.set(TEAM_HEADER, team.number);
      headers.set(TEAM_NAME_HEADER, encodeURIComponent(team.name));
      headers.delete("Cookie");
      if (access?.current) {
        headers.set("X-Board-Member-Internal", access.current.id);
        headers.set("Cookie", NAME_COOKIE + "=" + encodeURIComponent(access.current.name));
      } else if (rememberedName && rememberedName.length <= 50) {
        headers.set("Cookie", NAME_COOKIE + "=" + encodeURIComponent(rememberedName));
      }
    }
    request = new Request(request, { headers });
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, async () => {
      const response = await handler.fetch(request, env, ctx);
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(linkHeaders)) headers.set(name, value);
      if (fromPages) {
        for (const [name, value] of Object.entries(cors)) headers.set(name, value);
        const identity = headers.getSetCookie().find(value => value.startsWith(NAME_COOKIE + "="));
        if (identity) headers.set(NAME_HEADER, identity.slice(NAME_COOKIE.length + 1).split(";")[0]);
        headers.delete("Set-Cookie");
      } else if (teamCookie !== NAME_COOKIE) {
        const cookies = headers.getSetCookie();
        headers.delete("Set-Cookie");
        for (const cookie of cookies) headers.append("Set-Cookie", cookie.startsWith(NAME_COOKIE + "=") ? teamCookie + cookie.slice(NAME_COOKIE.length) : cookie);
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    });
  },
};

export default worker;
