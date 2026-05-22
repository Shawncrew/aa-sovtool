import type { SystemNode } from "../types";
import { apiClient } from "./client";

export async function fetchSystems(region?: string): Promise<SystemNode[]> {
  const response = await apiClient.get<SystemNode[]>("/systems", {
    params: region ? { region } : undefined,
  });
  return response.data;
}



