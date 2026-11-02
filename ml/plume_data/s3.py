"""Minimal anonymous S3 helpers for the OpenAQ open-data archive (no key needed)."""
import asyncio, re, os, ssl
import aiohttp

BUCKET = "https://openaq-data-archive.s3.amazonaws.com"
KEY_RE = re.compile(r"<Contents><Key>([^<]+)</Key>.*?<Size>(\d+)</Size>", re.S)
PFX_RE = re.compile(r"<CommonPrefixes><Prefix>([^<]+)</Prefix>")
TOK_RE = re.compile(r"<NextContinuationToken>([^<]+)</NextContinuationToken>")


def session(limit=64):
    ctx = ssl.create_default_context(cafile=os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE") or None)
    conn = aiohttp.TCPConnector(limit=limit, ssl=ctx)
    return aiohttp.ClientSession(connector=conn, trust_env=True, timeout=aiohttp.ClientTimeout(total=120))


async def get(sess, url, params=None, tries=6, binary=False):
    for i in range(tries):
        try:
            async with sess.get(url, params=params) as r:
                if r.status == 404:
                    return None
                if r.status != 200:
                    raise RuntimeError(f"HTTP {r.status}")
                return await (r.read() if binary else r.text())
        except Exception:
            if i == tries - 1:
                raise
            await asyncio.sleep(1.5 * (i + 1))


async def list_prefix(sess, prefix, delimiter=None):
    """Return (keys[(key,size)], common_prefixes) for a prefix, following pagination."""
    keys, pfx, token = [], [], None
    while True:
        p = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
        if delimiter:
            p["delimiter"] = delimiter
        if token:
            p["continuation-token"] = token
        xml = await get(sess, BUCKET + "/", params=p)
        keys += [(k, int(s)) for k, s in KEY_RE.findall(xml)]
        pfx += PFX_RE.findall(xml)
        m = TOK_RE.search(xml)
        if not m:
            return keys, pfx
        token = m.group(1).replace("&#x2F;", "/").replace("&amp;", "&")
