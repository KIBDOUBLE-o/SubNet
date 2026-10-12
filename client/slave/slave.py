from __future__ import annotations

import time
from typing import Optional

from client.client import Client, Payload


class Slave(Client):
    def __init__(self, password: str = "wrong"):
        super().__init__(password=password, auto_reconnect=True)

    def run(self) -> None:
        self.start()
        try:
            while self.running:
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()

    def on_message(self, message: str) -> Optional[Payload]:
        return f"Slave получил: {message}"
