from __future__ import annotations

import socket
import struct
import threading
import time
from typing import Callable, Optional, Union

from settings import address

Payload = Union[bytes, str]


class Client:
    def __init__(self, password: str = "wrong", auto_reconnect: bool = True):
        self.password = password
        self.auto_reconnect = auto_reconnect
        self.conn: Optional[socket.socket] = None
        self.received_buffer: list[bytes] = []
        self._lock = threading.Lock()
        self._send_lock = threading.Lock()
        self._cv = threading.Condition(self._lock)
        self.running = False
        self.authenticated = False
        self._thread: Optional[threading.Thread] = None
        self._reconnect_delay = 3.0
        self.error_callback: Callable[[str], None] = lambda _: None

    def set_error_callback(self, callback: Callable[[str], None]) -> None:
        self.error_callback = callback

    def start(self) -> None:
        if self.running:
            return
        self.running = True
        self._thread = threading.Thread(target=self._main_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self.running = False
        self.authenticated = False
        self._close()
        with self._cv:
            self._cv.notify_all()

    def send(self, data: Payload) -> bool:
        if not self.conn:
            return False
        if isinstance(data, str):
            data = data.encode()
        try:
            with self._send_lock:
                self.conn.sendall(struct.pack(">I", len(data)) + data)
            return True
        except OSError:
            return False

    def get_message(self, block: bool = False, timeout: Optional[float] = None) -> Optional[bytes]:
        deadline = None if timeout is None else time.time() + timeout
        with self._cv:
            while True:
                if self.received_buffer:
                    return self.received_buffer.pop(0)
                if not block or not self.running:
                    return None
                wait = 0.05 if deadline is None else max(0.0, deadline - time.time())
                if deadline is not None and wait <= 0:
                    return None
                self._cv.wait(timeout=wait)

    def get_message_str(self, block: bool = False, timeout: Optional[float] = None) -> Optional[str]:
        data = self.get_message(block=block, timeout=timeout)
        return None if data is None else data.decode("utf-8", errors="replace")

    def on_auth_success(self, response: str) -> None:
        pass

    def on_auth_failed(self) -> None:
        pass

    def on_message(self, message: str) -> Optional[Payload]:
        return None

    def on_disconnected(self) -> None:
        pass

    def _close(self) -> None:
        if self.conn:
            try:
                self.conn.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                self.conn.close()
            except OSError:
                pass
            self.conn = None
        self.authenticated = False

    def _recv_exact(self, n: int) -> bytes:
        buf = bytearray()
        while len(buf) < n:
            if not self.conn or not self.running:
                return b""
            try:
                chunk = self.conn.recv(n - len(buf))
            except socket.timeout:
                continue
            except OSError:
                return b""
            if not chunk:
                return b""
            buf.extend(chunk)
        return bytes(buf)

    def _recv_message(self) -> bytes:
        header = self._recv_exact(4)
        if not header:
            return b""
        length = struct.unpack(">I", header)[0]
        if length <= 0 or length > 16 * 1024 * 1024:
            return b""
        return self._recv_exact(length)

    def _connect(self) -> bool:
        self._close()
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(10.0)
            sock.connect(address.to_socket())
            self.conn = sock
            return True
        except OSError:
            self.conn = None
            return False

    def _auth(self) -> Optional[str]:
        if not self.send(f"auth {self.password}"):
            return None
        deadline = time.time() + 5.0
        while time.time() < deadline and self.running:
            try:
                data = self._recv_message()
                if data:
                    return data.decode("utf-8", errors="replace")
            except OSError:
                return None
            time.sleep(0.02)
        return None

    def _dispatch(self, data: bytes) -> None:
        try:
            reply = self.on_message(data.decode("utf-8", errors="replace"))
        except Exception:
            return
        if reply is not None:
            self.send(reply)

    def _should_reconnect(self) -> bool:
        if not self.running or not self.auto_reconnect:
            self.running = False
            return False
        time.sleep(self._reconnect_delay)
        return self.running

    def _main_loop(self) -> None:
        while self.running:
            if not self._connect():
                if not self._should_reconnect():
                    break
                continue

            response = self._auth()
            if response is None or response.strip() == "auth;fail":
                self._close()
                if response and response.strip() == "auth;fail":
                    self.on_auth_failed()
                if not self._should_reconnect():
                    break
                continue

            self.authenticated = True
            self.on_auth_success(response)

            while self.running and self.conn:
                try:
                    data = self._recv_message()
                except OSError:
                    break
                if not data:
                    break
                with self._cv:
                    self.received_buffer.append(data)
                    self._cv.notify()
                self._dispatch(data)

            self._close()
            self.on_disconnected()
            if not self._should_reconnect():
                break
