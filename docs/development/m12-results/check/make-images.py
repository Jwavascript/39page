# M12 실제 Chrome 시험용 이미지 — 표준 라이브러리만으로 만든다 (외부 도구 없음).
#   python make-images.py <out-dir>
# - cover-a.png   96×96 RGB 그라디언트 (정지)
# - cover-b.png   64×64 다른 그라디언트 (교체 시험)
# - dance.gif     8×8, 2 프레임(흰 · 검정 번갈아), 0.3초 — 움직이는 GIF
# - fake.png      PNG 라고 이름만 붙인 HTML (거절돼야 한다)
# - broken.png    PNG 서명 뒤가 망가진 파일 (디코딩 실패해야 한다)
# - noise-00..29.png  580×580 무작위 잡음, 압축 없음(약 1 MB) — 큰 ZIP · 메모리 · 120곡 측정용
# - big.gif       256×256, 16 프레임, 0.06초 — GIF CPU 측정용
import os
import random
import struct
import sys
import zlib

out = sys.argv[1]
os.makedirs(out, exist_ok=True)

PNG_SIGNATURE = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_png(path, size, rows, level=6):
    data = PNG_SIGNATURE
    data += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(rows, level))
    data += chunk(b'IEND', b'')
    with open(os.path.join(out, path), 'wb') as handle:
        handle.write(data)


def png(path, size, shade):
    rows = b''
    for y in range(size):
        rows += bytes([0]) + bytes(
            v for x in range(size) for v in ((x * 255 // size), (y * 255 // size), shade)
        )
    write_png(path, size, rows)


def noise_png(path, size, seed):
    rng = random.Random(seed)
    rows = b''.join(bytes([0]) + rng.randbytes(size * 3) for _ in range(size))
    write_png(path, size, rows, level=0)


def lzw_flat(index, count):
    """최소 코드 크기 2, 픽셀마다 clear 를 넣어 코드 폭을 3비트로 고정한 LZW."""
    codes = []
    for _ in range(count):
        codes += [4, index]
    codes.append(5)
    bits = 0
    nbits = 0
    out_bytes = bytearray()
    for code in codes:
        bits |= code << nbits
        nbits += 3
        while nbits >= 8:
            out_bytes.append(bits & 0xFF)
            bits >>= 8
            nbits -= 8
    if nbits:
        out_bytes.append(bits & 0xFF)
    blocks = bytearray([2])
    for start in range(0, len(out_bytes), 255):
        part = out_bytes[start:start + 255]
        blocks += bytes([len(part)]) + part
    blocks += bytes([0])
    return bytes(blocks)


def gif(path, size=8, frames=2, delay=30):
    data = b'GIF89a' + struct.pack('<HH', size, size) + bytes([0x80, 0, 0])
    data += bytes([0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00])  # 색표: 흰, 검정
    data += b'!' + bytes([0xFF, 0x0B]) + b'NETSCAPE2.0' + bytes([0x03, 0x01, 0x00, 0x00, 0x00])  # 무한 반복
    for frame in range(frames):
        index = frame % 2
        data += b'!' + bytes([0xF9, 0x04, 0x00]) + struct.pack('<H', delay) + bytes([0x00, 0x00])
        data += b',' + struct.pack('<HHHH', 0, 0, size, size) + bytes([0x00])
        data += lzw_flat(index, size * size)
    data += b';'
    with open(os.path.join(out, path), 'wb') as handle:
        handle.write(data)


png('cover-a.png', 96, 40)
png('cover-b.png', 64, 200)
gif('dance.gif')
gif('big.gif', 256, 16, 6)
for n in range(30):
    noise_png('noise-%02d.png' % n, 580, n)
with open(os.path.join(out, 'fake.png'), 'wb') as handle:
    handle.write(b'<!doctype html><script>alert(1)</script>')
with open(os.path.join(out, 'broken.png'), 'wb') as handle:
    handle.write(PNG_SIGNATURE + bytes(40))
print('ok', len(os.listdir(out)), 'files')
