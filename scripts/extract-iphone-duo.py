"""Extract the optional local Duo pack, without modifying or redistributing PSDs.

uv run --no-project --with 'psd-tools[composite]==1.19.0' python scripts/extract-iphone-duo.py /path/to/duo
The checked-in geometry is verified on every run. Assets stay gitignored.
"""
import argparse
import gc
import hashlib
import json
import tempfile
from pathlib import Path

from PIL import Image
from psd_tools import PSDImage

ROOT = Path(__file__).resolve().parents[1]
SPECS = [
    ("portrait", "Free iPhone Duo Mockup PSD (Landscape:Portrait).psd",
     "1451180dd59ae07a1c3b1805044596165d0201ace86d0f83b9210417c97e6a87",
     "Portrait", "Portrait", (1878, 2670), (1706, 533, 2585, 1753)),
    ("landscape", "Free iPhone Duo Mockup PSD (Landscape:Portrait).psd",
     "1451180dd59ae07a1c3b1805044596165d0201ace86d0f83b9210417c97e6a87",
     "Landscape", "Landscape", (2670, 1878), (418, 734, 1638, 1613)),
]


def extract(folder, spec, output):
    pose, filename, digest, group_name, screen_name, screen_size, viewport = spec
    source = folder / filename
    with source.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
            raise ValueError(f"Source SHA-256 mismatch: {filename}")
    print(f"Extracting {pose}", flush=True)
    psd = PSDImage.open(source)
    group = next(layer for layer in psd if layer.name == group_name) if group_name else psd
    layers = list(group)
    screen = next(layer for layer in layers if layer.name == screen_name)
    mask_layer = layers[layers.index(screen) - 1]
    if mask_layer.name != "Mask" or not screen.clipping:
        raise ValueError("Unexpected screen clipping structure")
    foreground_names = {"Left Thumb", "Right Thumb", "Camera"}
    background_names = {"Background Color", "Bg Color", "Texture", "Shadow", "Shadows"}
    # Keep clipping bases and body detail layers. Never enable hidden layers.
    body = group.composite(viewport=viewport, layer_filter=lambda layer:
        layer.is_visible() and layer is not screen
        and layer.name not in foreground_names | background_names
        and "G O O D M O C K U P S" not in layer.name).convert("RGBA")
    mask = mask_layer.composite(viewport=viewport,
        layer_filter=lambda layer: layer is mask_layer).convert("RGBA").getchannel("A")
    foreground = psd.composite(viewport=viewport, layer_filter=lambda layer:
        layer.is_visible() and layer.name in foreground_names).convert("RGBA") if not group_name else None
    scale = min(1, 1440 / max(body.size))
    size = tuple(round(value * scale) for value in body.size)
    sx, sy = size[0] / body.width, size[1] / body.height
    quad = screen.smart_object.transform_box
    identity = f"iphone-duo-{pose}-v1"
    metadata = {"id": identity, "width": size[0], "height": size[1],
        "screenAspect": screen_size[0] / screen_size[1],
        "corners": [[round((quad[i] - viewport[0]) * sx, 6),
                     round((quad[i + 1] - viewport[1]) * sy, 6)] for i in range(0, 8, 2)],
        "hasForeground": foreground is not None}
    body = body.resize(size, Image.Resampling.LANCZOS)
    mask_rgba = Image.new("RGBA", size, (255, 255, 255, 0))
    mask_rgba.putalpha(mask.resize(size, Image.Resampling.LANCZOS))
    images = {"": body, "-screen": mask_rgba}
    preview = body.copy()
    if foreground is not None:
        foreground = foreground.resize(size, Image.Resampling.LANCZOS)
        images["-foreground"] = foreground
        preview.alpha_composite(foreground)
    preview.thumbnail((320, 320), Image.Resampling.LANCZOS)
    images["-thumb"] = preview
    files = {}
    for suffix, image in images.items():
        path = output / f"{identity}{suffix}.png"
        image.save(path, optimize=True)
        files[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return metadata, {"id": identity, "sourceFile": filename, "sourceSha256": digest,
        "viewport": viewport, "screenSourceSize": screen_size, "files": files,
        "licenseStatus": "unverified", "publicRedistributionApproved": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    output = ROOT / "local-device-assets"
    output.mkdir(exist_ok=True)
    # Validate the whole pack before replacing any installed file. A wrong PSD,
    # compositor failure or changed geometry must leave the previous pack intact.
    with tempfile.TemporaryDirectory(prefix=".duo-", dir=output) as staging:
        geometry, provenance = [], []
        for spec in SPECS:
            info, record = extract(args.source, spec, Path(staging))
            geometry.append(info)
            provenance.append(record)
            gc.collect()
        expected = ROOT / "src/utils/iphoneDuoGeometry.json"
        if [entry for entry in json.loads(expected.read_text(encoding="utf-8"))
            if not entry["hasForeground"]] != geometry:
            raise ValueError("Geometry changed; review before updating iphoneDuoGeometry.json")
        (Path(staging) / "iphone-duo-provenance.json").write_text(
            json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
        for path in Path(staging).iterdir():
            path.replace(output / path.name)


if __name__ == "__main__":
    main()
