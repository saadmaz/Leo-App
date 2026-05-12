"""
Tool dispatcher - executes Claude tool_use calls for the chat agent.

When Claude returns a tool_use block, the stream route calls dispatch_tool()
with the tool name and inputs. This module routes to the correct
Exa/Tavily function and formats the result as a string Claude can consume.

Graceful degradation:
  - If Exa fails, falls back to Tavily equivalent.
  - If Tavily fails, falls back to Exa equivalent.
  - If both fail, returns a neutral "search unavailable" string so the
    conversation continues rather than crashing.

Tool definitions (exposed to Claude via SEARCH_TOOLS constant).
"""

import asyncio
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tool definitions - injected into every stream_chat_with_tools call
# ---------------------------------------------------------------------------

SEARCH_TOOLS = [
    {
        "name": "web_search",
        "description": (
            "Search the web for current, real-world information about brands, "
            "companies, competitors, market trends, industry news, or any topic "
            "that requires up-to-date data. Use this whenever the user asks about "
            "recent events, competitor activity, market data, or anything that "
            "requires information beyond your training data."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query. Be specific and descriptive.",
                },
                "search_type": {
                    "type": "string",
                    "enum": ["general", "news", "company"],
                    "description": (
                        "general = broad web search; "
                        "news = recent news articles only; "
                        "company = search company/brand profiles"
                    ),
                },
                "num_results": {
                    "type": "integer",
                    "description": "Number of results to return (1-10, default 5).",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "find_similar_companies",
        "description": (
            "Find companies or brands that are semantically similar to a given URL. "
            "Use this to discover competitors, comparable brands, or companies in "
            "the same space as a given website. Provide the full URL (e.g. https://brand.com)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The website URL to find similar companies for.",
                },
                "num_results": {
                    "type": "integer",
                    "description": "Number of similar companies to return (default 5).",
                },
            },
            "required": ["url"],
        },
    },
    {
        "name": "research_topic",
        "description": (
            "Conduct in-depth research on a topic and get a synthesized answer "
            "with citations. Use for market analysis, audience research, brand "
            "benchmarking, or any question requiring comprehensive coverage across "
            "multiple sources. Returns a detailed answer with source URLs."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The research question or topic to investigate.",
                },
                "depth": {
                    "type": "string",
                    "enum": ["fast", "standard"],
                    "description": (
                        "fast = quick multi-source search with answer (seconds); "
                        "standard = deeper RAG-style answer with citations (seconds)"
                    ),
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_brand_news",
        "description": (
            "Get recent news articles about a specific brand, company, or person. "
            "Use this when the user asks what a competitor has been up to, wants "
            "brand mention monitoring, or needs recent PR/news context."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "brand_name": {
                    "type": "string",
                    "description": "The brand or company name to search news for.",
                },
                "days_back": {
                    "type": "integer",
                    "description": "How many days back to search (default 30).",
                },
            },
            "required": ["brand_name"],
        },
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_search_results(results: list[dict], query: str) -> str:
    if not results:
        return f"No results found for: {query}"
    lines = [f"SEARCH RESULTS for '{query}':\n"]
    for i, r in enumerate(results[:8], 1):
        title = r.get("title", "Untitled")
        url = r.get("url", "")
        content = r.get("content") or r.get("highlights", [""])[0] if r.get("highlights") else r.get("summary", "")
        if not content:
            content = r.get("text", "")[:200]
        lines.append(f"{i}. {title}\n   URL: {url}\n   {content[:300]}\n")
    return "\n".join(lines)


def _format_similar_companies(results: list[dict], url: str) -> str:
    if not results:
        return f"No similar companies found for: {url}"
    lines = [f"SIMILAR COMPANIES to {url}:\n"]
    for i, r in enumerate(results[:8], 1):
        title = r.get("title", "Untitled")
        result_url = r.get("url", "")
        highlights = r.get("highlights", [])
        snippet = highlights[0] if highlights else r.get("summary", "")[:200]
        lines.append(f"{i}. {title}\n   URL: {result_url}\n   {snippet}\n")
    return "\n".join(lines)


def _format_news(exa_results: list, tavily_results: list, brand_name: str) -> str:
    # Merge and deduplicate by URL
    seen_urls: set = set()
    combined = []
    for r in exa_results + tavily_results:
        url = r.get("url", "")
        if url and url not in seen_urls:
            seen_urls.add(url)
            combined.append(r)

    if not combined:
        return f"No recent news found for: {brand_name}"

    lines = [f"RECENT NEWS about '{brand_name}':\n"]
    for i, r in enumerate(combined[:8], 1):
        title = r.get("title", "Untitled")
        url = r.get("url", "")
        date = r.get("published_date", "")
        snippet = r.get("content") or r.get("highlights", [""])[0] if r.get("highlights") else ""
        if not snippet:
            snippet = r.get("text", "")[:200]
        date_str = f" ({date[:10]})" if date else ""
        lines.append(f"{i}. {title}{date_str}\n   URL: {url}\n   {snippet[:250]}\n")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main dispatcher
# ---------------------------------------------------------------------------

async def dispatch_tool(
    tool_name: str,
    tool_input: dict,
    project_id: Optional[str] = None,
) -> str:
    """
    Execute a Claude tool call and return the result as a string.
    Never raises - returns an error string on failure so the conversation continues.
    """
    try:
        if tool_name == "web_search":
            return await _handle_web_search(tool_input, project_id)
        elif tool_name == "find_similar_companies":
            return await _handle_find_similar(tool_input, project_id)
        elif tool_name == "research_topic":
            return await _handle_research(tool_input, project_id)
        elif tool_name == "get_brand_news":
            return await _handle_brand_news(tool_input, project_id)
        else:
            return f"Unknown tool: {tool_name}"
    except Exception as exc:
        logger.error("Tool dispatch error for %s: %s", tool_name, exc)
        return (
            f"Search tool '{tool_name}' encountered an error: {exc}. "
            "Please answer using your training knowledge and note that "
            "real-time data was unavailable."
        )


# ---------------------------------------------------------------------------
# Individual tool handlers
# ---------------------------------------------------------------------------

async def _handle_web_search(inputs: dict, project_id: Optional[str]) -> str:
    query = inputs.get("query", "")
    search_type = inputs.get("search_type", "general")
    num_results = min(int(inputs.get("num_results", 5)), 10)

    if search_type == "news":
        # Tavily is better for news
        try:
            from backend.services.integrations import tavily_client
            resp = await tavily_client.search_news(
                query=query, days=14, max_results=num_results, project_id=project_id
            )
            return _format_search_results(resp["results"], query)
        except Exception:
            pass
        # Fallback to Exa news
        try:
            from backend.services.integrations import exa_client
            results = await exa_client.search_news(query=query, num_results=num_results, project_id=project_id)
            return _format_search_results(results, query)
        except Exception:
            return f"News search unavailable for: {query}"

    elif search_type == "company":
        # Exa is better for company search
        try:
            from backend.services.integrations import exa_client
            results = await exa_client.search_companies(query=query, num_results=num_results, project_id=project_id)
            return _format_search_results(results, query)
        except Exception:
            pass
        # Fallback to Tavily
        try:
            from backend.services.integrations import tavily_client
            resp = await tavily_client.search_advanced(query=query, max_results=num_results, project_id=project_id)
            return _format_search_results(resp["results"], query)
        except Exception:
            return f"Company search unavailable for: {query}"

    else:
        # General: Tavily primary (handles scraping + filtering), Exa fallback
        try:
            from backend.services.integrations import tavily_client
            resp = await tavily_client.search_advanced(
                query=query, max_results=num_results, include_answer=True, project_id=project_id
            )
            result_text = _format_search_results(resp["results"], query)
            if resp.get("answer"):
                result_text = f"QUICK ANSWER: {resp['answer']}\n\n" + result_text
            return result_text
        except Exception:
            pass
        # Fallback to Exa
        try:
            from backend.services.integrations import exa_client
            results = await exa_client.search(
                query=query, num_results=num_results, include_highlights=True, project_id=project_id
            )
            return _format_search_results(results, query)
        except Exception:
            return f"Web search unavailable for: {query}"


async def _handle_find_similar(inputs: dict, project_id: Optional[str]) -> str:
    url = inputs.get("url", "")
    num_results = min(int(inputs.get("num_results", 5)), 10)

    if not url:
        return "Error: url is required for find_similar_companies."

    try:
        from backend.services.integrations import exa_client
        # Extract domain to exclude from results
        from urllib.parse import urlparse
        domain = urlparse(url).netloc
        results = await exa_client.find_similar(
            url=url,
            num_results=num_results,
            exclude_domains=[domain] if domain else None,
            project_id=project_id,
        )
        return _format_similar_companies(results, url)
    except Exception as exc:
        logger.error("find_similar error: %s", exc)
        # Fallback: Tavily company search using the domain as query
        try:
            from backend.services.integrations import tavily_client
            from urllib.parse import urlparse
            domain = urlparse(url).netloc.replace("www.", "")
            resp = await tavily_client.search_advanced(
                query=f"companies similar to {domain}",
                max_results=num_results,
                project_id=project_id,
            )
            return _format_similar_companies(resp["results"], url)
        except Exception:
            return f"Similar company search unavailable for: {url}"


async def _handle_research(inputs: dict, project_id: Optional[str]) -> str:
    query = inputs.get("query", "")
    depth = inputs.get("depth", "standard")

    if depth == "fast":
        # Tavily advanced search with answer
        try:
            from backend.services.integrations import tavily_client
            resp = await tavily_client.search_advanced(
                query=query,
                max_results=10,
                include_answer=True,
                include_raw_content=False,
                project_id=project_id,
            )
            result_text = f"RESEARCH: {query}\n\n"
            if resp.get("answer"):
                result_text += f"SUMMARY: {resp['answer']}\n\n"
            result_text += _format_search_results(resp["results"], query)
            return result_text
        except Exception:
            pass

    # Standard: Exa answer (RAG with citations)
    try:
        from backend.services.integrations import exa_client
        result = await exa_client.answer_question(query=query, project_id=project_id)
        answer = result.get("answer", "")
        citations = result.get("citations", [])

        text = f"RESEARCH FINDINGS: {query}\n\n{answer}\n"
        if citations:
            text += "\nSOURCES:\n"
            for i, c in enumerate(citations[:5], 1):
                text += f"{i}. {c.get('title', 'Source')} - {c.get('url', '')}\n"
        return text
    except Exception:
        pass

    # Final fallback: Tavily
    try:
        from backend.services.integrations import tavily_client
        resp = await tavily_client.search_advanced(
            query=query, max_results=10, include_answer=True, project_id=project_id
        )
        result_text = f"RESEARCH: {query}\n\n"
        if resp.get("answer"):
            result_text += f"SUMMARY: {resp['answer']}\n\n"
        result_text += _format_search_results(resp["results"], query)
        return result_text
    except Exception:
        return f"Research unavailable for: {query}. Please use training knowledge."


async def _handle_brand_news(inputs: dict, project_id: Optional[str]) -> str:
    brand_name = inputs.get("brand_name", "")
    days_back = int(inputs.get("days_back", 30))

    # Run Tavily and Exa in parallel for best coverage
    exa_results: list = []
    tavily_results: list = []

    async def _get_exa():
        try:
            from backend.services.integrations import exa_client
            return await exa_client.search_news(
                query=f'"{brand_name}"',
                num_results=5,
                days_back=days_back,
                project_id=project_id,
            )
        except Exception:
            return []

    async def _get_tavily():
        try:
            from backend.services.integrations import tavily_client
            resp = await tavily_client.search_news(
                query=f"{brand_name} news",
                days=days_back,
                max_results=5,
                project_id=project_id,
            )
            return resp.get("results", [])
        except Exception:
            return []

    exa_results, tavily_results = await asyncio.gather(_get_exa(), _get_tavily())
    return _format_news(exa_results, tavily_results, brand_name)
