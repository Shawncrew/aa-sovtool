"""Resolve EVE solar_system_ids for every cached System.

The bundled systems.json catalog had a ``starID`` field that turned
out to be the star's celestial item ID (40M range), not the solar
system ID (30M range) that ESI uses everywhere. This command
backfills the real solar_system_id by POSTing every system name
to ESI's /universe/ids/ resolver in 500-name batches.

Run once after migration 0003. Idempotent — re-running is fine.
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
import requests

from aasovtool import esi_client, models


BATCH = 500


class Command(BaseCommand):
    help = "Resolve solar_system_id for every System via ESI /universe/ids/."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Re-resolve even systems whose solar_system_id is already set.",
        )

    def handle(self, *args, force: bool, **opts):
        qs = models.System.objects.all()
        if not force:
            qs = qs.filter(solar_system_id__isnull=True)

        names = list(qs.values_list("system_name", flat=True))
        if not names:
            self.stdout.write(self.style.SUCCESS("Nothing to resolve."))
            return

        self.stdout.write(f"Resolving {len(names)} system names via ESI…")

        resolved: dict[str, int] = {}
        unresolved: list[str] = []
        for i in range(0, len(names), BATCH):
            chunk = names[i : i + BATCH]
            try:
                resp = requests.post(
                    f"{esi_client.ESI_BASE}/universe/ids/",
                    json=chunk,
                    headers=esi_client._headers(),
                    timeout=30,
                )
                resp.raise_for_status()
            except requests.HTTPError as e:
                self.stderr.write(
                    self.style.ERROR(f"  batch starting at {i}: HTTP {e.response.status_code}")
                )
                continue
            data = resp.json() or {}
            systems_block = data.get("systems") or []
            for entry in systems_block:
                name = entry.get("name")
                sys_id = entry.get("id")
                if name and sys_id:
                    resolved[name] = int(sys_id)
            self.stdout.write(
                f"  batch {i//BATCH + 1}: resolved {len(systems_block)} / {len(chunk)}"
            )

        # Now write back to the DB. Single query per system would be
        # too slow for 5000+ systems; do bulk_update in chunks.
        updates: list[models.System] = []
        for row in qs.only("id", "system_name"):
            sys_id = resolved.get(row.system_name)
            if sys_id is None:
                unresolved.append(row.system_name)
                continue
            row.solar_system_id = sys_id
            updates.append(row)

        if updates:
            models.System.objects.bulk_update(updates, ["solar_system_id"], batch_size=500)

        self.stdout.write(
            self.style.SUCCESS(
                f"Resolved + saved {len(updates)} systems. "
                f"{len(unresolved)} unresolved."
            )
        )
        if unresolved[:10]:
            self.stdout.write(f"First unresolved names: {unresolved[:10]}")
