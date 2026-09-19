"""Generate the demo feed's media.

Two visual styles stand in for real-world inputs:
  * "camera" assets carry sensor noise, muted saturation and a wide tonal range
  * "generated" assets are smooth, saturated and low-noise, like diffusion output

Run: python3 demo/generate_assets.py
"""

import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

ASSETS = Path(__file__).parent / "assets"
SIZE = (640, 420)


def gradient(width: int, height: int, colors) -> np.ndarray:
    top_left, top_right, bottom_left, bottom_right = (np.array(c, dtype=float) for c in colors)
    x = np.linspace(0, 1, width)[None, :, None]
    y = np.linspace(0, 1, height)[:, None, None]
    top = top_left * (1 - x) + top_right * x
    bottom = bottom_left * (1 - x) + bottom_right * x
    return top * (1 - y) + bottom * y


def blobs(width: int, height: int, seed: int, count: int = 5) -> np.ndarray:
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:height, 0:width]
    field = np.zeros((height, width, 3))
    for _ in range(count):
        cx, cy = rng.uniform(0, width), rng.uniform(0, height)
        radius = rng.uniform(0.15, 0.4) * max(width, height)
        color = rng.uniform(80, 255, size=3)
        mask = np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * radius**2)))
        field += mask[..., None] * color
    return field / max(1.0, field.max()) * 255


def generated_image(seed: int, colors) -> Image.Image:
    width, height = SIZE
    base = gradient(width, height, colors) * 0.55 + blobs(width, height, seed) * 0.45
    # Saturate and keep the surface almost noise free.
    mean = base.mean(axis=2, keepdims=True)
    base = np.clip(mean + (base - mean) * 1.6, 0, 255)
    base += np.random.default_rng(seed).normal(0, 0.35, base.shape)
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))


def camera_image(seed: int) -> Image.Image:
    width, height = SIZE
    rng = np.random.default_rng(seed)
    base = blobs(width, height, seed, count=3) * 0.7 + 40
    # Texture, grain and a wide tonal range, the way a sensor records a scene.
    texture = rng.normal(0, 26, (height, width, 1)).repeat(3, axis=2)
    fine = rng.normal(0, 14, (height, width, 3))
    stripes = (np.sin(np.linspace(0, 60, width))[None, :, None] * 12).repeat(height, axis=0)
    mean = base.mean(axis=2, keepdims=True)
    base = mean + (base - mean) * 0.55
    frame = base + texture + fine + stripes
    frame[: height // 3] *= 1.25
    frame[-height // 4 :] *= 0.6
    return Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8))


def write_video(name: str, frames) -> None:
    tmp = ASSETS / f".{name}-frames"
    tmp.mkdir(parents=True, exist_ok=True)
    for index, frame in enumerate(frames):
        frame.save(tmp / f"{index:03d}.png")
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error", "-framerate", "12",
            "-i", str(tmp / "%03d.png"),
            "-vf", "scale=480:-2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
            str(ASSETS / name),
        ],
        check=True,
    )
    for path in tmp.iterdir():
        path.unlink()
    tmp.rmdir()


def shift(image: Image.Image, offset: int) -> Image.Image:
    return Image.fromarray(np.roll(np.asarray(image), offset, axis=1))


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)

    generated_image(7, [(90, 40, 200), (250, 120, 60), (40, 180, 220), (250, 220, 90)]).save(
        ASSETS / "generated-landscape.png"
    )
    generated_image(21, [(250, 90, 160), (120, 60, 240), (60, 220, 200), (255, 200, 80)]).save(
        ASSETS / "generated-portrait.png"
    )
    camera_image(3).save(ASSETS / "camera-street.png")
    camera_image(11).save(ASSETS / "camera-kitchen.png")

    smooth = generated_image(33, [(70, 60, 220), (240, 110, 80), (50, 200, 210), (255, 230, 120)])
    write_video("generated-clip.mp4", [shift(smooth, i * 3) for i in range(24)])
    write_video("camera-clip.mp4", [camera_image(100 + i) for i in range(24)])


if __name__ == "__main__":
    main()
