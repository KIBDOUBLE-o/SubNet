import json
import os

import webview
from webview import Window
from webview.dom import DOMEventHandler

from client.master.master import Master
from client.master.remote_input import RemoteInput
from client.master.screen_stream import ScreenStream
from client.master.web_constructor_dummy import WebConstructorDummy


class MasterUI:
    def __init__(self):
        self.master: Master | None = None
        self.main_window: Window | None = None
        self.fullscreen_window: Window | None = None
        self.maximized = False

        self.screen = ScreenStream(
            send=self._send,
            on_error=self.on_error,
            get_master_identifier=self._master_identifier,
        )
        self.input = RemoteInput(
            send=self._send,
            get_slave_id=lambda: self.screen.selected_slave,
        )

    def _send(self, message: str):
        if self.master:
            self.master.send(message)

    def _master_identifier(self) -> str:
        if self.master and hasattr(self.master, "identifier"):
            return str(self.master.identifier)
        return ""

    def is_fullscreen_open(self) -> bool:
        w = self.fullscreen_window
        if w is None:
            return False
        return w in webview.windows

    def call(self, func: str, *args):
        js_args = ", ".join(json.dumps(arg) for arg in args)
        self.main_window.evaluate_js(f"{func}({js_args});")

    def call_fullscreen(self, func: str, *args):
        if self.fullscreen_window is None:
            return
        js_args = ", ".join(json.dumps(arg) for arg in args)
        self.fullscreen_window.evaluate_js(f"{func}({js_args});")

    def set_authenticated(self, state: bool):
        self.call("setAuthenticated", state)

    def send_announce(self, message: str, t: str = "info"):
        self.call("sendAnnounce", message, t)

    def set_slaves(self, slaves: list):
        self.call("setSlavesTree", slaves)

    def append_bash(self, text):
        self.call("appendBash", text)

    def set_info(self, info: dict):
        self.call("setInfo", info)

    def set_screen(self, image):
        if image is None:
            self.call("setScreen", None)
            return
        if self.screen.selected_slave is not None:
            if self.is_fullscreen_open():
                self.call_fullscreen("setScreen", image)
                self.call("setScreen", None)
            else:
                self.call("setScreen", image)

    def fullscreen_set_frame_rate(self, frames):
        if self.is_fullscreen_open():
            self.call_fullscreen("setFrameRate", frames)

    def fullscreen_set_interactive(self, state):
        if self.is_fullscreen_open():
            self.call_fullscreen("setInteractive", state)

    def on_error(self, error: str):
        self.send_announce(error, "error")

    def on_drop(self):
        pass

    def on_loaded(self):
        self.main_window.dom.document.events.drop += DOMEventHandler(self.on_drop, False, False)

    def run(self):
        ui = self

        class FullscreenApi:
            def quit(api):
                w = ui.fullscreen_window
                ui.fullscreen_window = None
                if w is not None:
                    w.destroy()

            def set_input_enabled(api, enabled: bool):
                ui.input.enabled = bool(enabled)

            def on_mouse_move(api, nx: float, ny: float):
                ui.input.mouse_move(nx, ny)

            def on_mouse_down(api, button: str, nx: float, ny: float):
                ui.input.mouse_down(button, nx, ny)

            def on_mouse_up(api, button: str, nx: float, ny: float):
                ui.input.mouse_up(button, nx, ny)

            def on_mouse_scroll(api, dx: float, dy: float):
                ui.input.mouse_scroll(dx, dy)

            def on_key_down(api, key: str):
                ui.input.key_down(key)

            def on_key_up(api, key: str):
                ui.input.key_up(key)

        class MainApi:
            def window_move(api, dx: int, dy: int):
                x, y = ui.main_window.x, ui.main_window.y
                ui.main_window.move(x + dx, y + dy)

            def log_in(api, password: str):
                ui.master = Master(password, ui)
                ui.master.set_error_callback(ui.on_error)

                if ui.master.start(password):
                    ui.set_authenticated(True)
                    ui.send_announce("Successful authentication")
                    api.request_slaves()

            def window_minimize(api):
                ui.main_window.minimize()

            def window_maximize(api):
                if not ui.maximized:
                    ui.main_window.maximize()
                else:
                    ui.main_window.restore()

                ui.call("setMaximized", ui.main_window.maximized)
                ui.maximized = not ui.maximized

            def window_close(api):
                ui.screen.stop()
                if ui.is_fullscreen_open():
                    ui.fullscreen_window.destroy()
                    ui.fullscreen_window = None
                ui.main_window.destroy()

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
                ui._send(f"request slave {ui.screen.selected_slave} bash_execution {cmd}")

            def on_screen_drop(api, data_url, filename):
                pass

            def on_screen_expand(api):
                if ui.fullscreen_window is None:
                    ui.fullscreen_window = webview.create_window(
                        "SubNet: DungeonMaster (Fullscreen)",
                        html=fs_constructor.build(),
                        js_api=FullscreenApi(),
                        frameless=True,
                        easy_drag=False,
                        fullscreen=True,
                    )
                else:
                    ui.fullscreen_window.show()

            def on_screen_fps(api, fps: int):
                ui.screen.set_fps(fps)

            def on_screen_quality(api, quality: str):
                ui.screen.set_quality(quality)

            def request_screen(api, selected: str):
                ui.screen.request_once(selected)
                ui.screen.start(selected)

        # main UI
        constructor = WebConstructorDummy()
        if os.path.exists("ui"):
            constructor.include_index(open("ui/main/index.html", encoding="utf-8").read())
            constructor.include_style(open("ui/main/style.css", encoding="utf-8").read())
            constructor.include_script(open("ui/main/script.js", encoding="utf-8").read())
            constructor.create_dump("master.uinterface")
        else:
            constructor.load_dump("master.uinterface")

        self.main_window = webview.create_window(
            "SubNet: DungeonMaster",
            html=constructor.build(),
            js_api=MainApi(),
            text_select=True,
            width=1280,
            height=820,
            frameless=True,
            easy_drag=False,
        )

        # fullscreen UI (html заранее)
        fs_constructor = WebConstructorDummy()
        if os.path.exists("ui"):
            fs_constructor.include_index(open("ui/fullscreen/index.html", encoding="utf-8").read())
            fs_constructor.include_style(open("ui/fullscreen/style.css", encoding="utf-8").read())
            fs_constructor.include_script(open("ui/fullscreen/script.js", encoding="utf-8").read())
            fs_constructor.create_dump("fullscreen.uinterface")
        else:
            fs_constructor.load_dump("fullscreen.uinterface")

        webview.start(func=self.on_loaded)
