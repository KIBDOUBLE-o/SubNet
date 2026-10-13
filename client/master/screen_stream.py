import threading
from typing import Callable, Optional


class ScreenStream:
    def __init__(
        self,
        send: Callable[[str], None],
        on_error: Optional[Callable[[str], None]] = None,
        get_master_identifier: Optional[Callable[[], str]] = None,
    ):
        self._send = send
        self._on_error = on_error or (lambda e: None)
        self._get_master_identifier = get_master_identifier or (lambda: "")

        self.fps = 20
        self.quality = "mid"  # low / mid / high

        self.selected_slave: str | None = None
        self._stop_event: threading.Event | None = None
        self._lock = threading.Lock()

    @property
    def is_active(self) -> bool:
        return self.selected_slave is not None

    def start(self, slave_id: str):
        with self._lock:
            self._stop_current()
            self.selected_slave = slave_id
            self._stop_event = threading.Event()
            self._send_start(slave_id)

    def stop(self):
        with self._lock:
            self._stop_current()
            self.selected_slave = None
            self._stop_event = None

    def set_fps(self, fps: int):
        self.fps = max(1, min(int(fps), 30))
        self._restart_if_active()

    def set_quality(self, quality: str):
        self.quality = (quality or "mid").lower()
        self._restart_if_active()

    def request_once(self, slave_id: str):
        self._send(f"request slave {slave_id} slave_screen {self.quality}")

    def _send_start(self, slave_id: str):
        fps = max(1, self.fps)
        quality = self.quality.lower()
        master_id = self._get_master_identifier()
        self._send(
            f"request slave {slave_id} stream_start {master_id} {fps} {quality}"
        )

    def _restart_if_active(self):
        if self.selected_slave:
            self._send_start(self.selected_slave)

    def _stop_current(self):
        if self._stop_event:
            self._stop_event.set()
        if self.selected_slave:
            try:
                self._send(f"request slave {self.selected_slave} stream_stop")
            except Exception:
                pass
