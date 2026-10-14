import json
import os.path
import threading
from time import sleep


class DataManager:
    def __init__(self):
        self.data = {}
        self.lock = threading.Lock()
        self.last_update_time = 0.0
        self.reload_data()

    @property
    def slaves(self) -> list:
        return self.data.get("slaves", [])

    def start_update_loop(self):
        def loop():
            while True:
                if self.is_dirty():
                    self.reload_data()
                sleep(10)
        threading.Thread(target=loop, daemon=True).start()

    def reload_data(self):
        with self.lock:
            if os.path.exists("data.json"):
                with open("data.json", "r", encoding="utf-8") as f:
                    self.data = json.load(f)
                self.data.setdefault("slaves", [])
            else:
                self.data = {"slaves": []}
                self._write_unlocked()
            self.last_update_time = self._mtime()

    def update_data(self):
        with self.lock:
            self._write_unlocked()

    def _write_unlocked(self):
        with open("data.json", "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=4, ensure_ascii=False)
        self.last_update_time = self._mtime()

    def _mtime(self):
        try:
            return os.path.getmtime("data.json")
        except FileNotFoundError:
            return 0.0

    def is_dirty(self):
        t = self._mtime()
        if t != self.last_update_time:
            self.last_update_time = t
            return True
        return False

    # --- slave registry ---

    def _find_slave(self, nodes: list, slave_id: str) -> dict | None:
        """Рекурсивный поиск slave по id в дереве."""
        for node in nodes:
            if node.get("type") == "slave" and node.get("id") == slave_id:
                return node
            if node.get("type") == "group":
                found = self._find_slave(node.get("children", []), slave_id)
                if found:
                    return found
        return None

    def on_slave_connected(self, slave_id: str, ip: str):
        with self.lock:
            node = self._find_slave(self.data["slaves"], slave_id)
            if node:
                node["ip"] = ip
                node["online"] = True
            else:
                self.data["slaves"].append({
                    "type": "slave",
                    "id": slave_id,
                    "displayName": slave_id,
                    "ip": ip,
                    "ping": None,
                    "online": True,
                })
            self._write_unlocked()

    def on_slave_disconnected(self, slave_id: str):
        with self.lock:
            node = self._find_slave(self.data["slaves"], slave_id)
            if node:
                node["online"] = False
                node["ping"] = None
                self._write_unlocked()

    def get_slaves_tree(self) -> list:
        with self.lock:
            return json.loads(json.dumps(self.data["slaves"]))

    def _remove_slave(self, nodes: list, slave_id: str) -> dict | None:
        """Вырезает slave из дерева, возвращает его или None."""
        for i, node in enumerate(nodes):
            if node.get("type") == "slave" and node.get("id") == slave_id:
                return nodes.pop(i)
            if node.get("type") == "group":
                found = self._remove_slave(node.get("children", []), slave_id)
                if found:
                    return found
        return None

    def rename_slave(self, slave_id: str, display_name: str) -> bool:
        with self.lock:
            node = self._find_slave(self.data["slaves"], slave_id)
            if not node:
                return False
            node["displayName"] = display_name
            self._write_unlocked()
        return True

    def move_slave(self, slave_id: str, group_name: str | None) -> bool:
        with self.lock:
            slave = self._remove_slave(self.data["slaves"], slave_id)
            if not slave:
                return False
            if group_name is None:
                self.data["slaves"].append(slave)
            else:
                for node in self.data["slaves"]:
                    if node.get("type") == "group" and node.get("name") == group_name:
                        node["children"].append(slave)
                        break
                else:
                    # группа не найдена — вернуть на место в корень
                    self.data["slaves"].append(slave)
            self._write_unlocked()
        return True
