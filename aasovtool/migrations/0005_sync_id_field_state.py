"""Bring the migration state in line with the database and the models.

Every aasovtool id column is already BIGINT in the database (and the models resolve to
BigAutoField via AppConfig.default_auto_field), but parts of the migration history still
recorded plain AutoField. Update the recorded state only; no DDL is issued.
"""

from django.db import migrations, models

MODELS = [
    "accesslist",
    "accesslistmember",
    "auditentry",
    "corpstructure",
    "corptoken",
    "editableregion",
    "scenario",
    "sovstructure",
    "system",
    "systemoverride",
    "upgrade",
]


class Migration(migrations.Migration):

    dependencies = [
        ("aasovtool", "0004_maps_and_positions"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.AlterField(
                    model_name=model_name,
                    name="id",
                    field=models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                )
                for model_name in MODELS
            ],
        ),
    ]
