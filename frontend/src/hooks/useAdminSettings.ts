import useSWR from "swr";
import { ApiError, fetchAdminSettings } from "../lib/api";
import type { AdminSettings } from "../types/api";

export function useAdminSettings(token: string | null) {
  const key = token ? (["admin-settings", token] as const) : null;

  return useSWR<AdminSettings>(key, () => fetchAdminSettings(token!), {
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        return;
      }

      console.error(error);
    },
  });
}
