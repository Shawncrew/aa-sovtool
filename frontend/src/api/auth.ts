import { apiClient } from "./client";
import type {
  AuthResponse,
  CreateUserRequest,
  UpdateUserRequest,
  UserSummary,
} from "../types";

/**
 * Under Alliance Auth, primary authentication is done by Django via the
 * AA login page. The SPA only needs to read the current user from
 * GET /sovtool/api/me and treat the response as the source of truth.
 *
 * The legacy username/password login form is kept as a compile-time shim
 * so the existing App.tsx code doesn't have to be re-shaped to remove it;
 * it just isn't rendered (App detects authState from /me).
 */
export async function login(_username: string, _password: string): Promise<AuthResponse> {
  // Force the browser through AA's login page; on return the session cookie
  // is set and the SPA reloads to pick it up.
  if (typeof window !== "undefined") {
    window.location.href = `/account/login/?next=${encodeURIComponent(
      window.location.pathname,
    )}`;
  }
  return Promise.reject(new Error("Redirecting to Alliance Auth login."));
}

export async function fetchCurrentUser(): Promise<AuthResponse | null> {
  try {
    const response = await apiClient.get<{
      username: string;
      role: AuthResponse["role"];
      editableRegions: string[];
    }>("/me");
    return {
      access_token: "session",
      token_type: "bearer",
      role: response.data.role,
      editableRegions: response.data.editableRegions,
    };
  } catch {
    return null;
  }
}

export async function fetchUsers(): Promise<UserSummary[]> {
  const response = await apiClient.get<UserSummary[]>("/users");
  return response.data;
}

export async function createUser(_payload: CreateUserRequest): Promise<UserSummary> {
  throw new Error(
    "User creation is managed in the Alliance Auth admin panel.",
  );
}

export async function updateUser(
  username: string,
  payload: UpdateUserRequest,
): Promise<UserSummary> {
  const response = await apiClient.patch<UserSummary>(
    `/users/${encodeURIComponent(username)}`,
    payload,
  );
  return response.data;
}

export async function deleteUser(_username: string): Promise<void> {
  throw new Error(
    "User deletion is managed in the Alliance Auth admin panel.",
  );
}
