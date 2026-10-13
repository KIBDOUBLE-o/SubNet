import threading
import time
from typing import Callable, Optional


class ScreenStream:
    def __init__(
        self,
        send: Callable[[str], None],
        on_error: Optional[Callable[[str], None]] = None,
        get_master_identifier: Optional[Callable[[], str]] = None,
    ):
        """
        send(msg)                    — отправка команды на сервер
        on_error(msg)                — колбэк ошибок
        get_master_identifier()      — текущий identifier мастера
        """
        self._send = send
        self._on_error = on_error or (lambda e: None)
        self._get_master_identifier = get_master_identifier or (lambda: "")

        self.fps = 15
        self.quality = "MID"

        self.selected_slave: str | None = None
        self._stop_event: threading.Event | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    @property
    def is_active(self) -> bool:
        return self.selected_slave is not None

    def start(self, slave_id: str):
        with self._lock:
            self._stop_current()

            self.selected_slave = slave_id
            self._stop_event = threading.Event()

            fps = max(1, self.fps)
            quality = self.quality.lower()
            master_id = self._get_master_identifier()

            self._send(
                f"request slave {slave_id} stream_start {master_id} {fps} {quality}"
            )

    def stop(self):
        with self._lock:
            self._stop_current()
            self.selected_slave = None
            self._stop_event = None
            self._thread = None

    def set_fps(self, fps: int):
        self.fps = max(1, min(fps, 60))
        self._restart_if_active()

    def set_quality(self, quality: str):
        self.quality = quality
        self._restart_if_active()

    def request_once(self, slave_id: str):
        """Один кадр без постоянного стрима (legacy)."""
        self._send(
            f"request slave {slave_id} slave_screen {self.quality}"
        )

    def _restart_if_active(self):
        if not self.selected_slave:
            return

        fps = max(1, self.fps)
        quality = self.quality.lower()
        master_id = self._get_master_identifier()

        self._send(
            f"request slave {self.selected_slave} stream_start {master_id} {fps} {quality}"
        )

    def _stop_current(self):
        if self._stop_event:
            self._stop_event.set()

        if self.selected_slave:
            try:
                self._send(f"request slave {self.selected_slave} stream_stop")
            except Exception:
                pass
