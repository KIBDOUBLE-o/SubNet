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
from logger import Logger


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
                size = len(message.encode()) if isinstance(message, str) else len(message)
                Logger.log(f"send_to_session | session={session} size={size}", "debug")
                receiver.send(message)
            except Exception as e:
                Logger.log(f"send_to_session | session={session} | send failed: {type(e).__name__}: {e}", "error")
        else:
            Logger.log(f"send_to_session | session={session} | receiver not found", "warn")

    def send_by_identifier(self, identifier: Identifier, message: str):
        with self.clients_lock:
            receiver = self.clients_identifier_mapped.get(str(identifier))

        if receiver:
            self.send_to_session(receiver.session_id, message)
        else:
            Logger.log(f"send_by_identifier | identifier={identifier} | not found | mapped={list(self.clients_identifier_mapped.keys())}", "warn")

    def auth_attempt(self, password: str):
        return password == PASSWORD

    def start(self):
        Logger.log(f"Listening on {str(address)}", "info")

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
                Logger.log(f"accept error: {type(e).__name__}: {e}", "error")
                continue

            client = ClientObject(Address.from_socket(addr), conn)
            sid = client.session_id
            with self.clients_lock:
                self.clients[sid] = client

            Logger.log(f"connection {str(client.address)} -> session={sid}", "info")
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
                        Logger.log(f"ping | session={client.session_id} identifier={client.identifier} | no pong, kicking", "warn")
                        self._kick(client, reason="ping_timeout")
                        continue

                    client.ping_sent_at = time.monotonic()
                    try:
                        client.send("ping")
                    except Exception as e:
                        Logger.log(f"ping | session={client.session_id} | send failed: {type(e).__name__}: {e}", "error")

        threading.Thread(target=loop, daemon=True).start()

    def handle_client(self, client: ClientObject):
        sid = client.session_id
        try:
            while self.running:
                try:
                    raw = client.recv()
                except (ConnectionResetError, BrokenPipeError, OSError) as e:
                    Logger.log(f"session={sid} | recv error | {type(e).__name__}: {e}", "error")
                    break

                if not raw:
                    # Logger.log(f"session={sid} | recv returned empty, closing", "warn")
                    time.sleep(1)
                    continue

                try:
                    received = raw.decode('utf-8')
                except UnicodeDecodeError:
                    Logger.log(f"session={sid} | invalid UTF-8", "error")
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
                                Logger.log(f"session={sid} | auth | missing identifier", "error")
                                client.send("error;auth;Usage: auth <password> <identifier>")
                                continue

                            password = auth_parts[0].strip()
                            identifier = auth_parts[1].strip()

                            if not password:
                                Logger.log(f"session={sid} | auth | empty password", "warn")
                                client.send("error;auth;Password is empty")
                                continue

                            if not identifier:
                                Logger.log(f"session={sid} | auth | empty identifier", "warn")
                                client.send("error;auth;Identifier is empty")
                                continue

                            is_master = self.auth_attempt(password)
                            auth_ok = is_master or password == "wrong"

                            if not auth_ok:
                                Logger.log(f"session={sid} | auth | fail (bad password)", "warn")
                                client.send("auth;fail")
                                continue

                            with self.clients_lock:
                                client.identifier = Identifier(identifier)
                                client.type = ClientType.Master if is_master else ClientType.Slave

                            Logger.log(f"session={sid} | auth ok | type={'master' if is_master else 'slave'} | identifier={client.identifier}", "info")
                            self._register_and_dedup(client)
                            client.send(f"auth;ok;{client.identifier}")

                    else:
                        if client.is_master:
                            if root == "request":
                                if not rest:
                                    Logger.log(f"session={sid} | request | missing subject", "error")
                                    client.send(
                                        "error;request;Missing subject. "
                                        "Usage: request slaves | request slave <id> <cmd> [args]"
                                    )
                                    continue

                                req_parts = rest.split(maxsplit=1)
                                subject = req_parts[0]

                                if subject == "slaves":
                                    Logger.log(f"session={sid} | request slaves", "info")
                                    client.send(f"slaves{json.dumps(self._cmd_get_slaves())}")

                                elif subject == "slave":
                                    if len(req_parts) < 2:
                                        Logger.log(f"session={sid} | request slave | missing args", "error")
                                        client.send(
                                            "error;request;Missing arguments. "
                                            "Usage: request slave <id> <cmd> [args]"
                                        )
                                        continue

                                    slave_parts = req_parts[1].split(maxsplit=2)
                                    if len(slave_parts) < 2:
                                        Logger.log(f"session={sid} | request slave | need <id> and <cmd>, got: {req_parts[1]!r}", "error")
                                        client.send(
                                            "error;request;Need at least <id> and <cmd>. "
                                            "Usage: request slave <id> <cmd> [args]"
                                        )
                                        continue

                                    target = slave_parts[0]
                                    request = slave_parts[1]
                                    args = slave_parts[2] if len(slave_parts) > 2 else ""

                                    Logger.log(f"session={sid} | request slave | target={target} request={request} args={args!r}", "info")
                                    try:
                                        self.send_by_identifier(
                                            Identifier(target),
                                            f"request {request} {args} {client.identifier}".strip()
                                        )
                                    except KeyError:
                                        Logger.log(f"session={sid} | request slave | not found: {target}", "error")
                                        client.send(f"error;request;Slave not found: {target}")
                                    except Exception as e:
                                        Logger.log(f"session={sid} | request slave | send failed target={target}: {type(e).__name__}: {e}", "error")
                                        client.send(f"error;request;Failed to send to slave {target}: {e}")

                                elif subject == "group":
                                    if len(req_parts) < 2:
                                        Logger.log(f"session={sid} | request group | missing action", "error")
                                        client.send("error;request;Missing group action")
                                        continue

                                    group_parts = req_parts[1].split(maxsplit=2)
                                    action = group_parts[0] if group_parts else ""
                                    Logger.log(f"session={sid} | request group | action={action}", "info")

                                    if action == "create":
                                        if len(group_parts) < 2:
                                            Logger.log(f"session={sid} | group create | missing name", "error")
                                            client.send("error;request;Usage: request group create <name>")
                                            continue

                                        name = decode_base64(group_parts[1])
                                        Logger.log(f"session={sid} | group create | name={name!r}", "info")
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
                                            Logger.log(f"session={sid} | group rename | missing args", "error")
                                            client.send("error;request;Usage: request group rename <old> <new>")
                                            continue

                                        old_name = decode_base64(group_parts[1])
                                        new_name = decode_base64(group_parts[2])
                                        Logger.log(f"session={sid} | group rename | {old_name!r} -> {new_name!r}", "info")
                                        with self.data_mgr.lock:
                                            for node in self.data_mgr.data["slaves"]:
                                                if node.get("type") == "group" and node.get("name") == old_name:
                                                    node["name"] = new_name
                                                    break
                                            self.data_mgr._write_unlocked()
                                        client.send(f"slaves{json.dumps(self._cmd_get_slaves())}")

                                    elif action == "remove":
                                        if len(group_parts) < 2:
                                            Logger.log(f"session={sid} | group remove | missing name", "error")
                                            client.send("error;request;Usage: request group remove <name>")
                                            continue

                                        name = decode_base64(group_parts[1])
                                        Logger.log(f"session={sid} | group remove | name={name!r}", "info")
                                        with self.data_mgr.lock:
                                            new_root = []
                                            for n in self.data_mgr.data["slaves"]:
                                                if n.get("type") == "group" and n.get("name") == name:
                                                    new_root.extend(n.get("children", []))
                                                else:
                                                    new_root.append(n)
                                            self.data_mgr.data["slaves"] = new_root
                                            self.data_mgr._write_unlocked()
                                        client.send(f"slaves{json.dumps(self._cmd_get_slaves())}")

                                    elif action == "slave_rename":
                                        if len(group_parts) < 3:
                                            Logger.log(f"session={sid} | slave_rename | missing args", "error")
                                            client.send("error;request;Usage: request group slave_rename <id> <name>")
                                            continue
                                        slave_id = decode_base64(group_parts[1])
                                        display_name = decode_base64(group_parts[2])
                                        Logger.log(f"session={sid} | slave_rename | id={slave_id!r} name={display_name!r}", "info")
                                        self.data_mgr.rename_slave(slave_id, display_name)
                                        client.send(f"slaves{json.dumps(self._cmd_get_slaves())}")

                                    elif action == "move_slave":
                                        if len(group_parts) < 2:
                                            Logger.log(f"session={sid} | move_slave | missing args", "error")
                                            client.send("error;request;Usage: request group move_slave <id> [group]")
                                            continue

                                        slave_id = decode_base64(group_parts[1])
                                        raw_group = decode_base64(group_parts[2]) if len(group_parts) > 2 else None
                                        group_name = None if raw_group in (None, "null", "", "None") else raw_group
                                        Logger.log(f"session={sid} | move_slave | slave_id={slave_id!r} group={group_name!r}", "info")
                                        self.data_mgr.move_slave(slave_id, group_name)
                                        client.send(f"slaves{json.dumps(self._cmd_get_slaves())}")

                                    else:
                                        Logger.log(f"session={sid} | group | unknown action={action!r}", "error")
                                        client.send(f"error;request;Unknown group action '{action}'")

                                else:
                                    Logger.log(f"session={sid} | request | unknown subject={subject!r}", "error")
                                    client.send(
                                        f"error;request;Unknown subject '{subject}'. "
                                        f"Available: slaves, slave"
                                    )

                            elif root == "send":
                                send_parts = rest.split(maxsplit=2)
                                if len(send_parts) < 3:
                                    Logger.log(f"session={sid} | master send | missing args: {rest!r}", "error")
                                    client.send(
                                        "error;send;Missing arguments. "
                                        "Usage: send <subject> <target> <payload>"
                                    )
                                    continue

                                subject = send_parts[0]
                                target = send_parts[1]
                                payload = send_parts[2]
                                Logger.log(f"session={sid} | master send | subject={subject} target={target} payload_len={len(payload)}", "info")

                                try:
                                    self.send_by_identifier(
                                        Identifier(target),
                                        f"send {subject} {payload}"
                                    )
                                except KeyError:
                                    Logger.log(f"session={sid} | master send | target not found: {target}", "error")
                                    client.send(f"error;send;Target not found: {target}")
                                except Exception as e:
                                    Logger.log(f"session={sid} | master send | failed target={target}: {type(e).__name__}: {e}", "error")
                                    client.send(f"error;send;Failed to send to {target}: {e}")

                            else:
                                Logger.log(f"session={sid} | unknown command={root!r}", "error")
                                client.send(
                                    f"error;unknown_command;Unknown command '{root}'. "
                                    f"Available: request, send"
                                )

                        elif client.is_slave:
                            if root == "send":
                                send_parts = rest.split(maxsplit=2)
                                if len(send_parts) < 3:
                                    Logger.log(f"session={sid} | slave send | missing args: {rest!r}", "error")
                                    client.send(
                                        "error;send;Missing arguments. "
                                        "Usage: send <subject> <target> <payload>"
                                    )
                                    continue

                                subject = send_parts[0]
                                target = send_parts[1]
                                payload = send_parts[2]

                                if subject == "slave_screen":
                                    Logger.log(f"session={sid} | slave send | subject=slave_screen target={target} payload_len={len(payload)}", "debug")
                                else:
                                    Logger.log(f"session={sid} | slave send | subject={subject} target={target} payload_len={len(payload)}", "info")

                                try:
                                    self.send_by_identifier(
                                        Identifier(target),
                                        f"send {subject} {payload}"
                                    )
                                except KeyError:
                                    Logger.log(f"session={sid} | slave send | target not found: {target} | all: {list(self.clients_identifier_mapped.keys())}", "error")
                                    client.send(f"error;send;Target not found: {target}")
                                except Exception as e:
                                    Logger.log(f"session={sid} | slave send | failed target={target}: {type(e).__name__}: {e}", "error")
                                    client.send(f"error;send;Failed to send to {target}: {e}")
                            else:
                                Logger.log(f"session={sid} | slave | unhandled root={root!r} | {received[:120]}", "debug")

                except Exception as e:
                    Logger.log(f"session={sid} | internal | {type(e).__name__}: {e} | raw={received!r}", "error")
                    try:
                        client.send(f"error;internal;{type(e).__name__}: {e}")
                    except Exception:
                        pass

        finally:
            self._disconnect_client(client)

    def _disconnect_client(self, client: ClientObject):
        client.close()
        owned_identifier = False

        with self.clients_lock:
            if self.clients.get(client.session_id) is client:
                self.clients.pop(client.session_id)

            key = str(client.identifier)
            if (
                not client.identifier.is_empty
                and self.clients_identifier_mapped.get(key) is client
            ):
                self.clients_identifier_mapped.pop(key)
                owned_identifier = True

        if client.is_slave and not client.identifier.is_empty and owned_identifier:
            self.data_mgr.on_slave_disconnected(str(client.identifier))

        Logger.log(f"disconnected | session={client.session_id} identifier={client.identifier} type={client.type} owned_identifier={owned_identifier}", "info")

    def stop(self):
        if not self.running:
            return
        Logger.log("stopping server...", "info")
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

        if client.is_slave and not client.identifier.is_empty:
            self.data_mgr.on_slave_connected(str(client.identifier), client.address.ip)

        for other in victims:
            Logger.log(f"dedup | kicking session={other.session_id} identifier={other.identifier} reason=duplicate", "warn")
            self._kick(other, reason="duplicate")

    def _kick(self, client: ClientObject, reason: str = "replaced"):
        Logger.log(f"kick | session={client.session_id} identifier={client.identifier} reason={reason}", "warn")
        try:
            client.send(f"kick;{reason}")
        except Exception as e:
            Logger.log(f"kick | session={client.session_id} | send failed: {type(e).__name__}: {e}", "error")
        client.close()
        with self.clients_lock:
            if self.clients.get(client.session_id) is client:
                self.clients.pop(client.session_id, None)
            key = str(client.identifier)
            if not client.identifier.is_empty and self.clients_identifier_mapped.get(key) is client:
                self.clients_identifier_mapped.pop(key, None)
