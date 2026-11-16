"""Step 0: reference geography (Natural Earth country polygons and coastline, GeoNames cities)
and the NASA Black Marble night-lights texture for the globe."""
import io, urllib.request, zipfile
from pathlib import Path

GEO = Path("data/geo")
ZIPS = {
    "ne_50m_admin_0_countries": "https://naturalearth.s3.amazonaws.com/50m_cultural/ne_50m_admin_0_countries.zip",
    "ne_50m_coastline": "https://naturalearth.s3.amazonaws.com/50m_physical/ne_50m_coastline.zip",
    "cities15000": "https://download.geonames.org/export/dump/cities15000.zip",
}
BLACK_MARBLE = ("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0"
                "&LAYERS=VIIRS_Black_Marble&STYLES=&FORMAT=image/jpeg&CRS=EPSG:4326&BBOX=-90,-180,90,180"
                "&WIDTH=4096&HEIGHT=2048&TIME=2016-01-01")


def main():
    for name, url in ZIPS.items():
        out = GEO / name
        if out.exists():
            continue
        out.mkdir(parents=True)
        zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url).read())).extractall(out)
        print("fetched", name)
    tex = Path("web/public/tex/black-marble-2016.jpg")
    if not tex.exists():
        tex.parent.mkdir(parents=True, exist_ok=True)
        tex.write_bytes(urllib.request.urlopen(BLACK_MARBLE).read())
        print("fetched Black Marble texture")


if __name__ == "__main__":
    main()
