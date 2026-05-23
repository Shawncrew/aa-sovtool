"""Views for the AA sovtool app.

The main page renders a single Django template that hosts the React SPA
bundle (built into ``aasovtool/static/aasovtool/``). The JSON API endpoints
mirror the original FastAPI surface so the frontend code only needs minimal
changes (base URL + auth header swapped for Django session/CSRF).
"""
from __future__ import annotations

import json
from typing import Iterable

from django.contrib.auth.decorators import login_required, permission_required
from django.db import transaction
from django.http import HttpResponse, JsonResponse, HttpResponseRedirect
from django.shortcuts import render, get_object_or_404
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from esi.decorators import token_required

from . import app_settings, models
from . import permissions as perms


# --- Helpers --------------------------------------------------------------


def _json_request(request) -> dict:
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}


def _serialize_system(
    system: models.System,
    override: models.SystemOverride | None,
    hub_detail: dict | None = None,
    upgrade_catalog: dict[int, models.Upgrade] | None = None,
    system_name_by_id: dict[int, str] | None = None,
) -> dict:
    """Compose the per-system payload the planner consumes.

    Layering order (later wins):
      1. catalog defaults from System
      2. live ESI hub-detail (if a hub is present and we have a token)
      3. scenario override (user planning edits)
    """
    # Canonical position from the System catalog is the default; user
    # maps can override via SystemOverride.position.
    canonical_pos = None
    if system.canonical_x is not None and system.canonical_y is not None:
        canonical_pos = {"x": system.canonical_x, "y": system.canonical_y}

    base = {
        "systemName": system.system_name,
        "starID": system.star_id,
        "regionName": system.region_name,
        "constellationName": system.constellation_name,
        "security": system.security,
        "starType": system.star_type,
        "starPower": system.star_power,
        "planetPower": system.planet_power,
        "workforce": system.workforce,
        "totalPower": system.total_power,
        "coordX": system.coord_x,
        "coordY": system.coord_y,
        "coordZ": system.coord_z,
        "factionId": system.faction_id,
        "baseSuperionicIcePerHour": system.base_superionic_ice_per_hour,
        "baseMagmaticGasPerHour": system.base_magmatic_gas_per_hour,
        "neighbors": list(system.neighbors or []),
        "role": "transit",
        "upgrades": [],
        "transfers": [],
        "position": canonical_pos,
        "ansiblexPartner": None,
        "live": None,
    }

    if hub_detail:
        _apply_hub_detail_to_system(
            base, hub_detail, upgrade_catalog or {}, system_name_by_id or {}
        )

    # ESI is the source of truth for role / upgrades / transfers /
    # ansiblex partner. The override table only contributes layout
    # (position) so admins can arrange the planner cards. Other
    # override fields are ignored on the main map; once we add
    # alternate scenarios, those will be presented as separate views.
    if override and override.position:
        base["position"] = override.position
    return base


def _apply_hub_detail_to_system(
    base: dict,
    hub_detail: dict,
    upgrade_catalog: dict[int, models.Upgrade],
    system_name_by_id: dict[int, str],
) -> None:
    """Translate GetCorporationsStructuresSovereigntyHubsDetail into the
    planner's per-system shape.

    Schema reference (CCP, X-Compatibility-Date 2026-05-19):
      - resources.power / resources.workforce: {allocated, available}
      - upgrades: [{type_id, power_state: Unspecified|Online|Offline|Low|Pending}]
      - vulnerability_window: {start, end} (optional — omitted while in campaign)
      - reagent_bay: {last_updated, reagents:[{type_id, amount, burning_per_hour}]}
      - workforce_transport.configuration: oneOf {import:{sources:[{solar_system_id}]},
          export:{...}, transit:{...}} — the *planned* role
      - workforce_transport.state: oneOf {import:{sources:[{amount, solar_system_id}]},
          export:{...}, transit:{...}} — the *currently active* role with amounts
      - fuel_access_list_id: id of the access list governing fuel mgmt
    """
    # ---- Role: prefer the live state, fall back to configuration. ----
    transport = hub_detail.get("workforce_transport") or {}
    role = _detect_transport_role(transport.get("state")) or _detect_transport_role(
        transport.get("configuration")
    )
    if role:
        base["role"] = role

    # ---- Upgrades: join with the local catalog so we have names + costs. ----
    upgrades_out: list[dict] = []
    for entry in hub_detail.get("upgrades") or []:
        type_id = entry.get("type_id")
        if not type_id:
            continue
        cat = upgrade_catalog.get(int(type_id))
        upgrades_out.append(
            {
                "typeId": int(type_id),
                "upgradeName": cat.upgrade_name if cat else f"Type {type_id}",
                "power": cat.power if cat else 0,
                "workforce": cat.workforce if cat else 0,
                "superionicIcePerHour": cat.superionic_ice_per_hour if cat else 0,
                "magmaticGasPerHour": cat.magmatic_gas_per_hour if cat else 0,
                "priority": 1,
                "isOnline": (entry.get("power_state") or "Unspecified") == "Online",
                "powerState": entry.get("power_state") or "Unspecified",
            }
        )
    if upgrades_out:
        base["upgrades"] = upgrades_out

    # ---- Transfers: build edges from the *state* block (real amounts). ----
    #
    # Live ESI shapes (confirmed):
    #   import:  {"import":  {"sources":      [{solar_system_id, amount}]}}
    #   export:  {"export":  {solar_system_id, amount}}      <-- single dest
    #   transit: {"transit": true}                            <-- boolean
    #
    # We only emit edges from the EXPORT side (one transfer per export
    # hub). Import-side `sources` is mirror data — the corresponding
    # export hub's record already carries the same edge.
    transfers_out: list[dict] = []
    state = transport.get("state") or {}
    export_block = state.get("export")
    if isinstance(export_block, dict):
        # Tolerate both the confirmed single-dest shape and a future
        # array shape (just in case CCP extends it).
        if "solar_system_id" in export_block:
            dests = [export_block]
        else:
            dests = (
                export_block.get("destinations")
                or export_block.get("sources")
                or []
            )
        for dest in dests:
            target_id = dest.get("solar_system_id")
            target_name = system_name_by_id.get(int(target_id)) if target_id else None
            if not target_name:
                continue
            transfers_out.append(
                {
                    "sourceSystemId": base["systemName"],
                    "targetSystemId": target_name,
                    "amount": int(dest.get("amount") or 0),
                    "viaSystems": [],
                    "isOnline": True,
                }
            )
    if transfers_out:
        base["transfers"] = transfers_out

    # ---- Live snapshot the card displays ----
    resources = hub_detail.get("resources") or {}
    power = resources.get("power") or {}
    wf = resources.get("workforce") or {}
    reagent_bay = hub_detail.get("reagent_bay") or {}
    reagents_out: list[dict] = []
    min_hours: float | None = None
    for r in reagent_bay.get("reagents") or []:
        type_id = r.get("type_id")
        amount = int(r.get("amount") or 0)
        burn = int(r.get("burning_per_hour") or 0)
        reagents_out.append(
            {
                "typeId": type_id,
                "amount": amount,
                "burningPerHour": burn,
            }
        )
        if burn > 0:
            hours = amount / burn
            min_hours = hours if min_hours is None else min(min_hours, hours)

    vuln = hub_detail.get("vulnerability_window") or {}
    base["live"] = {
        "power": {
            "allocated": power.get("allocated"),
            "available": power.get("available"),
        },
        "workforce": {
            "allocated": wf.get("allocated"),
            "available": wf.get("available"),
        },
        "vulnerabilityWindow": {
            "start": vuln.get("start"),
            "end": vuln.get("end"),
        } if vuln else None,
        "reagentBay": {
            "lastUpdated": reagent_bay.get("last_updated"),
            "reagents": reagents_out,
            "minHoursRemaining": min_hours,
        } if reagent_bay else None,
        "fuelAccessListId": hub_detail.get("fuel_access_list_id"),
        "transportConfiguration": _detect_transport_role(
            transport.get("configuration")
        ),
        "transportState": _detect_transport_role(transport.get("state")),
    }


def _bfs_path(
    source: str, target: str, neighbors_by_name: dict[str, list[str]], max_hops: int = 16
) -> list[str]:
    """Return the list of intermediate system names connecting source to
    target along stargate neighbours, exclusive of both endpoints.

    Returns [] if source == target or if no path is found within
    ``max_hops`` jumps. Used to populate ``viaSystems`` on ESI-derived
    transfers so the TransferEdge component can lay each segment along
    a real stargate connection.
    """
    if source == target or source not in neighbors_by_name:
        return []
    visited = {source}
    queue: list[tuple[str, list[str]]] = [(source, [])]
    while queue:
        node, path = queue.pop(0)
        if len(path) > max_hops:
            continue
        for neighbor in neighbors_by_name.get(node, []):
            if neighbor in visited:
                continue
            visited.add(neighbor)
            if neighbor == target:
                return path
            queue.append((neighbor, path + [neighbor]))
    return []


def _populate_via_systems(
    rows: list[dict], neighbors_by_name: dict[str, list[str]]
) -> None:
    """For every transfer that lacks an explicit viaSystems list, run
    BFS over the stargate graph and fill it in. This makes the
    transfer-edge renderer draw each leg between real neighbours
    instead of cutting a diagonal across the map.
    """
    for row in rows:
        for transfer in row.get("transfers", []):
            if transfer.get("viaSystems"):
                continue
            via = _bfs_path(
                transfer["sourceSystemId"],
                transfer["targetSystemId"],
                neighbors_by_name,
            )
            if via:
                transfer["viaSystems"] = via


def _detect_transport_role(node: dict | None) -> str | None:
    """Read the oneOf discriminator. The schema embeds import/export/transit
    as keys; whichever is present (and truthy) is the active role.

    Confirmed live shapes:
      import:  {"import":  {"sources": [...]}}
      export:  {"export":  {solar_system_id, amount}}
      transit: {"transit": true}
    """
    if not isinstance(node, dict):
        return None
    for candidate in ("import", "export", "transit"):
        value = node.get(candidate)
        # Accept truthy dicts AND truthy bools (transit = true).
        if value or value is True:
            return candidate
    return None


def _serialize_upgrade(upgrade: models.Upgrade) -> dict:
    return {
        "typeID": upgrade.type_id,
        "upgradeName": upgrade.upgrade_name,
        "power": upgrade.power,
        "workforce": upgrade.workforce,
        "superionicIcePerHour": upgrade.superionic_ice_per_hour,
        "magmaticGasPerHour": upgrade.magmatic_gas_per_hour,
    }


def _serialize_scenario(scenario: models.Scenario, systems: Iterable[dict]) -> dict:
    return {
        "name": scenario.name,
        "description": scenario.description,
        "systems": list(systems),
        "updated_at": scenario.updated_at.isoformat(),
    }


def _user_role(request) -> str:
    user = request.user
    if user.has_perm("aasovtool.manage_sovtool"):
        return "admin"
    if user.has_perm("aasovtool.edit_sovtool"):
        return "edit"
    if user.has_perm("aasovtool.view_sovtool"):
        return "view"
    return ""


def _editable_regions(request) -> list[str]:
    if not request.user.is_authenticated:
        return []
    return list(
        models.EditableRegion.objects.filter(user=request.user).values_list(
            "region_name", flat=True
        )
    )


def _build_scenario_systems(
    scenario: models.Scenario | None, *, apply_overrides: bool = True
) -> list[dict]:
    """Build the per-system payload for a map.

    ``apply_overrides=False`` is used for the Live Map: ESI hub_detail
    + System canonical positions only, no scenario overrides applied
    even if the scenario row carries them. This guarantees the Live
    Map is a true read-only mirror of ESI state.
    """
    overrides = (
        {ov.system_name: ov for ov in scenario.overrides.all()}
        if scenario and apply_overrides
        else {}
    )
    region_filter = [r.lower() for r in app_settings.AASOVTOOL_ALLOWED_REGIONS]
    out: list[dict] = []
    qs = models.System.objects.all()
    if region_filter:
        qs = qs.filter(region_name__iregex=r"^(%s)$" % "|".join(region_filter))
    # Index live ESI sovereignty data by solar_system_id for an O(1) merge.
    sov_by_id = {
        s.solar_system_id: s for s in models.SovStructure.objects.all()
    }
    corp_by_system_id: dict[int, list[models.CorpStructure]] = {}
    for cs in models.CorpStructure.objects.all():
        corp_by_system_id.setdefault(cs.system_id, []).append(cs)
    # Look-up tables passed to _serialize_system so hub_detail can be
    # translated without N+1 queries.
    upgrade_catalog = {u.type_id: u for u in models.Upgrade.objects.all()}
    system_name_by_id: dict[int, str] = {}
    for sys_row in models.System.objects.exclude(solar_system_id=None).only(
        "solar_system_id", "system_name"
    ):
        system_name_by_id[int(sys_row.solar_system_id)] = sys_row.system_name
    # Neighbour graph for BFS path-finding on ESI-derived transfers.
    neighbors_by_name: dict[str, list[str]] = {
        s.system_name: list(s.neighbors or []) for s in qs
    }

    for system in qs:
        join_key = system.solar_system_id or system.star_id
        sov = sov_by_id.get(join_key) if join_key else None
        hub_detail = (sov.hub_detail or None) if sov else None
        row = _serialize_system(
            system,
            overrides.get(system.system_name),
            hub_detail=hub_detail,
            upgrade_catalog=upgrade_catalog,
            system_name_by_id=system_name_by_id,
        )
        if sov:
            row["sovereignty"] = {
                "allianceId": sov.alliance_id,
                "corporationId": sov.corporation_id,
                "structureTypeName": sov.structure_type_name,
                "activityDefenseMultiplier": sov.activity_defense_multiplier,
                "activityDefenseBreakdown": sov.activity_defense_breakdown,
                "vulnerableStart": sov.vulnerable_start_time.isoformat()
                if sov.vulnerable_start_time
                else None,
                "vulnerableEnd": sov.vulnerable_end_time.isoformat()
                if sov.vulnerable_end_time
                else None,
                "isRaidable": sov.is_raidable,
            }
        corp_structs = corp_by_system_id.get(system.star_id, []) if system.star_id else []
        row["corpStructures"] = [
            {
                "structureId": cs.structure_id,
                "typeName": cs.type_name,
                "state": cs.state,
                "fuelExpires": cs.fuel_expires.isoformat() if cs.fuel_expires else None,
            }
            for cs in corp_structs
        ]
        out.append(row)
    _populate_via_systems(out, neighbors_by_name)
    return out


def _get_or_create_default_scenario() -> models.Scenario:
    scenario, _ = models.Scenario.objects.get_or_create(
        name=app_settings.AASOVTOOL_DEFAULT_SCENARIO,
        defaults={"is_default": True},
    )
    return scenario


# --- Pages ----------------------------------------------------------------


def _resolve_frontend_assets() -> dict:
    """Look up the built React bundle and return fully-resolved static URLs.

    Returns a dict with keys:
        scripts: list[str]  -- absolute static URLs for entry JS chunks
        styles:  list[str]  -- absolute static URLs for stylesheets
        ready:   bool       -- True if the bundle is present

    Resolves URLs through ``staticfiles_storage`` so it works with both
    plain and ManifestStaticFilesStorage backends. If no manifest is
    found (frontend has not been built yet), returns ``ready=False`` and
    empty lists so the template can render a friendly placeholder
    instead of crashing.
    """
    import json as _json
    from django.contrib.staticfiles import finders
    from django.contrib.staticfiles.storage import staticfiles_storage

    manifest = {}
    for candidate in (
        "aasovtool/.vite/manifest.json",
        "aasovtool/manifest.json",
    ):
        path = finders.find(candidate)
        if not path:
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                manifest = _json.load(fh)
            break
        except (OSError, ValueError):
            continue

    scripts: list[str] = []
    styles: list[str] = []

    def _safe_url(rel_path: str) -> str | None:
        try:
            return staticfiles_storage.url(rel_path)
        except (ValueError, OSError):
            return None

    if manifest:
        for entry in manifest.values():
            if not entry.get("isEntry"):
                continue
            script = _safe_url(f"aasovtool/{entry['file']}")
            if script:
                scripts.append(script)
            for css in entry.get("css", []) or []:
                style = _safe_url(f"aasovtool/{css}")
                if style:
                    styles.append(style)

    return {
        "scripts": scripts,
        "styles": styles,
        "ready": bool(scripts),
    }


@login_required
@permission_required("aasovtool.view_sovtool", raise_exception=True)
def index(request):
    context = {
        "page_title": "Sovereignty Planner",
        "role": _user_role(request),
        "editable_regions": _editable_regions(request),
        "default_scenario": app_settings.AASOVTOOL_DEFAULT_SCENARIO,
        "frontend_assets": _resolve_frontend_assets(),
    }
    return render(request, "aasovtool/sovtool.html", context)


# --- ESI corp token management -------------------------------------------


@login_required
@permission_required("aasovtool.manage_sovtool", raise_exception=True)
def add_corp_token(request):
    """Entry point for adding a corp ESI token.

    We simply forward to ``corp_token_callback``, which is decorated with
    django-esi's ``@token_required``. That decorator drives the proper
    add-character flow: it shows a chooser for any of the user's existing
    AA-linked alts whose tokens already cover the required scopes, plus
    a button to launch CCP SSO for a new character.

    Importantly this avoids AA's ``/sso/login`` route, which enforces
    main-character authentication and refuses alts — that was the
    'Unable to authenticate as the selected character' error.
    """
    return HttpResponseRedirect(reverse("aasovtool:corp_token_callback"))


@login_required
@permission_required("aasovtool.manage_sovtool", raise_exception=True)
@token_required(scopes=app_settings.AASOVTOOL_ESI_SCOPES, new=True)
def corp_token_callback(request, token):
    """Persist the returned ESI token against the character's corp."""
    from .esi_client import resolve_character_affiliations

    affil = resolve_character_affiliations(token)
    corp_id = affil.get("corporation_id")
    corp_name = affil.get("corporation_name", "")
    record, _created = models.CorpToken.objects.update_or_create(
        corporation_id=corp_id,
        defaults={
            "corporation_name": corp_name,
            "character_id": token.character_id,
            "character_name": token.character_name,
            "esi_token": token,
            "added_by": request.user,
            "is_enabled": True,
        },
    )
    record.last_used_at = timezone.now()
    record.save(update_fields=["last_used_at"])
    return HttpResponseRedirect(reverse("aasovtool:index"))


# --- JSON API -------------------------------------------------------------


@login_required
def api_me(request):
    if not request.user.has_perm("aasovtool.view_sovtool"):
        return JsonResponse({"detail": "Forbidden"}, status=403)
    return JsonResponse(
        {
            "username": request.user.username,
            "role": _user_role(request),
            "editableRegions": _editable_regions(request),
        }
    )


@login_required
@permission_required("aasovtool.view_sovtool", raise_exception=True)
def api_systems(request):
    region = request.GET.get("region")
    scenario = _get_or_create_default_scenario()
    systems = _build_scenario_systems(scenario)
    if region:
        systems = [s for s in systems if s["regionName"].lower() == region.lower()]
    return JsonResponse(systems, safe=False)


@login_required
@permission_required("aasovtool.view_sovtool", raise_exception=True)
def api_upgrades(request):
    payload = [_serialize_upgrade(u) for u in models.Upgrade.objects.all()]
    return JsonResponse(payload, safe=False)


@login_required
@permission_required("aasovtool.view_sovtool", raise_exception=True)
def api_scenarios(request):
    payload = [
        {
            "name": s.name,
            "description": s.description,
            "updated_at": s.updated_at.isoformat(),
        }
        for s in models.Scenario.objects.all()
    ]
    return JsonResponse(payload, safe=False)


@login_required
@require_http_methods(["GET", "PUT"])
def api_scenario_detail(request, name: str):
    if not request.user.has_perm("aasovtool.view_sovtool"):
        return JsonResponse({"detail": "Forbidden"}, status=403)

    if request.method == "GET":
        scenario, _ = models.Scenario.objects.get_or_create(
            name=name,
            defaults={"is_default": name == app_settings.AASOVTOOL_DEFAULT_SCENARIO},
        )
        return JsonResponse(
            _serialize_scenario(scenario, _build_scenario_systems(scenario))
        )

    # PUT — save
    if not request.user.has_perm("aasovtool.edit_sovtool"):
        return JsonResponse({"detail": "Permission denied."}, status=403)

    payload = _json_request(request)
    systems_payload = payload.get("systems") or []
    description = payload.get("description")

    if not request.user.has_perm("aasovtool.manage_sovtool"):
        allowed = {r.lower() for r in _editable_regions(request)}
        for system in systems_payload:
            if system.get("regionName", "").lower() not in allowed:
                return JsonResponse(
                    {
                        "detail": (
                            "You do not have permission to edit systems in the "
                            f"{system.get('regionName')} region."
                        )
                    },
                    status=403,
                )

    scenario, _ = models.Scenario.objects.get_or_create(name=name)
    scenario.description = description
    scenario.updated_at = timezone.now()
    scenario.save()
    perms.replace_overrides(scenario, systems_payload)

    models.AuditEntry.objects.create(
        scenario=scenario,
        user=request.user,
        username=request.user.username,
        message="Scenario saved.",
    )

    return JsonResponse(
        _serialize_scenario(scenario, _build_scenario_systems(scenario))
    )


# --- Map management (Live + user maps) -----------------------------------


def _map_summary(scenario: models.Scenario) -> dict:
    """Serialise a map for the listing modal: includes regions covered
    by the map's overrides + creator + timestamps.
    """
    region_names = list(
        models.System.objects.filter(
            system_name__in=scenario.overrides.values_list("system_name", flat=True)
        ).values_list("region_name", flat=True).distinct()
    )
    return {
        "name": scenario.name,
        "description": scenario.description,
        "createdAt": scenario.created_at.isoformat(),
        "updatedAt": scenario.updated_at.isoformat(),
        "isLive": scenario.is_live,
        "creator": scenario.creator.username if scenario.creator else None,
        "basedOn": scenario.based_on_name,
        "regions": sorted({r for r in region_names if r}),
        "overrideCount": scenario.overrides.count(),
    }


def _ensure_live_map() -> models.Scenario:
    live, _ = models.Scenario.objects.get_or_create(
        is_live=True,
        defaults={
            "name": "live",
            "is_default": True,
            "description": "Source-of-truth map driven by ESI.",
        },
    )
    return live


@login_required
@permission_required("aasovtool.view_sovtool", raise_exception=True)
@require_http_methods(["GET", "POST"])
def api_maps(request):
    """GET → list user maps; POST → create a new user map.

    POST body: {name, basedOn?: str | "live"}.
    On create, copies overrides from the base map so the new map opens
    pre-populated with whatever the base has.
    """
    if request.method == "GET":
        rows = [
            _map_summary(s)
            for s in models.Scenario.objects.exclude(is_live=True).order_by("name")
        ]
        return JsonResponse(rows, safe=False)

    if not request.user.has_perm("aasovtool.edit_sovtool"):
        return JsonResponse({"detail": "Permission denied."}, status=403)

    payload = _json_request(request)
    name = (payload.get("name") or "").strip()
    based_on = (payload.get("basedOn") or "live").strip()
    if not name:
        return JsonResponse({"detail": "Name is required."}, status=400)
    if name.lower() == "live":
        return JsonResponse({"detail": "Reserved name."}, status=400)
    if models.Scenario.objects.filter(name=name).exists():
        return JsonResponse({"detail": "A map with that name already exists."}, status=409)

    scenario = models.Scenario.objects.create(
        name=name,
        description=payload.get("description") or None,
        creator=request.user,
        based_on_name=based_on if based_on != "live" else "live",
        updated_at=timezone.now(),
        created_at=timezone.now(),
    )

    # Copy overrides from the base map (unless basing off live, which
    # has no relevant overrides — positions come from System catalog).
    if based_on and based_on != "live":
        base = models.Scenario.objects.filter(name=based_on).first()
        if base:
            for ov in base.overrides.all():
                models.SystemOverride.objects.create(
                    scenario=scenario,
                    system_name=ov.system_name,
                    role=ov.role,
                    upgrades=ov.upgrades,
                    transfers=ov.transfers,
                    position=ov.position,
                    ansiblex_partner=ov.ansiblex_partner,
                )
    return JsonResponse(_map_summary(scenario), status=201)


@login_required
@permission_required("aasovtool.view_sovtool", raise_exception=True)
def api_map_live(request):
    """Live Map: ESI hub_detail + canonical System positions only.

    Overrides are *not* applied even though there's a Scenario row,
    so the response is a faithful mirror of ESI plus the canonical
    layout. Returns the same shape as the scenario detail endpoint
    so the frontend can swap freely between live and user maps.
    """
    scenario = _ensure_live_map()
    systems = _build_scenario_systems(scenario, apply_overrides=False)
    return JsonResponse(
        {
            "name": "live",
            "isLive": True,
            "description": scenario.description,
            "systems": systems,
            "updated_at": scenario.updated_at.isoformat(),
        }
    )


@login_required
@require_http_methods(["GET", "PUT", "DELETE"])
def api_map_detail(request, name: str):
    if not request.user.has_perm("aasovtool.view_sovtool"):
        return JsonResponse({"detail": "Forbidden"}, status=403)
    if name == "live":
        return JsonResponse(
            {"detail": "Use /api/maps/live for the live map."}, status=400
        )

    scenario = models.Scenario.objects.filter(name=name, is_live=False).first()
    if scenario is None:
        return JsonResponse({"detail": "Map not found."}, status=404)

    if request.method == "GET":
        systems = _build_scenario_systems(scenario, apply_overrides=True)
        return JsonResponse(
            {
                "name": scenario.name,
                "isLive": False,
                "description": scenario.description,
                "creator": scenario.creator.username if scenario.creator else None,
                "basedOn": scenario.based_on_name,
                "createdAt": scenario.created_at.isoformat(),
                "updatedAt": scenario.updated_at.isoformat(),
                "systems": systems,
                "updated_at": scenario.updated_at.isoformat(),
            }
        )

    if request.method == "DELETE":
        # Allow delete by creator or by anyone with manage_sovtool.
        is_admin = request.user.has_perm("aasovtool.manage_sovtool")
        if scenario.creator_id != request.user.id and not is_admin:
            return JsonResponse({"detail": "Only the creator or an admin can delete."}, status=403)
        scenario.delete()
        return JsonResponse({"status": "deleted"})

    # PUT — instant save of overrides.
    if not request.user.has_perm("aasovtool.edit_sovtool"):
        return JsonResponse({"detail": "Permission denied."}, status=403)

    payload = _json_request(request)
    systems_payload = payload.get("systems") or []
    if not request.user.has_perm("aasovtool.manage_sovtool"):
        allowed = {r.lower() for r in _editable_regions(request)}
        for system in systems_payload:
            if system.get("regionName", "").lower() not in allowed:
                return JsonResponse(
                    {
                        "detail": (
                            "You do not have permission to edit systems in the "
                            f"{system.get('regionName')} region."
                        )
                    },
                    status=403,
                )

    scenario.updated_at = timezone.now()
    if "description" in payload:
        scenario.description = payload.get("description")
    scenario.save()
    perms.replace_overrides(scenario, systems_payload)
    return JsonResponse(
        {
            "name": scenario.name,
            "isLive": False,
            "updated_at": scenario.updated_at.isoformat(),
            "systems": _build_scenario_systems(scenario),
        }
    )


# --- User / region management --------------------------------------------


@login_required
@permission_required("aasovtool.manage_sovtool", raise_exception=True)
def api_users(request):
    from django.contrib.auth import get_user_model

    User = get_user_model()
    if request.method == "GET":
        users = []
        for u in User.objects.filter(is_active=True):
            users.append(
                {
                    "username": u.username,
                    "role": _user_role_for(u),
                    "editableRegions": list(
                        models.EditableRegion.objects.filter(user=u).values_list(
                            "region_name", flat=True
                        )
                    ),
                }
            )
        return JsonResponse(users, safe=False)
    return JsonResponse({"detail": "Use the AA admin to create users."}, status=405)


@login_required
@permission_required("aasovtool.manage_sovtool", raise_exception=True)
@require_http_methods(["PATCH", "DELETE"])
def api_user_detail(request, username: str):
    from django.contrib.auth import get_user_model

    User = get_user_model()
    user = get_object_or_404(User, username=username)

    if request.method == "DELETE":
        return JsonResponse(
            {"detail": "Delete users via the AA admin."}, status=405
        )

    payload = _json_request(request)
    if "role" in payload:
        perms.apply_role(user, payload["role"])
    if "editableRegions" in payload:
        regions = payload.get("editableRegions") or []
        models.EditableRegion.objects.filter(user=user).delete()
        for region in regions:
            models.EditableRegion.objects.get_or_create(
                user=user, region_name=region
            )
    return JsonResponse(
        {
            "username": user.username,
            "role": _user_role_for(user),
            "editableRegions": list(
                models.EditableRegion.objects.filter(user=user).values_list(
                    "region_name", flat=True
                )
            ),
        }
    )


def _user_role_for(user) -> str:
    if user.has_perm("aasovtool.manage_sovtool"):
        return "admin"
    if user.has_perm("aasovtool.edit_sovtool"):
        return "edit"
    if user.has_perm("aasovtool.view_sovtool"):
        return "view"
    return ""


# --- ESI live data --------------------------------------------------------


@login_required
@permission_required("aasovtool.view_sovtool", raise_exception=True)
def api_sov_structures(request):
    rows = []
    for s in models.SovStructure.objects.all():
        rows.append(
            {
                "structureId": s.structure_id,
                "structureTypeId": s.structure_type_id,
                "structureTypeName": s.structure_type_name,
                "solarSystemId": s.solar_system_id,
                "solarSystemName": s.solar_system_name,
                "allianceId": s.alliance_id,
                "corporationId": s.corporation_id,
                "vulnerabilityOccupancyLevel": s.vulnerability_occupancy_level,
                "vulnerableStart": s.vulnerable_start_time.isoformat()
                if s.vulnerable_start_time
                else None,
                "vulnerableEnd": s.vulnerable_end_time.isoformat()
                if s.vulnerable_end_time
                else None,
                "activityDefenseMultiplier": s.activity_defense_multiplier,
                "activityDefenseBreakdown": s.activity_defense_breakdown,
                "isRaidable": s.is_raidable,
                "raidableUntil": s.raidable_until.isoformat()
                if s.raidable_until
                else None,
                "lastSeenAt": s.last_seen_at.isoformat(),
            }
        )
    return JsonResponse(rows, safe=False)


@login_required
@permission_required("aasovtool.view_sovtool", raise_exception=True)
def api_sov_systems(request):
    """Return sov-system-level data (ADM breakdown etc) joined with catalog."""
    sov_by_system = {
        s.solar_system_id: s for s in models.SovStructure.objects.all()
    }
    out = []
    for system in models.System.objects.all():
        sov = sov_by_system.get(system.star_id)
        out.append(
            {
                "systemName": system.system_name,
                "starID": system.star_id,
                "regionName": system.region_name,
                "activityDefenseMultiplier": sov.activity_defense_multiplier
                if sov
                else None,
                "activityDefenseBreakdown": sov.activity_defense_breakdown
                if sov
                else {},
                "isRaidable": sov.is_raidable if sov else False,
            }
        )
    return JsonResponse(out, safe=False)


@login_required
@permission_required("aasovtool.view_sovtool", raise_exception=True)
def api_corp_structures(request):
    rows = []
    for s in models.CorpStructure.objects.all():
        rows.append(
            {
                "structureId": s.structure_id,
                "corporationId": s.corporation_id,
                "typeId": s.type_id,
                "typeName": s.type_name,
                "systemId": s.system_id,
                "systemName": s.system_name,
                "state": s.state,
                "fuelExpires": s.fuel_expires.isoformat() if s.fuel_expires else None,
                "services": s.services,
            }
        )
    return JsonResponse(rows, safe=False)


@login_required
@permission_required("aasovtool.view_sovtool", raise_exception=True)
def api_access_list(request, structure_id: int):
    lists = models.AccessList.objects.filter(structure_id=structure_id)
    out = []
    for al in lists:
        out.append(
            {
                "accessListId": al.access_list_id,
                "name": al.name,
                "description": al.description,
                "ownerId": al.owner_id,
                "members": [
                    {
                        "entityId": m.entity_id,
                        "entityType": m.entity_type,
                        "entityName": m.entity_name,
                        "isBlocked": m.is_blocked,
                    }
                    for m in al.members.all()
                ],
            }
        )
    return JsonResponse(out, safe=False)


@login_required
@permission_required("aasovtool.manage_sovtool", raise_exception=True)
@require_http_methods(["POST"])
def api_refresh(request):
    """Trigger an immediate ESI refresh of sov + structures + access lists."""
    from .tasks import refresh_all

    refresh_all.delay()
    return JsonResponse({"status": "queued"})


# late import to avoid circular issues at module load
from . import permissions  # noqa: E402
