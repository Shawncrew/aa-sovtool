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

import time

import requests

ESI_BASE = "https://esi.evetech.net/latest"
# Additional bases tried (in order) for Equinox endpoints. CCP serves
# the new sov-hub/access-list endpoints from the bare host without a
# version prefix (confirmed via API explorer):
#   https://esi.evetech.net/corporations/{id}/structures/sovereignty-hubs
ESI_FALLBACK_BASES = (
    "https://esi.evetech.net",
    "https://esi.evetech.net/dev",
    "https://esi.evetech.net/v1",
    "https://esi.evetech.net/v2",
)
USER_AGENT = "aa-sovtool/0.1 (+https://github.com/)"

# Rate-limit awareness. ESI advertises a per-IP error budget via the
# X-ESI-Error-Limit-Remain / X-ESI-Error-Limit-Reset response headers
# and returns HTTP 420 once the budget is exhausted. We honor it by:
#   - stopping ourselves before we burn through (soft-back-off when the
#     remaining budget drops below ERROR_BUDGET_FLOOR)
#   - sleeping for the advertised reset window if we do get a 420
_ERROR_BUDGET_FLOOR = 20
_error_limit_reset_at: float = 0.0


def _record_rate_limit(response: requests.Response) -> None:
    """Inspect ESI rate-limit headers and arm a cooldown ONLY if the
    error budget is actually low or exhausted.

    Previous bug: we set ``_error_limit_reset_at`` on every response,
    which caused subsequent calls to sleep ~60s between *every*
    request. We only care when we're about to trip the limiter.
    """
    global _error_limit_reset_at
    try:
        remain_raw = response.headers.get("X-ESI-Error-Limit-Remain")
        reset_raw = response.headers.get("X-ESI-Error-Limit-Reset")
        if remain_raw is None and reset_raw is None:
            return
        remain = int(remain_raw) if remain_raw is not None else 100
        reset = int(reset_raw) if reset_raw is not None else 0
    except (TypeError, ValueError):
        return
    if response.status_code == 420 or remain <= _ERROR_BUDGET_FLOOR:
        _error_limit_reset_at = time.monotonic() + max(1, reset)
        time.sleep(max(1, reset))


def _maybe_wait_for_budget() -> None:
    """If a previous request armed the cooldown, sleep until the
    advertised reset moment before making the next call.
    """
    if _error_limit_reset_at <= 0:
        return
    delta = _error_limit_reset_at - time.monotonic()
    if delta > 0:
        time.sleep(min(delta, 60))


def _headers(token=None) -> dict[str, str]:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        # CCP's new ESI (Equinox endpoints) pins responses via a
        # compatibility-date header. Without it the host returns 404 for
        # un-versioned paths. Update this when CCP publishes a newer
        # contract date; the value pins the response schema we coded
        # against. Override via the AASOVTOOL_ESI_COMPAT_DATE setting.
        "X-Compatibility-Date": _compat_date(),
    }
    if token is not None:
        # django-esi's Token has .valid_access_token() which refreshes if needed
        headers["Authorization"] = f"Bearer {token.valid_access_token()}"
    return headers


def _compat_date() -> str:
    # CCP pins this to a single allowed value per endpoint contract.
    # As of the Equinox sov-hub listing spec the only accepted value is
    # 2026-05-19. Override via AASOVTOOL_ESI_COMPAT_DATE if CCP rolls
    # a newer contract date.
    try:
        from django.conf import settings as _s
        return getattr(_s, "AASOVTOOL_ESI_COMPAT_DATE", "2026-05-19")
    except Exception:
        return "2026-05-19"


def _get(path: str, *, token=None, params: dict | None = None, base: str | None = None) -> Any:
    _maybe_wait_for_budget()
    url = f"{base or ESI_BASE}{path}"
    response = requests.get(
        url, headers=_headers(token), params=params or {}, timeout=30
    )
    # CCP returns 429 (Too Many Requests) for per-route rate-group
    # exhaustion, distinct from the per-IP error-rate 420. Honor the
    # Retry-After header and retry once instead of bubbling the error
    # up and skipping the row.
    if response.status_code == 429:
        retry_after = response.headers.get("Retry-After")
        try:
            sleep_for = float(retry_after) if retry_after else 60.0
        except ValueError:
            sleep_for = 60.0
        time.sleep(min(sleep_for, 60))
        response = requests.get(
            url, headers=_headers(token), params=params or {}, timeout=30
        )
    _record_rate_limit(response)
    response.raise_for_status()
    return response.json()


def _get_paged(
    path: str, *, token=None, params: dict | None = None, base: str | None = None
) -> list:
    """Walk every ESI page (using the ``X-Pages`` response header) and
    return the concatenated list. ESI uses 1-indexed ``page`` query param.
    """
    _maybe_wait_for_budget()
    url = f"{base or ESI_BASE}{path}"
    base_params = dict(params or {})
    base_params["page"] = 1
    first = requests.get(url, headers=_headers(token), params=base_params, timeout=30)
    _record_rate_limit(first)
    first.raise_for_status()
    payload = first.json()
    if not isinstance(payload, list):
        return payload
    total_pages = int(first.headers.get("X-Pages", "1") or "1")
    out: list = list(payload)
    for page in range(2, total_pages + 1):
        _maybe_wait_for_budget()
        page_params = dict(params or {})
        page_params["page"] = page
        resp = requests.get(
            url, headers=_headers(token), params=page_params, timeout=30
        )
        _record_rate_limit(resp)
        resp.raise_for_status()
        out.extend(resp.json() or [])
    return out


# --- Public endpoints -----------------------------------------------------


def _try_public_paths(*paths: tuple[str, str]) -> Any:
    """Try a sequence of (base, path) pairs until one returns 200.

    CCP retired several legacy /latest/sovereignty/* endpoints when
    Equinox shipped; the replacements live on the bare host with the
    X-Compatibility-Date header. We try the new endpoint first, then
    fall back to /latest/ so older deployments still work.
    """
    last_err: requests.HTTPError | None = None
    for base, path in paths:
        try:
            return _get(path, base=base)
        except requests.HTTPError as err:
            if err.response.status_code == 404:
                last_err = err
                continue
            raise
    if last_err is not None:
        raise last_err
    return []


def _try_public_paths_safe(*paths: tuple[str, str]) -> Any:
    """Like _try_public_paths but swallows 404 across every candidate.

    Returns [] if nothing responded. Public sovereignty endpoints have
    been shuffling around since Equinox; we'd rather log a miss and let
    the rest of the refresh proceed than crash the whole task.
    """
    last_err: requests.HTTPError | None = None
    for base, path in paths:
        try:
            return _get(path, base=base)
        except requests.HTTPError as err:
            if err.response.status_code == 404:
                last_err = err
                continue
            raise
    if last_err is not None:
        print(f"[sovtool] public endpoint not found at any candidate, returning [].")
    return []


def _unwrap_list(payload, keys: tuple[str, ...]) -> list[dict]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in keys:
            inner = payload.get(key)
            if isinstance(inner, list):
                return inner
    return []


def fetch_sovereignty_structures() -> list[dict]:
    """Legacy ESI-wide sov-structures listing.

    CCP retired this endpoint in the Equinox API rollout. The
    replacement is :func:`fetch_sovereignty_systems` which exposes
    per-system claim data (faction/alliance/corp) for all of K-space.
    Kept as a stub returning [] so old callers don't crash.
    """
    return []


def fetch_sovereignty_map() -> list[dict]:
    payload = _try_public_paths_safe(
        ("https://esi.evetech.net", "/sovereignty/map"),
        ("https://esi.evetech.net", "/sovereignty-map"),
        (ESI_BASE, "/sovereignty/map/"),
    )
    return _unwrap_list(payload, ("map", "systems"))


def fetch_sovereignty_campaigns() -> list[dict]:
    payload = _try_public_paths_safe(
        ("https://esi.evetech.net", "/sovereignty/campaigns"),
        ("https://esi.evetech.net", "/sovereignty-campaigns"),
        (ESI_BASE, "/sovereignty/campaigns/"),
    )
    return _unwrap_list(payload, ("campaigns",))


def fetch_sovereignty_systems() -> list[dict]:
    """Equinox per-system sov details (replaces /sovereignty/structures/).

    Confirmed endpoint:
        GET https://esi.evetech.net/sovereignty/systems
        X-Compatibility-Date: 2026-05-19
    No scope required (public). Cached for 5 minutes; rate-limit
    group 'sovereignty', 600 tokens / 15 minutes.

    Response shape:
        {"solar_systems": [
            {"claim": {"faction": {"faction_id": ...} | alliance | corp}, ...}
        ]}
    """
    payload = _try_public_paths_safe(
        ("https://esi.evetech.net", "/sovereignty/systems"),
    )
    return _unwrap_list(payload, ("solar_systems", "systems", "sovereignty_systems"))


_RAIDABLE_PATH: str | None = None


def fetch_raidable_skyhooks() -> list[dict]:
    """Equinox: rolling list of skyhooks that are currently raidable.

    Caches the working path after the first successful probe so we
    don't bleed the error budget on every refresh.
    """
    global _RAIDABLE_PATH
    candidates = (
        "/sovereignty/skyhooks/raidable/",
        "/sovereignty/raidable/",
        "/universe/skyhooks/raidable/",
    )
    if _RAIDABLE_PATH:
        try:
            return _get(_RAIDABLE_PATH)
        except requests.HTTPError as err:
            if err.response.status_code == 404:
                return []
            raise
    for path in candidates:
        try:
            payload = _get(path)
        except requests.HTTPError as err:
            if err.response.status_code in (404, 400):
                continue
            raise
        _RAIDABLE_PATH = path
        return payload
    return []


# --- Authenticated endpoints (require CorpToken) --------------------------


def fetch_corp_structures(token, corporation_id: int) -> list[dict]:
    """GET /corporations/{corp_id}/structures/ — corp-owned structures.

    Paginated: walks every page exposed by the ``X-Pages`` header so we
    don't silently truncate at the first 250 results.
    """
    return _get_paged(
        f"/corporations/{corporation_id}/structures/",
        token=token,
    )


# Cache the path template that actually works once we discover it, so we
# don't keep blasting all candidates and burning the ESI error budget.
_HUB_DETAIL_PATH_TEMPLATE: str | None = None
_HUB_LIST_PATH_TEMPLATE: str | None = None


# Confirmed Equinox endpoint: base is bare https://esi.evetech.net (no
# version prefix) and the path uses dashes, not underscores. We list
# this candidate first so it always wins on the first probe; the older
# guesses remain only as defensive fallbacks if CCP later renames it.
EQUINOX_BASE = "https://esi.evetech.net"
HUB_LIST_CANDIDATES: tuple[str, ...] = (
    "/corporations/{corp}/structures/sovereignty-hubs",
    "/corporations/{corp}/structures/sovereignty_hubs/",
    "/corporations/{corp}/structures/sovereignty/hubs/",
    "/corporations/{corp}/sovereignty-hubs",
    "/corporations/{corp}/sovereignty_hubs/",
)


def _unwrap_hub_list(payload) -> list[dict]:
    """Normalize the sov-hub listing response.

    CCP returns ``{"sovereignty_hubs": [{"id": ..., "solar_system_id": ...}]}``
    on the Equinox endpoint; older candidate paths returned a bare list.
    We accept either shape and emit a uniform list of dicts.
    """
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("sovereignty_hubs", "structures", "items", "data"):
            inner = payload.get(key)
            if isinstance(inner, list):
                return inner
    return []


def fetch_corp_sov_hubs_list(token, corporation_id: int) -> list[dict]:
    """Equinox: list of sov hubs owned by ``corporation_id``.

    Confirmed endpoint:
      GET https://esi.evetech.net/corporations/{id}/structures/sovereignty-hubs
      headers: X-Compatibility-Date: 2026-05-19
      scope:   esi-structures.read_corporation.v1
    Response shape:
      {"sovereignty_hubs": [{"id": <structure_id>, "solar_system_id": <sys_id>}, ...]}
    """
    global _HUB_LIST_PATH_TEMPLATE, _HUB_LIST_BASE
    if _HUB_LIST_PATH_TEMPLATE:
        try:
            return _unwrap_hub_list(
                _get(
                    _HUB_LIST_PATH_TEMPLATE.format(corp=corporation_id),
                    token=token,
                    base=_HUB_LIST_BASE,
                )
            )
        except requests.HTTPError as err:
            if err.response.status_code == 404:
                return []
            raise
    bases = (ESI_BASE,) + ESI_FALLBACK_BASES
    for base in bases:
        for template in HUB_LIST_CANDIDATES:
            try:
                payload = _get(
                    template.format(corp=corporation_id), token=token, base=base
                )
            except requests.HTTPError as err:
                if err.response.status_code in (404, 400):
                    continue
                raise
            _HUB_LIST_PATH_TEMPLATE = template
            _HUB_LIST_BASE = base
            return _unwrap_hub_list(payload)
    return []


_HUB_LIST_BASE: str = ESI_BASE


HUB_DETAIL_CANDIDATES: tuple[str, ...] = (
    # Confirmed-style dash path on the bare host (follows the LIST pattern).
    "/corporations/{corp}/structures/sovereignty-hubs/{sid}",
    "/corporations/{corp}/structures/sovereignty_hubs/{sid}/",
    "/corporations/{corp}/structures/sovereignty/hubs/{sid}/",
    "/corporations/{corp}/structures/{sid}/sovereignty_hub/",
    "/corporations/{corp}/sovereignty-hubs/{sid}",
    "/corporations/{corp}/sovereignty_hubs/{sid}/",
)


def fetch_corp_sov_hub_detail(token, corporation_id: int, structure_id: int) -> dict:
    """Equinox: GetCorporationsStructuresSovereigntyHubsDetail."""
    global _HUB_DETAIL_PATH_TEMPLATE, _HUB_DETAIL_BASE
    if _HUB_DETAIL_PATH_TEMPLATE:
        try:
            return _get(
                _HUB_DETAIL_PATH_TEMPLATE.format(
                    corp=corporation_id, sid=structure_id
                ),
                token=token,
                base=_HUB_DETAIL_BASE,
            )
        except requests.HTTPError as err:
            if err.response.status_code == 404:
                return {}
            raise
    bases = (ESI_BASE,) + ESI_FALLBACK_BASES
    # Prefer the same base that worked for the LIST endpoint (more likely
    # to also work for DETAIL).
    if _HUB_LIST_BASE != ESI_BASE:
        bases = (_HUB_LIST_BASE,) + tuple(b for b in bases if b != _HUB_LIST_BASE)
    for base in bases:
        for template in HUB_DETAIL_CANDIDATES:
            try:
                payload = _get(
                    template.format(corp=corporation_id, sid=structure_id),
                    token=token,
                    base=base,
                )
            except requests.HTTPError as err:
                if err.response.status_code in (404, 400):
                    continue
                raise
            _HUB_DETAIL_PATH_TEMPLATE = template
            _HUB_DETAIL_BASE = base
            return payload
    return {}


_HUB_DETAIL_BASE: str = ESI_BASE


def fetch_structure(token, structure_id: int) -> dict:
    """GET /universe/structures/{structure_id}/ — names + locations."""
    return _get(f"/universe/structures/{structure_id}/", token=token)


_ACCESS_LIST_PATH_TEMPLATE: str | None = None
_ACCESS_LIST_MEMBERS_PATH_TEMPLATE: str | None = None


def fetch_structure_access_lists(token, structure_id: int) -> list[dict]:
    """Equinox: access lists attached to a structure.

    Caches the working path template after the first successful probe.
    """
    global _ACCESS_LIST_PATH_TEMPLATE
    templates = (
        "/structures/{sid}/access_lists/",
        "/universe/structures/{sid}/access_lists/",
    )
    if _ACCESS_LIST_PATH_TEMPLATE:
        try:
            return _get(_ACCESS_LIST_PATH_TEMPLATE.format(sid=structure_id), token=token)
        except requests.HTTPError as err:
            if err.response.status_code == 404:
                return []
            raise
    for template in templates:
        try:
            payload = _get(template.format(sid=structure_id), token=token)
        except requests.HTTPError as err:
            if err.response.status_code in (404, 400):
                continue
            raise
        _ACCESS_LIST_PATH_TEMPLATE = template
        return payload
    return []


def fetch_access_list_members(token, access_list_id: int) -> list[dict]:
    """Retrieve members of an access list."""
    global _ACCESS_LIST_MEMBERS_PATH_TEMPLATE
    templates = (
        "/access_lists/{alid}/members/",
        "/access_lists/{alid}/",
    )
    if _ACCESS_LIST_MEMBERS_PATH_TEMPLATE:
        try:
            return _get(
                _ACCESS_LIST_MEMBERS_PATH_TEMPLATE.format(alid=access_list_id),
                token=token,
            )
        except requests.HTTPError as err:
            if err.response.status_code == 404:
                return []
            raise
    for template in templates:
        try:
            payload = _get(template.format(alid=access_list_id), token=token)
        except requests.HTTPError as err:
            if err.response.status_code in (404, 400):
                continue
            raise
        _ACCESS_LIST_MEMBERS_PATH_TEMPLATE = template
        return payload
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
