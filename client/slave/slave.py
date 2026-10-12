from __future__ import annotations

import time
from typing import Optional

from client.client import Client, Payload
from utils import capture_screen


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
        cmd = message.split()
        if not cmd: return

        root = cmd[0]
        cmd = cmd[1:]

        if root == "request":
            subject = cmd[0]
            if subject == "slave_screen":
                quality = cmd[1]
                quality = 30 if quality == "LOW" else 50 if quality == "MID" else 70
                master = cmd[2]
                self.send(f"send slave_screen {master} {capture_screen(quality)}")
