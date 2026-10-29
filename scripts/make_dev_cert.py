"""Create a self-signed HTTPS certificate for testing on phones over the home Wi-Fi.

Phones only allow camera/microphone on HTTPS pages. This makes a certificate valid for localhost and
this computer's LAN addresses. It is NOT installed into any trust store — the phone shows a one-time
"not secure" warning that you accept (for both :3000 and :8000).

Usage: backend/.venv/Scripts/python scripts/make_dev_cert.py
Writes certs/dev-cert.pem and certs/dev-key.pem (gitignored).
"""

import datetime
import ipaddress
import socket
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

OUT = Path(__file__).resolve().parents[1] / "certs"


def lan_addresses() -> list[str]:
    addrs = {"127.0.0.1"}
    try:
        # The address the OS would use to reach the internet = this machine's Wi-Fi/LAN address.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            addrs.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addrs.add(info[4][0])
    except OSError:
        pass
    return sorted(a for a in addrs if ipaddress.ip_address(a).is_private or a == "127.0.0.1")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    ips = lan_addresses()
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "SignSense dev")])
    now = datetime.datetime.now(datetime.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=90))
        .add_extension(
            x509.SubjectAlternativeName(
                [x509.DNSName("localhost")] + [x509.IPAddress(ipaddress.ip_address(ip)) for ip in ips]
            ),
            critical=False,
        )
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    (OUT / "dev-key.pem").write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    )
    (OUT / "dev-cert.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    lan = [ip for ip in ips if ip != "127.0.0.1"]
    print(f"certificate for localhost, {', '.join(ips)} -> {OUT} (valid 90 days)")
    if lan:
        print(f"On your phone open: https://{lan[0]}:8000/api/health (accept warning), then https://{lan[0]}:3000")


if __name__ == "__main__":
    main()
