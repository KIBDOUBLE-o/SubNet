import socket
import struct
import threading
from typing import Optional

from settings import address


class Client:
    def __init__(self):
        self.conn = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.conn.settimeout(10.0)

        self.received_buffer: list[bytes] = []

        self.lock = threading.Lock()
        self.send_lock = threading.Lock()

        self.running = False
        self._recv_thread: Optional[threading.Thread] = None

    def connect(self) -> bool:
        try:
            print(f"Connecting to {str(address)}...")
            self.conn.connect(address.to_socket())
            print("Connected.")
            return True
        except Exception as e:
            print(f"Connection failed: {e}")
            return False

    def start(self):
        if self.running:
            return

        self.running = True
        self._recv_thread = threading.Thread(target=self._recv_loop, daemon=True)
        self._recv_thread.start()

    def stop(self):
        self.running = False
        try:
            self.conn.shutdown(socket.SHUT_RDWR)
        except Exception:
            pass
        try:
            self.conn.close()
        except Exception:
            pass

    def _recv_exact(self, n: int) -> bytes:
        data = bytearray()
        while len(data) < n:
            try:
                chunk = self.conn.recv(n - len(data))
            except socket.timeout:
                continue
            except Exception:
                return b''

            if not chunk:
                return b''
            data.extend(chunk)
        return bytes(data)

    def _recv_message(self) -> bytes:
        header = self._recv_exact(4)
        if not header:
            return b''

        length = struct.unpack('>I', header)[0]
        if length == 0:
            return b''

        return self._recv_exact(length)

    def send(self, data: bytes | str) -> bool:
        if isinstance(data, str):
            data = data.encode('utf-8')

        try:
            with self.send_lock:
                header = struct.pack('>I', len(data))
                self.conn.sendall(header + data)
            return True
        except Exception as e:
            print(f"Send error: {e}")
            self.running = False
            return False

    def _recv_loop(self):
        while self.running:
            try:
                data = self._recv_message()
                if not data:
                    # Соединение закрыто
                    self.running = False
                    break

                with self.lock:
                    self.received_buffer.append(data)

            except Exception as e:
                if self.running:
                    print(f"Receive error: {e}")
                self.running = False
                break

    def get_message(self, block: bool = False) -> Optional[bytes]:
        while True:
            with self.lock:
                if self.received_buffer:
                    return self.received_buffer.pop(0)

            if not block or not self.running:
                return None

            threading.Event().wait(0.01)

    def get_message_str(self, block: bool = False) -> Optional[str]:
        data = self.get_message(block=block)
        if data is None:
            return None
        try:
            return data.decode('utf-8')
        except UnicodeDecodeError:
            return None
