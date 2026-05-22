from django.contrib import admin

from . import models


@admin.register(models.System)
class SystemAdmin(admin.ModelAdmin):
    list_display = ("system_name", "region_name", "constellation_name", "security")
    search_fields = ("system_name", "region_name", "constellation_name")
    list_filter = ("region_name",)


@admin.register(models.Upgrade)
class UpgradeAdmin(admin.ModelAdmin):
    list_display = ("upgrade_name", "type_id", "power", "workforce")
    search_fields = ("upgrade_name",)


@admin.register(models.Scenario)
class ScenarioAdmin(admin.ModelAdmin):
    list_display = ("name", "updated_at", "is_default")
    search_fields = ("name",)


@admin.register(models.SystemOverride)
class SystemOverrideAdmin(admin.ModelAdmin):
    list_display = ("scenario", "system_name", "role")
    search_fields = ("system_name",)
    list_filter = ("role",)


@admin.register(models.EditableRegion)
class EditableRegionAdmin(admin.ModelAdmin):
    list_display = ("user", "region_name")
    search_fields = ("user__username", "region_name")


@admin.register(models.CorpToken)
class CorpTokenAdmin(admin.ModelAdmin):
    list_display = (
        "corporation_name",
        "corporation_id",
        "character_name",
        "is_enabled",
        "added_at",
        "last_used_at",
    )
    search_fields = ("corporation_name", "character_name")
    list_filter = ("is_enabled",)


@admin.register(models.SovStructure)
class SovStructureAdmin(admin.ModelAdmin):
    list_display = (
        "structure_id",
        "structure_type_name",
        "solar_system_name",
        "alliance_id",
        "is_raidable",
    )
    search_fields = ("solar_system_name", "structure_type_name")
    list_filter = ("is_raidable", "structure_type_name")


@admin.register(models.CorpStructure)
class CorpStructureAdmin(admin.ModelAdmin):
    list_display = (
        "structure_id",
        "type_name",
        "system_name",
        "state",
        "fuel_expires",
    )
    search_fields = ("system_name", "type_name")
    list_filter = ("state",)


@admin.register(models.AccessList)
class AccessListAdmin(admin.ModelAdmin):
    list_display = ("name", "structure_id", "owner_id", "last_seen_at")
    search_fields = ("name",)


@admin.register(models.AccessListMember)
class AccessListMemberAdmin(admin.ModelAdmin):
    list_display = ("access_list", "entity_type", "entity_name", "is_blocked")
    list_filter = ("entity_type", "is_blocked")


@admin.register(models.AuditEntry)
class AuditEntryAdmin(admin.ModelAdmin):
    list_display = ("timestamp", "scenario", "username", "message")
    search_fields = ("username", "message")
