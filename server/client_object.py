import socket
from socket import socket as con
import struct

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

    def close(self):
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except:
            pass
        try:
            self.connection.close()
        except:
            pass

    def _recv_exact(self, n: int) -> bytes:
        data = bytearray()
        while len(data) < n:
            chunk = self.connection.recv(n - len(data))
            if not chunk:
                return b''
            data.extend(chunk)
        return bytes(data)

    def recv(self) -> str:
        header = self._recv_exact(4)
        if not header:
            return ""

        length = struct.unpack('>I', header)[0]
        if length == 0:
            return ""

        return self._recv_exact(length).decode("utf-8", errors="replace")

    def send(self, data: bytes | str):
        if isinstance(data, str):
            data = data.encode('utf-8')

        header = struct.pack('>I', len(data))
        self.connection.sendall(header + data)
