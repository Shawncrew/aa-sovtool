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


def _serialize_system(system: models.System, override: models.SystemOverride | None) -> dict:
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
        "position": None,
        "ansiblexPartner": None,
    }
    if override:
        if override.role:
            base["role"] = override.role
        if override.upgrades:
            base["upgrades"] = override.upgrades
        if override.transfers:
            base["transfers"] = override.transfers
        if override.position:
            base["position"] = override.position
        if override.ansiblex_partner:
            base["ansiblexPartner"] = override.ansiblex_partner
    return base


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


def _build_scenario_systems(scenario: models.Scenario) -> list[dict]:
    overrides = {ov.system_name: ov for ov in scenario.overrides.all()}
    region_filter = [r.lower() for r in app_settings.AASOVTOOL_ALLOWED_REGIONS]
    out: list[dict] = []
    qs = models.System.objects.all()
    if region_filter:
        qs = qs.filter(region_name__iregex=r"^(%s)$" % "|".join(region_filter))
    for system in qs:
        out.append(_serialize_system(system, overrides.get(system.system_name)))
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
    """Kick off the ESI OAuth flow for a corp-scoped token."""
    # Redirect through django-esi's token request view so the user is sent
    # to CCP SSO; on return we land at corp_token_callback below.
    scopes = "+".join(app_settings.AASOVTOOL_ESI_SCOPES)
    callback = request.build_absolute_uri(reverse("aasovtool:corp_token_callback"))
    return HttpResponseRedirect(
        f"/sso/login?scopes={scopes}&next={callback}"
    )


@login_required
@permission_required("aasovtool.manage_sovtool", raise_exception=True)
@token_required(scopes=app_settings.AASOVTOOL_ESI_SCOPES)
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
