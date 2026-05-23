from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def seed_live_map(apps, schema_editor):
    """Promote the default scenario (or create it) as the live map."""
    Scenario = apps.get_model("aasovtool", "Scenario")
    SystemOverride = apps.get_model("aasovtool", "SystemOverride")
    System = apps.get_model("aasovtool", "System")

    live, created = Scenario.objects.get_or_create(
        name="live",
        defaults={
            "is_live": True,
            "is_default": True,
            "description": "Source-of-truth map driven by ESI.",
        },
    )
    if not live.is_live:
        live.is_live = True
        live.save(update_fields=["is_live"])

    # Migrate position overrides from any existing scenarios onto the
    # System catalog (canonical_x / canonical_y) so the live map has a
    # default layout. Pull them from whatever scenarios exist; prefer
    # the bundled 'default' scenario.
    sources = list(Scenario.objects.filter(name="default")) + list(
        Scenario.objects.exclude(name="default")
    )
    seen: set[str] = set()
    for src in sources:
        for ov in SystemOverride.objects.filter(scenario=src):
            if ov.system_name in seen:
                continue
            pos = ov.position
            if not isinstance(pos, dict):
                continue
            x = pos.get("x")
            y = pos.get("y")
            if x is None or y is None:
                continue
            System.objects.filter(system_name=ov.system_name).update(
                canonical_x=float(x), canonical_y=float(y)
            )
            seen.add(ov.system_name)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("aasovtool", "0003_system_solar_system_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="system",
            name="canonical_x",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="system",
            name="canonical_y",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="scenario",
            name="is_live",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="scenario",
            name="based_on_name",
            field=models.CharField(blank=True, max_length=128, null=True),
        ),
        migrations.AddField(
            model_name="scenario",
            name="creator",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="sovtool_maps",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.RunPython(seed_live_map, noop_reverse),
    ]
