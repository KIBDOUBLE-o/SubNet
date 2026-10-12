from __future__ import annotations

import json
import time
from typing import TYPE_CHECKING, Any, Optional

from client.client import Client, Payload

if TYPE_CHECKING:
    from master_ui import MasterUI


class Master(Client):
    def __init__(self, password: str = "", ui: Optional["MasterUI"] = None):
        super().__init__(password=password, auto_reconnect=False)
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
        if self.ui and hasattr(self.ui, "send_announce"):
            self.ui.send_announce("Disconnected from server", "warn")

    def on_message(self, message: str) -> Optional[Payload]:
        if message.startswith("slaves"):
            try:
                tree = json.loads(message[6:].lstrip())
            except json.JSONDecodeError as e:
                self.error_callback(f"Bad slaves payload: {e}")
                return None
            self._set_slaves(tree)
        return None

    def _set_slaves(self, tree: Any) -> None:
        if not self.ui:
            return
        if hasattr(self.ui, "set_slaves"):
            self.ui.set_slaves(tree)
        elif hasattr(self.ui, "call"):
            self.ui.call("setSlavesTree", tree)
