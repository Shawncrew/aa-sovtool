"""One-off fixup: some catalog entries in upgrades.json were seeded with
made-up type_ids that don't correspond to real EVE items (they 404 on
ESI's icon server). The real type_ids for those same modules were later
auto-discovered via live ESI data (see
tasks._resolve_unknown_upgrade_names) and ended up as separate, 0-stat
duplicate catalog rows under the same display name.

This command:
  1. Rewrites any SystemOverride.upgrades entries using an old fake
     type_id to the corresponding real one.
  2. Deletes the now-unreferenced fake-id catalog rows.

Safe to re-run — a no-op once nothing references the old ids.
"""
from __future__ import annotations

from django.core.management.base import BaseCommand

from aasovtool import models

# old (fake, 404 on ESI) -> new (real, ESI-verified) type_id
ID_REMAP = {
    91001: 87710,  # Workforce Mecha-Tooling 1
    91002: 88228,  # Workforce Mecha-Tooling 2
    91003: 88229,  # Workforce Mecha-Tooling 3
    91004: 87703,  # Power Monitoring Division 1
    91005: 88221,  # Power Monitoring Division 2
    91006: 88227,  # Power Monitoring Division 3
    92001: 87948,  # Exploration Detector 1
    92002: 87953,  # Exploration Detector 2
    92003: 87954,  # Exploration Detector 3
    92012: 87951,  # Exotic Stability Generator
}


class Command(BaseCommand):
    help = "Remap fake placeholder upgrade type_ids to their real ESI-verified ids."

    def handle(self, *args, **opts):
        remapped_overrides = 0
        for row in models.SystemOverride.objects.exclude(upgrades=[]):
            changed = False
            for upgrade in row.upgrades or []:
                type_id = upgrade.get("typeId")
                if type_id in ID_REMAP:
                    upgrade["typeId"] = ID_REMAP[type_id]
                    changed = True
            if changed:
                row.save(update_fields=["upgrades"])
                remapped_overrides += 1

        deleted, _ = models.Upgrade.objects.filter(
            type_id__in=ID_REMAP.keys()
        ).delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"Remapped upgrades on {remapped_overrides} SystemOverride rows; "
                f"deleted {deleted} stale catalog row(s)."
            )
        )
