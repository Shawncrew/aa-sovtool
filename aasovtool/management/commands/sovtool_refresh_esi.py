"""Trigger the ESI refresh tasks synchronously (no celery worker required)."""
from django.core.management.base import BaseCommand

from aasovtool.tasks import refresh_all


class Command(BaseCommand):
    help = "Pull live sovereignty / corp-structures / access-lists data from ESI."

    def handle(self, *args, **opts):
        result = refresh_all()
        self.stdout.write(self.style.SUCCESS(f"Refresh complete: {result}"))
