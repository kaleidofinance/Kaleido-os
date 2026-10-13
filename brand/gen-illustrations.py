import math

W, H = 1500, 1000
TW, TH = 178, 102          # iso tile top diagonals (2:1-ish dimetric)
OX, OY = W/2, 430          # projection origin (grid center)

def proj(gx, gy, elev=0):
    sx = OX + (gx - gy) * (TW/2)
    sy = OY + (gx + gy) * (TH/2) - elev
    return sx, sy

def tile(gx, gy, elev, thick, scale=1.0, layers=1):
    """Return SVG for an isometric tile (top + 2 visible sides + layered stack)."""
    w, h = TW*scale, TH*scale
    cx, cy = proj(gx, gy, elev)
    top = [(cx, cy-h/2), (cx+w/2, cy), (cx, cy+h/2), (cx-w/2, cy)]
    def poly(pts, fill, stroke="#2f4d3f", sw=1.0, op=1):
        p = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        return f'<polygon points="{p}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round" opacity="{op}"/>'
    s = []
    # stacked layers (thin plates) below the top for the "stack of tiles" look
    gap = thick / max(1, layers)
    for i in range(layers, 0, -1):
        e = elev - i*gap
        c2y = OY + (gx+gy)*(TH/2) - e
        t2 = [(cx, c2y-h/2), (cx+w/2, c2y), (cx, c2y+h/2), (cx-w/2, c2y)]
        # right + left side faces of this plate
        rt = [t2[1], t2[2], (t2[2][0], t2[2][1]+gap), (t2[1][0], t2[1][1]+gap)]
        lt = [t2[3], t2[2], (t2[2][0], t2[2][1]+gap), (t2[3][0], t2[3][1]+gap)]
        s.append(poly(lt, "#16261f", sw=0.8))
        s.append(poly(rt, "#101c16", sw=0.8))
    # main body sides (thickness under the top)
    r = [top[1], top[2], (top[2][0], top[2][1]+thick), (top[1][0], top[1][1]+thick)]
    l = [top[3], top[2], (top[2][0], top[2][1]+thick), (top[3][0], top[3][1]+thick)]
    s.append(poly(l, "url(#sideL)", sw=1))
    s.append(poly(r, "url(#sideR)", sw=1))
    # top face
    s.append(poly(top, "url(#topG)", sw=1.1))
    # subtle speckle on the top
    s.append(poly(top, "url(#speck)", stroke="none", op=0.5))
    return "".join(s), (cx, cy)

# ---- icons (upright, thin stroke, drawn centered at (x,y) size ~sz) ----
def icon(name, x, y, sz=42, stroke="#cbbf9f", sw=3.4):
    g = f'<g fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" transform="translate({x:.1f},{y:.1f})">'
    r = sz/2
    if name == "agent":  # rounded head + eye + antenna (the AI agent)
        b = f'<rect x="{-r}" y="{-r*0.8}" width="{sz}" height="{sz*0.8}" rx="10"/>'\
            f'<circle cx="{-r*0.4}" cy="0" r="3.6" fill="{stroke}" stroke="none"/>'\
            f'<circle cx="{r*0.4}" cy="0" r="3.6" fill="{stroke}" stroke="none"/>'\
            f'<line x1="0" y1="{-r*0.8}" x2="0" y2="{-r*1.25}"/><circle cx="0" cy="{-r*1.35}" r="3" fill="{stroke}" stroke="none"/>'
        return g+b+"</g>"
    if name == "swap":
        b = f'<path d="M {-r} {-6} H {r-8} l -8 -8 M {-r} {-6} l 8 -8"/>'\
            f'<path d="M {r} {8} H {-r+8} l 8 8 M {r} {8} l -8 8"/>'
        return g+b+"</g>"
    if name == "lend":  # percent
        b = f'<line x1="{-r*0.7}" y1="{r*0.7}" x2="{r*0.7}" y2="{-r*0.7}"/>'\
            f'<circle cx="{-r*0.55}" cy="{-r*0.55}" r="{r*0.28}"/>'\
            f'<circle cx="{r*0.55}" cy="{r*0.55}" r="{r*0.28}"/>'
        return g+b+"</g>"
    if name == "stake":  # diamond + up chevron
        b = f'<path d="M 0 {-r} L {r} 0 L 0 {r} L {-r} 0 Z"/>'\
            f'<path d="M {-r*0.35} {r*0.1} L 0 {-r*0.35} L {r*0.35} {r*0.1}"/>'
        return g+b+"</g>"
    if name == "coin":  # $ coin
        b = f'<ellipse cx="0" cy="0" rx="{r}" ry="{r*0.9}"/>'\
            f'<path d="M 0 {-r*0.5} V {r*0.5} M {-r*0.32} {-r*0.28} q {r*0.32} {-r*0.22} {r*0.32} {r*0.1} q 0 {r*0.3} {-r*0.32} {r*0.1}" />'
        return g+b+"</g>"
    if name == "bridge":  # arc between two nodes
        b = f'<path d="M {-r} {r*0.5} q {r} {-r*1.4} {r*2} 0"/>'\
            f'<circle cx="{-r}" cy="{r*0.5}" r="4" fill="{stroke}" stroke="none"/>'\
            f'<circle cx="{r}" cy="{r*0.5}" r="4" fill="{stroke}" stroke="none"/>'
        return g+b+"</g>"
    if name == "chart":
        b = f'<line x1="{-r*0.7}" y1="{r*0.7}" x2="{-r*0.7}" y2="{r*0.1}"/>'\
            f'<line x1="{-r*0.23}" y1="{r*0.7}" x2="{-r*0.23}" y2="{-r*0.3}"/>'\
            f'<line x1="{r*0.23}" y1="{r*0.7}" x2="{r*0.23}" y2="{-r*0.6}"/>'\
            f'<line x1="{r*0.7}" y1="{r*0.7}" x2="{r*0.7}" y2="{-r*0.1}"/>'
        return g+b+"</g>"
    return g+"</g>"

# ---- scene ----
# hub at center; satellites around it on the iso grid
sats = [
    (( 1.75,-1.75), "swap"),
    (( 2.0, 0.45), "coin"),
    (( 0.3, 2.0),  "chart"),
    ((-1.75, 1.75),"stake"),
    ((-2.0,-0.45), "lend"),
    ((-0.3,-2.0),  "bridge"),
]

parts = []
# faint iso grid
grid = []
N = 7
for i in range(-N, N+1):
    a = proj(i, -N); b = proj(i, N)
    grid.append(f'<line x1="{a[0]:.0f}" y1="{a[1]:.0f}" x2="{b[0]:.0f}" y2="{b[1]:.0f}"/>')
    a = proj(-N, i); b = proj(N, i)
    grid.append(f'<line x1="{a[0]:.0f}" y1="{a[1]:.0f}" x2="{b[0]:.0f}" y2="{b[1]:.0f}"/>')
grid_svg = f'<g stroke="#1c2e25" stroke-width="1" opacity="0.8">{"".join(grid)}</g>'

# connectors first (behind tiles): hub top to each satellite top
hub_top = proj(0,0, 86)
conn = []
for (gx,gy),_ in sats:
    st = proj(gx,gy, 24)
    conn.append(f'<line x1="{hub_top[0]:.0f}" y1="{hub_top[1]:.0f}" x2="{st[0]:.0f}" y2="{st[1]:.0f}" stroke="#35d18d" stroke-width="1.4" stroke-dasharray="1 7" stroke-linecap="round" opacity="0.7"/>')
    conn.append(f'<circle cx="{st[0]:.0f}" cy="{st[1]:.0f}" r="3.2" fill="#35d18d"/>')
conn_svg = "".join(conn)

# shadow ellipses under tiles
def shadow(gx,gy,scale=1.0):
    cx,cy = proj(gx,gy,0)
    return f'<ellipse cx="{cx:.0f}" cy="{cy+10:.0f}" rx="{TW*scale*0.66:.0f}" ry="{TH*scale*0.62:.0f}" fill="url(#shad)"/>'

# draw order: far (top of screen, smaller gx+gy) to near. Sort by (gx+gy).
draw = [((gx,gy),n) for (gx,gy),n in sats]
draw_sorted = sorted(draw, key=lambda d: d[0][0]+d[0][1])

body = []
# satellites behind the hub (gx+gy < 0) then hub then front sats
def draw_tile(gx,gy,name,scale,thick,elev,layers,isz):
    svg,(cx,cy) = tile(gx,gy,elev,thick,scale=scale,layers=layers)
    ic = icon(name, cx, cy-10, sz=isz)  # rest the icon on the tile top face
    return shadow(gx,gy,scale) + svg + ic

# render satellites and hub in correct painter order
items = []
for (gx,gy),n in sats:
    items.append((gx+gy, gx, gy, n, 0.82, 24, 40, 34))
items.append((0, 0, 0, "agent", 1.5, 34, 78, 132, 56))  # hub (special)

# rebuild with explicit hub handling
render = []
# satellites with gx+gy < 0 (behind)
for (gx,gy),n in sorted(sats, key=lambda d:d[0][0]+d[0][1]):
    if gx+gy < 0:
        render.append((gx+gy, draw_tile(gx,gy,n,0.9,24,40,3,52)))
# hub
svg,(hx,hy) = tile(0,0,86,42,scale=1.6,layers=6)
hglow = f'<ellipse cx="{hx:.0f}" cy="{hy-14:.0f}" rx="130" ry="86" fill="url(#hubglow)"/>'
hub = shadow(0,0,1.6) + svg + hglow + icon("agent", hx, hy-14, sz=78, sw=4, stroke="#35d18d")
render.append((0.01, hub))
# front satellites
for (gx,gy),n in sorted(sats, key=lambda d:d[0][0]+d[0][1]):
    if gx+gy >= 0:
        render.append((gx+gy, draw_tile(gx,gy,n,0.9,24,40,3,52)))

render_sorted = [s for _,s in sorted(render, key=lambda r:r[0])]

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<defs>
  <linearGradient id="topG" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#1e332a"/><stop offset="1" stop-color="#132119"/></linearGradient>
  <linearGradient id="sideR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f1c16"/><stop offset="1" stop-color="#0a140f"/></linearGradient>
  <linearGradient id="sideL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#152720"/><stop offset="1" stop-color="#0f1c16"/></linearGradient>
  <radialGradient id="shad" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="rgba(0,0,0,0.5)"/><stop offset="1" stop-color="rgba(0,0,0,0)"/></radialGradient>
  <radialGradient id="hubglow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="rgba(53,209,141,0.28)"/><stop offset="1" stop-color="rgba(53,209,141,0)"/></radialGradient>
  <filter id="speckF"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.21  0 0 0 0 0.35  0 0 0 0 0.29  0 0 0 0.35 0"/></filter>
  <pattern id="speck" width="{W}" height="{H}" patternUnits="userSpaceOnUse"><rect width="{W}" height="{H}" filter="url(#speckF)"/></pattern>
  <radialGradient id="bgv" cx="0.5" cy="0.42" r="0.75"><stop offset="0" stop-color="#0e1b16"/><stop offset="1" stop-color="#07110e"/></radialGradient>
</defs>
<rect width="{W}" height="{H}" fill="url(#bgv)"/>
{grid_svg}
{conn_svg}
{"".join(render_sorted)}
</svg>'''
open("brand/kaleido-ecosystem.svg","w",encoding="utf-8").write(svg)
print("wrote brand/kaleido-ecosystem.svg", len(svg), "bytes")
