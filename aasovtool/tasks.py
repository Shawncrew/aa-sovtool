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
def refresh_sovereignty_structures() -> int:  # noqa: C901 - readability trumps splitting
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

    seen_ids: list[int] = []
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
    # ESI is authoritative: drop any cached sov structures that are no
    # longer reported by /sovereignty/structures/ (demolished, unanchored,
    # etc). We only do this when ESI actually returned a non-empty list to
    # avoid wiping the cache if the call failed silently.
    if seen_ids:
        deleted, _ = models.SovStructure.objects.exclude(
            structure_id__in=seen_ids
        ).delete()
        if deleted:
            print(f"[sovtool] Pruned {deleted} stale SovStructure rows.")
    return len(seen_ids)


@shared_task(name="aasovtool.refresh_corp_structures")
def refresh_corp_structures() -> int:
    """Refresh /corporations/{corp_id}/structures/ for every enabled CorpToken.

    ESI is authoritative for this corp's structures: any cached row that
    is no longer returned is pruned at the end of the per-corp pass.
    """
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

        seen_ids: list[int] = []
        for entry in structures:
            sid = entry.get("structure_id")
            if not sid:
                continue
            seen_ids.append(int(sid))
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

        # Authoritative: prune cached corp structures this corp no longer
        # owns. Scoped to this corp so we never touch another corp's rows
        # if its token failed in this pass.
        if seen_ids:
            deleted, _ = (
                models.CorpStructure.objects.filter(
                    corporation_id=record.corporation_id
                )
                .exclude(structure_id__in=seen_ids)
                .delete()
            )
            if deleted:
                print(
                    f"[sovtool] Pruned {deleted} stale CorpStructure rows "
                    f"for {record.corporation_name}."
                )

        record.last_used_at = timezone.now()
        record.save(update_fields=["last_used_at"])

    return total


@shared_task(name="aasovtool.refresh_access_lists")
def refresh_access_lists() -> int:
    """Fetch access lists for every cached CorpStructure / SovStructure.

    ESI is authoritative: per-structure access-list rows that ESI no
    longer returns are pruned, and members of each list that disappear
    are also pruned.
    """
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
        seen_list_ids: list[int] = []
        for al in lists:
            access_list_id = al.get("access_list_id") or al.get("id")
            if not access_list_id:
                continue
            seen_list_ids.append(int(access_list_id))
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
            seen_member_keys: set[tuple[int, str]] = set()
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
                seen_member_keys.add((int(mid), entity_type))
            # Drop members that no longer appear in the list. We rebuild
            # the keep-set from the source-of-truth keys we just inserted
            # so any orphaned rows (from a previous schema) are removed.
            keep_pks: list[int] = []
            for mid, et in seen_member_keys:
                keep_pks.extend(
                    models.AccessListMember.objects.filter(
                        access_list=record, entity_id=mid, entity_type=et
                    ).values_list("pk", flat=True)
                )
            models.AccessListMember.objects.filter(access_list=record).exclude(
                pk__in=keep_pks
            ).delete()
            total += 1

        # Authoritative: prune access lists that ESI no longer reports
        # for this structure.
        if seen_list_ids:
            stale = models.AccessList.objects.filter(structure_id=structure_id).exclude(
                access_list_id__in=seen_list_ids
            )
            if stale.exists():
                stale.delete()

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
    # Track which hubs we successfully populated this run so we can clear
    # stale hub_detail on rows that are no longer corp-owned.
    refreshed_ids: set[int] = set()
    corp_ids_seen: set[int] = set()
    corp_owned_hub_ids: set[int] = set()
    for record in models.CorpToken.objects.filter(is_enabled=True):
        if not record.esi_token:
            continue
        corp_ids_seen.add(record.corporation_id)
        # Source of truth for "which sov hubs does this corp own" is the
        # Equinox listing endpoint:
        # /corporations/{id}/structures/sovereignty_hubs/
        # (we probe candidates once via fetch_corp_sov_hubs_list).
        # /corporations/{id}/structures/ doesn't return sov hubs — only
        # upwell structures (citadels, ECs, refineries).
        owned_ids: list[int] = []
        try:
            hub_list = esi_client.fetch_corp_sov_hubs_list(
                record.esi_token, record.corporation_id
            )
        except Exception:
            hub_list = []
        for entry in hub_list:
            sid = entry.get("structure_id")
            if sid:
                owned_ids.append(int(sid))
        if not owned_ids:
            # Fallback: try CorpStructure rows in case CCP eventually
            # surfaces sov hubs via the unified endpoint.
            owned_ids = list(
                models.CorpStructure.objects.filter(
                    corporation_id=record.corporation_id
                ).values_list("structure_id", flat=True)
            )
        if not owned_ids:
            continue
        corp_owned_hub_ids.update(owned_ids)
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
            refreshed_ids.add(hub.structure_id)
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
    # Authoritative: any cached SovStructure that previously had
    # hub_detail but is no longer corp-owned (by any registered token)
    # gets its hub_detail cleared. We only do this when at least one
    # token actually succeeded this run, so a transient ESI failure
    # doesn't wipe live data.
    if corp_ids_seen:
        cleared = (
            models.SovStructure.objects.exclude(structure_id__in=corp_owned_hub_ids)
            .exclude(hub_detail={})
            .update(hub_detail={})
        )
        if cleared:
            print(f"[sovtool] Cleared stale hub_detail on {cleared} rows.")
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
