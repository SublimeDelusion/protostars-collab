import handler from "vinext/server/fetch-handler";
import { BOARD_COOKIE, NAME_COOKIE, boardCookie, readCookie } from "../lib/board-cookies";
import { PAGES_ORIGIN, INVITE_HEADER, NAME_HEADER, CLAIM_HEADER, SESSION_HEADER, workshopInviteLink } from "../lib/pages-origin";
import { DEFAULT_TEAM, TEAM_HEADER, TEAM_NAME_HEADER, teams } from "../lib/teams";
import { claimTeamInvite, findBoardAccess, newBoardToken, issueMagicLink, resumeBoardSession, startBoardSession } from "../lib/team-invites";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const url = new URL(request.url);
    const bindings = env as unknown as Record<string, unknown>;
    const linkHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
    if (env.DB && request.method === "GET" && url.pathname.startsWith("/join/")) {
      const token = url.pathname.slice(6);
      const access = await findBoardAccess(env.DB, bindings, token);
      const session = newBoardToken();
      if (access && access.kind !== "session" && await startBoardSession(env.DB, access.team.number, access.kind, token, session)) {
        return new Response(null, { status: 303, headers: { ...linkHeaders, Location: "/", "Set-Cookie": boardCookie(BOARD_COOKIE, session) } });
      }
    }
    const fromPages = url.pathname === "/api/board" && request.headers.get("Origin") === PAGES_ORIGIN;
    const cors = {
      "Access-Control-Allow-Origin": PAGES_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": `Content-Type, ${INVITE_HEADER}, ${NAME_HEADER}, ${CLAIM_HEADER}`,
      "Access-Control-Expose-Headers": `${NAME_HEADER}, ${SESSION_HEADER}`,
      "Vary": "Origin",
    };
    if (fromPages && request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const token = (fromPages ? request.headers.get(INVITE_HEADER) : readCookie(request, BOARD_COOKIE)) ?? "";
    if (request.method === "POST" && fromPages && url.searchParams.get("join") === "team") {
      const claim = env.DB && await claimTeamInvite(env.DB, token, request.headers.get(CLAIM_HEADER) ?? "");
      const headers = { ...linkHeaders, ...cors };
      return claim ? Response.json(claim, { headers })
        : Response.json({ error: "This invite is invalid or has already been used. Ask the team for a teammate link." }, { status: 404, headers });
    }
    const isBoardGet = request.method === "GET" && url.pathname === "/api/board";
    const session = isBoardGet ? fromPages ? request.headers.get(CLAIM_HEADER) ?? "" : newBoardToken() : "";
    const access = env.DB ? await findBoardAccess(env.DB, bindings, token) : undefined;
    const resumedTeam = env.DB && !access && session ? await resumeBoardSession(env.DB, token, session) : undefined;
    const upgradedTeam = env.DB && access && access.kind !== "session" && session &&
      await startBoardSession(env.DB, access.team.number, access.kind, token, session) ? access.team : undefined;
    const sessionStarted = Boolean(resumedTeam ?? upgradedTeam);
    const invitedTeam = resumedTeam ?? upgradedTeam ?? (access?.kind === "session" || access?.kind === "legacy" ? access.team : undefined);
    const team = invitedTeam ?? (import.meta.env.DEV ? teams.find(item => item.number === DEFAULT_TEAM) : undefined);
    if (url.pathname === "/api/board" && url.searchParams.get("share") === "invite") {
      const headers = { ...linkHeaders, ...(fromPages ? cors : {}) };
      if (!access || !env.DB) return Response.json({ error: "Open the team’s invite link first." }, { status: 404, headers });
      if (request.method !== "POST") return Response.json({ error: "Refresh the Workshop to create a new invite link." }, { status: 405, headers });
      if (access.kind !== "session") return Response.json({ error: "Refresh the Workshop to upgrade your session." }, { status: 409, headers });
      if (!fromPages && request.headers.get("Origin") !== url.origin) return Response.json({ error: "Origin does not match." }, { status: 403, headers });
      return Response.json({ url: workshopInviteLink(await issueMagicLink(env.DB, access.team.number)) }, { headers });
    }
    const logo = request.method === "GET" && teams.some(item => item.logo === url.pathname);
    if (!team && !logo) {
      return new Response("Open the team’s invite link to access the board.", { status: 404, headers: { ...linkHeaders, ...(fromPages ? cors : {}), "Content-Type": "text/plain; charset=utf-8" } });
    }
    const headers = new Headers(request.headers);
    headers.delete(TEAM_HEADER);
    headers.delete(TEAM_NAME_HEADER);
    headers.delete(INVITE_HEADER);
    headers.delete(NAME_HEADER);
    headers.delete(CLAIM_HEADER);
    if (team) {
      headers.set(TEAM_HEADER, team.number);
      headers.set(TEAM_NAME_HEADER, encodeURIComponent(team.name));
    }
    const teamCookie = team && team.number !== DEFAULT_TEAM ? NAME_COOKIE + "-" + team.number : NAME_COOKIE;
    if (fromPages || teamCookie !== NAME_COOKIE) {
      const name = fromPages ? request.headers.get(NAME_HEADER) ?? "" : encodeURIComponent(readCookie(request, teamCookie));
      headers.delete("Cookie");
      if (/^[A-Za-z0-9_.!~*'()%+-]{1,600}$/.test(name)) headers.set("Cookie", NAME_COOKIE + "=" + name);
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
      if (sessionStarted && response.ok) {
        if (fromPages) headers.set(SESSION_HEADER, "1");
        else headers.append("Set-Cookie", boardCookie(BOARD_COOKIE, session));
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    });
  },
};

export default worker;
