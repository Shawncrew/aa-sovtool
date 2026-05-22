export type SystemRole = "export" | "import" | "transit";
export type UserRole = "admin" | "edit" | "view";

export interface AuthResponse {
  access_token: string;
  token_type: "bearer";
  role: UserRole;
  editableRegions: string[];
}

export interface UserSummary {
  username: string;
  role: UserRole;
  editableRegions: string[];
}

export interface WorkforceTransfer {
  id?: string;
  sourceSystemId: string;
  targetSystemId: string;
  amount: number;
  viaSystems?: string[];
  isOnline?: boolean;
}

export interface SystemUpgrade {
  typeId: number;
  upgradeName: string;
  power: number;
  workforce: number;
  superionicIcePerHour: number;
  magmaticGasPerHour: number;
  priority?: number;
  isOnline?: boolean;
}

export interface NodePosition {
  x: number;
  y: number;
}

export interface SystemNode {
  systemName: string;
  starID?: number;
  regionName: string;
  constellationName?: string | null;
  security: number;
  starType: string;
  starPower: number;
  planetPower: number;
  workforce: number;
  totalPower: number;
  coordX: number;
  coordY: number;
  coordZ: number;
  role: SystemRole;
  upgrades: SystemUpgrade[];
  transfers: WorkforceTransfer[];
  neighbors: string[];
  position?: NodePosition;
  factionId?: number | null;
  baseSuperionicIcePerHour?: number;
  baseMagmaticGasPerHour?: number;
  ansiblexPartner?: string | null;
  sovereignty?: {
    allianceId?: number | null;
    corporationId?: number | null;
    structureTypeName?: string;
    activityDefenseMultiplier?: number | null;
    activityDefenseBreakdown?: Record<string, number>;
    vulnerableStart?: string | null;
    vulnerableEnd?: string | null;
    isRaidable?: boolean;
  } | null;
  live?: {
    power?: { allocated?: number | null; available?: number | null } | null;
    workforce?: { allocated?: number | null; available?: number | null } | null;
    vulnerabilityWindow?: { start?: string | null; end?: string | null } | null;
    reagentBay?: {
      lastUpdated?: string | null;
      reagents: Array<{
        typeId?: number;
        amount: number;
        burningPerHour: number;
      }>;
      minHoursRemaining?: number | null;
    } | null;
    fuelAccessListId?: number | null;
    transportConfiguration?: "import" | "export" | "transit" | null;
    transportState?: "import" | "export" | "transit" | null;
  } | null;
  corpStructures?: Array<{
    structureId: number;
    typeName: string;
    state: string;
    fuelExpires?: string | null;
  }>;
}

export interface UpgradeDefinition {
  typeID: number;
  upgradeName: string;
  power: number;
  workforce: number;
  superionicIcePerHour: number;
  magmaticGasPerHour: number;
}

export interface ScenarioResponse {
  name: string;
  description?: string | null;
  systems: SystemNode[];
  updated_at: string;
}

export interface ScenarioSummary {
  name: string;
  description?: string | null;
  updated_at: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  role: UserRole;
  editableRegions?: string[];
}

export interface UpdateUserRequest {
  password?: string;
  role?: UserRole;
  editableRegions?: string[];
}



