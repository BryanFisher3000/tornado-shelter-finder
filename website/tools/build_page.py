"""Inline the logo and Leaflet's stylesheet into src/index.html → index.html."""
import base64, pathlib
here = pathlib.Path(__file__).parent
src = (here.parent / "src" / "index.html").read_text()
logo = "data:image/png;base64," + base64.b64encode((here / "logo.png").read_bytes()).decode()
css = (here / "leaflet.css").read_text()
out = src.replace("{{LOGO}}", logo).replace("{{LEAFLET_CSS}}", css)
(here.parent / "index.html").write_text(out)
print("index.html", len(out), "bytes")
