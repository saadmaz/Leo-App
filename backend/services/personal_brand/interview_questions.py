"""
Structured interview questions for the 5-module Personal Core discovery process.
Each question has a key, module, prompt, and optional hint.
"""

INTERVIEW_MODULES = {
    "A": {
        "label": "Identity & Positioning",
        "questions": [
            {
                "key": "A_what_do_you_do",
                "prompt": "What do you do? Tell me your role, profession, and the area you work in.",
                "hint": "e.g. 'I'm a product designer who helps early-stage SaaS startups...'",
                "chips": [],
            },
            {
                "key": "A_what_do_you_stand_for",
                "prompt": "What do you stand for? What are the core values that drive your work?",
                "hint": "Pick as many as you like, or type your own.",
                "chips": ["Transparency", "Craft", "Honesty", "Impact", "Simplicity", "Boldness",
                          "Empathy", "Accountability", "Curiosity", "Independence"],
            },
            {
                "key": "A_unfair_advantage",
                "prompt": "What is your unfair advantage? What do you know or do that most people in your field don't?",
                "hint": "Think about hard-won experience, rare combinations of skills, or unique access.",
                "chips": [],
            },
            {
                "key": "A_target_audience",
                "prompt": "Who do you want to reach? Describe your ideal audience - their profession, industry, and what stage they're at.",
                "hint": "e.g. 'First-time founders at pre-seed' or 'Marketing managers at B2B SaaS companies'",
                "chips": [],
            },
            {
                "key": "A_name_perception",
                "prompt": "What do you want people to think when they hear your name?",
                "hint": "One sentence. The feeling, the association, the reputation.",
                "chips": [],
            },
            {
                "key": "A_not_known_for",
                "prompt": "What do you NOT want to be known for? What topics or associations feel wrong for you?",
                "hint": "This is just as important - it defines the edges of your brand.",
                "chips": [],
            },
        ],
    },
    "B": {
        "label": "Story & Expertise",
        "questions": [
            {
                "key": "B_origin_story",
                "prompt": "What is your origin story? How did you get to where you are today? Give me the 3-paragraph version: where you started, the turning point, and where you are now.",
                "hint": "Don't worry about making it sound impressive - make it sound real.",
                "chips": [],
            },
            {
                "key": "B_proudest_achievement",
                "prompt": "What are you most proud of professionally? Name your top 2-3 achievements or moments.",
                "hint": "These become the proof points that back your brand.",
                "chips": [],
            },
            {
                "key": "B_deep_expertise",
                "prompt": "What do you know better than most people in your space? What topic could you talk about for an hour without notes?",
                "hint": "Be specific - 'B2B sales psychology for technical founders' beats 'sales'.",
                "chips": [],
            },
            {
                "key": "B_hard_lessons",
                "prompt": "What have you learned the hard way that others could benefit from?",
                "hint": "The failures, pivots, and realisations that shaped how you work now.",
                "chips": [],
            },
            {
                "key": "B_controversial_take",
                "prompt": "What is a controversial or counterintuitive belief you hold in your field? Something most people in your niche would push back on.",
                "hint": "The stronger the take, the more memorable your brand becomes.",
                "chips": [],
            },
        ],
    },
    "C": {
        "label": "Voice & Tone",
        "questions": [
            {
                "key": "C_natural_style",
                "prompt": "How do you naturally communicate? Pick the words that feel most like you.",
                "hint": "You can pick multiple.",
                "chips": ["Direct", "Conversational", "Formal", "Warm", "Analytical", "Storytelling",
                          "Provocative", "Dry / Witty", "Energetic", "Calm"],
            },
            {
                "key": "C_analytical_or_emotional",
                "prompt": "Are you more analytical or emotional in how you communicate? Or somewhere in between?",
                "hint": "e.g. 'I lead with data but close with human stories'",
                "chips": ["Mostly analytical", "Mostly emotional/personal", "Equal mix", "Depends on the topic"],
            },
            {
                "key": "C_signature_words",
                "prompt": "What words or phrases do you use all the time that feel distinctly like you?",
                "hint": "Expressions, terms, or ways of phrasing things that show up in your writing naturally.",
                "chips": [],
            },
            {
                "key": "C_avoided_language",
                "prompt": "What words or phrases feel completely wrong for you - things you would never say?",
                "hint": "Corporate jargon, buzzwords, phrases that feel hollow or unlike you.",
                "chips": ["Leverage", "Synergy", "Circle back", "Move the needle", "Low-hanging fruit",
                          "Thought leader", "Disruptive", "Game-changer", "Crush it", "Hustle"],
            },
            {
                "key": "C_writing_samples",
                "prompt": "Paste 2-3 pieces of writing that felt authentically like you - posts, emails, messages, anything. The more real the better.",
                "hint": "LEO will use these to learn your voice patterns and calibrate all future content.",
                "chips": [],
            },
        ],
    },
    "D": {
        "label": "Goals & Platforms",
        "questions": [
            {
                "key": "D_brand_purpose",
                "prompt": "What is this personal brand for? What outcome do you want it to drive?",
                "hint": "Pick all that apply.",
                "chips": ["Get consulting/freelance clients", "Job opportunities", "Speaking engagements",
                          "Build an audience / following", "Attract investors", "Sell a product or course",
                          "Network with specific people", "Creative expression"],
            },
            {
                "key": "D_platforms",
                "prompt": "Which platforms do you actually want to show up on?",
                "hint": "Be honest about where you'll commit. Two platforms done well beats six done poorly.",
                "chips": ["LinkedIn", "Instagram", "TikTok", "X / Twitter", "YouTube", "Threads",
                          "Facebook", "Newsletter / Substack"],
            },
            {
                "key": "D_current_presence",
                "prompt": "Where are you starting from on those platforms?",
                "hint": "e.g. 'LinkedIn: 800 connections, rarely post. Instagram: 200 followers, occasional posts. TikTok: starting from zero.'",
                "chips": [],
            },
            {
                "key": "D_time_budget",
                "prompt": "How much time can you realistically spend on personal brand content per week?",
                "hint": "Be honest - 30 minutes 3x a week is better than an aspirational 3 hours you won't stick to.",
                "chips": ["Under 1 hour/week", "1-2 hours/week", "3-5 hours/week", "5-10 hours/week", "More than 10 hours/week"],
            },
            {
                "key": "D_success_metrics",
                "prompt": "What does success look like for you? In 90 days, and in 12 months?",
                "hint": "Be as specific as possible - followers, clients, opportunities, or whatever matters most to you.",
                "chips": [],
            },
        ],
    },
    "E": {
        "label": "Competitive Landscape",
        "questions": [
            {
                "key": "E_admired_voices",
                "prompt": "Name 2-3 people in your space whose online presence you admire. What do they do well?",
                "hint": "LEO will research them to understand what works in your niche and identify gaps.",
                "chips": [],
            },
            {
                "key": "E_gap_voices",
                "prompt": "Name 1-2 people who are doing what you want to do - but doing it wrong. What are they missing?",
                "hint": "The gap they leave is often where your positioning lives.",
                "chips": [],
            },
            {
                "key": "E_tired_topics",
                "prompt": "What do people in your niche post about constantly that you're tired of seeing?",
                "hint": "The topics you want to avoid are as important as the ones you want to own.",
                "chips": [],
            },
        ],
    },
}


def get_all_questions() -> list[dict]:
    """Flatten all questions across modules into a single ordered list."""
    questions = []
    for module_key, module in INTERVIEW_MODULES.items():
        for q in module["questions"]:
            questions.append({**q, "module": module_key, "moduleLabel": module["label"]})
    return questions


def get_question_by_key(key: str) -> dict | None:
    """Find a question by its unique key."""
    for q in get_all_questions():
        if q["key"] == key:
            return q
    return None


def get_next_unanswered(answered_keys: list[str]) -> dict | None:
    """Return the next question the user hasn't answered yet."""
    for q in get_all_questions():
        if q["key"] not in answered_keys:
            return q
    return None


def calculate_progress(answered_keys: list[str]) -> int:
    """Return interview progress as a percentage (0-100)."""
    total = sum(len(m["questions"]) for m in INTERVIEW_MODULES.values())
    answered = len([k for k in answered_keys if k in {q["key"] for q in get_all_questions()}])
    return min(int((answered / total) * 100), 100)
