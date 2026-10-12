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

    ## Shortcuts

    @property
    def clients(self) -> list[dict]:
        return self.data.get("clients", [])

    ##

    def start_update_loop(self):
        def loop():
            while True:
                if self.is_dirty():
                    self.reload_data()

                sleep(10)

        threading.Thread(target=loop, daemon=True).start()

    def reload_data(self):
        if os.path.exists("data.json"):
            with open("data.json", "r", encoding="utf-8") as file:
                self.data = json.load(file)

            self.data.setdefault("clients", {})
        else:
            self.data = {
                "clients": {}
            }
            with open("data.json", "w", encoding="utf-8") as file:
                json.dump(self.data, file, indent=4, ensure_ascii=False)

    def update_data(self):
        with self.lock:
            with open("data.json", "w", encoding="utf-8") as file:
                json.dump(self.data, file, indent=4, ensure_ascii=False)
            self.last_update_time = os.path.getmtime("data.json")

    def is_dirty(self):
        new_update_time = os.path.getmtime("data.json")
        if new_update_time != self.last_update_time:
            self.last_update_time = new_update_time
            return True
        return False
