"""
Multilingual Adaptation - DeepL (base translation) + Claude (tone/brand voice),
SSE streaming.

DeepL produces a fast, accurate base translation.
Claude then adapts tone, idioms, and brand voice for each target language.
Degrades gracefully to Claude-only if DEEPL_API_KEY is not configured.
"""

from __future__ import annotations

import json
import logging
from typing import AsyncGenerator

import anthropic
import httpx

from backend.config import settings
from backend.schemas.pillar2 import TranslateRequest
from backend.services import firebase_service

logger = logging.getLogger(__name__)

DEEPL_LANGUAGE_NAMES: dict[str, str] = {
    "AR": "Arabic", "ZH": "Chinese (Simplified)", "CS": "Czech",
    "DA": "Danish", "NL": "Dutch", "EN": "English", "ET": "Estonian",
    "FI": "Finnish", "FR": "French", "DE": "German", "EL": "Greek",
    "HU": "Hungarian", "ID": "Indonesian", "IT": "Italian", "JA": "Japanese",
    "KO": "Korean", "LV": "Latvian", "LT": "Lithuanian", "NB": "Norwegian",
    "PL": "Polish", "PT": "Portuguese", "RO": "Romanian", "RU": "Russian",
    "SK": "Slovak", "SL": "Slovenian", "ES": "Spanish", "SV": "Swedish",
    "TR": "Turkish", "UK": "Ukrainian",
}


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _deepl_translate(text: str, source_lang: str, target_lang: str) -> str:
    """Translate via DeepL API. Returns translated text."""
    api_key = settings.DEEPL_API_KEY or ""
    base_url = "https://api-free.deepl.com" if api_key.endswith(":fx") else "https://api.deepl.com"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{base_url}/v2/translate",
            headers={"Authorization": f"DeepL-Auth-Key {api_key}"},
            json={
                "text": [text],
                "source_lang": source_lang.upper(),
                "target_lang": target_lang.upper(),
                "preserve_formatting": True,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["translations"][0]["text"]


async def generate(
    project: dict,
    body: TranslateRequest,
    project_id: str,
    owner_uid: str,
) -> AsyncGenerator[str, None]:

    async def _stream() -> AsyncGenerator[str, None]:
        brand_name = project.get("name", "the brand")
        brand_core = project.get("brandCore") or {}
        tone = brand_core.get("tone") or {}

        langs_str = ", ".join(body.target_langs)
        title = f"Translation - {body.source_lang} → {langs_str}"
        doc = firebase_service.create_pillar1_doc(project_id, "translation", owner_uid, title)
        doc_id = doc["id"]

        use_deepl = bool(settings.DEEPL_API_KEY)
        translations: list[dict] = []

        for lang in body.target_langs:
            lang_name = DEEPL_LANGUAGE_NAMES.get(lang.upper(), lang)

            # ── Step: DeepL base translation ──────────────────────────────────
            base_translation = body.content
            if use_deepl:
                yield _sse({"type": "research_step", "step": f"deepl_{lang}",
                            "label": f"DeepL base translation → {lang_name}...", "status": "running"})
                try:
                    base_translation = await _deepl_translate(body.content, body.source_lang, lang)
                    yield _sse({"type": "research_step", "step": f"deepl_{lang}",
                                "label": f"DeepL: {lang_name} done", "status": "done"})
                except Exception as exc:
                    logger.warning("DeepL failed for %s: %s", lang, exc)
                    yield _sse({"type": "research_step", "step": f"deepl_{lang}",
                                "label": f"DeepL unavailable, using Claude only", "status": "skipped"})
            else:
                yield _sse({"type": "research_step", "step": f"deepl_{lang}",
                            "label": f"DeepL not configured - Claude translating {lang_name}",
                            "status": "skipped"})

            # ── Step: Claude tone adaptation ──────────────────────────────────
            yield _sse({"type": "research_step", "step": f"claude_{lang}",
                        "label": f"Adapting brand voice for {lang_name}...", "status": "running"})

            brand_tone_desc = ""
            if tone.get("style"):
                brand_tone_desc = f"The brand tone is {tone['style']}."
            if not body.preserve_tone:
                brand_tone_desc += " Adapt fully to local cultural norms."

            adaptation_prompt = f"""\
Brand: {brand_name}
{brand_tone_desc}
Target language: {lang_name} ({lang})

ORIGINAL ({body.source_lang}):
{body.content}

{"BASE TRANSLATION (from DeepL):" if use_deepl else ""}
{base_translation if use_deepl and base_translation != body.content else ""}

{"Refine the base translation to match brand voice and cultural nuances." if use_deepl else f"Translate the original content to {lang_name}, preserving brand voice."}

Respond with ONLY a JSON object:
{{
  "lang": "{lang}",
  "lang_name": "{lang_name}",
  "translated_content": "The final adapted translation",
  "cultural_notes": "Any cultural adaptations made (e.g. idioms changed, formality adjusted)",
  "tone_notes": "How brand voice was preserved or adapted"
}}
"""
            client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
            assembled: list[str] = []
            async with client.messages.stream(
                model=settings.LLM_CLASSIFICATION_MODEL,
                max_tokens=2000,
                messages=[{"role": "user", "content": adaptation_prompt}],
            ) as stream:
                async for text in stream.text_stream:
                    assembled.append(text)
                    yield _sse({"type": "delta", "content": text})

            raw = "".join(assembled).strip().lstrip("```json").lstrip("```").rstrip("```")
            try:
                t_data = json.loads(raw)
            except json.JSONDecodeError:
                t_data = {"lang": lang, "lang_name": lang_name,
                          "translated_content": raw, "parse_error": True}

            translations.append(t_data)
            yield _sse({"type": "research_step", "step": f"claude_{lang}",
                        "label": f"{lang_name} ready", "status": "done"})

        payload = {
            "source_lang": body.source_lang,
            "source_content": body.content,
            "translations": translations,
            "deepl_used": use_deepl,
        }

        firebase_service.update_pillar1_doc(project_id, doc_id, {
            "status": "complete",
            "payload": payload,
            "credits_spent": 15,
        })

        yield _sse({"type": "translate_saved", "doc_id": doc_id, "payload": payload})
        yield "data: [DONE]\n\n"

    return _stream()
