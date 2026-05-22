"""Celery tasks that refresh ESI-backed data into local cache tables."""
from __future__ import annotations

from datetime import datetime, timezone as dt_timezone
from typing import Iterable

from celery import shared_task
from django.utils import timezone

from . import esi_client, models


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=dt_timezone.utc)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return None


@shared_task(name="aasovtool.refresh_sovereignty_structures")
def refresh_sovereignty_structures() -> int:
    """Refresh the public /sovereignty/structures/ + /sovereignty/systems/ data."""
    structures = esi_client.fetch_sovereignty_structures()
    sov_systems = []
    try:
        sov_systems = esi_client.fetch_sovereignty_systems()
    except Exception:
        # Endpoint may not yet be live in all envs; fall back silently.
        sov_systems = []

    raidable = {}
    try:
        for row in esi_client.fetch_raidable_skyhooks():
            sid = row.get("structure_id")
            if sid:
                raidable[int(sid)] = row
    except Exception:
        raidable = {}

    adm_by_system = {
        int(row.get("system_id", 0)): row for row in sov_systems if row.get("system_id")
    }

    # Resolve type + system names in one pass
    name_ids = set()
    for s in structures:
        name_ids.add(s.get("structure_type_id"))
        name_ids.add(s.get("solar_system_id"))
    name_map = esi_client.resolve_names(name_ids)

    seen_ids = []
    for entry in structures:
        sid = entry.get("structure_id")
        if not sid:
            continue
        seen_ids.append(int(sid))
        adm_row = adm_by_system.get(int(entry.get("solar_system_id", 0)), {})
        raid_row = raidable.get(int(sid), {})
        models.SovStructure.objects.update_or_create(
            structure_id=sid,
            defaults={
                "structure_type_id": entry.get("structure_type_id") or 0,
                "structure_type_name": name_map.get(
                    entry.get("structure_type_id"), ""
                ),
                "solar_system_id": entry.get("solar_system_id") or 0,
                "solar_system_name": name_map.get(
                    entry.get("solar_system_id"), ""
                ),
                "alliance_id": entry.get("alliance_id"),
                "corporation_id": entry.get("corporation_id"),
                "vulnerability_occupancy_level": entry.get(
                    "vulnerability_occupancy_level"
                ),
                "vulnerable_start_time": _parse_dt(entry.get("vulnerable_start_time")),
                "vulnerable_end_time": _parse_dt(entry.get("vulnerable_end_time")),
                "activity_defense_multiplier": adm_row.get(
                    "activity_defense_multiplier"
                ),
                "activity_defense_breakdown": adm_row.get(
                    "activity_defense_breakdown", {}
                ) or {},
                "is_raidable": bool(raid_row),
                "raidable_until": _parse_dt(raid_row.get("raidable_until")),
                "last_seen_at": timezone.now(),
            },
        )
    return len(seen_ids)


@shared_task(name="aasovtool.refresh_corp_structures")
def refresh_corp_structures() -> int:
    """Refresh /corporations/{corp_id}/structures/ for every enabled CorpToken."""
    total = 0
    for record in models.CorpToken.objects.filter(is_enabled=True):
        if not record.esi_token:
            continue
        try:
            structures = esi_client.fetch_corp_structures(
                record.esi_token, record.corporation_id
            )
        except Exception:
            continue

        type_ids = {s.get("type_id") for s in structures if s.get("type_id")}
        system_ids = {s.get("system_id") for s in structures if s.get("system_id")}
        name_map = esi_client.resolve_names(type_ids | system_ids)

        for entry in structures:
            sid = entry.get("structure_id")
            if not sid:
                continue
            models.CorpStructure.objects.update_or_create(
                structure_id=sid,
                defaults={
                    "corporation_id": record.corporation_id,
                    "type_id": entry.get("type_id") or 0,
                    "type_name": name_map.get(entry.get("type_id"), ""),
                    "system_id": entry.get("system_id") or 0,
                    "system_name": name_map.get(entry.get("system_id"), ""),
                    "profile_id": entry.get("profile_id"),
                    "state": entry.get("state", ""),
                    "state_timer_start": _parse_dt(entry.get("state_timer_start")),
                    "state_timer_end": _parse_dt(entry.get("state_timer_end")),
                    "fuel_expires": _parse_dt(entry.get("fuel_expires")),
                    "unanchors_at": _parse_dt(entry.get("unanchors_at")),
                    "services": entry.get("services") or [],
                    "last_seen_at": timezone.now(),
                },
            )
            total += 1

        record.last_used_at = timezone.now()
        record.save(update_fields=["last_used_at"])

    return total


@shared_task(name="aasovtool.refresh_access_lists")
def refresh_access_lists() -> int:
    """Fetch access lists for every cached CorpStructure / SovStructure."""
    total = 0
    tokens = list(models.CorpToken.objects.filter(is_enabled=True))
    if not tokens:
        return 0
    primary = tokens[0]
    token = primary.esi_token
    if not token:
        return 0

    structure_ids: Iterable[int] = list(
        models.CorpStructure.objects.values_list("structure_id", flat=True)
    ) + list(
        models.SovStructure.objects.values_list("structure_id", flat=True)
    )
    structure_ids = list({int(s) for s in structure_ids})

    for structure_id in structure_ids:
        try:
            lists = esi_client.fetch_structure_access_lists(token, structure_id)
        except Exception:
            continue
        for al in lists:
            access_list_id = al.get("access_list_id") or al.get("id")
            if not access_list_id:
                continue
            record, _ = models.AccessList.objects.update_or_create(
                access_list_id=access_list_id,
                defaults={
                    "structure_id": structure_id,
                    "name": al.get("name", ""),
                    "description": al.get("description", ""),
                    "owner_id": al.get("owner_id"),
                    "last_seen_at": timezone.now(),
                },
            )
            try:
                members = esi_client.fetch_access_list_members(token, access_list_id)
            except Exception:
                members = al.get("members") or []
            member_ids = []
            for member in members:
                mid = member.get("entity_id") or member.get("id")
                if not mid:
                    continue
                entity_type = member.get("entity_type") or member.get("type") or "character"
                models.AccessListMember.objects.update_or_create(
                    access_list=record,
                    entity_id=mid,
                    entity_type=entity_type,
                    defaults={
                        "entity_name": member.get("name", ""),
                        "is_blocked": bool(member.get("blocked")),
                    },
                )
                member_ids.append((mid, entity_type))
            # Drop members that no longer appear in the list
            if member_ids:
                keep_filter = models.AccessListMember.objects.filter(access_list=record)
                kept_pks = set()
                for mid, et in member_ids:
                    kept_pks.update(
                        keep_filter.filter(entity_id=mid, entity_type=et).values_list(
                            "pk", flat=True
                        )
                    )
                keep_filter.exclude(pk__in=kept_pks).delete()
            total += 1
    return total


@shared_task(name="aasovtool.refresh_corp_sov_hubs")
def refresh_corp_sov_hubs() -> int:
    """Pull GetCorporationsStructuresSovereigntyHubsDetail for every sov
    hub owned by a registered CorpToken's corporation, and cache the
    full payload on :class:`SovStructure.hub_detail`.

    The detail includes installed upgrades, workforce/power consumption,
    ADM breakdown, resource yields, and ansiblex links — i.e. all the
    fields the planner cards display about a sov hub.
    """
    updated = 0
    for record in models.CorpToken.objects.filter(is_enabled=True):
        if not record.esi_token:
            continue
        # /sovereignty/structures/ only exposes alliance_id, so we can't
        # filter SovStructure by corporation_id. Instead use the corp's
        # own structure listing (already cached in CorpStructure) as the
        # bridge — every sov-relevant structure_id the corp owns will be
        # in there once /corporations/{id}/structures/ has been paged
        # through, and we look those up in the public sov table to know
        # which are actually hubs.
        owned_ids = list(
            models.CorpStructure.objects.filter(
                corporation_id=record.corporation_id
            ).values_list("structure_id", flat=True)
        )
        if not owned_ids:
            continue
        hubs = models.SovStructure.objects.filter(structure_id__in=owned_ids)
        for hub in hubs:
            try:
                detail = esi_client.fetch_corp_sov_hub_detail(
                    record.esi_token, record.corporation_id, hub.structure_id
                )
            except Exception:
                continue
            if not detail:
                continue
            hub.hub_detail = detail
            # If the detail surfaces an ADM, prefer that over the public
            # /sovereignty/systems/ aggregate.
            adm = detail.get("activity_defense_multiplier")
            if adm is not None:
                hub.activity_defense_multiplier = adm
            breakdown = detail.get("activity_defense_breakdown")
            if breakdown:
                hub.activity_defense_breakdown = breakdown
            hub.last_seen_at = timezone.now()
            hub.save(
                update_fields=[
                    "hub_detail",
                    "activity_defense_multiplier",
                    "activity_defense_breakdown",
                    "last_seen_at",
                ]
            )
            updated += 1
    return updated


@shared_task(name="aasovtool.refresh_all")
def refresh_all() -> dict:
    """Convenience task that runs all refreshes sequentially."""
    return {
        "sov_structures": refresh_sovereignty_structures(),
        "corp_structures": refresh_corp_structures(),
        "corp_sov_hubs": refresh_corp_sov_hubs(),
        "access_lists": refresh_access_lists(),
    }
