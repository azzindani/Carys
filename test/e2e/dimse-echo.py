#!/usr/bin/env python3
"""T1 DIMSE handshake: pynetdicom C-ECHO loopback against an in-process SCP.

TOOLING only — never shipped, never in packages/. Proves the DIMSE upper
layer works in this environment (association + Verification SOP + 0x0000
success) so a future live-server handshake script has a verified floor.
pynetdicom 3.0.4 MIT (past back 2026-09-18). Exits nonzero on any failure.
"""
import sys
import time

from pynetdicom import AE
from pynetdicom.sop_class import Verification

PORT = 11119


def main():
    scp = AE()
    scp.add_supported_context(Verification)
    server = scp.start_server(('', PORT), block=False)
    time.sleep(0.5)
    try:
        ae = AE()
        ae.add_requested_context(Verification)
        assoc = ae.associate('localhost', PORT)
        if not assoc.is_established:
            print('FAIL dimse-echo: association rejected')
            return 1
        try:
            status = assoc.send_c_echo()
            if status is None or getattr(status, 'Status', None) != 0x0000:
                print(f'FAIL dimse-echo: status {status!r}')
                return 1
        finally:
            assoc.release()
    finally:
        server.shutdown()
    print('agree dimse-echo: C-ECHO 0x0000 over loopback (pynetdicom)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
