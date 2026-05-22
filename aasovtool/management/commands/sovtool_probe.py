"""Probe every candidate ESI path/base for the Equinox sov-hub
endpoints and print the HTTP status of each. Use when the discovery
logic in esi_client.py can't find the working endpoint on its own.

Usage:
    python manage.py sovtool_probe
    python manage.py sovtool_probe --structure-id <id>
"""
from django.core.management.base import BaseCommand
import requests

from aasovtool import esi_client, models


class Command(BaseCommand):
    help = "Probe every candidate Equinox sov-hub endpoint and print HTTP status."

    def add_arguments(self, parser):
        parser.add_argument(
            "--structure-id",
            type=int,
            default=None,
            help="Optional structure_id to probe the DETAIL endpoint with.",
        )

    def handle(self, *args, structure_id, **opts):
        token_row = models.CorpToken.objects.filter(is_enabled=True).first()
        if not token_row or not token_row.esi_token:
            self.stderr.write(self.style.ERROR("No enabled CorpToken with an ESI token."))
            return

        token = token_row.esi_token
        corp_id = token_row.corporation_id
        self.stdout.write(self.style.MIGRATE_HEADING(
            f"Probing as {token_row.character_name} for corp "
            f"{token_row.corporation_name} ({corp_id})"
        ))

        bases = (esi_client.ESI_BASE,) + esi_client.ESI_FALLBACK_BASES

        self.stdout.write(self.style.MIGRATE_LABEL("\nLIST candidates:"))
        for base in bases:
            for template in esi_client.HUB_LIST_CANDIDATES:
                path = template.format(corp=corp_id)
                url = f"{base}{path}"
                resp = self._do_get(url, token)
                self._report(url, resp)

        if structure_id:
            self.stdout.write(self.style.MIGRATE_LABEL(
                f"\nDETAIL candidates (structure_id={structure_id}):"
            ))
            for base in bases:
                for template in esi_client.HUB_DETAIL_CANDIDATES:
                    path = template.format(corp=corp_id, sid=structure_id)
                    url = f"{base}{path}"
                    resp = self._do_get(url, token)
                    self._report(url, resp)
        else:
            self.stdout.write(
                "\n(No --structure-id given; skipping DETAIL probes.)"
            )

    def _do_get(self, url: str, token) -> requests.Response | None:
        try:
            return requests.get(
                url, headers=esi_client._headers(token), params={"page": 1}, timeout=15
            )
        except Exception as e:
            self.stdout.write(self.style.ERROR(f"  {url}\n    -> exception: {e}"))
            return None

    def _report(self, url: str, resp: requests.Response | None) -> None:
        if resp is None:
            return
        style = self.style.SUCCESS if resp.status_code == 200 else self.style.WARNING
        line = f"  {resp.status_code}  {url}"
        if resp.status_code == 200:
            try:
                body = resp.json()
                if isinstance(body, list):
                    line += f"  -> list[{len(body)}]"
                    if body:
                        line += f"  keys={sorted(body[0].keys()) if isinstance(body[0], dict) else type(body[0]).__name__}"
                elif isinstance(body, dict):
                    line += f"  -> dict keys={sorted(body.keys())}"
            except Exception:
                line += "  -> (non-JSON body)"
        elif resp.status_code in (400, 403, 420):
            try:
                line += f"  -> {resp.json()}"
            except Exception:
                pass
        self.stdout.write(style(line))
