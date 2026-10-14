import json
import socket
import threading
import time

from objects.identifier import Identifier
from server.client_object import ClientObject
from server.client_type import ClientType
from server.data_manager import DataManager
from settings import *
from utils import decode_base64


class Server:
    def __init__(self):
        self.clients: dict[str, ClientObject] = {}
        self.clients_identifier_mapped: dict[str, ClientObject] = {}
        self.clients_lock = threading.Lock()

        self.data_mgr = DataManager()

        self.conn = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.conn.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.conn.bind(address.to_socket())
        self.conn.listen(50)
        self.conn.settimeout(1.0)

        self.running = True

    def send_to_session(self, session: str, message: str):
        with self.clients_lock:
            receiver = self.clients.get(session, None)

        if receiver:
            try:
                receiver.send(message)
            except:
                pass

    def send_by_identifier(self, identifier: Identifier, message: str):
        with self.clients_lock:
            print(f"[send_by_id] looking for={identifier}, mapped={list(self.clients_identifier_mapped.keys())}")
            receiver = self.clients_identifier_mapped.get(str(identifier))

        if receiver:
            self.send_to_session(receiver.session_id, message)

    def auth_attempt(self, password: str):
        return password == PASSWORD

    def start(self):
        print(f"Listening on {str(address)}")

        self.data_mgr.start_update_loop()
        self._start_ping_loop()

        while self.running:
            try:
                conn, addr = self.conn.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            except Exception as e:
                print(f"Accept error: {e}")
                continue

            client = ClientObject(Address.from_socket(addr), conn)
            sid = client.session_id
            with self.clients_lock:
                self.clients[sid] = client

            print(f"[+] Connection {str(client.address)} -> session={sid}")
            threading.Thread(target=self.handle_client, args=(client,), daemon=True).start()

    def _cmd_get_slaves(self) -> list:
        return self.data_mgr.get_slaves_tree()

    def _start_ping_loop(self):
        def loop():
            while self.running:
                time.sleep(5)
                with self.clients_lock:
                    targets = list(self.clients.values())

                now = time.monotonic()
                for client in targets:
                    if client.is_untyped:
                        continue

                    if now - client.last_pong > 30:
                        print(f"[ping] session={client.session_id} | no pong, kicking")
                        self._kick(client, reason="ping_timeout")
                        continue

                    client.ping_sent_at = time.monotonic()
                    try:
                        client.send("ping")
                    except Exception:
                        pass

        threading.Thread(target=loop, daemon=True).start()

    def handle_client(self, client: ClientObject):
        sid = client.session_id
        try:
            while self.running:
                try:
                    raw = client.recv()
                except (ConnectionResetError, BrokenPipeError, OSError):
                    break

                if not raw:
                    break

                try:
                    received = raw.decode('utf-8')
                except UnicodeDecodeError:
                    print(f"[error] session={sid} | invalid UTF-8")
                    client.send("error;invalid_encoding;Message is not valid UTF-8")
                    continue

                if not received.strip():
                    continue

                parts = received.split(maxsplit=1)
                root = parts[0]
                rest = parts[1] if len(parts) > 1 else ""

                try:
                    if root == "pong":
                        now = time.monotonic()
                        client.last_pong = now
                        if client.ping_sent_at is not None:
                            rtt = int((now - client.ping_sent_at) * 1000)
                            client.rtt_ms = rtt
                            client.ping_sent_at = None
                            if client.is_slave and not client.identifier.is_empty:
                                self.data_mgr.set_ping(str(client.identifier), rtt)
                        continue

                    if client.is_untyped:
                        if root == "auth":
                            auth_parts = rest.split(maxsplit=1)

                            if len(auth_parts) < 2:
                                print(f"[error] session={sid} | auth | missing identifier")
                                client.send("error;auth;Usage: auth <password> <identifier>")
                                continue

                            password = auth_parts[0].strip()
                            identifier = auth_parts[1].strip()

                            if not password:
                                client.send("error;auth;Password is empty")
                                continue

                            if not identifier:
                                client.send("error;auth;Identifier is empty")
                                continue

                            is_master = self.auth_attempt(password)
                            auth_ok = is_master or password == "wrong"

                            if not auth_ok:
                                print(f"[auth] session={sid} | fail (bad password)")
                                client.send("auth;fail")
                                continue

                            with self.clients_lock:
                                client.identifier = Identifier(identifier)
                                client.type = ClientType.Master if is_master else ClientType.Slave

                            self._register_and_dedup(client)

                            if is_master:
                                print(
                                    f"[auth] session={sid} | master ok "
                                    f"| identifier={client.identifier}"
                                )
                            else:
                                print(
                                    f"[auth] session={sid} | slave ok "
                                    f"| identifier={client.identifier}"
                                )

                            client.send(f"auth;ok;{client.identifier}")

                    else:
                        if client.is_master:
                            if root == "request":
                                if not rest:
                                    print(f"[error] session={sid} | request | missing subject")
                                    client.send(
                                        "error;request;Missing subject. "
                                        "Usage: request slaves | request slave <id> <cmd> [args]"
                                    )
                                    continue

                                req_parts = rest.split(maxsplit=1)
                                subject = req_parts[0]

                                if subject == "slaves":
                                    client.send(
                                        f"slaves{json.dumps(self._cmd_get_slaves())}"
                                    )

                                elif subject == "slave":
                                    if len(req_parts) < 2:
                                        print(f"[error] session={sid} | request slave | missing args")
                                        client.send(
                                            "error;request;Missing arguments. "
                                            "Usage: request slave <id> <cmd> [args]"
                                        )
                                        continue

                                    slave_parts = req_parts[1].split(maxsplit=2)
                                    if len(slave_parts) < 2:
                                        print(
                                            f"[error] session={sid} | request slave | "
                                            f"need <id> and <cmd>, got: {req_parts[1]!r}"
                                        )
                                        client.send(
                                            "error;request;Need at least <id> and <cmd>. "
                                            "Usage: request slave <id> <cmd> [args]"
                                        )
                                        continue

                                    target = slave_parts[0]
                                    request = slave_parts[1]
                                    args = slave_parts[2] if len(slave_parts) > 2 else ""

                                    try:
                                        self.send_by_identifier(
                                            Identifier(target),
                                            f"request {request} {args} {client.identifier}".strip()
                                        )
                                    except KeyError:
                                        print(f"[error] session={sid} | request slave | not found: {target}")
                                        client.send(
                                            f"error;request;Slave not found: {target}"
                                        )
                                    except Exception as e:
                                        print(
                                            f"[error] session={sid} | request slave | "
                                            f"send failed target={target}: {type(e).__name__}: {e}"
                                        )
                                        client.send(
                                            f"error;request;Failed to send to slave {target}: {e}"
                                        )

                                elif subject == "group":
                                    if len(req_parts) < 2:
                                        client.send("error;request;Missing group action")
                                        continue

                                    group_parts = req_parts[1].split(maxsplit=2)
                                    action = group_parts[0] if group_parts else ""
                                    if action == "create":
                                        if len(group_parts) < 2:
                                            client.send("error;request;Usage: request group create <name>")
                                            continue

                                        name = decode_base64(group_parts[1])
                                        with self.data_mgr.lock:
                                            self.data_mgr.data["slaves"].append({
                                                "type": "group",
                                                "name": name,
                                                "children": []
                                            })
                                            self.data_mgr._write_unlocked()
                                        client.send(f"slaves{json.dumps(self._cmd_get_slaves())}")

                                    elif action == "rename":
                                        if len(group_parts) < 3:
                                            client.send("error;request;Usage: request group rename <old> <new>")
                                            continue

                                        old_name = decode_base64(group_parts[1])
                                        new_name = decode_base64(group_parts[2])
                                        with self.data_mgr.lock:
                                            for node in self.data_mgr.data["slaves"]:
                                                if node.get("type") == "group" and node.get("name") == old_name:
                                                    node["name"] = new_name
                                                    break
                                            self.data_mgr._write_unlocked()
                                        client.send(f"slaves{json.dumps(self._cmd_get_slaves())}")

                                    elif action == "remove":
                                        if len(group_parts) < 2:
                                            client.send("error;request;Usage: request group remove <name>")
                                            continue

                                        name = decode_base64(group_parts[1])
                                        with self.data_mgr.lock:
                                            self.data_mgr.data["slaves"] = [
                                                n for n in self.data_mgr.data["slaves"]
                                                if not (n.get("type") == "group" and n.get("name") == name)
                                            ]
                                            self.data_mgr._write_unlocked()
                                        client.send(f"slaves{json.dumps(self._cmd_get_slaves())}")

                                    elif action == "slave_rename":
                                        if len(group_parts) < 3:
                                            client.send("error;request;Usage: request group slave_rename <id> <name>")
                                            continue
                                        slave_id = decode_base64(group_parts[1])
                                        display_name = decode_base64(group_parts[2])
                                        self.data_mgr.rename_slave(slave_id, display_name)
                                        client.send(f"slaves{json.dumps(self._cmd_get_slaves())}")

                                    elif action == "move_slave":
                                        if len(group_parts) < 2:
                                            client.send("error;request;Usage: request group move_slave <id> [group]")
                                            continue

                                        slave_id = decode_base64(group_parts[1])
                                        raw_group = decode_base64(group_parts[2]) if len(group_parts) > 2 else None
                                        group_name = None if raw_group in (None, "null", "", "None") else raw_group
                                        print(f"[move_slave] slave_id={slave_id}, group={group_name}")
                                        self.data_mgr.move_slave(slave_id, group_name)
                                        client.send(f"slaves{json.dumps(self._cmd_get_slaves())}")

                                    else:
                                        client.send(f"error;request;Unknown group action '{action}'")

                                else:
                                    print(f"[error] session={sid} | request | unknown subject '{subject}'")
                                    client.send(
                                        f"error;request;Unknown subject '{subject}'. "
                                        f"Available: slaves, slave"
                                    )

                            elif root == "send":
                                send_parts = rest.split(maxsplit=2)
                                if len(send_parts) < 3:
                                    print(
                                        f"[error] session={sid} | send | missing args: {rest!r}"
                                    )
                                    client.send(
                                        "error;send;Missing arguments. "
                                        "Usage: send <subject> <target> <payload>"
                                    )
                                    continue

                                subject = send_parts[0]
                                target = send_parts[1]
                                payload = send_parts[2]

                                try:
                                    self.send_by_identifier(
                                        Identifier(target),
                                        f"send {subject} {payload}"
                                    )
                                except KeyError:
                                    print(f"[error] session={sid} | send | target not found: {target}")
                                    client.send(
                                        f"error;send;Target not found: {target}"
                                    )
                                except Exception as e:
                                    print(
                                        f"[error] session={sid} | send | "
                                        f"failed target={target}: {type(e).__name__}: {e}"
                                    )
                                    client.send(
                                        f"error;send;Failed to send to {target}: {e}"
                                    )

                            else:
                                print(f"[error] session={sid} | unknown command '{root}'")
                                client.send(
                                    f"error;unknown_command;Unknown command '{root}'. "
                                    f"Available: request, send"
                                )

                        elif client.is_slave:
                            if root == "send":
                                send_parts = rest.split(maxsplit=2)
                                if len(send_parts) < 3:
                                    print(
                                        f"[error] session={sid} | slave send | missing args: {rest!r}"
                                    )
                                    client.send(
                                        "error;send;Missing arguments. "
                                        "Usage: send <subject> <target> <payload>"
                                    )
                                    continue

                                subject = send_parts[0]
                                target = send_parts[1]
                                payload = send_parts[2]

                                try:
                                    self.send_by_identifier(
                                        Identifier(target),
                                        f"send {subject} {payload}"
                                    )
                                except KeyError:
                                    print(
                                        f"[error] session={sid} | slave send | target not found: {target} all identifiers: {list(self.clients_identifier_mapped.keys())}")
                                    client.send(
                                        f"error;send;Target not found: {target}"
                                    )
                                except Exception as e:
                                    print(
                                        f"[error] session={sid} | slave send | "
                                        f"failed target={target}: {type(e).__name__}: {e}"
                                    )
                                    client.send(
                                        f"error;send;Failed to send to {target}: {e}"
                                    )
                            else:
                                print(f"[slave:{sid}] {received}")

                except Exception as e:
                    print(
                        f"[error] session={sid} | internal | "
                        f"{type(e).__name__}: {e} | raw={received!r}"
                    )
                    try:
                        client.send(f"error;internal;{type(e).__name__}: {e}")
                    except Exception:
                        pass

        finally:
            self._disconnect_client(client)

    def _disconnect_client(self, client: ClientObject):
        client.close()
        with self.clients_lock:
            if self.clients.get(client.session_id) is client:
                self.clients.pop(client.session_id)

            key = str(client.identifier)
            if (
                    not client.identifier.is_empty
                    and self.clients_identifier_mapped.get(key) is client
            ):
                self.clients_identifier_mapped.pop(key)

        if client.is_slave and not client.identifier.is_empty:
            self.data_mgr.on_slave_disconnected(str(client.identifier))

        print(f"[-] {client.session_id} disconnected")

    def stop(self):
        if not self.running:
            return
        print("Stopping server...")
        self.running = False

        with self.clients_lock:
            for client in self.clients.values():
                client.close()
            self.clients.clear()
            self.clients_identifier_mapped.clear()

        try:
            self.conn.close()
        except:
            pass

        self.data_mgr.update_data()

    def _register_and_dedup(self, client: ClientObject):
        victims = []

        with self.clients_lock:
            if client.is_master:
                victims = [c for c in self.clients.values() if c is not client and c.is_master]
                if key := (str(client.identifier) if not client.identifier.is_empty else None):
                    self.clients_identifier_mapped[key] = client

            elif client.is_slave:
                key = str(client.identifier) if not client.identifier.is_empty else None
                for other in self.clients.values():
                    if other is client or not other.is_slave:
                        continue
                    same_id = key and not other.identifier.is_empty and str(other.identifier) == key
                    same_ip = other.address.ip == client.address.ip
                    if same_id or (not key and same_ip):
                        victims.append(other)
                if key:
                    self.clients_identifier_mapped[key] = client

        # on_slave_connected до кика — новый клиент уже в маппинге
        if client.is_slave and not client.identifier.is_empty:
            self.data_mgr.on_slave_connected(str(client.identifier), client.address.ip)

        for other in victims:
            self._kick(other, reason="duplicate")

    def _kick(self, client: ClientObject, reason: str = "replaced"):
        try:
            client.send(f"kick;{reason}")
        except Exception:
            pass
        client.close()
        with self.clients_lock:
            if self.clients.get(client.session_id) is client:
                self.clients.pop(client.session_id, None)
            key = str(client.identifier)
            if not client.identifier.is_empty and self.clients_identifier_mapped.get(key) is client:
                self.clients_identifier_mapped.pop(key, None)
        print(f"[kick] {client.session_id} reason={reason}")
