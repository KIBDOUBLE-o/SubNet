from __future__ import annotations

import socket
import struct
import threading
import time
from typing import Callable, Optional, Union

from settings import address

BytesOrStr = Union[bytes, str]


class Client:
    def __init__(self, password: str = "wrong", auto_reconnect: bool = True):
        self.password = password
        self.auto_reconnect = auto_reconnect

        self.conn: Optional[socket.socket] = None
        self.received_buffer: list[bytes] = []

        self.lock = threading.Lock()
        self.send_lock = threading.Lock()
        self._buffer_cv = threading.Condition(self.lock)

        self.running = False
        self.authenticated = False
        self._recv_thread: Optional[threading.Thread] = None
        self._reconnect_delay = 3.0

        self.error_callback: Callable[[str], None] = lambda _error: None

    # ── public API ────────────────────────────────────────────

    def set_error_callback(self, callback: Callable[[str], None]) -> None:
        self.error_callback = callback

    def start(self) -> None:
        if self.running:
            return
        self.running = True
        self._recv_thread = threading.Thread(
            target=self._main_loop, name="client-recv", daemon=True
        )
        self._recv_thread.start()

    def stop(self) -> None:
        self.running = False
        self.authenticated = False
        self._close_connection()
        # wake any blocking get_message
        with self._buffer_cv:
            self._buffer_cv.notify_all()

    def send(self, data: BytesOrStr) -> bool:
        if not self.conn:
            return False
        if isinstance(data, str):
            data = data.encode("utf-8")
        try:
            with self.send_lock:
                header = struct.pack(">I", len(data))
                self.conn.sendall(header + data)
            return True
        except OSError as e:
            print(f"[Client] Send error: {e}")
            return False

    def get_message(self, block: bool = False, timeout: Optional[float] = None) -> Optional[bytes]:
        """Pop next raw message from the buffer. Optional blocking wait."""
        deadline = None if timeout is None else time.time() + timeout
        with self._buffer_cv:
            while True:
                if self.received_buffer:
                    return self.received_buffer.pop(0)
                if not block or not self.running:
                    return None
                if deadline is not None:
                    remaining = deadline - time.time()
                    if remaining <= 0:
                        return None
                    self._buffer_cv.wait(timeout=remaining)
                else:
                    self._buffer_cv.wait(timeout=0.05)

    def get_message_str(self, block: bool = False, timeout: Optional[float] = None) -> Optional[str]:
        data = self.get_message(block=block, timeout=timeout)
        if data is None:
            return None
        return data.decode("utf-8", errors="replace")

    # ── hooks (override in subclasses) ────────────────────────

    def on_auth_success(self, response: str) -> None:
        pass

    def on_auth_failed(self) -> None:
        pass

    def on_message(self, message: str) -> Optional[BytesOrStr]:
        """
        Called on the recv thread for every post-auth message.
        Return a str/bytes to auto-reply, or None.
        """
        return None

    def on_disconnected(self) -> None:
        pass

    # ── connection / framing ──────────────────────────────────

    def _create_socket(self) -> socket.socket:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(10.0)
        return sock

    def connect(self) -> bool:
        try:
            self._close_connection(keep_auth_flag=True)
            self.conn = self._create_socket()
            print(f"[Client] Connecting to {address}...")
            self.conn.connect(address.to_socket())
            print("[Client] Connected.")
            return True
        except OSError as e:
            print(f"[Client] Connection failed: {e}")
            self.conn = None
            return False

    def _close_connection(self, keep_auth_flag: bool = False) -> None:
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
        if not keep_auth_flag:
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
        if length == 0:
            return b""
        if length > 16 * 1024 * 1024:
            # sanity guard
            print(f"[Client] Rejected oversized frame: {length}")
            return b""
        return self._recv_exact(length)

    # ── auth ──────────────────────────────────────────────────

    def _authenticate(self) -> bool:
        print("[Client] Authenticating...")
        return self.send(f"auth {self.password}")

    def _wait_auth_response(self, timeout: float = 5.0) -> Optional[str]:
        deadline = time.time() + timeout
        while time.time() < deadline and self.running:
            try:
                data = self._recv_message()
                if data:
                    return data.decode("utf-8", errors="replace")
            except OSError:
                return None
            time.sleep(0.02)
        return None

    # ── main loop ─────────────────────────────────────────────

    def _main_loop(self) -> None:
        while self.running:
            if not self.connect():
                if not self._retry_or_stop("connect"):
                    break
                continue

            if not self._authenticate():
                self._close_connection()
                if not self._retry_or_stop("auth send"):
                    break
                continue

            response = self._wait_auth_response(timeout=5.0)
            if response is None:
                print("[Client] Server did not answer auth")
                self._close_connection()
                if not self._retry_or_stop("auth timeout"):
                    break
                continue

            if response.strip() == "auth;fail":
                print("[Client] Auth failed (auth;fail)")
                self._close_connection()
                self.on_auth_failed()
                if not self._retry_or_stop("auth reject"):
                    break
                continue

            print(f"[Client] Auth ok: {response}")
            self.authenticated = True
            try:
                self.on_auth_success(response)
            except Exception as e:
                print(f"[Client] on_auth_success error: {e}")

            # ── message pump ──────────────────────────────────
            while self.running and self.conn:
                try:
                    data = self._recv_message()
                except OSError as e:
                    if self.running:
                        print(f"[Client] Receive error: {e}")
                    break

                if not data:
                    print("[Client] Connection closed by peer")
                    break

                with self._buffer_cv:
                    self.received_buffer.append(data)
                    self._buffer_cv.notify()

                # dispatch immediately — this is why Master was "silent" before
                self._dispatch(data)

            was_auth = self.authenticated
            self._close_connection()
            if was_auth:
                try:
                    self.on_disconnected()
                except Exception as e:
                    print(f"[Client] on_disconnected error: {e}")

            if not self._retry_or_stop("disconnect"):
                break

    def _dispatch(self, data: bytes) -> None:
        try:
            text = data.decode("utf-8", errors="replace")
        except Exception:
            return
        try:
            reply = self.on_message(text)
        except Exception as e:
            print(f"[Client] on_message error: {e}")
            return
        if reply is not None:
            self.send(reply)

    def _retry_or_stop(self, reason: str) -> bool:
        """Return True if we should keep looping (reconnect)."""
        if not self.running:
            return False
        if not self.auto_reconnect:
            self.running = False
            return False
        print(f"[Client] Reconnect in {self._reconnect_delay}s ({reason})")
        time.sleep(self._reconnect_delay)
        return self.running
