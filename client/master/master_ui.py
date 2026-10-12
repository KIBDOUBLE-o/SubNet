import json
import os

import webview
from webview import Window
from webview.dom import DOMEventHandler

from client.master.master import Master
from client.master.web_constructor_dummy import WebConstructorDummy


class MasterUI:
    def __init__(self):
        self.master: Master | None = None
        self.window: Window | None = None
        self.maximized = False

    def call(self, func: str, *args):
        js_args = ", ".join(json.dumps(arg) for arg in args)
        self.window.evaluate_js(f"{func}({js_args});")

    def set_authenticated(self, state: bool):
        self.call("setAuthenticated", state)

    def send_announce(self, message: str, t: str = "info"):
        self.call("sendAnnounce", message, t)

    def set_slaves(self, slaves: list):
        self.call("setSlavesTree", slaves)

    def on_error(self, error: str):
        self.send_announce(error, "error")

    def on_drop(self):
        pass

    def on_loaded(self):
        self.window.dom.document.events.drop += DOMEventHandler(self.on_drop, False, False)

    def run(self):
        class Api:
            def log_in(api, password: str):
                # self.set_authenticated(True)
                # self.send_announce("Asdasd")
                # return
                self.master = Master(password, self)
                self.master.set_error_callback(self.on_error)

                if self.master.start(password):
                    self.set_authenticated(True)
                    self.send_announce("Successful authentication")

                    api.request_slaves()

            def window_minimize(api):
                self.window.minimize()

            def window_maximize(api):
                if not self.maximized:
                    self.window.maximize()
                else:
                    self.window.restore()

                self.call("setMaximized", self.window.maximized)
                self.maximized = not self.maximized

            def window_close(api):
                self.window.destroy()

            def request_slaves(api):
                self.master.send("request slaves")

            def on_slaves_refresh(api):
                api.request_slaves()

            def on_slave_open(api, slave_id: str):
                # загрузить info/screen/bash для этого slave
                # self.call("setInfo", {...})
                # self.call("setScreen", data_url)
                pass

            def on_slave_close(api, slave_id: str):
                pass

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
                pass

            def on_screen_quality(api, quality: str):
                pass

        constructor = WebConstructorDummy()
        if os.path.exists("ui"):
            constructor.include_index(open("ui/index.html", encoding="utf-8").read())
            constructor.include_style(open("ui/style.css", encoding="utf-8").read())
            constructor.include_script(open("ui/script.js", encoding="utf-8").read())
            constructor.create_dump(".uinterface")
        else:
            constructor.load_dump(".uinterface")

        self.window = webview.create_window("SubNet: DungeonMaster", html=constructor.build(), js_api=Api(), text_select=True,
                                            width=1280, height=820, frameless=True, easy_drag=False)
        webview.start(func=self.on_loaded)