import threading
from datetime import datetime

from settings import MAX_LOGS_LENGTH, LOGGER_SIMILARITY_THRESHOLD, LOGGER_LATEST_HISTORY_CAPACITY
from utils import SimCode


class Logger:
    LOG_LOCK = threading.Lock()
    LATEST_HISTORY = []
    _updating = False

    @staticmethod
    def _format(message: str, log_type: str) -> str:
        timestamp = datetime.now().strftime("%H:%M:%S")
        thread_name = threading.current_thread().name.upper()
        return f"{timestamp}\t[{thread_name}]\t({log_type.upper()})>\t{message}"

    @classmethod
    def _write_file(cls, log_message: str, replace_last: bool) -> None:
        try:
            with open("logs.txt", "r", encoding="utf-8", errors="replace") as file:
                logs_now = file.read().splitlines()
        except FileNotFoundError:
            logs_now = []

        if MAX_LOGS_LENGTH <= 0:
            logs_now = []
        else:
            if replace_last and logs_now:
                logs_now[-1] = log_message
            else:
                logs_now.append(log_message)
            logs_now = logs_now[-MAX_LOGS_LENGTH:]

        with open("logs.txt", "w", encoding="utf-8") as file:
            if logs_now:
                file.write("\n".join(logs_now) + "\n")

    @classmethod
    def _is_similarities_in_history(cls, string: str) -> bool:
        return any(SimCode.create(string).is_similar_with(LOGGER_SIMILARITY_THRESHOLD, SimCode(item)) for item in cls.LATEST_HISTORY)

    @classmethod
    def _add_to_history(cls, string: str):
        if len(cls.LATEST_HISTORY) > LOGGER_LATEST_HISTORY_CAPACITY:
            cls.LATEST_HISTORY = cls.LATEST_HISTORY[-LOGGER_LATEST_HISTORY_CAPACITY:]
        cls.LATEST_HISTORY.append(SimCode.create(string).value)

    @classmethod
    def log(cls, message: str, log_type: str = "debug") -> None:
        log_message = cls._format(message, log_type)

        if cls._is_similarities_in_history(log_message):
            return

        try:
            with cls.LOG_LOCK:
                if cls._updating:
                    print()
                    cls._updating = False
                print(log_message)
                cls._write_file(log_message, replace_last=False)
                cls._add_to_history(log_message)
        except OSError as e:
            print(f"Logging error: {e}")

    @classmethod
    def update_log(cls, message: str, log_type: str = "debug") -> None:
        log_message = cls._format(message, log_type)

        try:
            with cls.LOG_LOCK:
                print(f"\r\x1b[2K{log_message}", end="", flush=True)
                cls._write_file(log_message, replace_last=cls._updating)
                cls._updating = True
        except OSError as e:
            print(f"\nLogging error: {e}")