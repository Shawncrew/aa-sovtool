import type { UpgradeDefinition } from "../types";
import { apiClient } from "./client";

export async function fetchUpgrades(): Promise<UpgradeDefinition[]> {
  const response = await apiClient.get<UpgradeDefinition[]>("/upgrades");
  return response.data;
}



