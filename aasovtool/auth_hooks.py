from allianceauth import hooks
from allianceauth.services.hooks import MenuItemHook, UrlHook

from . import urls


class SovtoolMenuItem(MenuItemHook):
    def __init__(self):
        super().__init__(
            "Sovereignty",
            "fa-solid fa-globe",
            "aasovtool:index",
            navactive=["aasovtool:"],
        )

    def render(self, request):
        if request.user.has_perm("aasovtool.view_sovtool"):
            return MenuItemHook.render(self, request)
        return ""


@hooks.register("menu_item_hook")
def register_menu():
    return SovtoolMenuItem()


@hooks.register("url_hook")
def register_urls():
    return UrlHook(urls, "aasovtool", r"^sovtool/")
