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
def refresh_sovereignty_structures() -> int:  # noqa: C901
    """Refresh public sovereignty data per K-space system.

    The legacy /sovereignty/structures/ EVE-wide listing was retired in
    the Equinox API rollout. Its replacement is /sovereignty/systems,
    which returns a ``claim`` block per K-space system describing who
    holds it (faction / alliance / corporation) plus ADM data.

    We upsert one ``SovStructure`` row per claimed system, keyed off
    ``solar_system_id`` (since there's only one sov hub per system).
    Hubs the corp owns get linked up later in ``refresh_corp_sov_hubs``
    via the structure_id from the corp-scoped listing.
    """
    try:
        sov_systems = esi_client.fetch_sovereignty_systems()
    except Exception:
        sov_systems = []

    # Filter to systems in the planner's configured regions — there's no
    # reason to cache faction-claimed high-sec entries. We resolve via
    # the bundled System catalog which is small (~8k rows in-memory).
    from . import app_settings as _settings
    allowed_regions = {r.lower() for r in _settings.AASOVTOOL_ALLOWED_REGIONS}
    if allowed_regions and sov_systems:
        allowed_solar_system_ids = set(
            models.System.objects.filter(
                region_name__iregex=r"^(%s)$" % "|".join(allowed_regions)
            ).values_list("solar_system_id", flat=True)
        )
        allowed_solar_system_ids.discard(None)
        if allowed_solar_system_ids:
            sov_systems = [
                row for row in sov_systems
                if int(row.get("solar_system_id") or row.get("system_id") or 0)
                in allowed_solar_system_ids
            ]

    raidable: dict[int, dict] = {}
    try:
        for row in esi_client.fetch_raidable_skyhooks():
            sid = row.get("structure_id") or row.get("id")
            if sid:
                raidable[int(sid)] = row
    except Exception:
        raidable = {}

    # Resolve system + alliance names in one batch.
    name_ids: set[int] = set()
    for row in sov_systems:
        sid = row.get("solar_system_id") or row.get("system_id")
        if sid:
            name_ids.add(int(sid))
        claim = row.get("claim") or {}
        for entity in ("alliance", "corporation", "faction"):
            block = claim.get(entity) or {}
            entity_id = (
                block.get(f"{entity}_id")
                or block.get("id")
            )
            if entity_id:
                name_ids.add(int(entity_id))
    name_map = esi_client.resolve_names(name_ids)

    seen_system_ids: list[int] = []
    for entry in sov_systems:
        system_id = entry.get("solar_system_id") or entry.get("system_id")
        if not system_id:
            continue
        seen_system_ids.append(int(system_id))
        claim = entry.get("claim") or {}
        alliance = (claim.get("alliance") or {})
        corporation = (claim.get("corporation") or {})
        faction = (claim.get("faction") or {})
        alliance_id = alliance.get("alliance_id") or alliance.get("id")
        corp_id = corporation.get("corporation_id") or corporation.get("id")
        faction_id = faction.get("faction_id") or faction.get("id")
        adm = entry.get("activity_defense_multiplier") or claim.get(
            "activity_defense_multiplier"
        )
        adm_breakdown = entry.get("activity_defense_breakdown") or claim.get(
            "activity_defense_breakdown"
        )
        vuln = entry.get("vulnerability_window") or claim.get("vulnerability_window") or {}

        # Defensively dedupe legacy rows from a previous schema.
        existing_rows = list(
            models.SovStructure.objects.filter(solar_system_id=int(system_id))
        )
        if len(existing_rows) > 1:
            # Keep the one with a positive (real) structure_id if any,
            # else the first; delete the rest.
            keep = next(
                (r for r in existing_rows if (r.structure_id or 0) > 0),
                existing_rows[0],
            )
            for r in existing_rows:
                if r.pk != keep.pk:
                    r.delete()
            existing_rows = [keep]

        existing = existing_rows[0] if existing_rows else None

        # Preserve a real positive structure_id if it's already been
        # attached by refresh_corp_sov_hubs; otherwise use a synthetic
        # negative one keyed on system_id.
        structure_id_value = (
            existing.structure_id
            if existing and (existing.structure_id or 0) > 0
            else -int(system_id)
        )
        update_fields = {
            "structure_id": structure_id_value,
            "structure_type_id": existing.structure_type_id if existing else 0,
            "structure_type_name": existing.structure_type_name
            if existing and existing.structure_type_name
            else "Sov Hub",
            "solar_system_name": name_map.get(int(system_id), "") or (
                existing.solar_system_name if existing else ""
            ),
            "alliance_id": alliance_id,
            "corporation_id": corp_id or faction_id or (
                existing.corporation_id if existing else None
            ),
            "vulnerable_start_time": _parse_dt(vuln.get("start")),
            "vulnerable_end_time": _parse_dt(vuln.get("end")),
            "activity_defense_multiplier": adm,
            "activity_defense_breakdown": adm_breakdown or {},
            "is_raidable": False,  # raidable feed is per-skyhook, set below
            "raidable_until": None,
            "last_seen_at": timezone.now(),
        }
        if existing:
            for k, v in update_fields.items():
                setattr(existing, k, v)
            existing.save()
        else:
            models.SovStructure.objects.create(
                solar_system_id=int(system_id), **update_fields
            )
    # Cross-reference raidable feed (keyed on structure_id) onto the
    # rows we just upserted. The corp refresh will later fill in the
    # real structure_id for hubs we own; for systems we don't own this
    # stays synthetic.
    if raidable:
        for sid_int in raidable.keys():
            models.SovStructure.objects.filter(structure_id=sid_int).update(
                is_raidable=True,
                raidable_until=_parse_dt(raidable[sid_int].get("raidable_until")),
            )

    # Prune systems no longer in the listing.
    if seen_system_ids:
        # Don't delete rows that hold a *real* (positive) structure_id —
        # those were attached by refresh_corp_sov_hubs and are still
        # valid even when the public claim listing churns.
        stale = (
            models.SovStructure.objects.filter(structure_id__lt=0)
            .exclude(solar_system_id__in=seen_system_ids)
        )
        deleted = stale.count()
        if deleted:
            stale.delete()
            print(f"[sovtool] Pruned {deleted} stale SovStructure rows.")
    return len(seen_system_ids)


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

    # Scope to structures the registered tokens actually have access to:
    # the corp's own upwell structures + the corp's own sov hubs.
    # Public sov rows (synthetic structure_id < 0) don't grant ACL
    # visibility — iterating them would burn thousands of fruitless
    # ESI calls.
    structure_ids: Iterable[int] = list(
        models.CorpStructure.objects.values_list("structure_id", flat=True)
    ) + list(
        models.SovStructure.objects.filter(structure_id__gt=0).values_list(
            "structure_id", flat=True
        )
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
    # stale hub_detail on rows that are no longer corp-owned. Scoped per
    # corp (not a single global set) so one corp's ESI failure can't wipe
    # hub_detail belonging to a different, successfully-refreshed corp.
    refreshed_ids: set[int] = set()
    succeeded_corp_ids: set[int] = set()
    owned_hub_ids_by_corp: dict[int, set[int]] = {}
    for record in models.CorpToken.objects.filter(is_enabled=True):
        if not record.esi_token:
            continue
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
            # Fetch failed — skip this corp entirely this run. Its cached
            # hub_detail is left untouched (no wipe) since we never mark
            # it as succeeded below.
            continue
        succeeded_corp_ids.add(record.corporation_id)
        for entry in hub_list:
            # CCP's sov-hub LIST uses 'id'; older candidate paths used
            # 'structure_id'. Accept either.
            sid = entry.get("id") or entry.get("structure_id")
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
        # Record ownership (possibly empty) now that the list fetch
        # succeeded, so the per-corp prune below runs correctly even for
        # a corp that legitimately owns zero hubs this run.
        owned_hub_ids_by_corp[record.corporation_id] = set(owned_ids)
        if not owned_ids:
            continue
        # Sync corp-owned hub rows: when refresh_sovereignty_structures
        # has run, there's already a row per system keyed on
        # solar_system_id (with a synthetic negative structure_id). We
        # upgrade those in place — overwriting structure_id with the
        # real one and tagging the corp. If there's no row yet, create.
        for entry in hub_list:
            real_sid = int(entry.get("id") or entry.get("structure_id") or 0)
            system_id = int(entry.get("solar_system_id") or 0)
            if not real_sid or not system_id:
                continue
            row = models.SovStructure.objects.filter(
                solar_system_id=system_id
            ).first()
            if row:
                if row.structure_id != real_sid:
                    row.structure_id = real_sid
                row.corporation_id = record.corporation_id
                row.save(update_fields=["structure_id", "corporation_id"])
            else:
                models.SovStructure.objects.create(
                    structure_id=real_sid,
                    structure_type_id=0,
                    solar_system_id=system_id,
                    corporation_id=record.corporation_id,
                )
        hubs = list(models.SovStructure.objects.filter(structure_id__in=owned_ids))
        print(f"[sovtool] {record.corporation_name}: fetching detail for {len(hubs)} hubs…")
        import time as _t
        loop_start = _t.monotonic()
        for idx, hub in enumerate(hubs, 1):
            t0 = _t.monotonic()
            try:
                detail = esi_client.fetch_corp_sov_hub_detail(
                    record.esi_token, record.corporation_id, hub.structure_id
                )
            except Exception as exc:
                print(f"[sovtool]   {idx}/{len(hubs)} hub={hub.structure_id} FAILED ({exc})")
                continue
            took = _t.monotonic() - t0
            if not detail:
                print(f"[sovtool]   {idx}/{len(hubs)} hub={hub.structure_id} empty ({took:.2f}s)")
                continue
            refreshed_ids.add(hub.structure_id)
            hub.hub_detail = detail
            if idx == 1 or idx % 10 == 0:
                print(
                    f"[sovtool]   {idx}/{len(hubs)} hub={hub.structure_id} ok ({took:.2f}s, "
                    f"keys={len(detail)})"
                )
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
    # hub_detail but is no longer corp-owned gets its hub_detail cleared
    # — but only per corp whose hub-list fetch actually succeeded this
    # run. A corp whose ESI call failed is skipped entirely above (see
    # the `continue` in the except block), so its hubs never appear here
    # and its cached hub_detail survives untouched.
    if succeeded_corp_ids:
        cleared = 0
        for corp_id in succeeded_corp_ids:
            owned = owned_hub_ids_by_corp.get(corp_id, set())
            cleared += (
                models.SovStructure.objects.filter(corporation_id=corp_id)
                .exclude(structure_id__in=owned)
                .exclude(hub_detail={})
                .update(hub_detail={})
            )
        if cleared:
            print(f"[sovtool] Cleared stale hub_detail on {cleared} rows.")

    # Resolve names for any upgrade type_ids the catalog doesn't know
    # about yet. Equinox keeps adding new upgrade types and our
    # bundled upgrades.json only covered the launch set, so the cards
    # show 'Type 88227' for anything new. Pulling via /universe/names/
    # gets us the in-game name without needing an updated bundled
    # catalog. Power/workforce costs stay 0 until manually filled.
    _resolve_unknown_upgrade_names()

    return updated


def _resolve_unknown_upgrade_names() -> None:
    seen_type_ids: set[int] = set()
    for row in models.SovStructure.objects.exclude(hub_detail={}):
        for upg in (row.hub_detail.get("upgrades") or []):
            tid = upg.get("type_id")
            if tid:
                seen_type_ids.add(int(tid))
    if not seen_type_ids:
        return
    known = set(
        models.Upgrade.objects.filter(type_id__in=seen_type_ids).values_list(
            "type_id", flat=True
        )
    )
    missing = list(seen_type_ids - known)
    if not missing:
        return
    print(f"[sovtool] Resolving {len(missing)} unknown upgrade type_ids via ESI…")
    name_map = esi_client.resolve_names(missing)
    for type_id in missing:
        models.Upgrade.objects.update_or_create(
            type_id=int(type_id),
            defaults={"upgrade_name": name_map.get(int(type_id), f"Type {type_id}")},
        )


@shared_task(name="aasovtool.refresh_all")
def refresh_all() -> dict:
    """Convenience task that runs all refreshes sequentially."""
    return {
        "sov_structures": refresh_sovereignty_structures(),
        "corp_structures": refresh_corp_structures(),
        "corp_sov_hubs": refresh_corp_sov_hubs(),
        "access_lists": refresh_access_lists(),
    }
