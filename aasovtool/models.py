"""Django models for the sovereignty planner.

Mirrors the original FastAPI/Pydantic schema:
  - System: catalog of EVE solar systems with sov stats
  - Upgrade: catalog of available Equinox upgrades
  - Scenario: a saved plan (per-system role / upgrade / transfer overrides)
  - SystemOverride: per-system override inside a scenario
  - CorpStructure / SovStructure / AccessList / AccessListMember:
    cached ESI data for visibility into corp-owned sov structures
  - CorpToken: an ESI token registered by an admin for a corp that owns sov structures
"""
from __future__ import annotations

from django.db import models
from django.utils import timezone


class General(models.Model):
    """Container for app-level permissions only (no rows)."""

    class Meta:
        managed = False
        default_permissions = ()
        permissions = (
            ("view_sovtool", "Can view the sovereignty planner"),
            ("edit_sovtool", "Can edit the sovereignty planner"),
            ("manage_sovtool", "Can manage scenarios, users, and ESI tokens"),
        )


# --- Catalog --------------------------------------------------------------


class System(models.Model):
    system_name = models.CharField(max_length=64, unique=True, db_index=True)
    star_id = models.BigIntegerField(null=True, blank=True)
    # EVE's solar_system_id (30000000-31000000 range). This is the key
    # ESI uses for sovereignty/structure lookups. Populated by the
    # sovtool_backfill_system_ids management command via the
    # POST /universe/ids/ name-resolution endpoint.
    solar_system_id = models.IntegerField(null=True, blank=True, db_index=True)
    region_name = models.CharField(max_length=64, db_index=True)
    constellation_name = models.CharField(max_length=64, null=True, blank=True)
    security = models.FloatField(default=0.0)
    star_type = models.CharField(max_length=64, default="")
    star_power = models.IntegerField(default=0)
    planet_power = models.IntegerField(default=0)
    workforce = models.IntegerField(default=0)
    total_power = models.IntegerField(default=0)
    coord_x = models.FloatField(default=0.0)
    coord_y = models.FloatField(default=0.0)
    coord_z = models.FloatField(default=0.0)
    faction_id = models.IntegerField(null=True, blank=True)
    base_superionic_ice_per_hour = models.IntegerField(default=0)
    base_magmatic_gas_per_hour = models.IntegerField(default=0)
    # adjacency by system name (matches original JSON shape)
    neighbors = models.JSONField(default=list, blank=True)
    # Canonical card position used by the live map. Seeded from the
    # bundled default.json; admins can edit via the Django admin or a
    # one-shot management command. User maps override via SystemOverride.
    canonical_x = models.FloatField(null=True, blank=True)
    canonical_y = models.FloatField(null=True, blank=True)

    class Meta:
        ordering = ("system_name",)

    def __str__(self) -> str:
        return self.system_name


class Upgrade(models.Model):
    type_id = models.IntegerField(unique=True, db_index=True)
    upgrade_name = models.CharField(max_length=128)
    power = models.IntegerField(default=0)
    workforce = models.IntegerField(default=0)
    superionic_ice_per_hour = models.IntegerField(default=0)
    magmatic_gas_per_hour = models.IntegerField(default=0)

    class Meta:
        ordering = ("upgrade_name",)

    def __str__(self) -> str:
        return self.upgrade_name


# --- Scenarios ------------------------------------------------------------


class Scenario(models.Model):
    """A user-created planning map (or the special live map).

    The live map (``is_live=True``, exactly one row) renders straight
    ESI hub-detail data and is uneditable. User-created maps copy
    overrides from a base (live or another user map) and are saved
    incrementally as the user edits the planner.
    """

    name = models.CharField(max_length=128, unique=True)
    description = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)
    is_default = models.BooleanField(default=False)
    # The Live Map row, auto-managed. Exactly one Scenario should
    # carry this flag.
    is_live = models.BooleanField(default=False)
    # Who created this map. NULL on the auto-managed live map.
    creator = models.ForeignKey(
        "auth.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sovtool_maps",
    )
    # Name of the map this one was branched from. NULL means branched
    # from the live map. Kept as a string rather than a hard FK so a
    # deleted parent doesn't cascade-wipe its descendants.
    based_on_name = models.CharField(max_length=128, null=True, blank=True)

    class Meta:
        ordering = ("-updated_at",)

    def __str__(self) -> str:
        return self.name


class SystemOverride(models.Model):
    """Per-system override applied on top of the catalog for a scenario."""

    ROLE_EXPORT = "export"
    ROLE_IMPORT = "import"
    ROLE_TRANSIT = "transit"
    ROLE_CHOICES = (
        (ROLE_EXPORT, "Export"),
        (ROLE_IMPORT, "Import"),
        (ROLE_TRANSIT, "Transit"),
    )

    scenario = models.ForeignKey(
        Scenario, on_delete=models.CASCADE, related_name="overrides"
    )
    system_name = models.CharField(max_length=64, db_index=True)
    role = models.CharField(
        max_length=16, choices=ROLE_CHOICES, null=True, blank=True
    )
    # JSON fields mirror the original payload format used by the React frontend
    upgrades = models.JSONField(default=list, blank=True)
    transfers = models.JSONField(default=list, blank=True)
    position = models.JSONField(null=True, blank=True)
    ansiblex_partner = models.CharField(max_length=64, null=True, blank=True)

    class Meta:
        unique_together = (("scenario", "system_name"),)

    def is_empty(self) -> bool:
        return (
            self.role is None
            and not self.upgrades
            and not self.transfers
            and self.position is None
            and not self.ansiblex_partner
        )


# --- Region permissions ---------------------------------------------------


class EditableRegion(models.Model):
    """Grants a user the ability to edit a specific region.

    Used in conjunction with the ``edit_sovtool`` Django permission to scope
    edits to one or more regions. Admins (``manage_sovtool``) bypass region
    checks.
    """

    user = models.ForeignKey(
        "auth.User", on_delete=models.CASCADE, related_name="sovtool_regions"
    )
    region_name = models.CharField(max_length=64)

    class Meta:
        unique_together = (("user", "region_name"),)

    def __str__(self) -> str:
        return f"{self.user.username}:{self.region_name}"


# --- ESI / Live data ------------------------------------------------------


class CorpToken(models.Model):
    """An ESI token registered by an admin for a corporation that owns sov.

    The actual OAuth refresh token lives in django-esi's ``esi.Token`` table;
    this row tracks which token to use for which corp and what scopes it
    carries.
    """

    corporation_id = models.IntegerField(unique=True)
    corporation_name = models.CharField(max_length=128)
    character_id = models.IntegerField()
    character_name = models.CharField(max_length=128)
    esi_token = models.ForeignKey(
        "esi.Token",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    added_by = models.ForeignKey(
        "auth.User", on_delete=models.SET_NULL, null=True, blank=True
    )
    added_at = models.DateTimeField(default=timezone.now)
    last_used_at = models.DateTimeField(null=True, blank=True)
    is_enabled = models.BooleanField(default=True)

    def __str__(self) -> str:
        return f"{self.corporation_name} ({self.character_name})"


class SovStructure(models.Model):
    """A sovereignty structure (hub / TCU / skyhook) as reported by ESI.

    Sourced primarily from GET /sovereignty/structures/ (public) and
    GET /sovereignty/systems/ (Equinox endpoint adding activity defense
    multiplier breakdowns).
    """

    structure_id = models.BigIntegerField(unique=True)
    structure_type_id = models.IntegerField()
    structure_type_name = models.CharField(max_length=128, blank=True)
    solar_system_id = models.IntegerField(db_index=True)
    solar_system_name = models.CharField(max_length=64, blank=True)
    alliance_id = models.IntegerField(null=True, blank=True)
    corporation_id = models.IntegerField(null=True, blank=True)
    vulnerability_occupancy_level = models.FloatField(null=True, blank=True)
    vulnerable_start_time = models.DateTimeField(null=True, blank=True)
    vulnerable_end_time = models.DateTimeField(null=True, blank=True)
    # Equinox: ADM breakdown + raidable skyhook flag
    activity_defense_multiplier = models.FloatField(null=True, blank=True)
    activity_defense_breakdown = models.JSONField(default=dict, blank=True)
    is_raidable = models.BooleanField(default=False)
    raidable_until = models.DateTimeField(null=True, blank=True)
    # Live state from /corporations/{corp_id}/structures/sovereignty_hubs/{id}/
    # — installed upgrades, workforce/power consumption, resource yields,
    # ansiblex links. Populated when a CorpToken with corp roles is registered.
    hub_detail = models.JSONField(default=dict, blank=True)
    last_seen_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return f"{self.structure_type_name} @ {self.solar_system_name}"


class CorpStructure(models.Model):
    """A corp-owned structure from GET /corporations/{corp_id}/structures/.

    Requires scope ``esi-corporations.read_structures.v1`` on a CorpToken.
    """

    structure_id = models.BigIntegerField(unique=True)
    corporation_id = models.IntegerField(db_index=True)
    type_id = models.IntegerField()
    type_name = models.CharField(max_length=128, blank=True)
    system_id = models.IntegerField()
    system_name = models.CharField(max_length=64, blank=True)
    profile_id = models.IntegerField(null=True, blank=True)
    state = models.CharField(max_length=64, blank=True)
    state_timer_start = models.DateTimeField(null=True, blank=True)
    state_timer_end = models.DateTimeField(null=True, blank=True)
    fuel_expires = models.DateTimeField(null=True, blank=True)
    unanchors_at = models.DateTimeField(null=True, blank=True)
    services = models.JSONField(default=list, blank=True)
    last_seen_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return f"{self.type_name} ({self.structure_id})"


class AccessList(models.Model):
    """Access list bound to a structure.

    Equinox introduced per-structure access lists; we cache the list
    metadata here and each member in :class:`AccessListMember`.
    """

    access_list_id = models.BigIntegerField(unique=True)
    structure_id = models.BigIntegerField(db_index=True)
    name = models.CharField(max_length=128, blank=True)
    description = models.TextField(blank=True)
    owner_id = models.IntegerField(null=True, blank=True)
    last_seen_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return self.name or str(self.access_list_id)


class AccessListMember(models.Model):
    ENTITY_CHARACTER = "character"
    ENTITY_CORPORATION = "corporation"
    ENTITY_ALLIANCE = "alliance"
    ENTITY_CHOICES = (
        (ENTITY_CHARACTER, "Character"),
        (ENTITY_CORPORATION, "Corporation"),
        (ENTITY_ALLIANCE, "Alliance"),
    )

    access_list = models.ForeignKey(
        AccessList, on_delete=models.CASCADE, related_name="members"
    )
    entity_id = models.IntegerField()
    entity_type = models.CharField(max_length=16, choices=ENTITY_CHOICES)
    entity_name = models.CharField(max_length=128, blank=True)
    is_blocked = models.BooleanField(default=False)

    class Meta:
        unique_together = (("access_list", "entity_id", "entity_type"),)


class AuditEntry(models.Model):
    """Records edits to scenarios for the change-history UI."""

    scenario = models.ForeignKey(
        Scenario, on_delete=models.CASCADE, related_name="audit_entries"
    )
    user = models.ForeignKey(
        "auth.User", on_delete=models.SET_NULL, null=True, blank=True
    )
    username = models.CharField(max_length=64)
    timestamp = models.DateTimeField(default=timezone.now)
    message = models.TextField()

    class Meta:
        ordering = ("-timestamp",)
