from __future__ import annotations

from typing import Optional, Union

from client.client import Client

BytesOrStr = Union[bytes, str]


class Slave(Client):
    def __init__(self, password: str = "wrong"):
        super().__init__(password=password, auto_reconnect=True)

    def run(self) -> None:
        """
        Start the client and keep the process alive until stop / Ctrl+C.
        Messages are handled in on_message (dispatched by Client recv loop).
        Do NOT poll get_message here — that would race with the dispatcher.
        """
        self.start()
        print("[Slave] Running")

        try:
            while self.running:
                # light sleep; work happens on recv thread
                self._wait_while_running(0.5)
        except KeyboardInterrupt:
            print("\n[Slave] Interrupted")
        finally:
            self.stop()
            print("[Slave] Stopped")

    def _wait_while_running(self, seconds: float) -> None:
        import time
        end = time.time() + seconds
        while self.running and time.time() < end:
            time.sleep(0.05)

    def on_auth_success(self, response: str) -> None:
        print(f"[Slave] Auth ok: {response}")

    def on_auth_failed(self) -> None:
        print("[Slave] Auth failed")

    def on_message(self, message: str) -> Optional[BytesOrStr]:
        print(f"[Slave] ← {message!r}")
        return f"Slave получил: {message}"

    def on_disconnected(self) -> None:
        print("[Slave] Disconnected")
