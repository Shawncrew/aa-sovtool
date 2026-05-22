"""Diagnose what ESI is returning for the registered corp tokens.

Use this when the structure count from /corporations/{id}/structures/
doesn't match the number you expect to own in-game.
"""
from django.core.management.base import BaseCommand
import requests

from aasovtool import esi_client, models


class Command(BaseCommand):
    help = "Print raw ESI response counts + pagination info for each CorpToken."

    def handle(self, *args, **opts):
        tokens = list(models.CorpToken.objects.filter(is_enabled=True))
        if not tokens:
            self.stdout.write(self.style.WARNING("No enabled CorpTokens registered."))
            return

        for record in tokens:
            self.stdout.write(self.style.MIGRATE_HEADING(
                f"\nCorp: {record.corporation_name} ({record.corporation_id}) "
                f"— authed as {record.character_name}"
            ))
            if not record.esi_token:
                self.stdout.write(self.style.ERROR("  No ESI token attached."))
                continue

            url = f"{esi_client.ESI_BASE}/corporations/{record.corporation_id}/structures/"
            try:
                resp = requests.get(
                    url,
                    headers=esi_client._headers(record.esi_token),
                    params={"page": 1},
                    timeout=30,
                )
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"  Request failed: {e}"))
                continue

            self.stdout.write(f"  HTTP {resp.status_code}")
            self.stdout.write(f"  X-Pages: {resp.headers.get('X-Pages', '(missing)')}")
            self.stdout.write(f"  Content-Length: {resp.headers.get('Content-Length', '(unknown)')}")

            if resp.status_code != 200:
                snippet = resp.text[:500]
                self.stdout.write(self.style.ERROR(f"  Body: {snippet}"))
                continue

            try:
                page1 = resp.json()
            except ValueError:
                self.stdout.write(self.style.ERROR("  Body was not JSON."))
                continue

            self.stdout.write(f"  Items on page 1: {len(page1)}")

            # Roll up all pages
            all_items = esi_client.fetch_corp_structures(
                record.esi_token, record.corporation_id
            )
            self.stdout.write(f"  Total across all pages: {len(all_items)}")

            type_counts: dict[int, int] = {}
            for entry in all_items:
                tid = entry.get("type_id", 0)
                type_counts[tid] = type_counts.get(tid, 0) + 1
            for tid, count in sorted(
                type_counts.items(), key=lambda kv: -kv[1]
            )[:10]:
                self.stdout.write(f"    type_id={tid}: {count}")

            self.stdout.write(
                f"  In aasovtool DB (CorpStructure rows): "
                f"{models.CorpStructure.objects.filter(corporation_id=record.corporation_id).count()}"
            )
            self.stdout.write(
                f"  SovStructure rows whose structure_id matches this corp's listing: "
                f"{models.SovStructure.objects.filter(structure_id__in=[i.get('structure_id') for i in all_items]).count()}"
            )

            # Try the Equinox sov-hub listing endpoint.
            self.stdout.write("")
            self.stdout.write(self.style.MIGRATE_LABEL(
                "  Sov-hub listing endpoint (Equinox):"
            ))
            try:
                hubs = esi_client.fetch_corp_sov_hubs_list(
                    record.esi_token, record.corporation_id
                )
            except Exception as e:
                self.stdout.write(self.style.ERROR(f"    Request failed: {e}"))
                continue
            self.stdout.write(
                f"    Discovered path: {esi_client._HUB_LIST_PATH_TEMPLATE or '(none — all candidates 404)'}"
            )
            self.stdout.write(f"    Sov hubs returned: {len(hubs)}")
            if hubs:
                sample = hubs[0]
                self.stdout.write(f"    Sample entry keys: {sorted(sample.keys())}")
