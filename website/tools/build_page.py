"""Inline the logo and Leaflet's stylesheet into the page sources:
src/index.html -> index.html (website) and src/mobile.html -> mobile.html (phone screen, v2)."""
import base64, pathlib
here = pathlib.Path(__file__).parent
logo = "data:image/png;base64," + base64.b64encode((here / "logo.png").read_bytes()).decode()
css = (here / "leaflet.css").read_text()
for name in ("index.html", "mobile.html"):
    src = (here.parent / "src" / name).read_text()
    out = src.replace("{{LOGO}}", logo).replace("{{LEAFLET_CSS}}", css)
    (here.parent / name).write_text(out)
    print(name, len(out), "bytes")
