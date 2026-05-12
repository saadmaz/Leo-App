"""
Carousel Studio - Playwright PNG Exporter

Renders each slide as an individual PNG at Instagram export dimensions.
Always uses 420px layout width with device_scale_factor = 1080/420 to reach
1080px output width. Only the viewport height changes per format.

CRITICAL:
  - HTML is written via Python Path.write_text() - NEVER via shell scripts
  - Wait 3000ms after page load (Google Fonts need time)
  - Hide .ig-header .ig-dots .ig-actions .ig-caption before screenshotting
  - Set track.style.transition='none' before each slide screenshot
  - Clip screenshot to exactly VIEW_W × VIEW_H
"""

from __future__ import annotations

import asyncio
import logging
import tempfile
import uuid
from pathlib import Path
from typing import AsyncIterator

logger = logging.getLogger(__name__)

FORMAT_DIMS: dict[str, tuple[int, int]] = {
    "portrait":  (420, 525),
    "square":    (420, 420),
    "landscape": (420, 220),
    "stories":   (420, 747),
}

SCALE = 1080 / 420  # Always 2.5714...


async def export_slides(
    html_content: str,
    total_slides: int,
    carousel_format: str = "portrait",
) -> AsyncIterator[dict]:
    """
    Async generator. Yields progress events then a done event with slide paths.

    Yields:
      {"type": "progress", "slide": i+1, "total": total_slides}
      {"type": "done", "paths": ["/tmp/.../slide_01.png", ...]}
      {"type": "error", "message": "..."}
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        yield {"type": "error", "message": "Playwright not installed. Run: pip install playwright && playwright install chromium"}
        return

    view_w, view_h = FORMAT_DIMS.get(carousel_format, (420, 525))

    # Write HTML to a temp file (never use shell scripts - $ signs corrupt content)
    tmp_dir = Path(tempfile.mkdtemp(prefix="carousel_"))
    html_path = tmp_dir / "carousel.html"
    html_path.write_text(html_content, encoding="utf-8")

    slide_paths: list[Path] = []

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page(
                viewport={"width": view_w, "height": view_h},
                device_scale_factor=SCALE,
            )

            await page.goto(f"file://{html_path.as_posix()}", wait_until="networkidle")
            await page.wait_for_timeout(3000)  # Google Fonts load time

            # Hide IG chrome UI for clean slides
            await page.evaluate("""(viewH) => {
                document.querySelectorAll('.ig-header,.ig-dots,.ig-actions,.ig-caption')
                    .forEach(el => el.style.display = 'none');
                const frame = document.querySelector('.ig-frame');
                if (frame) {
                    frame.style.cssText = [
                        'width:420px',
                        'height:' + viewH + 'px',
                        'max-width:none',
                        'border-radius:0',
                        'box-shadow:none',
                        'overflow:hidden',
                        'margin:0'
                    ].join(';');
                }
                const vp = document.querySelector('.carousel-viewport');
                if (vp) {
                    vp.style.cssText = [
                        'width:420px',
                        'height:' + viewH + 'px',
                        'aspect-ratio:unset',
                        'overflow:hidden',
                        'cursor:default'
                    ].join(';');
                }
                document.body.style.cssText =
                    'padding:0;margin:0;display:block;overflow:hidden;background:#fff;';
            }""", view_h)
            await page.wait_for_timeout(500)

            for i in range(total_slides):
                # Navigate to slide without animation
                await page.evaluate("""(idx) => {
                    const t = document.querySelector('.carousel-track');
                    if (t) {
                        t.style.transition = 'none';
                        t.style.transform = 'translateX(' + (-idx * 420) + 'px)';
                    }
                }""", i)
                await page.wait_for_timeout(300)

                out_path = tmp_dir / f"slide_{i+1:02d}.png"
                await page.screenshot(
                    path=str(out_path),
                    clip={"x": 0, "y": 0, "width": view_w, "height": view_h},
                )
                slide_paths.append(out_path)
                logger.info("Exported slide %d/%d → %s", i + 1, total_slides, out_path.name)
                yield {"type": "progress", "slide": i + 1, "total": total_slides}

            await browser.close()

    except Exception as exc:
        logger.exception("Playwright export failed: %s", exc)
        yield {"type": "error", "message": str(exc)}
        return

    yield {"type": "done", "paths": [str(p) for p in slide_paths], "tmp_dir": str(tmp_dir)}
