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



