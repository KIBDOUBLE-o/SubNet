class Identifier:
    __slots__ = '_value'

    def __init__(self, preset = None):
        self._value = preset if preset else self._create()

    @staticmethod
    def _create():
        new_identifier = ""

        return new_identifier

    @staticmethod
    def empty() -> 'Identifier':
        return Identifier("UNIDENTIFIED")

    @property
    def is_empty(self):
        return self._value == "UNIDENTIFIED"

    def __str__(self):
        return self._value
