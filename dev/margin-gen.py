"""A generated 1920x1080 cartoon-like picture: a large soft orange blob and a small magenta one, each with a dark outline (generated, no owner data)."""
import sys
import cv2
import numpy as np

out = sys.argv[1]
H, W = 1080, 1920
img = np.full((H, W, 3), (214, 196, 160), np.uint8)   # BGR: a pale blue-grey ground
yy, xx = np.mgrid[0:H, 0:W]
img = (img * (0.92 + 0.08 * (yy / H))[..., None]).astype(np.uint8)


def blob(cx, cy, R, k):
    th = np.linspace(0, 2 * np.pi, 720, endpoint=False)
    r = R * (1 + 0.07 * np.cos(3 * th + k) + 0.04 * np.sin(2 * th + 2 * k))
    return np.c_[cx + r * np.cos(th), cy + r * np.sin(th)]


def draw(poly, fill_a, fill_b, outline_px):
    p = np.round(poly * 16).astype(np.int32)
    m = np.zeros((H, W), np.uint8)
    cv2.fillPoly(m, [p], 255, cv2.LINE_AA, 4)
    cy = poly[:, 1].mean()
    top, bot = poly[:, 1].min(), poly[:, 1].max()
    t = np.clip((yy - top) / (bot - top + 1e-6), 0, 1)[..., None]
    fill = (np.array(fill_a) * (1 - t) + np.array(fill_b) * t).astype(np.uint8)
    a = (m.astype(np.float32) / 255)[..., None]
    global img
    img = (img * (1 - a) + fill * a).astype(np.uint8)
    cv2.polylines(img, [p], True, (24, 20, 30), outline_px, cv2.LINE_AA, 4)


LARGE = (700, 520, 330, 0.0)
SMALL = (1450, 700, 62, 1.3)
draw(blob(*LARGE[:3], LARGE[3]), (70, 150, 250), (62, 140, 242), 12)   # large soft orange blob, 12 px outline
draw(blob(*SMALL[:3], SMALL[3]), (170, 70, 210), (160, 62, 200), 7)    # small magenta blob, 7 px outline
cv2.imwrite(out, img)
print("written", out)
