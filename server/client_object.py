import socket
import struct
from socket import socket as con

from objects.address import Address
from objects.identifier import Identifier
from server.client_type import ClientType
from utils import fash_hash


class ClientObject:
    __slots__ = ('address', 'connection', 'identifier', 'type')

    def __init__(self, address: Address, connection: con):
        self.address = address
        self.connection = connection
        self.identifier = Identifier.empty()
        self.type = ClientType.UnTyped

    @property
    def session_id(self):
        return fash_hash(str(self.address))

    @property
    def is_master(self) -> bool:
        return self.type == ClientType.Master

    @property
    def is_slave(self) -> bool:
        return self.type == ClientType.Slave

    @property
    def is_untyped(self) -> bool:
        return self.type == ClientType.UnTyped

    def close(self):
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except Exception:
            pass
        try:
            self.connection.close()
        except Exception:
            pass

    def _recv_exact(self, n: int) -> bytes:
        """Читает ровно n байт. b'' = соединение закрыто."""
        data = bytearray()
        while len(data) < n:
            try:
                chunk = self.connection.recv(n - len(data))
            except Exception:
                return b''
            if not chunk:
                return b''
            data.extend(chunk)
        return bytes(data)

    def recv(self) -> bytes:
        """
        Получает одно полное сообщение.
        Формат: [4 байта длины big-endian] + [данные]
        """
        header = self._recv_exact(4)
        if not header:
            return b''

        length = struct.unpack('>I', header)[0]
        if length == 0:
            return b''

        return self._recv_exact(length)

    def send(self, data: bytes | str) -> bool:
        """Отправляет одно полное сообщение любого размера."""
        if isinstance(data, str):
            data = data.encode('utf-8')

        try:
            header = struct.pack('>I', len(data))
            self.connection.sendall(header + data)
            return True
        except Exception:
            return False