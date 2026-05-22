"""Permission helpers and override-save logic."""
from __future__ import annotations

from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType

from . import models


# Maps the legacy ``view / edit / admin`` role to AA permissions on the
# ``General`` proxy. Admins additionally get is_staff so they can reach the
# Django admin if desired.
ROLE_PERMS = {
    "view": ["view_sovtool"],
    "edit": ["view_sovtool", "edit_sovtool"],
    "admin": ["view_sovtool", "edit_sovtool", "manage_sovtool"],
}


def _general_ct() -> ContentType:
    return ContentType.objects.get_for_model(models.General)


def apply_role(user, role: str) -> None:
    """Replace a user's sovtool perms with those of ``role``."""
    ct = _general_ct()
    sovtool_perms = Permission.objects.filter(content_type=ct)
    for perm in sovtool_perms:
        user.user_permissions.remove(perm)
    codenames = ROLE_PERMS.get(role, [])
    for codename in codenames:
        try:
            perm = Permission.objects.get(content_type=ct, codename=codename)
        except Permission.DoesNotExist:
            continue
        user.user_permissions.add(perm)


def replace_overrides(scenario: models.Scenario, systems_payload: list[dict]) -> None:
    """Persist scenario overrides given a frontend-shaped systems payload."""
    catalog = {s.system_name: s for s in models.System.objects.all()}
    scenario.overrides.all().delete()
    new_overrides = []
    for system in systems_payload:
        name = system.get("systemName")
        if not name or name not in catalog:
            continue
        override = models.SystemOverride(
            scenario=scenario,
            system_name=name,
            role=system.get("role"),
            upgrades=system.get("upgrades") or [],
            transfers=system.get("transfers") or [],
            position=system.get("position"),
            ansiblex_partner=system.get("ansiblexPartner"),
        )
        if not override.is_empty():
            new_overrides.append(override)
    models.SystemOverride.objects.bulk_create(new_overrides, batch_size=200)


def ensure_default_groups() -> None:
    """Create ``Sovtool Viewers`` / ``Sovtool Editors`` / ``Sovtool Admins`` groups
    so AA admins can assign them in one click instead of stacking permissions.
    """
    ct = _general_ct()
    for role, codenames in ROLE_PERMS.items():
        group_name = {
            "view": "Sovtool Viewers",
            "edit": "Sovtool Editors",
            "admin": "Sovtool Admins",
        }[role]
        group, _ = Group.objects.get_or_create(name=group_name)
        # NOTE: do not use .clear() here — Alliance Auth's
        # m2m_changed_group_permissions signal handler crashes on pre_clear
        # (pk_set is None). Compute the target set and use .set() which
        # emits add/remove with explicit pks instead.
        desired = list(
            Permission.objects.filter(content_type=ct, codename__in=codenames)
        )
        group.permissions.set(desired)
