from enum import Enum


class ClientType(Enum):
    UnTyped = "untyped"
    Slave = "slave"
    Master = "master"
