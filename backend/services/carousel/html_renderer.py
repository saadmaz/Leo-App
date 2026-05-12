"""
Carousel Studio - HTML Renderer

Takes structured slide_data JSON + colour_system + fonts and returns
a complete carousel HTML string with an Instagram-frame UI wrapper.

All styles are inline - no external CSS files - required for Playwright reliability.
"""

from __future__ import annotations

import json
import re
from typing import Optional

# ---------------------------------------------------------------------------
# Colour system derivation
# ---------------------------------------------------------------------------

def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except Exception:
        return 99, 102, 241  # fallback indigo


def _lighten(hex_color: str, pct: float) -> str:
    r, g, b = _hex_to_rgb(hex_color)
    r = min(255, int(r + (255 - r) * pct))
    g = min(255, int(g + (255 - g) * pct))
    b = min(255, int(b + (255 - b) * pct))
    return f"#{r:02x}{g:02x}{b:02x}"


def _darken(hex_color: str, pct: float) -> str:
    r, g, b = _hex_to_rgb(hex_color)
    r = max(0, int(r * (1 - pct)))
    g = max(0, int(g * (1 - pct)))
    b = max(0, int(b * (1 - pct)))
    return f"#{r:02x}{g:02x}{b:02x}"


def _is_warm(hex_color: str) -> bool:
    r, g, b = _hex_to_rgb(hex_color)
    return r > b


def derive_colour_system(primary: str) -> dict:
    warm = _is_warm(primary)
    return {
        "BRAND_PRIMARY": primary,
        "BRAND_LIGHT": _lighten(primary, 0.2),
        "BRAND_DARK": _darken(primary, 0.3),
        "LIGHT_BG": "#FAF9F7" if warm else "#F4F6FA",
        "LIGHT_BORDER": "#E8E5E0" if warm else "#DDE3EE",
        "DARK_BG": "#1A1612" if warm else "#0F172A",
        "GRADIENT": f"linear-gradient(165deg, {_darken(primary, 0.3)} 0%, {primary} 50%, {_lighten(primary, 0.2)} 100%)",
    }


# ---------------------------------------------------------------------------
# Font Google URL builder
# ---------------------------------------------------------------------------

_GOOGLE_FONT_MAP = {
    "Space Grotesk":         "Space+Grotesk:wght@300;400;500;600;700;800",
    "Plus Jakarta Sans":     "Plus+Jakarta+Sans:wght@300;400;500;600;700;800",
    "Lora":                  "Lora:wght@400;600;700",
    "Nunito Sans":           "Nunito+Sans:wght@300;400;600;700",
    "Playfair Display":      "Playfair+Display:wght@400;600;700",
    "DM Sans":               "DM+Sans:wght@300;400;500;600;700",
    "Fraunces":              "Fraunces:wght@300;400;600;700",
    "Outfit":                "Outfit:wght@300;400;500;600;700;800",
    "Space Mono":            "Space+Mono:wght@400;700",
    "Inter":                 "Inter:wght@300;400;500;600;700;800",
    "Bricolage Grotesque":   "Bricolage+Grotesque:wght@300;400;500;600;700;800",
}


def _font_url(name: str) -> Optional[str]:
    slug = _GOOGLE_FONT_MAP.get(name)
    if slug:
        return f"https://fonts.googleapis.com/css2?family={slug}&display=swap"
    return None


# ---------------------------------------------------------------------------
# Slide background resolver
# ---------------------------------------------------------------------------

def _resolve_bg(bg_key: str, cs: dict, design_style: str) -> str:
    # Design style overrides
    if design_style == "dark_bold":
        return cs["DARK_BG"]
    if design_style == "light_clean":
        return cs["LIGHT_BG"]
    if design_style == "brand_gradient":
        return cs["GRADIENT"] if bg_key != "LIGHT_BG" else cs["DARK_BG"]

    # Per-slide bg_key
    if bg_key == "GRADIENT":
        return cs["GRADIENT"]
    if bg_key == "DARK_BG":
        return cs["DARK_BG"]
    return cs["LIGHT_BG"]


def _is_dark_bg(bg_val: str) -> bool:
    return "gradient" in bg_val.lower() or (
        bg_val.startswith("#") and sum(_hex_to_rgb(bg_val)) < 380
    )


def _text_colors(is_dark: bool, cs: dict) -> tuple[str, str, str]:
    """Returns heading_color, body_color, tag_color."""
    if is_dark:
        return "#FFFFFF", "rgba(255,255,255,0.8)", cs["BRAND_LIGHT"]
    return cs["DARK_BG"], "rgba(0,0,0,0.65)", cs["BRAND_PRIMARY"]


# ---------------------------------------------------------------------------
# Component renderers
# ---------------------------------------------------------------------------

def _render_stat_block(data: dict, is_dark: bool, cs: dict) -> str:
    stats = data.get("stats", [])
    if not stats:
        return ""
    items = ""
    for s in stats[:3]:
        color = "#FFFFFF" if is_dark else cs["BRAND_PRIMARY"]
        label_color = "rgba(255,255,255,0.7)" if is_dark else "rgba(0,0,0,0.55)"
        items += f"""
        <div style="text-align:center;padding:12px 0;border-top:1px solid {'rgba(255,255,255,0.1)' if is_dark else cs['LIGHT_BORDER']};">
          <div style="font-size:52px;font-weight:800;line-height:1;color:{color};letter-spacing:-1px;">{s.get('number','')}</div>
          <div style="font-size:11px;font-weight:500;letter-spacing:1px;text-transform:uppercase;color:{label_color};margin-top:4px;">{s.get('label','')}</div>
        </div>"""
    return f'<div style="margin-top:16px;">{items}</div>'


def _render_feature_list(data: dict, is_dark: bool, cs: dict) -> str:
    features = data.get("features", [])
    if not features:
        return ""
    items = ""
    for f in features[:4]:
        icon_color = cs["BRAND_LIGHT"] if is_dark else cs["BRAND_PRIMARY"]
        title_color = "#FFFFFF" if is_dark else cs["DARK_BG"]
        desc_color = "rgba(255,255,255,0.65)" if is_dark else "rgba(0,0,0,0.55)"
        border = "rgba(255,255,255,0.08)" if is_dark else cs["LIGHT_BORDER"]
        items += f"""
        <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid {border};">
          <span style="font-size:14px;color:{icon_color};flex-shrink:0;">{f.get('icon','✓')}</span>
          <div>
            <div style="font-size:13px;font-weight:600;color:{title_color};">{f.get('title','')}</div>
            <div style="font-size:11px;color:{desc_color};margin-top:2px;">{f.get('desc','')}</div>
          </div>
        </div>"""
    return f'<div style="margin-top:14px;">{items}</div>'


def _render_numbered_steps(data: dict, is_dark: bool, cs: dict, heading_font: str) -> str:
    steps = data.get("steps", [])
    if not steps:
        return ""
    items = ""
    for s in steps[:4]:
        num_color = cs["BRAND_LIGHT"] if is_dark else cs["BRAND_PRIMARY"]
        title_color = "#FFFFFF" if is_dark else cs["DARK_BG"]
        desc_color = "rgba(255,255,255,0.65)" if is_dark else "rgba(0,0,0,0.55)"
        items += f"""
        <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px;">
          <div style="font-size:28px;font-weight:300;line-height:1;color:{num_color};font-family:'{heading_font}',sans-serif;flex-shrink:0;">{s.get('number','01')}</div>
          <div>
            <div style="font-size:13px;font-weight:600;color:{title_color};">{s.get('title','')}</div>
            <div style="font-size:11px;color:{desc_color};margin-top:2px;">{s.get('desc','')}</div>
          </div>
        </div>"""
    return f'<div style="margin-top:14px;">{items}</div>'


def _render_quote_box(data: dict, is_dark: bool, cs: dict) -> str:
    quote = data.get("quote", "")
    author = data.get("author", "")
    role = data.get("role", "")
    if not quote:
        return ""
    bg = "rgba(255,255,255,0.08)" if is_dark else cs["LIGHT_BG"]
    border = f"2px solid {cs['BRAND_PRIMARY']}"
    text_color = "#FFFFFF" if is_dark else cs["DARK_BG"]
    meta_color = "rgba(255,255,255,0.6)" if is_dark else "rgba(0,0,0,0.5)"
    return f"""
    <div style="background:{bg};border-left:{border};border-radius:0 8px 8px 0;padding:14px 16px;margin-top:14px;">
      <div style="font-size:13px;font-style:italic;color:{text_color};line-height:1.55;">"{quote}"</div>
      {f'<div style="margin-top:8px;font-size:11px;font-weight:600;color:{cs["BRAND_PRIMARY"]};">{author}</div>' if author else ''}
      {f'<div style="font-size:10px;color:{meta_color};">{role}</div>' if role else ''}
    </div>"""


def _render_cta_centred(data: dict, is_dark: bool, cs: dict) -> str:
    cta_text = data.get("cta_text", "")
    sub_text = data.get("sub_text", "")
    if not cta_text:
        return ""
    bg = cs["LIGHT_BG"] if is_dark else cs["BRAND_PRIMARY"]
    text_color = cs["DARK_BG"] if is_dark else "#FFFFFF"
    sub_color = "rgba(0,0,0,0.55)" if is_dark else "rgba(255,255,255,0.8)"
    return f"""
    <div style="margin-top:20px;text-align:center;">
      <div style="display:inline-block;background:{bg};color:{text_color};font-size:14px;font-weight:600;padding:12px 28px;border-radius:28px;">{cta_text}</div>
      {f'<div style="margin-top:10px;font-size:12px;color:{sub_color};">{sub_text}</div>' if sub_text else ''}
    </div>"""


# ---------------------------------------------------------------------------
# Single slide renderer
# ---------------------------------------------------------------------------

def _render_slide(
    slide: dict,
    idx: int,
    total: int,
    cs: dict,
    design_style: str,
    heading_font: str,
    body_font: str,
    brand_initial: str,
    brand_name: str,
    view_w: int,
    view_h: int,
) -> str:
    bg_key = slide.get("background", "DARK_BG")
    bg_val = _resolve_bg(bg_key, cs, design_style)
    is_dark = _is_dark_bg(bg_val)
    h_color, b_color, tag_color = _text_colors(is_dark, cs)

    # CSS background property
    if bg_val.startswith("linear-gradient"):
        bg_css = f"background:{bg_val};"
    else:
        bg_css = f"background:{bg_val};"

    tag = slide.get("tag", "")
    headline = slide.get("headline", "")
    body = slide.get("body", "")
    component_type = slide.get("component", "none")
    component_data = slide.get("component_data", {})

    # Component HTML
    component_html = ""
    if component_type == "stat_block":
        component_html = _render_stat_block(component_data, is_dark, cs)
    elif component_type == "feature_list":
        component_html = _render_feature_list(component_data, is_dark, cs)
    elif component_type == "numbered_steps":
        component_html = _render_numbered_steps(component_data, is_dark, cs, heading_font)
    elif component_type == "quote_box":
        component_html = _render_quote_box(component_data, is_dark, cs)
    elif component_type == "cta_centred":
        component_html = _render_cta_centred(component_data, is_dark, cs)

    # Progress bar
    pct = int(((idx + 1) / total) * 100)
    track = "rgba(255,255,255,0.12)" if is_dark else "rgba(0,0,0,0.08)"
    fill = "#ffffff" if is_dark else cs["BRAND_PRIMARY"]
    label_color = "rgba(255,255,255,0.5)" if is_dark else "rgba(0,0,0,0.4)"
    progress_bar = f"""
    <div style="position:absolute;bottom:0;left:0;right:0;padding:16px 24px 18px;z-index:10;display:flex;align-items:center;gap:10px;">
      <div style="flex:1;height:2px;background:{track};border-radius:2px;overflow:hidden;">
        <div style="height:100%;width:{pct}%;background:{fill};border-radius:2px;"></div>
      </div>
      <span style="font-size:10px;color:{label_color};font-weight:500;font-family:'{body_font}',sans-serif;">{idx+1}/{total}</span>
    </div>"""

    # Swipe arrow (not on last slide)
    swipe_arrow = ""
    if idx < total - 1:
        arrow_color = "rgba(255,255,255,0.4)" if is_dark else "rgba(0,0,0,0.25)"
        swipe_arrow = f"""
        <div style="position:absolute;right:0;top:0;bottom:0;width:40px;display:flex;align-items:center;justify-content:center;background:linear-gradient(to left,{'rgba(0,0,0,0.15)' if is_dark else 'rgba(255,255,255,0.3)'},transparent);z-index:10;">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="{arrow_color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>"""

    # Logo lockup (shown on hero slide 0 and last slide)
    logo_lockup = ""
    if idx == 0 or idx == total - 1:
        logo_bg = cs["BRAND_PRIMARY"]
        logo_text_color = "#FFFFFF"
        brand_name_color = "rgba(255,255,255,0.9)" if is_dark else cs["DARK_BG"]
        logo_lockup = f"""
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
          <div style="width:32px;height:32px;border-radius:50%;background:{logo_bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="font-size:13px;font-weight:700;color:{logo_text_color};font-family:'{heading_font}',sans-serif;">{brand_initial}</span>
          </div>
          <span style="font-size:12px;font-weight:600;letter-spacing:0.5px;color:{brand_name_color};font-family:'{heading_font}',sans-serif;">{brand_name}</span>
        </div>"""

    return f"""
    <div class="slide" style="position:relative;width:{view_w}px;height:{view_h}px;{bg_css}flex-shrink:0;overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding:28px 24px 48px;">
      <div style="position:relative;z-index:5;">
        {logo_lockup}
        {f'<div style="font-size:10px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:{tag_color};margin-bottom:10px;font-family:\'{body_font}\',sans-serif;">{tag}</div>' if tag else ''}
        <div style="font-size:30px;font-weight:700;line-height:1.15;letter-spacing:-0.4px;color:{h_color};font-family:\'{heading_font}\',sans-serif;">{headline}</div>
        {f'<div style="font-size:13px;line-height:1.6;color:{b_color};margin-top:10px;font-family:\'{body_font}\',sans-serif;">{body}</div>' if body else ''}
        {component_html}
      </div>
      {progress_bar}
      {swipe_arrow}
    </div>"""


# ---------------------------------------------------------------------------
# Full carousel HTML
# ---------------------------------------------------------------------------

def render_carousel(
    slide_data: list[dict],
    colour_system: dict,
    heading_font: str,
    body_font: str,
    design_style: str,
    carousel_format: str,
    brand_profile: dict,
    brand_name: str = "",
) -> str:
    """
    Render the complete Instagram-frame carousel HTML.
    carousel_format: portrait | square | landscape | stories
    """
    FORMAT_DIMS = {
        "portrait":  (420, 525),
        "square":    (420, 420),
        "landscape": (420, 220),
        "stories":   (420, 747),
    }
    view_w, view_h = FORMAT_DIMS.get(carousel_format, (420, 525))

    total = len(slide_data)
    brand_initial = (brand_name or brand_profile.get("domain", "B"))[:1].upper()
    display_name = brand_name or brand_profile.get("domain", "Brand")

    cs = colour_system

    # Build slides HTML
    slides_html = ""
    for i, slide in enumerate(slide_data):
        slides_html += _render_slide(
            slide, i, total, cs, design_style,
            heading_font, body_font,
            brand_initial, display_name,
            view_w, view_h,
        )

    # Dot indicators
    dots_html = ""
    for i in range(min(total, 10)):
        dots_html += f'<div class="dot" data-idx="{i}" style="width:{"8px" if i==0 else "6px"};height:{"8px" if i==0 else "6px"};border-radius:50%;background:{"" + cs["BRAND_PRIMARY"] if i==0 else "rgba(0,0,0,0.15)"};cursor:pointer;transition:all 0.2s;"></div>'

    # Font imports
    font_links = ""
    for font_name in set([heading_font, body_font]):
        url = _font_url(font_name)
        if url:
            font_links += f'<link rel="stylesheet" href="{url}">\n  '

    # Handle colour
    handle_color = cs["BRAND_PRIMARY"]
    primary = cs["BRAND_PRIMARY"]

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  {font_links}
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ background: #f0f0f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: '{body_font}', -apple-system, sans-serif; padding: 20px; }}
    .ig-frame {{ width: 420px; background: #fff; border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,0.15); overflow: hidden; }}
    .ig-header {{ display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #efefef; }}
    .ig-avatar {{ width: 40px; height: 40px; border-radius: 50%; background: {primary}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }}
    .ig-handle {{ font-size: 13px; font-weight: 600; color: #000; font-family: '{heading_font}', sans-serif; }}
    .ig-sub {{ font-size: 11px; color: #888; }}
    .ig-dots-btn {{ margin-left: auto; font-size: 18px; color: #555; line-height: 1; cursor: pointer; }}
    .carousel-viewport {{ width: 420px; height: {view_h}px; overflow: hidden; position: relative; cursor: grab; }}
    .carousel-viewport:active {{ cursor: grabbing; }}
    .carousel-track {{ display: flex; width: {420 * total}px; height: {view_h}px; transition: transform 0.35s cubic-bezier(.25,.46,.45,.94); }}
    .slide {{ user-select: none; }}
    .ig-dots {{ display: flex; align-items: center; justify-content: center; gap: 5px; padding: 8px 0; }}
    .ig-actions {{ display: flex; align-items: center; gap: 14px; padding: 10px 14px 4px; }}
    .ig-actions svg {{ cursor: pointer; }}
    .ig-views {{ font-size: 12px; color: #555; margin-left: auto; font-family: '{body_font}', sans-serif; }}
    .ig-caption {{ padding: 8px 14px 14px; font-size: 13px; color: #000; font-family: '{body_font}', sans-serif; line-height: 1.4; }}
    .ig-caption strong {{ font-weight: 600; }}
    .ig-timestamp {{ font-size: 10px; color: #aaa; margin-top: 4px; }}
  </style>
</head>
<body>
  <div class="ig-frame">
    <!-- Header -->
    <div class="ig-header">
      <div class="ig-avatar">
        <span style="font-size:15px;font-weight:700;color:#fff;font-family:'{heading_font}',sans-serif;">{brand_initial}</span>
      </div>
      <div>
        <div class="ig-handle">{display_name.lower().replace(" ","")}</div>
        <div class="ig-sub">Sponsored</div>
      </div>
      <div class="ig-dots-btn">···</div>
    </div>

    <!-- Carousel -->
    <div class="carousel-viewport" id="viewport">
      <div class="carousel-track" id="track">
        {slides_html}
      </div>
    </div>

    <!-- Dot indicators -->
    <div class="ig-dots" id="dots">
      {dots_html}
    </div>

    <!-- Actions -->
    <div class="ig-actions">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#262626" stroke-width="1.8"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#262626" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#262626" stroke-width="1.8"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      <span class="ig-views">1,247 views</span>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#262626" stroke-width="1.8" style="margin-left:auto;"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
    </div>

    <!-- Caption -->
    <div class="ig-caption">
      <strong>@{display_name.lower().replace(" ","")}</strong> Check out our latest carousel.
      <span style="color:{handle_color};">#marketing #brand #content</span>
      <div class="ig-timestamp">2 HOURS AGO</div>
    </div>
  </div>

  <script>
    (function() {{
      const track = document.getElementById('track');
      const dots = document.querySelectorAll('.dot');
      let current = 0;
      const total = {total};

      function goTo(idx) {{
        if (idx < 0 || idx >= total) return;
        current = idx;
        track.style.transform = 'translateX(' + (-current * 420) + 'px)';
        dots.forEach((d, i) => {{
          d.style.width  = i === current ? '8px' : '6px';
          d.style.height = i === current ? '8px' : '6px';
          d.style.background = i === current ? '{cs["BRAND_PRIMARY"]}' : 'rgba(0,0,0,0.15)';
        }});
      }}

      // Dot click
      dots.forEach((d, i) => d.addEventListener('click', () => goTo(i)));

      // Keyboard
      document.addEventListener('keydown', (e) => {{
        if (e.key === 'ArrowRight') goTo(current + 1);
        if (e.key === 'ArrowLeft')  goTo(current - 1);
      }});

      // Drag / swipe
      const vp = document.getElementById('viewport');
      let startX = 0, dragging = false;
      vp.addEventListener('mousedown', (e) => {{ startX = e.clientX; dragging = true; }});
      vp.addEventListener('mousemove', (e) => {{ if (!dragging) return; e.preventDefault(); }});
      vp.addEventListener('mouseup', (e) => {{
        if (!dragging) return;
        dragging = false;
        const diff = e.clientX - startX;
        if (Math.abs(diff) > 40) goTo(diff < 0 ? current + 1 : current - 1);
      }});
      vp.addEventListener('touchstart', (e) => {{ startX = e.touches[0].clientX; }}, {{passive:true}});
      vp.addEventListener('touchend', (e) => {{
        const diff = e.changedTouches[0].clientX - startX;
        if (Math.abs(diff) > 40) goTo(diff < 0 ? current + 1 : current - 1);
      }});
    }})();
  </script>
</body>
</html>"""
