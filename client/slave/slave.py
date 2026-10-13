from __future__ import annotations

import threading
import time
from typing import Optional

from client.client import Client, Payload
from utils import capture_screen


class Slave(Client):
    def __init__(self, password: str = "wrong"):
        super().__init__(password=password, auto_reconnect=True, identifier_t="s")
        self._stream_stop = threading.Event()
        self._stream_lock = threading.Lock()

    def run(self) -> None:
        self.start()
        try:
            while self.running:
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()

    def _start_stream(self, master: str, fps: int, quality: int):
        with self._stream_lock:
            self._stream_stop.set()
            stop = threading.Event()
            self._stream_stop = stop

        threading.Thread(
            target=self._stream_loop,
            args=(master, fps, quality, stop),
            daemon=True
        ).start()

    def _stop_stream(self):
        with self._stream_lock:
            self._stream_stop.set()

    def _stream_loop(self, master: str, fps: int, quality: int, stop: threading.Event):
        interval = 1.0 / max(1, fps)
        while not stop.is_set() and self.running:
            t = time.monotonic()
            frame = capture_screen(quality)
            self.send(f"send slave_screen {master} {frame}")
            elapsed = time.monotonic() - t
            stop.wait(max(0.0, interval - elapsed))

    def on_message(self, message: str) -> Optional[Payload]:
        tokens = message.split()
        if not tokens:
            return None

        if tokens[0] != "request" or len(tokens) < 2:
            return None

        subject = tokens[1]

        if subject == "stream_start":
            # tokens: [request, stream_start, master, fps, quality, <sender_id_appended_by_server>]
            if len(tokens) < 5:
                return None
            master = tokens[2]
            fps = int(tokens[3])
            quality_map = {"low": 40, "medium": 70, "high": 90}
            quality = quality_map.get(tokens[4].lower(), 70)
            self._start_stream(master, fps, quality)

        elif subject == "stream_stop":
            self._stop_stream()

        return None
