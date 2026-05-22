import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

import { SovereigntyGraph } from "./components/SovereigntyGraph";
import { useI18n } from "./i18n/context";
import type {
  ScenarioResponse,
  SystemNode,
  SystemRole,
  SystemUpgrade,
  WorkforceTransfer,
  UpgradeDefinition,
  NodePosition,
  UserRole,
  UserSummary,
} from "./types";
import { fetchSystems } from "./api/systems";
import { fetchScenario, saveScenario } from "./api/scenarios";
import { fetchUpgrades } from "./api/upgrades";
import { login, fetchCurrentUser, fetchUsers, createUser, updateUser, deleteUser } from "./api/auth";
import { UpgradeIcon } from "./components/UpgradeIcon";
import { ensureNodePositions } from "./layout";
import { setAuthToken } from "./api/client";
import "./App.css";

const ROLE_OPTIONS: SystemRole[] = ["export", "import", "transit"];
interface ChangeEntry {
  id: number;
  timestamp: number;
  message: string;
  username: string;
}
const HISTORY_LIMIT = 100;
const ALLOWED_REGIONS = new Set(["pure blind", "fade", "deklein"]);
const DEFAULT_SCENARIO_NAME = "default";
const HISTORY_STORAGE_VERSION = "v2";

const TRANSFER_KEY_DELIMITER = "||";
const ADVANCED_LOGISTICS_TYPE_ID = 81621;
type AnsiblexLinkChange = { previousPartner: string | null; newPartner: string | null };

function hasAdvancedLogisticsOnline(system: SystemNode | undefined): boolean {
  if (!system) {
    return false;
  }
  return system.upgrades.some(
    (upgrade) =>
      upgrade.typeId === ADVANCED_LOGISTICS_TYPE_ID && (upgrade.isOnline ?? true),
  );
}

function hasAdvancedLogisticsInstalled(system: SystemNode | undefined): boolean {
  if (!system) {
    return false;
  }
  return system.upgrades.some(
    (upgrade) => upgrade.typeId === ADVANCED_LOGISTICS_TYPE_ID,
  );
}

function clampExportTransfers(
  system: SystemNode,
): { normalizedSystem: SystemNode; removedCount: number } {
  const transfers = Array.isArray(system.transfers) ? system.transfers : [];
  const baseSystem = Array.isArray(system.transfers)
    ? system
    : {
        ...system,
        transfers,
      };

  if (system.role !== "export" || transfers.length <= 1) {
    return { normalizedSystem: baseSystem, removedCount: 0 };
  }

  const primaryTransfer =
    transfers.find((transfer) => transfer.isOnline !== false) ?? transfers[0];

  const normalizedPrimary = primaryTransfer
    ? {
        ...primaryTransfer,
        sourceSystemId:
          typeof primaryTransfer.sourceSystemId === "string" &&
          primaryTransfer.sourceSystemId.length > 0
            ? primaryTransfer.sourceSystemId
            : system.systemName,
        viaSystems: Array.isArray(primaryTransfer.viaSystems)
          ? [...primaryTransfer.viaSystems]
          : [],
      }
    : null;

  const trimmedTransfers = normalizedPrimary ? [normalizedPrimary] : [];
  return {
    normalizedSystem: {
      ...baseSystem,
      transfers: trimmedTransfers,
    },
    removedCount: transfers.length - trimmedTransfers.length,
  };
}

function clampExportTransfersInList(
  systems: SystemNode[],
): { normalizedSystems: SystemNode[]; removedCount: number } {
  let removedCount = 0;
  const normalizedSystems = systems.map((system) => {
    const { normalizedSystem, removedCount: removed } = clampExportTransfers(system);
    removedCount += removed;
    return normalizedSystem;
  });
  return { normalizedSystems, removedCount };
}

interface AuthState {
  username: string;
  role: UserRole;
  token: string;
  editableRegions: string[];
}

function loadStoredAuth(): AuthState | null {
  // Auth is now driven by the Alliance Auth session cookie; the SPA
  // resolves the current user via /sovtool/api/me on mount.
  return null;
}

function makeTransferKey(sourceSystemId: string, targetSystemId: string): string {
  return `${sourceSystemId}${TRANSFER_KEY_DELIMITER}${targetSystemId}`;
}

function splitTransferKey(key: string): [string, string] {
  const [source, target] = key.split(TRANSFER_KEY_DELIMITER);
  return [source ?? "", target ?? ""];
}

function findAlternateTransferPath(
  systemsIndex: Map<string, SystemNode>,
  sourceSystemId: string,
  targetSystemId: string,
): string[] | null {
  const queue: Array<{ node: string; via: string[] }> = [{ node: sourceSystemId, via: [] }];
  const visitedTransits = new Set<string>();

  while (queue.length > 0) {
    const currentItem = queue.shift();
    if (!currentItem) {
      continue;
    }
    const { node, via } = currentItem;
    const currentSystem = systemsIndex.get(node);
    if (!currentSystem) {
      continue;
    }

    for (const neighborName of currentSystem.neighbors ?? []) {
      const neighbor = systemsIndex.get(neighborName);
      if (!neighbor) {
        continue;
      }

      const isNpcSystem = neighbor.factionId !== null && neighbor.factionId !== undefined;

      if (neighbor.systemName === targetSystemId && neighbor.role === "import") {
        return via;
      }

      if (neighbor.role === "transit" && !isNpcSystem && !visitedTransits.has(neighborName)) {
        visitedTransits.add(neighborName);
        queue.push({
          node: neighborName,
          via: [...via, neighborName],
        });
      }
    }
  }

  return null;
}

function App() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [authState, setAuthState] = useState<AuthState | null>(() => loadStoredAuth());
  const [authResolved, setAuthResolved] = useState(false);
  // Container in the AA navbar that we'll portal our toolbar into.
  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (typeof document === "undefined") return;
    let target = document.getElementById("aa-sovtool-toolbar-target");
    let createdHere = false;
    if (!target) {
      // Try a handful of selectors so we cope with both AA's Bootstrap 5
      // base ("base-bs5.html") and any custom themes. We aim for the
      // rightmost container inside the top navbar.
      const candidates = [
        "nav.navbar .navbar-nav.ms-auto",
        "nav.navbar .ms-auto",
        "nav.navbar .navbar-collapse",
        "nav.navbar .container-fluid",
        "nav.navbar",
        "header nav",
      ];
      let host: Element | null = null;
      for (const selector of candidates) {
        host = document.querySelector(selector);
        if (host) break;
      }
      if (host) {
        target = document.createElement("div");
        target.id = "aa-sovtool-toolbar-target";
        target.className = "d-flex align-items-center";
        host.appendChild(target);
        createdHere = true;
      }
    }
    setToolbarTarget(target);
    return () => {
      if (createdHere && target?.parentNode) {
        target.parentNode.removeChild(target);
      }
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((user) => {
        if (cancelled) return;
        if (user) {
          setAuthState({
            username: "session",
            role: user.role,
            token: user.access_token,
            editableRegions: user.editableRegions || [],
          });
        }
      })
      .finally(() => {
        if (!cancelled) setAuthResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isUserManagerOpen, setIsUserManagerOpen] = useState(false);
  const [userRoleDrafts, setUserRoleDrafts] = useState<Record<string, UserRole>>({});
  const [userEditableRegionsDrafts, setUserEditableRegionsDrafts] = useState<Record<string, string[]>>({});
  const [newUserEditableRegions, setNewUserEditableRegions] = useState<string[]>([]);
  const [newUserUsername, setNewUserUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<UserRole>("view");
  const [userManagerMessage, setUserManagerMessage] = useState<string | null>(null);
  const [isUserOperationPending, setIsUserOperationPending] = useState(false);
  const [selectedSystemName, setSelectedSystemName] = useState<string | null>(null);
  const [systems, setSystems] = useState<SystemNode[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const layoutInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedUpgradeId, setSelectedUpgradeId] = useState<number | null>(null);
  const [selectedTransferTarget, setSelectedTransferTarget] = useState<string | null>(null);
  const [transferAmountInput, setTransferAmountInput] = useState<string>("0");
  const [workforceCapacity, setWorkforceCapacity] = useState<number | null>(null);
  const [powerCapacity, setPowerCapacity] = useState<number | null>(null);
  const historyIdRef = useRef(0);
  const pendingHistoryRef = useRef<ChangeEntry[]>([]);
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false);
  const [changeHistory, setChangeHistory] = useState<ChangeEntry[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [systemColorMode, setSystemColorMode] = useState<string>("none");
  const scenarioName = DEFAULT_SCENARIO_NAME;
  const canonicalScenarioName = DEFAULT_SCENARIO_NAME;
  const historyStorageKey = `sovtool:change-history:${HISTORY_STORAGE_VERSION}:${canonicalScenarioName}`;
  const canEdit = authState?.role === "admin" || authState?.role === "edit";
  const isAdmin = authState?.role === "admin";
  
  // Check if user can edit a specific region
  const canEditRegion = useCallback(
    (regionName: string): boolean => {
      if (!authState) return false;
      if (authState.role === "admin") return true;
      if (authState.role !== "edit") return false;
      return authState.editableRegions.some(
        (r) => r.toLowerCase() === regionName.toLowerCase(),
      );
    },
    [authState],
  );
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (authState) {
      window.localStorage.setItem(
        "authUser",
        JSON.stringify({ username: authState.username, role: authState.role }),
      );
    } else {
      window.localStorage.removeItem("authUser");
    }
  }, [authState]);
  const logChange = useCallback(
    (message: string, actor?: string) => {
      const username = actor ?? authState?.username ?? "Unknown";
      const entry: ChangeEntry = {
        id: historyIdRef.current++,
        timestamp: Date.now(),
        message,
        username,
      };
      pendingHistoryRef.current = [entry, ...pendingHistoryRef.current].slice(
        0,
        HISTORY_LIMIT,
      );
    },
    [authState?.username],
  );

  const commitPendingHistory = useCallback(
    (includeSaveEntry: boolean, saveMessage = t.scenarioSaved) => {
      const entriesToCommit: ChangeEntry[] = [];
      if (includeSaveEntry) {
        entriesToCommit.push({
          id: historyIdRef.current++,
          timestamp: Date.now(),
          message: saveMessage,
          username: authState?.username ?? "Unknown",
        });
      }
      if (pendingHistoryRef.current.length > 0) {
        entriesToCommit.push(...pendingHistoryRef.current);
      }
      pendingHistoryRef.current = [];
      if (entriesToCommit.length === 0) {
        return;
      }
      setChangeHistory((prev) => {
        const merged = [...entriesToCommit, ...prev];
        return merged.slice(0, HISTORY_LIMIT);
      });
    },
    [authState?.username],
  );

  const clearHistory = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      // Clear both current and legacy storage keys
      window.localStorage.removeItem(historyStorageKey);
      const legacyKey = `sovtool:change-history:${canonicalScenarioName}`;
      window.localStorage.removeItem(legacyKey);
      // Clear state
      setChangeHistory([]);
      pendingHistoryRef.current = [];
      historyIdRef.current = 0;
      setStatusMessage(t.historyCleared);
    } catch (error) {
      console.warn("Failed to clear change history", error);
      setStatusMessage(t.historyCleared);
    }
  }, [historyStorageKey, canonicalScenarioName, t]);

  const clearAnsiblexLink = useCallback((systemName: string) => {
    let removedPartner: string | null = null;
    setSystems((prev) => {
      const clone: SystemNode[] = prev.map((system) => ({ ...system }));
      const findSystem = (name: string) =>
        clone.find((system) => system.systemName === name);
      const source = findSystem(systemName);
      if (!source || !source.ansiblexPartner) {
        return prev;
      }
      const partnerName = source.ansiblexPartner;
      const partner = findSystem(partnerName);
      source.ansiblexPartner = null;
      if (partner && partner.ansiblexPartner === systemName) {
        partner.ansiblexPartner = null;
      }
      removedPartner = partnerName;
      return clone;
    });
    return removedPartner;
  }, []);

  const handleSetAnsiblexLink = useCallback(
    (sourceSystemName: string, partnerSystemName: string | null) => {
      let change: AnsiblexLinkChange | undefined;
      setSystems((prev) => {
        const clone: SystemNode[] = prev.map((system) => ({ ...system }));
        const findSystem = (name: string) =>
          clone.find((system) => system.systemName === name);
        const source = findSystem(sourceSystemName);
        if (!source) {
          return prev;
        }
        const currentPartner = source.ansiblexPartner ?? null;
        const desiredPartner = partnerSystemName ?? null;
        if (currentPartner === desiredPartner) {
          return prev;
        }

        const detachPair = (aName: string, bName: string | null) => {
          if (!bName) {
            return;
          }
          const a = findSystem(aName);
          const b = findSystem(bName);
          if (a && a.ansiblexPartner === bName) {
            a.ansiblexPartner = null;
          }
          if (b && b.ansiblexPartner === aName) {
            b.ansiblexPartner = null;
          }
        };

        if (currentPartner) {
          detachPair(sourceSystemName, currentPartner);
        }

        if (desiredPartner) {
          const target = findSystem(desiredPartner);
          if (!target) {
            return prev;
          }
          detachPair(desiredPartner, target.ansiblexPartner ?? null);
          source.ansiblexPartner = desiredPartner;
          target.ansiblexPartner = sourceSystemName;
        } else {
          source.ansiblexPartner = null;
        }

        change = { previousPartner: currentPartner, newPartner: desiredPartner };
        return clone;
      });

      if (!change) {
        return;
      }
      const { newPartner, previousPartner } = change;
      if (newPartner) {
        logChange(`Linked ${sourceSystemName} and ${newPartner} via Ansiblex.`);
        setStatusMessage(
          `Linked ${sourceSystemName} with ${newPartner} via Ansiblex.`,
        );
      } else {
        const previousNote = previousPartner
          ? ` (previously paired with ${previousPartner})`
          : "";
        logChange(`Cleared Ansiblex link from ${sourceSystemName}${previousNote}.`);
        setStatusMessage(`Cleared Ansiblex link from ${sourceSystemName}.`);
      }
    },
    [logChange],
  );
  const requireEditPermission = useCallback((): boolean => {
    if (canEdit) {
      return true;
    }
    setStatusMessage(t.noPermission);
    return false;
  }, [canEdit, t]);
  const handleLoginSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!loginUsername || !loginPassword) {
        setLoginError(t.invalidCredentials);
        return;
      }
      setIsLoggingIn(true);
      setLoginError(null);
      try {
        const authResponse = await login(loginUsername, loginPassword);
        const nextAuth: AuthState = {
          username: loginUsername,
          role: authResponse.role,
          token: authResponse.access_token,
          editableRegions: authResponse.editableRegions || [],
        };
        setAuthToken(authResponse.access_token);
        setAuthState(nextAuth);
        setStatusMessage(null);
        setLoginPassword("");
        await Promise.allSettled([
          queryClient.invalidateQueries({ queryKey: ["scenario", scenarioName] }),
          queryClient.invalidateQueries({ queryKey: ["upgrades"] }),
        ]);
      } catch (error) {
        if (isAxiosError(error)) {
          setLoginError(error.response?.data?.detail ?? "Invalid username or password.");
        } else {
          setLoginError("Failed to sign in. Please try again.");
        }
        setAuthToken(null);
        setAuthState(null);
      } finally {
        setIsLoggingIn(false);
      }
    },
    [loginUsername, loginPassword, queryClient, scenarioName],
  );
  const handleLogout = useCallback(() => {
    setAuthToken(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("authUser");
    }
    setAuthState(null);
    setSystems([]);
    setSelectedSystemName(null);
    setStatusMessage(null);
    setIsUserManagerOpen(false);
    setUserManagerMessage(null);
    setUserRoleDrafts({});
    setLoginPassword("");
    setLoginUsername("");
    pendingHistoryRef.current = [];
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setHasLoadedHistory(false);
    if (typeof window === "undefined") {
      setChangeHistory([]);
      historyIdRef.current = 0;
      setHasLoadedHistory(true);
      return;
    }

    pendingHistoryRef.current = [];
    try {
      const legacyKey = `sovtool:change-history:${canonicalScenarioName}`;
      if (window.localStorage.getItem(legacyKey)) {
        window.localStorage.removeItem(legacyKey);
      }
      const stored = window.localStorage.getItem(historyStorageKey);
      if (!stored) {
        setChangeHistory([]);
        historyIdRef.current = 0;
      } else {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const sanitized = parsed
            .filter(
              (item: unknown): item is Partial<ChangeEntry> &
                Pick<ChangeEntry, "id" | "timestamp" | "message"> =>
                typeof item === "object" &&
                item !== null &&
                typeof (item as ChangeEntry).id === "number" &&
                Number.isFinite((item as ChangeEntry).id) &&
                typeof (item as ChangeEntry).timestamp === "number" &&
                Number.isFinite((item as ChangeEntry).timestamp) &&
                typeof (item as ChangeEntry).message === "string",
            )
            .map((item) => ({
              ...item,
              username:
                typeof item.username === "string" && item.username.length > 0
                  ? item.username
                  : "Unknown",
            }));
          const limited = sanitized.slice(0, HISTORY_LIMIT) as ChangeEntry[];
          historyIdRef.current =
            limited.reduce((max, entry) => Math.max(max, entry.id), -1) + 1;
          setChangeHistory(limited);
        } else {
          setChangeHistory([]);
          historyIdRef.current = 0;
        }
      }
    } catch (error) {
      console.warn("Failed to load change history from storage", error);
      setChangeHistory([]);
      historyIdRef.current = 0;
    } finally {
      setHasLoadedHistory(true);
    }
  }, [historyStorageKey, canonicalScenarioName]);

  useEffect(() => {
    if (!hasLoadedHistory || typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(historyStorageKey, JSON.stringify(changeHistory));
    } catch (error) {
      console.warn("Failed to persist change history to storage", error);
    }
  }, [changeHistory, historyStorageKey, hasLoadedHistory]);

  const {
    data: scenarioData,
    isLoading,
    isError,
    error,
  } = useQuery<ScenarioResponse>({
    queryKey: ["scenario", scenarioName],
    retry: false,
    queryFn: async () => {
      try {
        return await fetchScenario(scenarioName);
      } catch (err) {
        if (isAxiosError(err)) {
          if (err.response?.status === 401) {
            handleLogout();
            throw err;
          }
          if (err.response?.status === 404) {
            try {
          const baseSystems = await fetchSystems();
          return {
            name: scenarioName,
            description: null,
            systems: baseSystems,
            updated_at: new Date().toISOString(),
          };
            } catch (systemsError) {
              if (isAxiosError(systemsError) && systemsError.response?.status === 401) {
                handleLogout();
              }
              throw systemsError;
            }
          }
        }
        throw err;
      }
    },
    enabled: Boolean(authState),
  });

  useEffect(() => {
    if (scenarioData?.systems) {
      const scopedSystems = scenarioData.systems.filter((system) =>
        ALLOWED_REGIONS.has(system.regionName.toLowerCase()),
      );
      const positionedSystems = ensureNodePositions(scopedSystems);
      const { normalizedSystems, removedCount } =
        clampExportTransfersInList(positionedSystems);
      setSystems(normalizedSystems);
      setSelectedSystemName(null);
      if (removedCount > 0) {
        setStatusMessage(
          `Removed ${removedCount} extra export route${removedCount === 1 ? "" : "s"} to enforce the single-destination rule.`,
        );
      } else {
        setStatusMessage(null);
      }
    }
  }, [scenarioData]);

  const { data: upgradeDefinitions = [], isLoading: upgradesLoading } = useQuery<
    UpgradeDefinition[]
  >({
    queryKey: ["upgrades"],
    queryFn: async () => {
      try {
        return await fetchUpgrades();
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 401) {
          handleLogout();
        }
        throw error;
      }
    },
    enabled: Boolean(authState),
    retry: false,
  });

  const usersQuery = useQuery<UserSummary[]>({
    queryKey: ["users"],
    queryFn: async () => {
      try {
        return await fetchUsers();
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 401) {
          handleLogout();
        }
        throw error;
      }
    },
    enabled: Boolean(isAdmin && isUserManagerOpen),
    staleTime: 0,
  });
  const managedUsers = usersQuery.data ?? [];
  const refetchUsers = usersQuery.refetch;
  const isFetchingUsers = usersQuery.isFetching;

  useEffect(() => {
    if (!isUserManagerOpen) {
      return;
    }
    setUserRoleDrafts((previous) => {
      const next: Record<string, UserRole> = {};
      managedUsers.forEach((user) => {
        next[user.username] = previous[user.username] ?? user.role;
      });
      return next;
    });
    setUserEditableRegionsDrafts((previous) => {
      const next: Record<string, string[]> = {};
      managedUsers.forEach((user) => {
        next[user.username] = previous[user.username] ?? (user.editableRegions || []);
      });
      return next;
    });
  }, [isUserManagerOpen, managedUsers]);

  const handleCreateUser = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!newUserUsername || !newUserPassword) {
        setUserManagerMessage("Provide a username and password for the new user.");
        return;
      }
      if (newUserPassword.length < 8) {
        setUserManagerMessage("Passwords must be at least 8 characters long.");
        return;
      }
      setIsUserOperationPending(true);
      setUserManagerMessage(null);
      try {
        await createUser({
          username: newUserUsername,
          password: newUserPassword,
          role: newUserRole,
          editableRegions: newUserRole === "edit" ? newUserEditableRegions : [],
        });
        setNewUserUsername("");
        setNewUserPassword("");
        setNewUserRole("view");
        setNewUserEditableRegions([]);
        setUserManagerMessage(`Created user ${newUserUsername}.`);
        await refetchUsers();
      } catch (error) {
        if (isAxiosError(error)) {
          if (error.response?.status === 401) {
            handleLogout();
            return;
          }
          setUserManagerMessage(error.response?.data?.detail ?? "Failed to create user.");
        } else {
          setUserManagerMessage("Failed to create user.");
        }
      } finally {
        setIsUserOperationPending(false);
      }
    },
    [
      newUserPassword,
      newUserRole,
      newUserUsername,
      refetchUsers,
      handleLogout,
    ],
  );

  const handleUpdateUserRole = useCallback(
    async (username: string) => {
      const nextRole = userRoleDrafts[username];
      if (!nextRole) {
        setUserManagerMessage("Select a valid role.");
        return;
      }
      setIsUserOperationPending(true);
      setUserManagerMessage(null);
      try {
        await updateUser(username, { role: nextRole });
        setUserManagerMessage(`Updated ${username} to ${nextRole} role.`);
        await refetchUsers();
      } catch (error) {
        if (isAxiosError(error)) {
          if (error.response?.status === 401) {
            handleLogout();
            return;
          }
          setUserManagerMessage(error.response?.data?.detail ?? "Failed to update user.");
        } else {
          setUserManagerMessage("Failed to update user.");
        }
      } finally {
        setIsUserOperationPending(false);
      }
    },
    [handleLogout, refetchUsers, userRoleDrafts],
  );

  const handleResetUserPassword = useCallback(
    async (username: string) => {
      const newPassword = window.prompt(
        `Enter a new password for ${username} (minimum 8 characters):`,
      );
      if (!newPassword) {
        return;
      }
      if (newPassword.length < 8) {
        setUserManagerMessage("Passwords must be at least 8 characters long.");
        return;
      }
      setIsUserOperationPending(true);
      setUserManagerMessage(null);
      try {
        await updateUser(username, { password: newPassword });
        setUserManagerMessage(`Updated password for ${username}.`);
        await refetchUsers();
      } catch (error) {
        if (isAxiosError(error)) {
          if (error.response?.status === 401) {
            handleLogout();
            return;
          }
          setUserManagerMessage(error.response?.data?.detail ?? "Failed to update password.");
        } else {
          setUserManagerMessage("Failed to update password.");
        }
      } finally {
        setIsUserOperationPending(false);
      }
    },
    [handleLogout, refetchUsers],
  );

  const handleDeleteUserAccount = useCallback(
    async (username: string) => {
      if (username === authState?.username) {
        setUserManagerMessage("You cannot delete the account you are currently using.");
        return;
      }
      const confirmed = window.confirm(
        `Delete user ${username}? This action cannot be undone.`,
      );
      if (!confirmed) {
        return;
      }
      setIsUserOperationPending(true);
      setUserManagerMessage(null);
      try {
        await deleteUser(username);
        setUserManagerMessage(`Deleted user ${username}.`);
        await refetchUsers();
      } catch (error) {
        if (isAxiosError(error)) {
          if (error.response?.status === 401) {
            handleLogout();
            return;
          }
          setUserManagerMessage(error.response?.data?.detail ?? "Failed to delete user.");
        } else {
          setUserManagerMessage("Failed to delete user.");
        }
      } finally {
        setIsUserOperationPending(false);
      }
    },
    [authState?.username, handleLogout, refetchUsers],
  );

  useEffect(() => {
    if (!selectedUpgradeId && upgradeDefinitions.length > 0) {
      setSelectedUpgradeId(upgradeDefinitions[0].typeID);
    }
  }, [selectedUpgradeId, upgradeDefinitions]);

  const systemsByName = useMemo(() => {
    return new Map(systems.map((system) => [system.systemName, system]));
  }, [systems]);

  useEffect(() => {
    setSelectedSystemName((prev) => {
      if (!prev) {
        return prev;
      }
      return systemsByName.has(prev) ? prev : null;
    });
  }, [systemsByName]);

  const filteredSystems = useMemo<SystemNode[]>(() => systems, [systems]);

  const selectedSystem = useMemo<SystemNode | undefined>(() => {
    if (!selectedSystemName) {
      return undefined;
    }
    return systems.find(
      (system) => system.systemName === selectedSystemName,
    );
  }, [selectedSystemName, systems]);

  const availableImportTargets = useMemo<
    Array<{ target: SystemNode; viaSystems: string[] }>
  >(() => {
    if (!selectedSystem || selectedSystem.role !== "export") {
      return [];
    }

    const existingTargets = new Set(
      selectedSystem.transfers.map((transfer) => transfer.targetSystemId),
    );
    const uniqueTargets = new Map<string, { target: SystemNode; viaSystems: string[] }>();
    const visitedTransits = new Set<string>();

    const queue: Array<{ node: string; viaSystems: string[] }> = [
      { node: selectedSystem.systemName, viaSystems: [] },
    ];

    while (queue.length > 0) {
      const { node, viaSystems } = queue.shift()!;
      const current = systemsByName.get(node);
      if (!current) {
        continue;
      }

      current.neighbors?.forEach((neighborName) => {
        const neighbor = systemsByName.get(neighborName);
        if (!neighbor) {
          return;
        }

        const isNpcSystem = neighbor.factionId !== null && neighbor.factionId !== undefined;

        if (neighbor.role === "import") {
          if (
            !existingTargets.has(neighbor.systemName) &&
            !uniqueTargets.has(neighbor.systemName)
          ) {
            uniqueTargets.set(neighbor.systemName, {
              target: neighbor,
              viaSystems,
            });
          }
          return;
        }

        if (neighbor.role !== "transit") {
          return;
        }

        if (isNpcSystem) {
          return;
        }

        if (neighbor.systemName === selectedSystem.systemName) {
          return;
        }

        if (visitedTransits.has(neighbor.systemName) || viaSystems.includes(neighbor.systemName)) {
          return;
        }

        visitedTransits.add(neighbor.systemName);
        queue.push({ node: neighbor.systemName, viaSystems: [...viaSystems, neighbor.systemName] });
      });
    }

    return Array.from(uniqueTargets.values()).sort((a, b) =>
      a.target.systemName.localeCompare(b.target.systemName),
    );
  }, [selectedSystem, systemsByName]);

  const ansiblexOptions = useMemo(() => {
    if (!selectedSystem || !hasAdvancedLogisticsOnline(selectedSystem)) {
      return [] as Array<{ value: string; label: string }>;
    }
    const sourceName = selectedSystem.systemName;
    const optionMap = new Map<string, string>();
    systems.forEach((system) => {
      if (system.systemName === sourceName) {
        return;
      }
      if (!hasAdvancedLogisticsOnline(system)) {
        return;
      }
      let label = system.systemName;
      if (
        system.ansiblexPartner &&
        system.ansiblexPartner !== sourceName
      ) {
        label = `${label} (linked with ${system.ansiblexPartner})`;
      }
      optionMap.set(system.systemName, label);
    });
    const currentPartner = selectedSystem.ansiblexPartner;
    if (currentPartner && !optionMap.has(currentPartner)) {
      optionMap.set(currentPartner, currentPartner);
    }
    return Array.from(optionMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, label]) => ({ value, label }));
  }, [selectedSystem, systems]);

  useEffect(() => {
    if (availableImportTargets.length === 0) {
      setSelectedTransferTarget(null);
      return;
    }
    setSelectedTransferTarget((current) => {
      if (current && availableImportTargets.some((entry) => entry.target.systemName === current)) {
        return current;
      }
      return availableImportTargets[0]?.target.systemName ?? null;
    });
  }, [availableImportTargets]);

  useEffect(() => {
    setTransferAmountInput("0");
  }, [selectedSystemName]);

  // Render a redirect prompt instead of an in-app login form. Under
  // Alliance Auth, authentication happens at /account/login/ and the SPA
  // simply consumes the session cookie set by the AA backend.
  const loginContent = (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#05050b] via-[#10162b] to-[#1e0f21] px-4 text-[#f5f1ff]">
      <div className="w-full max-w-sm rounded-lg border border-[#342d46] bg-[#100f1f] p-8 text-center shadow-[0_18px_45px_rgba(7,6,15,0.55)]">
        <h1 className="text-2xl font-semibold text-[#f9f7ff]">Sovereignty Planner</h1>
        <p className="mt-2 text-sm text-[#b9b1d6]">
          {authResolved
            ? "You need to sign in through Alliance Auth to continue."
            : "Checking session…"}
        </p>
        {authResolved && (
          <button
            type="button"
            onClick={() => {
              void login(loginUsername, loginPassword);
            }}
            disabled={isLoggingIn}
            className="mt-6 w-full rounded bg-[#22c55e] px-4 py-2 text-sm font-semibold text-[#0f172a] transition hover:bg-[#16a34a]"
          >
            Sign in with Alliance Auth
          </button>
        )}
        {loginError && (
          <p className="mt-4 rounded border border-rose-600 bg-rose-900/30 px-3 py-2 text-sm text-rose-200">
            {loginError}
          </p>
        )}
      </div>
    </div>
  );

  const selectedSystemUpgrades = selectedSystem?.upgrades ?? [];
  const transferStats = useMemo(() => {
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    systems.forEach((system) => {
      system.transfers.forEach((transfer) => {
        if (!(transfer.isOnline ?? true)) {
          return;
        }
        outgoing.set(
          system.systemName,
          (outgoing.get(system.systemName) ?? 0) + transfer.amount,
        );
        incoming.set(
          transfer.targetSystemId,
          (incoming.get(transfer.targetSystemId) ?? 0) + transfer.amount,
        );
      });
    });
    return { incoming, outgoing };
  }, [systems]);

  const upgradeTotals = selectedSystemUpgrades.reduce(
    (totals, upgrade) => {
      if (upgrade.isOnline === false) {
        return totals;
      }
      totals.power += upgrade.power;
      totals.workforce += upgrade.workforce;
      totals.superionicIce += upgrade.superionicIcePerHour;
      totals.magmaticGas += upgrade.magmaticGasPerHour;
      return totals;
    },
    { power: 0, workforce: 0, superionicIce: 0, magmaticGas: 0 },
  );
  const incomingWorkforce = useMemo(() => {
    if (!selectedSystem) {
      return 0;
    }
    return transferStats.incoming.get(selectedSystem.systemName) ?? 0;
  }, [selectedSystem, transferStats]);

  const outgoingWorkforce = useMemo(() => {
    if (!selectedSystem) {
      return 0;
    }
    return transferStats.outgoing.get(selectedSystem.systemName) ?? 0;
  }, [selectedSystem, transferStats]);
  const totalPowerUsed = selectedSystemUpgrades.reduce(
    (total, upgrade) =>
      upgrade.isOnline === false ? total : total + Math.max(0, upgrade.power),
    0,
  );
  const upgradeWorkforceUsed = selectedSystemUpgrades.reduce(
    (total, upgrade) =>
      upgrade.isOnline === false ? total : total + Math.max(0, upgrade.workforce),
    0,
  );
  const totalWorkforceUsed = upgradeWorkforceUsed + outgoingWorkforce;
  const totalPowerCapacity =
    (selectedSystem?.totalPower ?? 0) +
    selectedSystemUpgrades.reduce(
      (total, upgrade) =>
        upgrade.isOnline === false
          ? total
          : total + Math.max(0, upgrade.power < 0 ? -upgrade.power : 0),
      0,
    );
  const totalWorkforceCapacity =
    (selectedSystem?.workforce ?? 0) +
    incomingWorkforce +
    selectedSystemUpgrades.reduce(
      (total, upgrade) =>
        upgrade.isOnline === false
          ? total
          : total + Math.max(0, upgrade.workforce < 0 ? -upgrade.workforce : 0),
      0,
    );
  // ESI is the source of truth for the actual deployed numbers. When
  // a system has live hub_detail, the inspector reads
  // resources.power.allocated/available and resources.workforce.*
  // directly. Manual capacity overrides (powerCapacity /
  // workforceCapacity state) still win because the operator may be
  // exploring a what-if.
  const liveInspectorPowerUsed = selectedSystem?.live?.power?.allocated;
  const liveInspectorPowerCap = selectedSystem?.live?.power?.available;
  const liveInspectorWfUsed = selectedSystem?.live?.workforce?.allocated;
  const liveInspectorWfCap = selectedSystem?.live?.workforce?.available;
  const effectivePowerUsed =
    typeof liveInspectorPowerUsed === "number"
      ? liveInspectorPowerUsed
      : totalPowerUsed;
  const effectivePowerCapacity =
    powerCapacity ??
    (typeof liveInspectorPowerCap === "number"
      ? liveInspectorPowerCap
      : totalPowerCapacity);
  const effectiveWorkforceUsed =
    typeof liveInspectorWfUsed === "number"
      ? liveInspectorWfUsed
      : totalWorkforceUsed;
  const effectiveUpgradeWorkforceUsed =
    typeof liveInspectorWfUsed === "number"
      ? liveInspectorWfUsed
      : upgradeWorkforceUsed;
  const effectiveWorkforceCapacity =
    workforceCapacity ??
    (typeof liveInspectorWfCap === "number"
      ? liveInspectorWfCap
      : totalWorkforceCapacity);
  const powerUsagePercent =
    effectivePowerCapacity > 0
      ? Math.min(100, (effectivePowerUsed / effectivePowerCapacity) * 100)
      : 0;
  const upgradeWorkforcePercent =
    effectiveWorkforceCapacity > 0
      ? Math.min(100, (effectiveUpgradeWorkforceUsed / effectiveWorkforceCapacity) * 100)
      : 0;
  const totalWorkforcePercent =
    effectiveWorkforceCapacity > 0
      ? Math.min(100, (effectiveWorkforceUsed / effectiveWorkforceCapacity) * 100)
      : 0;
  const exportWorkforcePercent =
    effectiveWorkforceCapacity > 0
      ? Math.max(0, totalWorkforcePercent - upgradeWorkforcePercent)
      : 0;

  const mutation = useMutation({
    mutationFn: () =>
      saveScenario(
        scenarioName,
        systems,
        scenarioData?.description ?? null,
      ),
    onSuccess: (response) => {
      queryClient.setQueryData(["scenario", scenarioName], response);
      setStatusMessage("Scenario saved successfully.");
      commitPendingHistory(true, "Scenario saved.");
    },
    onError: (mutationError) => {
      if (isAxiosError(mutationError) && mutationError.response?.status === 401) {
        handleLogout();
        return;
      }
      const message = isAxiosError(mutationError)
        ? mutationError.response?.data?.detail ??
          mutationError.message
        : "Failed to save scenario.";
      setStatusMessage(message);
    },
  });
  const handleSaveScenario = useCallback(() => {
    if (!requireEditPermission()) {
      return;
    }
    mutation.mutate();
  }, [mutation, requireEditPermission]);

  const handleRoleChange = (role: SystemRole) => {
    if (!requireEditPermission()) {
      return;
    }
    if (!selectedSystemName) {
      return;
    }
    const system = systemsByName.get(selectedSystemName);
    if (system && !canEditRegion(system.regionName)) {
      setStatusMessage(
        `You do not have permission to edit systems in the ${system.regionName} region.`,
      );
      return;
    }

    const previousRole = systemsByName.get(selectedSystemName)?.role;
    const selectedSystemData = systemsByName.get(selectedSystemName);
    if (previousRole === role) {
      return;
    }

    // Check if changing from export to transit or import - need to clear exports
    const isExportToNonExport = previousRole === "export" && (role === "transit" || role === "import");
    const isTransitRoleChange = previousRole === "transit" && role !== "transit";
    const isImportRoleChange = previousRole === "import" && role !== "import";
    const affectedTransfers: Array<{
      sourceSystemId: string;
      targetSystemId: string;
      previousViaSystems: string[];
    }> = [];
    const affectedByKey = new Map<
      string,
      { sourceSystemId: string; targetSystemId: string; previousViaSystems: string[] }
    >();

    if (isTransitRoleChange) {
      systems.forEach((system) => {
        if (system.role !== "export") {
          return;
        }
        system.transfers.forEach((transfer) => {
          if (transfer.viaSystems?.includes(selectedSystemName)) {
            const key = makeTransferKey(system.systemName, transfer.targetSystemId);
            const entry = {
              sourceSystemId: system.systemName,
              targetSystemId: transfer.targetSystemId,
              previousViaSystems: transfer.viaSystems ?? [],
            };
            affectedTransfers.push(entry);
            affectedByKey.set(key, entry);
          }
        });
      });
    }

    const rerouteMap = new Map<string, string[]>();
    const removalSet = new Set<string>();
    const removalReasonByKey = new Map<string, "transit" | "import">();

    if (isTransitRoleChange && affectedTransfers.length > 0) {
      const updatedSystemsIndex = new Map<string, SystemNode>();
      systems.forEach((system) => {
        if (system.systemName === selectedSystemName) {
          updatedSystemsIndex.set(system.systemName, { ...system, role });
        } else {
          updatedSystemsIndex.set(system.systemName, system);
        }
      });

      affectedTransfers.forEach((transfer) => {
        const key = makeTransferKey(transfer.sourceSystemId, transfer.targetSystemId);
        const newPath = findAlternateTransferPath(
          updatedSystemsIndex,
          transfer.sourceSystemId,
          transfer.targetSystemId,
        );
        if (newPath) {
          rerouteMap.set(key, newPath);
        } else {
          removalSet.add(key);
          removalReasonByKey.set(key, "transit");
        }
      });

      if (removalSet.size > 0) {
        const affectedList = Array.from(removalSet)
          .map((key) => {
            const [source, target] = splitTransferKey(key);
            return `• ${source} → ${target}`;
          })
          .join("\n");
        const prompt = `Changing ${selectedSystemName} to ${role} will remove the following exports:\n${affectedList}\nContinue?`;
        const confirmed =
          typeof window === "undefined" ? true : window.confirm(prompt);
        if (!confirmed) {
          return;
        }
      }
    }

    if (isImportRoleChange) {
      systems.forEach((system) => {
        if (system.role !== "export") {
          return;
        }
        system.transfers.forEach((transfer) => {
          if (transfer.targetSystemId === selectedSystemName) {
            const key = makeTransferKey(system.systemName, transfer.targetSystemId);
            removalSet.add(key);
            removalReasonByKey.set(key, "import");
            affectedByKey.set(key, {
              sourceSystemId: system.systemName,
              targetSystemId: transfer.targetSystemId,
              previousViaSystems: transfer.viaSystems ?? [],
            });
          }
        });
      });
    }

    if (isImportRoleChange && selectedSystemData) {
      const activeUpgrades =
        selectedSystemData.upgrades?.filter((upgrade) => upgrade.isOnline ?? true) ?? [];
      const upgradeWorkforceUsage = activeUpgrades.reduce(
        (total, upgrade) => total + Math.max(0, upgrade.workforce),
        0,
      );
      const upgradeCapacityAddition = activeUpgrades.reduce(
        (total, upgrade) =>
          total + Math.max(0, upgrade.workforce < 0 ? -upgrade.workforce : 0),
        0,
      );
      const baseWorkforce = selectedSystemData.workforce ?? 0;
      const incomingWorkforce = transferStats.incoming.get(selectedSystemName) ?? 0;
      const workforceBeforeChange = baseWorkforce + incomingWorkforce + upgradeCapacityAddition;
      const workforceAfterChange = baseWorkforce + upgradeCapacityAddition;
      if (
        upgradeWorkforceUsage <= workforceBeforeChange &&
        upgradeWorkforceUsage > workforceAfterChange
      ) {
        const warningMessage = `Changing ${selectedSystemName} to ${role} will remove all incoming workforce.\n` +
          `Upgrades currently require ${upgradeWorkforceUsage.toLocaleString()} workforce, ` +
          `but only ${workforceAfterChange.toLocaleString()} will remain afterward.\n` +
          `This leaves a deficit of ${(upgradeWorkforceUsage - workforceAfterChange).toLocaleString()} workforce.\n` +
          `Do you want to continue?`;
        const confirmed =
          typeof window === "undefined" ? true : window.confirm(warningMessage);
        if (!confirmed) {
          return;
        }
      }
    }

    setSystems((prev) =>
      prev.map((system) => {
        if (system.systemName === selectedSystemName) {
          // Clear transfers if changing from export to transit or import
          const updatedSystem = isExportToNonExport
            ? { ...system, role, transfers: [] }
            : { ...system, role };
          return updatedSystem;
        }
        if (system.role === "export" && (rerouteMap.size > 0 || removalSet.size > 0)) {
          let changed = false;
          const updatedTransfers = system.transfers.flatMap((transfer) => {
            const key = makeTransferKey(system.systemName, transfer.targetSystemId);
            if (removalSet.has(key)) {
              changed = true;
              return [];
            }
            const newViaSystems = rerouteMap.get(key);
            if (newViaSystems) {
              changed = true;
              return [
                {
                  ...transfer,
                  viaSystems: [...newViaSystems],
                },
              ];
            }
            return [transfer];
          });
          if (changed) {
            return { ...system, transfers: updatedTransfers };
          }
        }
        return system;
      }),
    );

    const reroutedKeys = Array.from(rerouteMap.keys());
    const removedKeys = Array.from(removalSet);

    const statusParts = [`${selectedSystemName} role changed to ${role}`];
    if (isExportToNonExport && selectedSystemData?.transfers && selectedSystemData.transfers.length > 0) {
      statusParts.push(
        `${selectedSystemData.transfers.length} export${selectedSystemData.transfers.length === 1 ? "" : "s"} cleared`,
      );
    }
    if (reroutedKeys.length > 0) {
      statusParts.push(
        `${reroutedKeys.length} export${reroutedKeys.length === 1 ? "" : "s"} rerouted`,
      );
    }
    if (removedKeys.length > 0) {
      statusParts.push(
        `${removedKeys.length} export${removedKeys.length === 1 ? "" : "s"} removed`,
      );
    }
    setStatusMessage(statusParts.join(". "));

    logChange(
      `Changed ${selectedSystemName} role from ${previousRole ?? "unknown"} to ${role}.`,
    );

    // Log cleared exports if changing from export to transit/import
    if (isExportToNonExport && selectedSystemData?.transfers && selectedSystemData.transfers.length > 0) {
      selectedSystemData.transfers.forEach((transfer) => {
        logChange(
          `Cleared export from ${selectedSystemName} to ${transfer.targetSystemId} because ${selectedSystemName} is no longer an export system.`,
        );
      });
    }

    reroutedKeys.forEach((key) => {
      const [source, target] = splitTransferKey(key);
      const newVia = rerouteMap.get(key) ?? [];
      const previous = affectedByKey.get(key);
      const previousLabel =
        previous && previous.previousViaSystems.length > 0
          ? previous.previousViaSystems.join(" → ")
          : "direct";
      const newLabel = newVia.length > 0 ? newVia.join(" → ") : "direct";
      logChange(
        `Updated export from ${source} to ${target} after ${selectedSystemName} role change (${previousLabel} → ${newLabel}).`,
      );
    });

    removedKeys.forEach((key) => {
      const [source, target] = splitTransferKey(key);
      const previous = affectedByKey.get(key);
      const previousLabel =
        previous && previous.previousViaSystems.length > 0
          ? ` via ${previous.previousViaSystems.join(" → ")}`
          : "";
      const reason = removalReasonByKey.get(key);
      const reasonText =
        reason === "transit"
          ? ` because ${selectedSystemName} is no longer transit.`
          : reason === "import"
          ? ` because ${selectedSystemName} is no longer an import system.`
          : ".";
      logChange(
        `Removed export from ${source} to ${target}${previousLabel}${reasonText}`,
      );
    });
  };

  const handlePositionChange = useCallback(
    (systemName: string, position: { x: number; y: number }) => {
      if (!canEdit) {
      return;
    }
    setSystems((prev) =>
      prev.map((system) =>
          system.systemName === systemName
            ? system.position &&
              system.position.x === position.x &&
              system.position.y === position.y
              ? system
              : { ...system, position }
          : system,
      ),
    );
    },
    [canEdit],
  );

  const downloadBackup = useCallback(() => {
    const payload = {
      version: 1,
      generatedAt: new Date().toISOString(),
      scenario: scenarioName,
      systems: systems.map((system) => ({
        systemName: system.systemName,
        role: system.role,
        position: system.position ?? null,
        upgrades: system.upgrades ?? [],
        transfers: system.transfers ?? [],
        ansiblexPartner: system.ansiblexPartner ?? null,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTimestamp = payload.generatedAt.replace(/[:]/g, "-");
    link.href = url;
    link.download = `backup-${scenarioName}-${safeTimestamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatusMessage("Backup downloaded.");
  }, [scenarioName, systems]);

  const applyBackup = useCallback(
    (backup: {
      systems: Array<{
        systemName: string;
        role?: SystemRole;
        position?: NodePosition | null;
        upgrades?: SystemUpgrade[];
        transfers?: WorkforceTransfer[];
        ansiblexPartner?: string | null;
      }>;
    }) => {
      if (!requireEditPermission()) {
        return;
      }
      const backupSystems = Array.isArray(backup?.systems) ? backup.systems : [];
      if (backupSystems.length === 0) {
        throw new Error("Backup does not contain any systems.");
      }
      const backupByName = new Map(
        backupSystems
          .filter(
            (entry): entry is {
              systemName: string;
              role?: SystemRole;
              position?: NodePosition | null;
              upgrades?: SystemUpgrade[];
              transfers?: WorkforceTransfer[];
              ansiblexPartner?: string | null;
            } => typeof entry?.systemName === "string",
          )
          .map((entry) => [entry.systemName, entry]),
      );
      let trimmedExports = 0;
      setSystems((prevSystems) =>
        prevSystems.map((system) => {
          const backupEntry = backupByName.get(system.systemName);
          if (!backupEntry) {
            const { normalizedSystem, removedCount } = clampExportTransfers(system);
            trimmedExports += removedCount;
            return normalizedSystem;
          }
          const nextUpgrades = Array.isArray(backupEntry.upgrades)
            ? backupEntry.upgrades.map((upgrade) => ({ ...upgrade }))
            : system.upgrades;
          const nextTransfers = Array.isArray(backupEntry.transfers)
            ? backupEntry.transfers.map((transfer) => ({
                ...transfer,
                sourceSystemId:
                  transfer.sourceSystemId && transfer.sourceSystemId.length > 0
                    ? transfer.sourceSystemId
                    : system.systemName,
              }))
            : system.transfers;
          let nextPosition: NodePosition | undefined = system.position;
          if (backupEntry.position && typeof backupEntry.position === "object") {
            const { x, y } = backupEntry.position as NodePosition;
            if (Number.isFinite(x) && Number.isFinite(y)) {
              nextPosition = { x, y };
            }
          } else if (backupEntry.position === null) {
            nextPosition = undefined;
          }
          let nextAnsiblexPartner = system.ansiblexPartner ?? null;
          if (Object.prototype.hasOwnProperty.call(backupEntry, "ansiblexPartner")) {
            const partnerValue = backupEntry.ansiblexPartner;
            if (typeof partnerValue === "string" && partnerValue.length > 0) {
              nextAnsiblexPartner = partnerValue;
            } else if (partnerValue === null) {
              nextAnsiblexPartner = null;
            }
          }

          const updatedSystem = {
            ...system,
            role: backupEntry.role ?? system.role,
            upgrades: nextUpgrades,
            transfers: nextTransfers,
            position: nextPosition,
            ansiblexPartner: nextAnsiblexPartner,
          };
          const { normalizedSystem, removedCount } = clampExportTransfers(updatedSystem);
          trimmedExports += removedCount;
          return normalizedSystem;
        }),
      );
      const restoredSystems = backupSystems.map((entry) => entry.systemName).join(", ");
      const reminderMessage =
        "Backup restored. Remember to save the scenario to make the restore permanent.";
      const trimmedNote =
        trimmedExports > 0
          ? ` ${trimmedExports} export route${trimmedExports === 1 ? "" : "s"} trimmed to enforce the single-destination rule.`
          : "";
      setStatusMessage(`${reminderMessage}${trimmedNote}`);
      logChange(
        `Restored backup for systems: ${
          restoredSystems.length > 0 ? restoredSystems : "No systems matched in backup"
        }.`,
      );
      if (trimmedExports > 0) {
        logChange(
          `Trimmed ${trimmedExports} extra export route${trimmedExports === 1 ? "" : "s"} while applying the backup to enforce the single-destination rule.`,
        );
      }
    },
    [logChange, requireEditPermission],
  );

  const handleBackupFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!requireEditPermission()) {
        event.target.value = "";
        return;
      }
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const result = reader.result;
          if (typeof result !== "string") {
            throw new Error("Invalid file content.");
          }
          const parsed = JSON.parse(result) as {
            systems: Array<{
              systemName: string;
              role?: SystemRole;
              position?: NodePosition | null;
              upgrades?: SystemUpgrade[];
              transfers?: WorkforceTransfer[];
            }>;
          };
          applyBackup(parsed);
        } catch (error) {
          console.error("Failed to parse layout file", error);
          setStatusMessage("Failed to restore backup. Please verify the file.");
        } finally {
          event.target.value = "";
        }
      };
      reader.readAsText(file);
    },
    [applyBackup, requireEditPermission],
  );

  const triggerBackupUpload = () => {
    if (!requireEditPermission()) {
      return;
    }
    layoutInputRef.current?.click();
  };

  const handleAddUpgrade = () => {
    if (!requireEditPermission()) {
      return;
    }
    if (!selectedSystemName || selectedUpgradeId === null) {
      return;
    }
    const system = systemsByName.get(selectedSystemName);
    if (system && !canEditRegion(system.regionName)) {
      setStatusMessage(
        `You do not have permission to edit systems in the ${system.regionName} region.`,
      );
      return;
    }

    const definition = upgradeDefinitions.find(
      (upgrade) => upgrade.typeID === selectedUpgradeId,
    );
    if (!definition) {
      return;
    }

    let added = false;
    setSystems((prev) =>
      prev.map((system) => {
        if (system.systemName !== selectedSystemName) {
          return system;
        }

        const alreadyHas =
          system.upgrades?.some((upgrade) => upgrade.typeId === definition.typeID) ?? false;
        if (alreadyHas) {
          return system;
        }

        added = true;
        const newUpgrade: SystemUpgrade = {
          typeId: definition.typeID,
          upgradeName: definition.upgradeName,
          power: definition.power,
          workforce: definition.workforce,
          superionicIcePerHour: definition.superionicIcePerHour,
          magmaticGasPerHour: definition.magmaticGasPerHour,
          priority: 1,
          isOnline: true,
        };

        return {
          ...system,
          upgrades: [...(system.upgrades ?? []), newUpgrade],
        };
      }),
    );
    if (added) {
      setStatusMessage(`Added ${definition.upgradeName} to ${selectedSystemName}.`);
      logChange(`Added ${definition.upgradeName} to ${selectedSystemName}.`);
    }
  };

  const handleRemoveUpgrade = (systemName: string, typeId: number) => {
    if (!requireEditPermission()) {
      return;
    }
    const system = systemsByName.get(systemName);
    if (system && !canEditRegion(system.regionName)) {
      setStatusMessage(
        `You do not have permission to edit systems in the ${system.regionName} region.`,
      );
      return;
    }
    const removedDefinition = upgradeDefinitions.find(
      (upgrade) => upgrade.typeID === typeId,
    );
    let removedName: string | null = null;
    setSystems((prev) =>
      prev.map((system) => {
        if (system.systemName !== systemName) {
          return system;
        }
        const filtered = system.upgrades.filter((upgrade) => {
          if (upgrade.typeId === typeId) {
            removedName = upgrade.upgradeName;
            return false;
          }
          return true;
        });
        return {
          ...system,
          upgrades: filtered,
        };
      }),
    );
    const fallbackName =
      removedName ??
      upgradeDefinitions.find((upgrade) => upgrade.typeID === typeId)?.upgradeName ??
      "upgrade";
    if (removedName || fallbackName) {
      setStatusMessage(`Removed ${fallbackName} from ${systemName}.`);
      logChange(`Removed ${fallbackName} from ${systemName}.`);
    }
    if (removedDefinition?.typeID === ADVANCED_LOGISTICS_TYPE_ID) {
      const removedPartner = clearAnsiblexLink(systemName);
      if (removedPartner) {
        logChange(
          `Cleared Ansiblex link between ${systemName} and ${removedPartner} because the Advanced Logistics Network upgrade was removed.`,
        );
        setStatusMessage(
          `Cleared Ansiblex link between ${systemName} and ${removedPartner}.`,
        );
      }
    }
  };

  const handleToggleUpgrade = (systemName: string, typeId: number) => {
    if (!requireEditPermission()) {
      return;
    }
    const system = systemsByName.get(systemName);
    if (system && !canEditRegion(system.regionName)) {
      setStatusMessage(
        `You do not have permission to edit systems in the ${system.regionName} region.`,
      );
      return;
    }
    const currentUpgrade = systemsByName
      .get(systemName)
      ?.upgrades.find((upgrade) => upgrade.typeId === typeId);
    const nextState = currentUpgrade ? !(currentUpgrade.isOnline ?? true) : null;

    setSystems((prev) =>
      prev.map((system) => {
        if (system.systemName !== systemName) {
          return system;
        }
        return {
          ...system,
          upgrades: system.upgrades.map((upgrade) =>
            upgrade.typeId === typeId
              ? { ...upgrade, isOnline: !(upgrade.isOnline ?? true) }
              : upgrade,
          ),
        };
      }),
    );

    if (currentUpgrade && nextState !== null) {
      logChange(
        `${nextState ? "Enabled" : "Disabled"} ${currentUpgrade.upgradeName} on ${systemName}.`,
      );
      if (
        currentUpgrade.typeId === ADVANCED_LOGISTICS_TYPE_ID &&
        nextState === false
      ) {
        const removedPartner = clearAnsiblexLink(systemName);
        if (removedPartner) {
          logChange(
            `Cleared Ansiblex link between ${systemName} and ${removedPartner} because the Advanced Logistics Network is offline.`,
          );
          setStatusMessage(
            `Cleared Ansiblex link between ${systemName} and ${removedPartner}.`,
          );
        }
      }
    }
  };

  const systemStats = useMemo(() => {
    const stats = new Map<
      string,
      {
        powerUsed: number;
        powerCapacity: number;
        workforceUsed: number;
        workforceCapacity: number;
        upgradeWorkforceUsed: number;
        exportWorkforceUsed: number;
      }
    >();
    systems.forEach((system) => {
      const upgrades = system.upgrades ?? [];
      const activeUpgrades = upgrades.filter((upgrade) => upgrade.isOnline ?? true);
      const powerUsed = activeUpgrades.reduce(
        (total, upgrade) => total + Math.max(0, upgrade.power),
        0,
      );
      const workforceUsed =
        activeUpgrades.reduce(
          (total, upgrade) => total + Math.max(0, upgrade.workforce),
          0,
        ) + (transferStats.outgoing.get(system.systemName) ?? 0);
      const upgradeWorkforceUsed = activeUpgrades.reduce(
        (total, upgrade) => total + Math.max(0, upgrade.workforce),
        0,
      );
      const exportWorkforceUsed = transferStats.outgoing.get(system.systemName) ?? 0;
      const powerCapacity =
        system.totalPower +
        activeUpgrades.reduce(
          (total, upgrade) =>
            total + Math.max(0, upgrade.power < 0 ? -upgrade.power : 0),
          0,
        );
      const workforceCapacity =
        system.workforce +
        (transferStats.incoming.get(system.systemName) ?? 0) +
        activeUpgrades.reduce(
          (total, upgrade) =>
            total + Math.max(0, upgrade.workforce < 0 ? -upgrade.workforce : 0),
          0,
        );
      stats.set(system.systemName, {
        powerUsed,
        powerCapacity,
        workforceUsed,
        workforceCapacity,
        upgradeWorkforceUsed,
        exportWorkforceUsed,
      });
    });
    return stats;
  }, [systems, transferStats]);

  // Calculate min/max values for color gradients
  const colorModeRanges = useMemo(() => {
    if (systems.length === 0) {
      return { trueSec: { min: -1, max: 0 }, workforce: { min: 0, max: 0 }, power: { min: 0, max: 0 }, superionicIce: { min: 0, max: 0 }, magmaticGas: { min: 0, max: 0 } };
    }

    let trueSecMin = Infinity;
    let trueSecMax = -Infinity;
    let workforceMin = Infinity;
    let workforceMax = -Infinity;
    let powerMin = Infinity;
    let powerMax = -Infinity;
    let superionicIceMin = Infinity;
    let superionicIceMax = -Infinity;
    let magmaticGasMin = Infinity;
    let magmaticGasMax = -Infinity;

    systems.forEach((system) => {
      // True Sec
      if (system.security < trueSecMin) trueSecMin = system.security;
      if (system.security > trueSecMax) trueSecMax = system.security;

      // Workforce (capacity)
      const statsForSystem = systemStats.get(system.systemName);
      const workforce = statsForSystem?.workforceCapacity ?? system.workforce;
      if (workforce < workforceMin) workforceMin = workforce;
      if (workforce > workforceMax) workforceMax = workforce;

      // Power (capacity)
      const power = statsForSystem?.powerCapacity ?? system.totalPower;
      if (power < powerMin) powerMin = power;
      if (power > powerMax) powerMax = power;

      // Superionic Ice
      const ice = system.baseSuperionicIcePerHour ?? 0;
      if (ice < superionicIceMin) superionicIceMin = ice;
      if (ice > superionicIceMax) superionicIceMax = ice;

      // Magmatic Gas
      const gas = system.baseMagmaticGasPerHour ?? 0;
      if (gas < magmaticGasMin) magmaticGasMin = gas;
      if (gas > magmaticGasMax) magmaticGasMax = gas;
    });

    return {
      trueSec: { min: trueSecMin === Infinity ? -1 : trueSecMin, max: trueSecMax === -Infinity ? 0 : trueSecMax },
      workforce: { min: workforceMin === Infinity ? 0 : workforceMin, max: workforceMax === -Infinity ? 0 : workforceMax },
      power: { min: powerMin === Infinity ? 0 : powerMin, max: powerMax === -Infinity ? 0 : powerMax },
      superionicIce: { min: superionicIceMin === Infinity ? 0 : superionicIceMin, max: superionicIceMax === -Infinity ? 0 : superionicIceMax },
      magmaticGas: { min: magmaticGasMin === Infinity ? 0 : magmaticGasMin, max: magmaticGasMax === -Infinity ? 0 : magmaticGasMax },
    };
  }, [systems, systemStats]);

  const handleAddTransfer = () => {
    if (!requireEditPermission()) {
      return;
    }
    if (!selectedSystem) {
      return;
    }
    if (!canEditRegion(selectedSystem.regionName)) {
      setStatusMessage(
        `You do not have permission to edit systems in the ${selectedSystem.regionName} region.`,
      );
      return;
    }
    if (
      !selectedSystem ||
      selectedSystem.role !== "export" ||
      !selectedTransferTarget ||
      availableImportTargets.length === 0
    ) {
      return;
    }
    const parsedAmount = Math.round(Number(transferAmountInput.replace(/,/g, "")));
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setStatusMessage("Enter a positive workforce amount to export.");
      return;
    }
    const candidate = availableImportTargets.find(
      (entry) => entry.target.systemName === selectedTransferTarget,
    );
    if (!candidate) {
      setStatusMessage("Select a valid import system.");
      return;
    }
    const sourceName = selectedSystem.systemName;
    const sourceSystem = systemsByName.get(sourceName);
    const existingTransfer =
      sourceSystem && Array.isArray(sourceSystem.transfers) && sourceSystem.transfers.length > 0
        ? sourceSystem.transfers[0]
        : undefined;
    const newTransfer: WorkforceTransfer = {
      sourceSystemId: sourceName,
      targetSystemId: candidate.target.systemName,
      amount: parsedAmount,
      viaSystems: [...candidate.viaSystems],
      isOnline: true,
    };
    let updated = false;
    setSystems((prev) =>
      prev.map((system) => {
        if (system.systemName !== sourceName) {
          return system;
        }
        updated = true;
        return {
          ...system,
          transfers: [newTransfer],
        };
      }),
    );
    if (updated) {
      const formatRoute = (segments: string[] | undefined): string =>
        segments && segments.length > 0 ? `via ${segments.join(" → ")}` : "direct";
      const newRouteDescription = formatRoute(candidate.viaSystems);
      const existingRouteDescription = formatRoute(existingTransfer?.viaSystems);
      let message: string;
      if (!existingTransfer) {
        message = `Configured export of ${parsedAmount.toLocaleString()} workforce from ${sourceName} to ${candidate.target.systemName} (${newRouteDescription}).`;
      } else if (existingTransfer.targetSystemId === candidate.target.systemName) {
        const changes: string[] = [];
        if (existingTransfer.amount !== parsedAmount) {
          changes.push(
            `amount ${existingTransfer.amount.toLocaleString()} → ${parsedAmount.toLocaleString()}`,
          );
        }
        if (existingRouteDescription !== newRouteDescription) {
          changes.push(`route ${existingRouteDescription} → ${newRouteDescription}`);
        }
        message =
          changes.length > 0
            ? `Updated export from ${sourceName} to ${candidate.target.systemName}: ${changes.join(
                ", ",
              )}.`
            : `Export from ${sourceName} to ${candidate.target.systemName} already matched the requested configuration.`;
      } else {
        message = `Redirected export from ${sourceName} to ${candidate.target.systemName} (${newRouteDescription}), replacing previous destination ${existingTransfer.targetSystemId} (${existingRouteDescription}). Amount set to ${parsedAmount.toLocaleString()} workforce.`;
      }
      setStatusMessage(message);
      logChange(message);
    }
    setTransferAmountInput("0");
  };

  const handleTransferAmountChange = (
    sourceSystemId: string,
    targetSystemId: string,
    amount: number,
  ) => {
    if (!requireEditPermission()) {
      return;
    }
    const sanitized = Math.max(0, Math.round(amount));
    const existingTransfer = systemsByName
      .get(sourceSystemId)
      ?.transfers.find((transfer) => transfer.targetSystemId === targetSystemId);
    if (existingTransfer && existingTransfer.amount === sanitized) {
      return;
    }
    setSystems((prev) =>
      prev.map((system) => {
        if (system.systemName !== sourceSystemId) {
          return system;
        }
        return {
          ...system,
          transfers: system.transfers.map((transfer) =>
            transfer.targetSystemId === targetSystemId
              ? { ...transfer, amount: sanitized }
              : transfer,
          ),
        };
      }),
    );
    if (existingTransfer) {
      logChange(
        `Updated export from ${sourceSystemId} to ${targetSystemId} to ${sanitized.toLocaleString()} workforce.`,
      );
    }
  };

  const handleRemoveTransfer = (sourceSystemId: string, targetSystemId: string) => {
    if (!requireEditPermission()) {
      return;
    }
    const system = systemsByName.get(sourceSystemId);
    if (system && !canEditRegion(system.regionName)) {
      setStatusMessage(
        `You do not have permission to edit systems in the ${system.regionName} region.`,
      );
      return;
    }
    const sourceSystem = systemsByName.get(sourceSystemId);
    const transferToRemove = sourceSystem?.transfers.find(
      (transfer) => transfer.targetSystemId === targetSystemId,
    );
    setSystems((prev) =>
      prev.map((system) =>
        system.systemName === sourceSystemId
          ? {
              ...system,
              transfers: system.transfers.filter(
                (transfer) => transfer.targetSystemId !== targetSystemId,
              ),
            }
          : system,
      ),
    );
    if (transferToRemove) {
      logChange(
        `Removed export from ${sourceSystemId} to ${targetSystemId}${
          transferToRemove.viaSystems && transferToRemove.viaSystems.length > 0
            ? ` via ${transferToRemove.viaSystems.join(" → ")}`
            : ""
        }.`,
      );
    }
  };

  // The legacy FastAPI build pushed scenario updates over a WebSocket
  // at /api/ws/scenarios. Under Alliance Auth there's no WS endpoint
  // (and gunicorn doesn't serve WS anyway), so the reconnect loop was
  // spamming 404s into the access log every ~5 seconds. Drop it.
  // Periodic refresh of cached queries is handled by react-query's
  // staleTime + manual refetches after a save.

  if (!authState) {
    return loginContent;
  }

  return (
    <div className="relative flex flex-col bg-gradient-to-br from-[#06060d] via-[#0d101f] to-[#1b0f1b] text-[#f2ecff]" style={{ height: "calc(100vh - 120px)" }}>
      {/* The toolbar (Save / Add Corp Token / color mode / history /
          backup) is rendered via React Portal into Alliance Auth's
          blue top navbar — see toolbarTarget useEffect below. AA owns
          authentication, users, and translations; we don't render any
          banner of our own in the planner area. */}
      {toolbarTarget && createPortal(
        <div className="d-flex flex-wrap align-items-center gap-2 ms-auto me-3" style={{ pointerEvents: "auto" }}>
          {canEdit && (
            <button
              type="button"
              className="btn btn-sm btn-outline-danger"
              onClick={handleSaveScenario}
              disabled={mutation.isPending || isLoading}
            >
              {mutation.isPending ? "Saving…" : "Save Scenario"}
            </button>
          )}
          {isAdmin && (window as unknown as { AASOVTOOL_BOOTSTRAP?: { addTokenUrl?: string } }).AASOVTOOL_BOOTSTRAP?.addTokenUrl && (
            <a
              className="btn btn-sm btn-outline-info"
              href={(window as unknown as { AASOVTOOL_BOOTSTRAP: { addTokenUrl: string } }).AASOVTOOL_BOOTSTRAP.addTokenUrl}
            >
              Add Corp Token
            </a>
          )}
          <select
            value={systemColorMode}
            onChange={(e) => setSystemColorMode(e.target.value)}
            className="form-select form-select-sm"
            style={{ width: "auto" }}
            title="System color"
          >
            <option value="none">Gradient</option>
            <option value="trueSec">True Sec</option>
            <option value="workforce">Workforce</option>
            <option value="power">Power</option>
            <option value="superionicIce">Superionic Ice</option>
            <option value="magmaticGas">Magmatic Gas</option>
          </select>
          <button
            type="button"
            className="btn btn-sm btn-outline-light"
            onClick={() => setIsHistoryOpen((prev) => !prev)}
          >
            {isHistoryOpen ? "Hide History" : `History (${changeHistory.length})`}
          </button>
          {canEdit && (
            <>
              <button
                type="button"
                className="btn btn-sm btn-outline-light"
                onClick={downloadBackup}
              >
                Backup
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-light"
                onClick={triggerBackupUpload}
              >
                Restore
              </button>
            </>
          )}
        </div>,
        toolbarTarget,
      )}
      <input
        ref={layoutInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={handleBackupFileChange}
      />
      {isHistoryOpen && (
        <div className="fixed top-20 sm:top-24 right-2 sm:right-6 z-50 w-[calc(100%-1rem)] sm:w-96 max-w-sm overflow-hidden rounded border border-[#2f2942] bg-[#130f22] shadow-[0_15px_45px_rgba(8,6,15,0.55)]">
          <div className="flex items-center justify-between border-b border-[#2f2942] px-4 py-2">
            <div className="text-sm font-semibold text-[#f0eaff]">{t.recentChanges}</div>
            <div className="flex gap-2">
              {changeHistory.length > 0 && (
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs uppercase tracking-wide text-[#d6caef] transition hover:bg-[#2b233c] hover:text-[#090712]"
                  onClick={clearHistory}
                >
                  {t.clear}
                </button>
              )}
              <button
                type="button"
                className="rounded px-2 py-1 text-xs uppercase tracking-wide text-[#d6caef] transition hover:bg-[#2b233c] hover:text-[#090712]"
                onClick={() => setIsHistoryOpen(false)}
              >
                {t.close}
              </button>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto px-4 py-3 text-xs">
            {changeHistory.length === 0 ? (
              <p className="text-[#a89fc0]">{t.noChangesRecorded}</p>
            ) : (
              <ul className="space-y-1">
                {changeHistory.map((entry) => {
                  const entryDate = new Date(entry.timestamp);
                  const dateLabel = `${entryDate.toLocaleDateString()} ${entryDate.toLocaleTimeString()}`;
                  return (
                    <li key={entry.id} className="flex flex-col gap-1 rounded border border-[#2f2942] bg-[#1a1529] px-3 py-2 text-[#f7f4ff]">
                      <div className="flex items-center justify-between text-[10px] font-mono text-[#9388b6]">
                        <span>{entry.username}</span>
                        <span>{dateLabel}</span>
                      </div>
                      <span className="text-xs text-[#ebe6ff]">{entry.message}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
      <main className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        <section className="flex-1 overflow-hidden min-w-0">
          {isLoading && (
            <div className="flex h-full items-center justify-center text-slate-400">
              {t.loadingSystems}
            </div>
          )}
          {isError && !isLoading && (
            <div className="flex h-full items-center justify-center text-rose-400">
              {t.failedToLoad}
              {isAxiosError(error) && error.response?.data?.detail
                ? ` (${error.response.data.detail})`
                : ""}
            </div>
          )}
          {!isLoading && !isError && (
            <SovereigntyGraph
              systems={filteredSystems}
              systemStats={systemStats}
              selectedSystemName={selectedSystemName}
              onSelectSystem={setSelectedSystemName}
              onPositionChange={handlePositionChange}
              isEditable={canEdit}
              systemColorMode={systemColorMode}
              colorModeRanges={colorModeRanges}
            />
          )}
        </section>
        <aside className="w-full lg:w-[380px] shrink-0 border-t lg:border-t-0 lg:border-l border-[#2f2942] bg-[#100f1f] px-3 sm:px-4 py-3 sm:py-4 overflow-y-auto">
            {statusMessage && (
            <div className="mb-6 rounded border border-[#3a3150] bg-[#120f21] px-4 py-3 text-xs text-[#e4def9]">
              {statusMessage}
          </div>
          )}

          <div>
            <h3 className="text-lg font-medium text-[#f2edff]">{t.inspector}</h3>
            {!selectedSystem && (
              <p className="mt-2 text-sm text-[#a29abc]">
                {t.selectSystemToInspect}
              </p>
            )}
            {selectedSystem && (
              <div className="mt-4 space-y-3 rounded-md border border-[#2f2942] bg-[#0f0d1d] px-4 py-4">
                <div>
                  <p className="text-sm font-semibold text-sov-blue">
                    {selectedSystem.systemName}
                  </p>
                  <p className="text-xs text-[#aba4c5]">
                    {selectedSystem.regionName}
                  </p>
                </div>
                <p className="text-xs text-[#aba4c5]">
                  {t.starPower} {selectedSystem.starPower.toLocaleString()} | {t.planetPower}{" "}
                  {selectedSystem.planetPower.toLocaleString()}
                </p>
                <p className="text-xs text-[#aba4c5]">
                  {t.basePower} {selectedSystem.totalPower.toLocaleString()} | {t.baseWorkforce}{" "}
                  {selectedSystem.workforce.toLocaleString()}
                </p>
                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-[#b4adca]">
                      <span>{t.powerUsage}</span>
                      <span
                        className={
                          effectivePowerUsed > effectivePowerCapacity ? "text-red-400 font-semibold" : undefined
                        }
                      >
                        {effectivePowerUsed.toLocaleString()} / {effectivePowerCapacity.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
                      <div
                        className={`h-full ${
                          effectivePowerUsed > effectivePowerCapacity ? "bg-red-500" : "bg-sov-blue"
                        }`}
                        style={{ width: `${powerUsagePercent}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-400">
                      <span>{t.workforceUsage}</span>
                      <span
                        className={
                          effectiveWorkforceUsed > effectiveWorkforceCapacity
                            ? "text-red-400 font-semibold"
                            : undefined
                        }
                      >
                        {effectiveWorkforceUsed.toLocaleString()} / {effectiveWorkforceCapacity.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
                      <div className="relative h-full w-full">
                        <div
                          className={`absolute left-0 top-0 h-full ${
                            effectiveWorkforceUsed > effectiveWorkforceCapacity ? "bg-red-500" : "bg-sov-blue"
                          }`}
                          style={{
                            width: `${upgradeWorkforcePercent}%`,
                          }}
                        />
                        <div
                          className={`absolute top-0 h-full ${
                            effectiveWorkforceUsed > effectiveWorkforceCapacity ? "bg-red-500" : "bg-emerald-500"
                          }`}
                          style={{
                            left: `${upgradeWorkforcePercent}%`,
                            width: `${exportWorkforcePercent}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] uppercase tracking-wide text-slate-400">
                  <div>
                    {t.upgradePower}:{" "}
                    <span className="text-slate-200">
                      {upgradeTotals.power.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    {t.upgradeWorkforce}:{" "}
                    <span className="text-slate-200">
                      {upgradeTotals.workforce.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    {t.icePerHour}:{" "}
                    <span className="text-slate-200">
                      {upgradeTotals.superionicIce.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    {t.gasPerHour}:{" "}
                    <span className="text-slate-200">
                      {upgradeTotals.magmaticGas.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    {t.transitOut}:{" "}
                    <span className="text-slate-200">
                      {outgoingWorkforce.toLocaleString()}
                    </span>
                  </div>
                </div>
                <label className="block text-xs text-slate-300">
                  {t.systemRole}
                  <select
                    className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm focus:border-sov-orange focus:outline-none"
                    value={selectedSystem.role}
                    onChange={(event) =>
                      handleRoleChange(event.target.value as SystemRole)
                    }
                    disabled={!canEdit}
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option === "export" ? t.export : option === "import" ? t.import : t.transit}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="pt-3">
                  <h4 className="text-sm font-semibold text-slate-200">{t.upgrades}</h4>
                  <div className="mt-2 flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      {selectedUpgradeId !== null && (
                        <UpgradeIcon
                          typeId={selectedUpgradeId}
                          size={128}
                          alt="Selected upgrade icon"
                          className="h-14 w-14 flex-none rounded border border-slate-700 bg-slate-800 object-contain p-1"
                        />
                      )}
                      <select
                        className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm focus:border-sov-blue focus:outline-none disabled:opacity-50"
                        value={selectedUpgradeId ?? ""}
                        onChange={(event) => setSelectedUpgradeId(Number(event.target.value))}
                        disabled={upgradesLoading || upgradeDefinitions.length === 0}
                      >
                        {upgradeDefinitions.map((upgrade) => (
                          <option key={upgrade.typeID} value={upgrade.typeID}>
                            {upgrade.upgradeName} (
                            {upgrade.power.toLocaleString()} {t.power.toLowerCase()} /{" "}
                            {upgrade.workforce.toLocaleString()} {t.workforce.toLowerCase()})
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      className="self-start rounded-md border border-sov-blue bg-sov-blue/10 px-4 py-2 text-sm font-semibold text-sov-blue transition hover:bg-sov-blue hover:text-slate-900 disabled:opacity-50"
                      onClick={handleAddUpgrade}
                      disabled={!canEdit || selectedUpgradeId === null || upgradesLoading}
                    >
                      {t.addUpgrade}
                    </button>
                  </div>
                  {selectedSystemUpgrades.length === 0 ? (
                    <div className="mt-3 text-xs text-slate-500">
                      <p>{t.noUpgradesApplied}</p>
                      <p className="mt-1 text-[11px] text-slate-600">
                        {t.addUpgradesUsingSelector}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {selectedSystemUpgrades.map((upgrade, index) => {
                        const isOnline = upgrade.isOnline ?? true;
                        return (
                          <div
                            key={`${upgrade.typeId}-${index}`}
                            className="rounded border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200"
                          >
                            <div className="flex items-start gap-3">
                              <UpgradeIcon
                                typeId={upgrade.typeId}
                                size={128}
                                alt={`${upgrade.upgradeName} icon`}
                                className="mt-0.5 h-12 w-12 flex-none rounded border border-slate-700 bg-slate-800 object-contain p-1"
                              />
                              <div className="flex flex-1 flex-col gap-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-medium">{upgrade.upgradeName}</p>
                                  <span
                                    className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                                      isOnline
                                        ? "bg-emerald-500/10 text-emerald-300"
                                        : "bg-slate-700 text-slate-300"
                                    }`}
                                  >
                                    {isOnline ? t.online : t.offline}
                                  </span>
                                </div>
                                <p className="text-slate-400">
                                  {upgrade.power.toLocaleString()} {t.power.toLowerCase()} /{" "}
                                  {upgrade.workforce.toLocaleString()} {t.workforce.toLowerCase()}
                                </p>
                                {(upgrade.superionicIcePerHour > 0 ||
                                  upgrade.magmaticGasPerHour > 0) && (
                                  <p className="text-[11px] text-slate-500">
                                    {upgrade.superionicIcePerHour > 0
                                      ? `${upgrade.superionicIcePerHour.toLocaleString()} ${t.icePerHour.toLowerCase()}`
                                      : ""}
                                    {upgrade.superionicIcePerHour > 0 &&
                                    upgrade.magmaticGasPerHour > 0
                                      ? " • "
                                      : ""}
                                    {upgrade.magmaticGasPerHour > 0
                                      ? `${upgrade.magmaticGasPerHour.toLocaleString()} ${t.gasPerHour.toLowerCase()}`
                                      : ""}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-col gap-2">
                                <button
                                  type="button"
                                  className="rounded border border-slate-500 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-200 transition hover:bg-slate-500 hover:text-slate-900"
                                  onClick={() =>
                                    handleToggleUpgrade(selectedSystem.systemName, upgrade.typeId)
                                  }
                                  disabled={!canEdit}
                                >
                                  {isOnline ? t.disable : t.enable}
                                </button>
                                <button
                                  type="button"
                                  className="rounded border border-red-500 px-2 py-1 text-[11px] uppercase tracking-wide text-red-400 transition hover:bg-red-500 hover:text-slate-900"
                                  onClick={() =>
                                    handleRemoveUpgrade(selectedSystem.systemName, upgrade.typeId)
                                  }
                                  disabled={!canEdit}
                                >
                                  {t.remove}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {selectedSystem.role === "export" && (
                  <div className="pt-4">
                    <h4 className="text-sm font-semibold text-slate-200">{t.workforceExports}</h4>
                    <p className="mt-1 text-xs text-slate-500">
                      {t.exportsCanSupply}
                    </p>
                    {selectedSystem.transfers.length === 0 ? (
                      <p className="mt-3 text-xs text-slate-500">
                        {t.noExportRoutes}
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {selectedSystem.transfers.map((transfer) => {
                          const targetSystem = systemsByName.get(transfer.targetSystemId);
                          const viaLabel =
                            transfer.viaSystems && transfer.viaSystems.length > 0
                              ? `via ${transfer.viaSystems.join(" → ")}`
                              : "direct";
                          return (
                            <div
                              key={`${transfer.sourceSystemId}-${transfer.targetSystemId}`}
                              className="rounded border border-slate-800 bg-slate-900 px-3 py-3 text-xs text-slate-200"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="space-y-1">
                                  <p className="text-sm font-semibold text-slate-100">
                                    {targetSystem?.systemName ?? transfer.targetSystemId}
                                  </p>
                                  <p className="text-[11px] uppercase tracking-wide text-slate-500">
                                    {viaLabel === "direct" ? t.direct : `${t.via} ${transfer.viaSystems?.join(" → ")}`}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <label className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
                                    {t.amount}
                                    <input
                                      type="number"
                                      min={0}
                                      className="w-24 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 focus:border-sov-blue focus:outline-none"
                                      value={transfer.amount}
                                      onChange={(event) =>
                                        handleTransferAmountChange(
                                          selectedSystem.systemName,
                                          transfer.targetSystemId,
                                          Number(event.target.value),
                                        )
                                      }
                                      disabled={!canEdit}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    className="rounded border border-red-500 px-2 py-1 text-[11px] uppercase tracking-wide text-red-400 transition hover:bg-red-500 hover:text-slate-900"
                                    onClick={() =>
                                      handleRemoveTransfer(
                                        selectedSystem.systemName,
                                        transfer.targetSystemId,
                                      )
                                    }
                                    disabled={!canEdit}
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {(selectedSystem.transfers?.length ?? 0) === 0 ? (
                      <div className="mt-4 rounded border border-slate-800 bg-slate-900 px-3 py-3 text-xs text-slate-200">
                        <h5 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          Add Export Route
                        </h5>
                        {availableImportTargets.length === 0 ? (
                          <p className="mt-2 text-xs text-slate-500">
                            No eligible import systems are within range.
                          </p>
                        ) : (
                          <div className="mt-3 space-y-3">
                            <select
                              className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-slate-100 focus:border-sov-blue focus:outline-none"
                              value={selectedTransferTarget ?? ""}
                              onChange={(event) => setSelectedTransferTarget(event.target.value)}
                              disabled={!canEdit}
                            >
                              {availableImportTargets.map((entry) => (
                                <option
                                  key={entry.target.systemName}
                                  value={entry.target.systemName}
                                >
                                  {entry.target.systemName}
                                  {entry.viaSystems.length > 0
                                    ? ` (via ${entry.viaSystems.join(" → ")})`
                                    : " (direct)"}
                                </option>
                              ))}
                            </select>
                            <div className="flex gap-2">
                              <input
                                className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sov-blue focus:outline-none"
                                type="number"
                                min={0}
                                value={transferAmountInput}
                                onChange={(event) => setTransferAmountInput(event.target.value)}
                                placeholder="Workforce amount"
                                disabled={!canEdit}
                              />
                              <button
                                type="button"
                                className="flex items-center gap-2 rounded-md border border-sov-blue bg-sov-blue/10 px-4 py-2 text-sm font-semibold text-sov-blue transition hover:bg-sov-blue hover:text-slate-900 disabled:opacity-50"
                                onClick={handleAddTransfer}
                                disabled={!canEdit || !selectedTransferTarget}
                              >
                                <span className="text-lg leading-none">+</span>
                                <span>Add Export</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 rounded border border-slate-800 bg-slate-900 px-3 py-3 text-xs text-slate-300">
                        <h5 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          Export Route Locked
                        </h5>
                        <p className="mt-2 text-xs text-slate-500">
                          Remove the existing export route before configuring a new destination.
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {hasAdvancedLogisticsInstalled(selectedSystem) && (
                  <div className="border-t border-[#2f2942] pt-4">
                    <h4 className="text-sm font-semibold text-[#f2edff]">{t.ansiblexLink}</h4>
                    {hasAdvancedLogisticsOnline(selectedSystem) ? (
                    <div className="mt-2 space-y-2 text-xs text-[#d8d0f3]">
                      <p className="text-[11px] text-[#9f96c0]">
                        {t.pairSystemForAnsiblex}
                      </p>
                      {canEdit ? (
                        <div className="flex flex-col gap-2">
                          <select
                            className="rounded border border-[#3b3250] bg-[#120f1f] px-3 py-2 text-xs text-[#f0ecff] focus:border-[#f74b68] focus:outline-none"
                            value={selectedSystem.ansiblexPartner ?? ""}
                            onChange={(event) =>
                              handleSetAnsiblexLink(
                                selectedSystem.systemName,
                                event.target.value === "" ? null : event.target.value,
                              )
                            }
                          >
                            <option value="">{t.noLink}</option>
                            {ansiblexOptions.length === 0 ? (
                              <option value="" disabled>
                                {t.noEligibleSystems}
                              </option>
                            ) : (
                              ansiblexOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))
                            )}
                          </select>
                          {selectedSystem.ansiblexPartner && (
                            <p className="text-[11px] text-[#9f96c0]">
                              {t.currentlyLinkedWith} {selectedSystem.ansiblexPartner}.
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-[11px] text-[#b9b1d6]">
                          {selectedSystem.ansiblexPartner
                            ? `${t.linkedWith} ${selectedSystem.ansiblexPartner}.`
                            : t.noAnsiblexLinkConfigured}
                        </p>
                      )}
                    </div>
                    ) : (
                      <p className="mt-2 text-[11px] text-[#9f96c0]">
                        {t.installAdvancedLogisticsForAnsiblex}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;


