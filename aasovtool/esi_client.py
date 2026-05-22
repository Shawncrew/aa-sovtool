"""Thin wrappers around django-esi for the endpoints we need.

We use the raw HTTP client rather than the swagger-generated bindings so we
can hit Equinox endpoints (``/sovereignty/systems/``, structure access
lists, raidable skyhooks) even if they aren't yet in the bundled swagger
spec shipped with django-esi.

Required scopes (all granted to the registered CorpToken):
  - publicData
  - esi-corporations.read_structures.v1
  - esi-universe.read_structures.v1
  - esi-sovereignty.read_structures.v1
"""
from __future__ import annotations

from typing import Any, Iterable

import requests

ESI_BASE = "https://esi.evetech.net/latest"
USER_AGENT = "aa-sovtool/0.1 (+https://github.com/)"


def _headers(token=None) -> dict[str, str]:
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if token is not None:
        # django-esi's Token has .valid_access_token() which refreshes if needed
        headers["Authorization"] = f"Bearer {token.valid_access_token()}"
    return headers


def _get(path: str, *, token=None, params: dict | None = None) -> Any:
    url = f"{ESI_BASE}{path}"
    response = requests.get(
        url, headers=_headers(token), params=params or {}, timeout=30
    )
    response.raise_for_status()
    return response.json()


# --- Public endpoints -----------------------------------------------------


def fetch_sovereignty_structures() -> list[dict]:
    """GET /sovereignty/structures/ — list of all sov structures (public)."""
    return _get("/sovereignty/structures/")


def fetch_sovereignty_map() -> list[dict]:
    """GET /sovereignty/map/ — system → owner/faction (public)."""
    return _get("/sovereignty/map/")


def fetch_sovereignty_campaigns() -> list[dict]:
    """GET /sovereignty/campaigns/ — active campaigns (public)."""
    return _get("/sovereignty/campaigns/")


def fetch_sovereignty_systems() -> list[dict]:
    """GET /sovereignty/systems/ — Equinox combined occupancy + ADM data."""
    return _get("/sovereignty/systems/")


def fetch_raidable_skyhooks() -> list[dict]:
    """Equinox: rolling list of skyhooks that are currently raidable.

    The blog post introduces this endpoint without naming the exact path;
    we try the documented candidates in order.
    """
    for path in (
        "/sovereignty/skyhooks/raidable/",
        "/sovereignty/raidable/",
        "/universe/skyhooks/raidable/",
    ):
        try:
            return _get(path)
        except requests.HTTPError as err:
            if err.response.status_code in (404, 400):
                continue
            raise
    return []


# --- Authenticated endpoints (require CorpToken) --------------------------


def fetch_corp_structures(token, corporation_id: int) -> list[dict]:
    """GET /corporations/{corp_id}/structures/ — corp-owned structures."""
    return _get(
        f"/corporations/{corporation_id}/structures/",
        token=token,
    )


def fetch_structure(token, structure_id: int) -> dict:
    """GET /universe/structures/{structure_id}/ — names + locations."""
    return _get(f"/universe/structures/{structure_id}/", token=token)


def fetch_structure_access_lists(token, structure_id: int) -> list[dict]:
    """Equinox: access lists attached to a structure.

    Tries the candidate endpoints introduced in the Equinox blog post.
    """
    for path in (
        f"/structures/{structure_id}/access_lists/",
        f"/universe/structures/{structure_id}/access_lists/",
    ):
        try:
            return _get(path, token=token)
        except requests.HTTPError as err:
            if err.response.status_code in (404, 400):
                continue
            raise
    return []


def fetch_access_list_members(token, access_list_id: int) -> list[dict]:
    """Retrieve members of an access list."""
    for path in (
        f"/access_lists/{access_list_id}/members/",
        f"/access_lists/{access_list_id}/",
    ):
        try:
            return _get(path, token=token)
        except requests.HTTPError as err:
            if err.response.status_code in (404, 400):
                continue
            raise
    return []


# --- Resolution helpers ---------------------------------------------------


def resolve_names(ids: Iterable[int]) -> dict[int, str]:
    """POST /universe/names/ — resolve ids to names in batches."""
    ids = [i for i in {int(x) for x in ids if x}]
    out: dict[int, str] = {}
    for chunk_start in range(0, len(ids), 1000):
        chunk = ids[chunk_start : chunk_start + 1000]
        try:
            resp = requests.post(
                f"{ESI_BASE}/universe/names/",
                json=chunk,
                headers=_headers(),
                timeout=30,
            )
            resp.raise_for_status()
        except requests.HTTPError:
            continue
        for row in resp.json():
            out[int(row["id"])] = row.get("name", "")
    return out


def resolve_character_affiliations(token) -> dict:
    """Return {character_id, corporation_id, corporation_name} for a token."""
    char_id = token.character_id
    affil = requests.post(
        f"{ESI_BASE}/characters/affiliation/",
        json=[char_id],
        headers=_headers(),
        timeout=30,
    ).json()
    if not affil:
        return {"character_id": char_id}
    row = affil[0]
    corp_id = row.get("corporation_id")
    name_map = resolve_names([corp_id]) if corp_id else {}
    return {
        "character_id": char_id,
        "corporation_id": corp_id,
        "corporation_name": name_map.get(corp_id, ""),
        "alliance_id": row.get("alliance_id"),
    }
