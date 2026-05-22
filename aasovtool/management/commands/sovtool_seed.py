"""Seed the System / Upgrade catalog from the bundled Equinox dataset.

Usage:
    python manage.py sovtool_seed                # uses bundled JSON
    python manage.py sovtool_seed --data /path   # uses a custom JSON dir
"""
from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from aasovtool import models
from aasovtool.permissions import ensure_default_groups


BUNDLED_DATA = Path(__file__).resolve().parent.parent.parent / "data"


class Command(BaseCommand):
    help = "Seed sovtool catalogs (systems / upgrades / connections) from JSON."

    def add_arguments(self, parser):
        parser.add_argument(
            "--data",
            type=Path,
            default=BUNDLED_DATA,
            help="Directory containing systems.json, upgrades.json, connections.json.",
        )
        parser.add_argument(
            "--flush",
            action="store_true",
            help="Delete existing catalog rows before seeding.",
        )

    def handle(self, *args, data: Path, flush: bool, **opts):
        if not data.exists():
            self.stderr.write(self.style.ERROR(f"Data directory not found: {data}"))
            return

        systems_path = data / "systems.json"
        upgrades_path = data / "upgrades.json"
        connections_path = data / "connections.json"

        with transaction.atomic():
            if flush:
                models.System.objects.all().delete()
                models.Upgrade.objects.all().delete()

            self._seed_systems(systems_path, connections_path)
            self._seed_upgrades(upgrades_path)

        ensure_default_groups()
        self.stdout.write(self.style.SUCCESS("Seed complete."))

    def _seed_systems(self, systems_path: Path, connections_path: Path):
        if not systems_path.exists():
            self.stderr.write(self.style.WARNING(f"Missing {systems_path}, skipping."))
            return

        with systems_path.open("r", encoding="utf-8") as fh:
            systems = json.load(fh)

        neighbors = {}
        if connections_path.exists():
            with connections_path.open("r", encoding="utf-8") as fh:
                for entry in json.load(fh):
                    neighbors[entry["systemName"]] = entry.get("neighbors", [])

        created = 0
        updated = 0
        for entry in systems:
            obj, was_created = models.System.objects.update_or_create(
                system_name=entry["systemName"],
                defaults={
                    "star_id": entry.get("starID"),
                    "region_name": entry.get("regionName", ""),
                    "constellation_name": entry.get("constellationName"),
                    "security": entry.get("security", 0.0) or 0.0,
                    "star_type": entry.get("starType", ""),
                    "star_power": entry.get("starPower", 0) or 0,
                    "planet_power": entry.get("planetPower", 0) or 0,
                    "workforce": entry.get("workforce", 0) or 0,
                    "total_power": entry.get("totalPower", 0) or 0,
                    "coord_x": entry.get("coordX", 0.0) or 0.0,
                    "coord_y": entry.get("coordY", 0.0) or 0.0,
                    "coord_z": entry.get("coordZ", 0.0) or 0.0,
                    "faction_id": entry.get("factionId"),
                    "base_superionic_ice_per_hour": entry.get(
                        "baseSuperionicIcePerHour", 0
                    )
                    or 0,
                    "base_magmatic_gas_per_hour": entry.get(
                        "baseMagmaticGasPerHour", 0
                    )
                    or 0,
                    "neighbors": neighbors.get(entry["systemName"], []),
                },
            )
            if was_created:
                created += 1
            else:
                updated += 1
        self.stdout.write(
            f"Systems: {created} created, {updated} updated (neighbors for "
            f"{len(neighbors)} systems)."
        )

    def _seed_upgrades(self, upgrades_path: Path):
        if not upgrades_path.exists():
            self.stderr.write(self.style.WARNING(f"Missing {upgrades_path}, skipping."))
            return
        with upgrades_path.open("r", encoding="utf-8") as fh:
            upgrades = json.load(fh)
        created = 0
        updated = 0
        for entry in upgrades:
            _, was_created = models.Upgrade.objects.update_or_create(
                type_id=entry["typeID"],
                defaults={
                    "upgrade_name": entry["upgradeName"],
                    "power": entry.get("power", 0) or 0,
                    "workforce": entry.get("workforce", 0) or 0,
                    "superionic_ice_per_hour": entry.get("superionicIcePerHour", 0) or 0,
                    "magmatic_gas_per_hour": entry.get("magmaticGasPerHour", 0) or 0,
                },
            )
            created += int(was_created)
            updated += int(not was_created)
        self.stdout.write(f"Upgrades: {created} created, {updated} updated.")
