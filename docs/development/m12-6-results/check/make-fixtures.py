"""Synthetic wide animated GIF for isolated browser tests; standard library only."""
from pathlib import Path
import struct
import tempfile


def lzw(index, count):
    codes = []
    for _ in range(count):
        codes += [4, index]
    codes.append(5)
    bits = 0
    nbits = 0
    output = bytearray()
    for code in codes:
        bits |= code << nbits
        nbits += 3
        while nbits >= 8:
            output.append(bits & 255)
            bits >>= 8
            nbits -= 8
    if nbits:
        output.append(bits & 255)
    blocks = bytearray([2])
    for start in range(0, len(output), 255):
        part = output[start:start + 255]
        blocks += bytes([len(part)]) + part
    return bytes(blocks) + b'\x00'


out = Path(tempfile.gettempdir()) / '39page-m126-images'
out.mkdir(exist_ok=True)
width, height = 160, 80
data = b'GIF89a' + struct.pack('<HH', width, height) + bytes([0x80, 0, 0])
data += bytes([255, 140, 190, 0, 150, 160])
data += b'!\xff\x0bNETSCAPE2.0\x03\x01\x00\x00\x00'
for index in range(2):
    data += b'!\xf9\x04\x00' + struct.pack('<H', 30) + b'\x00\x00'
    data += b',' + struct.pack('<HHHH', 0, 0, width, height) + b'\x00'
    data += lzw(index, width * height)
data += b';'
(out / 'wide.gif').write_bytes(data)
print(out)
