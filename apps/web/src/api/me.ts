import { type Me, MeResponse } from "@budget/schema/me";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

export const getMe = async (): Promise<Me> =>
  (await apiFetch("/api/v1/me", { schema: MeResponse })).data;

export const useMe = () =>
  useQuery({ queryKey: ["me"], queryFn: getMe, staleTime: Number.POSITIVE_INFINITY });

/** The line shown under the plan name: the email, or the service token's name. */
export const identityLabel = (me: Me | undefined) =>
  me ? (me.kind === "user" ? me.email : me.name) : "";
