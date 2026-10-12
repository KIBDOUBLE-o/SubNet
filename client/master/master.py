from __future__ import annotations

import json
import time
from typing import TYPE_CHECKING, Any, Optional, Union

from client.client import Client

if TYPE_CHECKING:
    from master_ui import MasterUI

BytesOrStr = Union[bytes, str]


class Master(Client):
    def __init__(self, password: str = "", ui: Optional["MasterUI"] = None):
        super().__init__(password=password, auto_reconnect=False)
        self.ui = ui

    # ── lifecycle ─────────────────────────────────────────────

    def start(self, password: Optional[str] = None) -> bool:
        """
        Connect + authenticate. Blocks until auth succeeds/fails (max ~8s).
        After True, messages are delivered through on_message automatically.
        """
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

    # ── auth hooks ────────────────────────────────────────────

    def on_auth_success(self, response: str) -> None:
        print(f"[Master] Auth ok: {response}")

    def on_auth_failed(self) -> None:
        print("[Master] Invalid password")
        self.error_callback("Invalid password")

    def on_disconnected(self) -> None:
        print("[Master] Disconnected from server")
        if self.ui:
            try:
                self.ui.send_announce("Disconnected from server", "warn")
            except Exception:
                pass

    # ── message dispatch (called from recv thread) ────────────

    def on_message(self, message: str) -> Optional[BytesOrStr]:
        print(f"[Master] ← {message!r}")

        if message.startswith("slaves"):
            payload = message[6:].lstrip()
            try:
                tree = json.loads(payload)
            except json.JSONDecodeError as e:
                print(f"[Master] Bad slaves JSON: {e}")
                self.error_callback(f"Bad slaves payload: {e}")
                return None
            self._set_slaves(tree)
            return None

        # unknown / pass-through — ignore
        return None

    def _set_slaves(self, tree: Any) -> None:
        if not self.ui:
            print("[Master] No UI bound, slaves ignored")
            return
        # MasterUI may expose set_slaves or call JS setSlavesTree
        if hasattr(self.ui, "set_slaves"):
            self.ui.set_slaves(tree)
        elif hasattr(self.ui, "call"):
            self.ui.call("setSlavesTree", tree)
        else:
            print("[Master] UI has no set_slaves/call")
