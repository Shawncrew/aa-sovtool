"""Assign canonical live-map positions to a whole region, placed relative
to a reference region.

The live map reads card positions from System.canonical_x / canonical_y.
Only systems that were in the bundled default.json got seeded positions
(Pure Blind / Fade / Deklein), so regions added later via
AASOVTOOL_ALLOWED_REGIONS (Branch, Venal, Tenal, …) have no canonical
layout and fall back to the client's galactic-coordinate auto-layout.

This command lays a region out in a tidy grid and parks it just above
(or below/left/right of) a reference region's card cluster, writing the
result to canonical_x/y so the live map shows a stable arrangement that
editors can then fine-tune by dragging.

Examples:
    # Put every Branch card in a block above the Deklein cluster.
    python manage.py sovtool_position_region Branch --above Deklein

    # Wider gap, force a specific column count.
    python manage.py sovtool_position_region Branch --above Deklein \
        --gap 600 --columns 12
"""
from __future__ import annotations

import math

from django.core.management.base import BaseCommand, CommandError

from aasovtool import models


# Card + spacing constants mirror frontend/src/layout.ts so the grid
# spacing matches the cards the planner actually renders.
CARD_WIDTH = 210
CARD_HEIGHT = 125
COL_SPACING = CARD_WIDTH + 160  # 370
ROW_SPACING = CARD_HEIGHT + 180  # 305


class Command(BaseCommand):
    help = "Grid-position a region's live-map cards relative to another region."

    def add_arguments(self, parser):
        parser.add_argument(
            "region",
            help="Region to reposition (e.g. Branch). Case-insensitive.",
        )
        ref = parser.add_mutually_exclusive_group(required=True)
        ref.add_argument("--above", metavar="REGION", help="Park above this region.")
        ref.add_argument("--below", metavar="REGION", help="Park below this region.")
        ref.add_argument("--left", metavar="REGION", help="Park left of this region.")
        ref.add_argument("--right", metavar="REGION", help="Park right of this region.")
        parser.add_argument(
            "--gap",
            type=float,
            default=400.0,
            help="Pixel gap between the two clusters (default 400).",
        )
        parser.add_argument(
            "--columns",
            type=int,
            default=0,
            help="Force column count; default fits the reference region's width.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would change without writing.",
        )

    def handle(self, *args, region, above, below, left, right, gap, columns, dry_run, **opts):
        direction = (
            ("above", above)
            if above
            else ("below", below)
            if below
            else ("left", left)
            if left
            else ("right", right)
        )
        side, ref_region = direction

        movers = list(
            models.System.objects.filter(region_name__iexact=region).order_by(
                "constellation_name", "system_name"
            )
        )
        if not movers:
            raise CommandError(f"No systems found in region '{region}'.")

        ref_rows = list(
            models.System.objects.filter(
                region_name__iexact=ref_region,
                canonical_x__isnull=False,
                canonical_y__isnull=False,
            )
        )
        if not ref_rows:
            raise CommandError(
                f"Reference region '{ref_region}' has no positioned cards "
                "(canonical_x/y all null) — nothing to anchor against. "
                "Position it first, or drag a few of its cards on the live map."
            )

        ref_min_x = min(r.canonical_x for r in ref_rows)
        ref_max_x = max(r.canonical_x for r in ref_rows)
        ref_min_y = min(r.canonical_y for r in ref_rows)
        ref_max_y = max(r.canonical_y for r in ref_rows)
        ref_center_x = (ref_min_x + ref_max_x) / 2
        ref_center_y = (ref_min_y + ref_max_y) / 2
        ref_width = ref_max_x - ref_min_x
        ref_height = ref_max_y - ref_min_y

        n = len(movers)
        if columns > 0:
            ncols = columns
        elif side in ("above", "below"):
            # Match the reference cluster's width where possible.
            ncols = max(1, min(n, round(ref_width / COL_SPACING) or 1))
        else:
            # Stacking to the side: keep it roughly square.
            ncols = max(1, math.ceil(math.sqrt(n)))
        nrows = math.ceil(n / ncols)

        block_width = (ncols - 1) * COL_SPACING
        block_height = (nrows - 1) * ROW_SPACING

        if side in ("above", "below"):
            start_x = ref_center_x - block_width / 2
            if side == "above":
                # Grid's bottom row sits `gap` above the reference's top.
                start_y = (ref_min_y - gap) - block_height
            else:
                start_y = ref_max_y + gap
        else:
            start_y = ref_center_y - block_height / 2
            if side == "left":
                start_x = (ref_min_x - gap) - block_width
            else:
                start_x = ref_max_x + gap

        for i, sys in enumerate(movers):
            r, c = divmod(i, ncols)
            sys.canonical_x = start_x + c * COL_SPACING
            sys.canonical_y = start_y + r * ROW_SPACING

        self.stdout.write(
            f"{region}: {n} systems -> {ncols}x{nrows} grid, {side} {ref_region} "
            f"(gap {gap:g}px). x[{start_x:.0f}..{start_x + block_width:.0f}] "
            f"y[{start_y:.0f}..{start_y + block_height:.0f}]. "
            f"Ref {ref_region}: x[{ref_min_x:.0f}..{ref_max_x:.0f}] "
            f"y[{ref_min_y:.0f}..{ref_max_y:.0f}]."
        )

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry run — no changes written."))
            return

        models.System.objects.bulk_update(movers, ["canonical_x", "canonical_y"])
        self.stdout.write(self.style.SUCCESS(f"Updated {n} {region} cards."))
