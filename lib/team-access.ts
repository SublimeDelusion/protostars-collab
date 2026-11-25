export type AccessState = "guest" | "pending" | "active" | "declined" | "suspended" | "removed";

export type Member = {
  id: string;
  name: string;
  state: "invited" | "active" | "removed";
  removalBy: string | null;
  removalUntil: number | null;
};

export type JoinRequest = {
  id: string;
  name: string;
  email: string | null;
  existing: boolean;
  created: number;
};

export type TeamRoster = {
  members: Member[];
  requests: JoinRequest[];
  viewer: string | null;
  badge: number;
};
