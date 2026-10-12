import socket
import threading

from objects.identifier import Identifier
from server.client_object import ClientObject
from server.client_type import ClientType
from server.data_manager import DataManager
from settings import *


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
            receiver = self.clients_identifier_mapped[str(identifier)]

        if receiver:
            self.send_to_session(receiver.session_id, message)

    def auth_attempt(self, password: str):
        return password == PASSWORD

    def start(self):
        print(f"Listening on {str(address)}")

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

    def handle_client(self, client: ClientObject):
        sid = client.session_id
        try:
            while self.running:
                try:
                    received = client.recv()
                except (ConnectionResetError, BrokenPipeError, OSError):
                    break

                if not received:
                    break

                client.send(received)

                cmd = received.split()
                if not cmd: continue

                root = cmd[0]
                cmd = cmd[1:]
                is_master = client.type == ClientType.Master

                try:
                    if len(cmd) >= 1:
                        if client.type == ClientType.UnTyped:
                            is_master_connecting = False
                            if root == "auth":
                                password = cmd[0]
                                is_master_connecting = self.auth_attempt(password)

                            if is_master_connecting:
                                client.type = ClientType.Master
                            else:
                                client.type = ClientType.Slave

                except Exception as e:
                    print(f"[!] Command error from session={sid}: {e}")
                    try:
                        client.send(f"error;{e}")
                    except Exception:
                        pass

        finally:
            self._disconnect_client(client)

    def _disconnect_client(self, client: ClientObject):
        sid = client.session_id
        client.close()
        with self.clients_lock:
            if self.clients.get(sid) is client:
                self.clients.pop(sid, None)
            string_identifier = str(client.identifier)
            if not client.identifier.is_empty and self.clients_identifier_mapped.get(string_identifier) is client:
                self.clients_identifier_mapped.pop(string_identifier, None)
        print(f"[-] Client disconnected: session={sid}")

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
