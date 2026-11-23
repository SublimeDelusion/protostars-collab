export const PAGES_ORIGIN = "https://sublimedelusion.github.io";
export const INVITE_HEADER = "X-Protostars-Invite";
export const NAME_HEADER = "X-Protostars-Name";
export const CLAIM_HEADER = "X-Workshop-Claim";
export const SESSION_HEADER = "X-Workshop-Session";

export function workshopInviteLink(token: string) {
  return PAGES_ORIGIN + "/protostars-collab/#" + new URLSearchParams({ invite: token });
}
