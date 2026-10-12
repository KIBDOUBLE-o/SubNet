class Address:
    __slots__ = ('ip', 'port')

    def __init__(self, ip: str, port: int):
        self.ip = ip
        self.port = port

    def to_socket(self) -> tuple:
        return self.ip, self.port

    @staticmethod
    def from_socket(address: tuple) -> 'Address':
        return Address(address[0], address[1])

    def __str__(self):
        return f"{self.ip}:{self.port}"
