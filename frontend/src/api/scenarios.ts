import type {
  ScenarioResponse,
  ScenarioSummary,
  SystemNode,
} from "../types";
import { apiClient } from "./client";

export async function fetchScenario(
  name: string,
): Promise<ScenarioResponse> {
  const response = await apiClient.get<ScenarioResponse>(
    `/scenarios/${encodeURIComponent(name)}`,
  );
  return response.data;
}

export async function saveScenario(
  name: string,
  systems: SystemNode[],
  description?: string | null,
): Promise<ScenarioResponse> {
  const response = await apiClient.put<ScenarioResponse>(
    `/scenarios/${encodeURIComponent(name)}`,
    {
      systems,
      description,
    },
  );
  return response.data;
}

export async function listScenarios(): Promise<ScenarioSummary[]> {
  const response = await apiClient.get<ScenarioSummary[]>("/scenarios");
  return response.data;
}

// --- Map management (Live + user-created) ----

export interface MapSummary {
  name: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  isLive: boolean;
  creator: string | null;
  basedOn: string | null;
  regions: string[];
  overrideCount: number;
}

export interface MapResponse {
  name: string;
  isLive: boolean;
  description?: string | null;
  creator?: string | null;
  basedOn?: string | null;
  createdAt?: string;
  updatedAt?: string;
  systems: SystemNode[];
  updated_at: string;
}

export async function fetchMaps(): Promise<MapSummary[]> {
  const response = await apiClient.get<MapSummary[]>("/maps");
  return response.data;
}

export async function fetchLiveMap(): Promise<MapResponse> {
  const response = await apiClient.get<MapResponse>("/maps/live");
  return response.data;
}

export async function fetchUserMap(name: string): Promise<MapResponse> {
  const response = await apiClient.get<MapResponse>(
    `/maps/${encodeURIComponent(name)}`,
  );
  return response.data;
}

export async function createMap(payload: {
  name: string;
  basedOn?: string | "live";
  description?: string;
}): Promise<MapSummary> {
  const response = await apiClient.post<MapSummary>("/maps", payload);
  return response.data;
}

export async function deleteMap(name: string): Promise<void> {
  await apiClient.delete(`/maps/${encodeURIComponent(name)}`);
}

export async function saveUserMap(
  name: string,
  systems: SystemNode[],
): Promise<MapResponse> {
  const response = await apiClient.put<MapResponse>(
    `/maps/${encodeURIComponent(name)}`,
    { systems },
  );
  return response.data;
}

// Persist card positions on the Live Map (edit_sovtool only). Only the
// canonical card layout is saved; ESI-driven fields are ignored server-side.
export async function saveLiveMap(
  systems: SystemNode[],
): Promise<MapResponse> {
  const response = await apiClient.put<MapResponse>("/maps/live", { systems });
  return response.data;
}
