"""
Image generation service - wraps Google Imagen 3 via the google-genai SDK.

Returns a data URL (data:image/png;base64,...) so the image can be rendered
directly by the browser without requiring separate cloud storage.
All public functions are async.
"""
from __future__ import annotations

import asyncio
import base64
import logging

from backend.config import settings
from backend.services.llm_service import get_gemini_client

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Aspect-ratio / style mappings
# ---------------------------------------------------------------------------

# Imagen 3 accepts these aspect ratio strings.
_ASPECT_RATIO_MAP: dict[str, str] = {
    "square":    "1:1",
    "landscape": "16:9",
    "portrait":  "9:16",
}

# Style hints are appended to the prompt to steer the visual output.
_STYLE_HINTS: dict[str, str] = {
    "vivid":   "vibrant colours, dramatic lighting, high contrast, visually striking",
    "natural": "natural lighting, photorealistic, subtle tones, balanced composition",
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def generate_image(
    prompt: str,
    style: str = "vivid",
    aspect_ratio: str = "square",
) -> str:
    """
    Generate an image with Imagen 3 and return it as a base64 data URL.

    Args:
        prompt:       The image generation prompt (brand context expected from caller).
        style:        "vivid" or "natural".
        aspect_ratio: "square", "landscape", or "portrait".

    Returns:
        A data URL string: "data:image/png;base64,<...>"

    Raises:
        RuntimeError: If GEMINI_API_KEY is not configured.
        ValueError:   If generation fails or returns no image.
    """
    if not settings.GEMINI_API_KEY:
        raise RuntimeError(
            "GEMINI_API_KEY is not configured. "
            "Add it to backend/.env to enable image generation."
        )

    hint = _STYLE_HINTS.get(style, "")
    enhanced_prompt = f"{prompt}. Style: {hint}" if hint else prompt
    ar = _ASPECT_RATIO_MAP.get(aspect_ratio, "1:1")

    try:
        from google.genai.types import GenerateImagesConfig

        client = get_gemini_client()

        def _generate() -> bytes:
            response = client.models.generate_images(
                model=settings.GEMINI_IMAGE_MODEL,
                prompt=enhanced_prompt,
                config=GenerateImagesConfig(
                    number_of_images=1,
                    aspect_ratio=ar,
                ),
            )
            images = response.generated_images
            if not images:
                raise ValueError("Imagen returned no images.")
            return images[0].image.image_bytes

        image_bytes = await asyncio.to_thread(_generate)
        b64 = base64.b64encode(image_bytes).decode()
        logger.info("Generated image via Imagen 3 for prompt (first 80 chars): %.80s", prompt)
        return f"data:image/png;base64,{b64}"

    except RuntimeError:
        raise
    except Exception as exc:
        logger.error("Imagen 3 image generation failed: %s", exc)
        raise ValueError(f"Image generation failed: {exc}") from exc
