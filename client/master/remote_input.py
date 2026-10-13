from typing import Callable, Optional


class RemoteInput:
    def __init__(
        self,
        send: Callable[[str], None],
        get_slave_id: Callable[[], Optional[str]],
    ):
        self._send = send
        self._get_slave_id = get_slave_id
        self.enabled = True

    def _slave(self) -> Optional[str]:
        return self._get_slave_id() if self.enabled else None

    def _cmd(self, *parts: str):
        slave = self._slave()
        if not slave:
            return
        self._send(f"request slave {slave} input {' '.join(parts)}")

    # --- mouse ---
    def mouse_move(self, nx: float, ny: float):
        self._cmd("mouse_move", f"{nx:.5f}", f"{ny:.5f}")

    def mouse_down(self, btn: str, nx: float, ny: float):
        self._cmd("mouse_down", btn, f"{nx:.5f}", f"{ny:.5f}")

    def mouse_up(self, btn: str, nx: float, ny: float):
        self._cmd("mouse_up", btn, f"{nx:.5f}", f"{ny:.5f}")

    def mouse_click(self, btn: str, nx: float, ny: float):
        self._cmd("mouse_click", btn, f"{nx:.5f}", f"{ny:.5f}")

    def mouse_scroll(self, dx: float, dy: float):
        self._cmd("mouse_scroll", str(int(dx)), str(int(dy)))

    # --- keyboard ---
    def key_down(self, key: str):
        self._cmd("key_down", key)

    def key_up(self, key: str):
        self._cmd("key_up", key)

    def key_tap(self, key: str):
        self._cmd("key_tap", key)

    def key_hotkey(self, combo: str):
        """combo: 'ctrl+c', 'ctrl+shift+esc' """
        self._cmd("key_hotkey", combo)