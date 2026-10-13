import json
import os

import webview
from webview import Window
from webview.dom import DOMEventHandler

from client.master.master import Master
from client.master.screen_stream import ScreenStream
from client.master.web_constructor_dummy import WebConstructorDummy


class MasterUI:
    def __init__(self):
        self.master: Master | None = None
        self.window: Window | None = None
        self.maximized = False

        self.screen = ScreenStream(
            send=self._send,
            on_error=self.on_error,
            get_master_identifier=self._master_identifier,
        )

    def _send(self, message: str):
        if self.master:
            self.master.send(message)

    def _master_identifier(self) -> str:
        if self.master and hasattr(self.master, "identifier"):
            return str(self.master.identifier)
        return ""

    def call(self, func: str, *args):
        js_args = ", ".join(json.dumps(arg) for arg in args)
        self.window.evaluate_js(f"{func}({js_args});")

    def set_authenticated(self, state: bool):
        self.call("setAuthenticated", state)

    def send_announce(self, message: str, t: str = "info"):
        self.call("sendAnnounce", message, t)

    def set_slaves(self, slaves: list):
        self.call("setSlavesTree", slaves)

    def set_screen(self, image):
        if image is None or self.screen.selected_slave is not None:
            self.call("setScreen", image)

    def on_error(self, error: str):
        self.send_announce(error, "error")

    def on_drop(self):
        pass

    def on_loaded(self):
        self.window.dom.document.events.drop += DOMEventHandler(self.on_drop, False, False)

    def run(self):
        ui = self

        class Api:
            def window_move(api, dx: int, dy: int):
                x, y = ui.window.x, ui.window.y
                ui.window.move(x + dx, y + dy)

            def log_in(api, password: str):
                ui.master = Master(password, ui)
                ui.master.set_error_callback(ui.on_error)

                if ui.master.start(password):
                    ui.set_authenticated(True)
                    ui.send_announce("Successful authentication")
                    api.request_slaves()

            def window_minimize(api):
                ui.window.minimize()

            def window_maximize(api):
                if not ui.maximized:
                    ui.window.maximize()
                else:
                    ui.window.restore()

                ui.call("setMaximized", ui.window.maximized)
                ui.maximized = not ui.maximized

            def window_close(api):
                ui.screen.stop()
                ui.window.destroy()

            def request_slaves(api):
                ui._send("request slaves")

            def on_slaves_refresh(api):
                api.request_slaves()

            def on_slave_open(api, slave_id: str):
                ui.screen.start(slave_id)

            def on_slave_close(api, slave_id: str):
                if ui.screen.selected_slave == slave_id:
                    ui.screen.stop()
                ui.set_screen(None)

            def on_page_change(api, page: str):
                pass

            def on_group_toggle(api, name: str, collapsed: bool):
                pass

            def on_bash_command(api, cmd: str):
                pass

            def on_screen_drop(api, data_url, filename):
                pass

            def on_screen_expand(api):
                pass

            def on_screen_fps(api, fps: int):
                ui.screen.set_fps(fps)

            def on_screen_quality(api, quality: str):
                ui.screen.set_quality(quality)

            def request_screen(api, selected: str):
                ui.screen.request_once(selected)
                ui.screen.start(selected)

        constructor = WebConstructorDummy()
        if os.path.exists("ui"):
            constructor.include_index(open("ui/index.html", encoding="utf-8").read())
            constructor.include_style(open("ui/style.css", encoding="utf-8").read())
            constructor.include_script(open("ui/script.js", encoding="utf-8").read())
            constructor.create_dump(".uinterface")
        else:
            constructor.load_dump(".uinterface")

        self.window = webview.create_window(
            "SubNet: DungeonMaster",
            html=constructor.build(),
            js_api=Api(),
            text_select=True,
            width=1280,
            height=820,
            frameless=True,
            easy_drag=False,
        )
        webview.start(func=self.on_loaded)
