import axios from "axios";

/**
 * In the Alliance Auth deployment the React SPA is served from
 * /sovtool/ and authenticates via Django session cookies. We send the
 * CSRF token automatically on mutating requests; no JWT is required.
 */
function resolveBaseUrl(): string {
  if (typeof window !== "undefined") {
    const root = (window as unknown as { AASOVTOOL_API_ROOT?: string })
      .AASOVTOOL_API_ROOT;
    if (root) {
      return root.endsWith("/") ? root.slice(0, -1) : root;
    }
  }
  return "/sovtool/api";
}

export const apiClient = axios.create({
  baseURL: resolveBaseUrl(),
  timeout: 15000,
  withCredentials: true,
  xsrfCookieName: "csrftoken",
  xsrfHeaderName: "X-CSRFToken",
});

// Compat shim: the legacy code still calls setAuthToken on login/logout.
// Under AA auth there is no JWT to store, so this is a no-op.
export function setAuthToken(_token: string | null): void {
  /* intentionally empty: AA session is used instead */
}
