const PROMPT = (ticket) => `You are a ticket triage agent. Only return a strict JSON object with no extra text, headers, or markdown.

Analyze the following support ticket and provide a JSON object with:

- summary: A short 1-2 sentence summary of the issue.
- priority: One of "low", "medium", or "high".
- helpfulNotes: A detailed technical explanation that a moderator can use to solve this issue. Include useful external links or resources if possible.
- relatedSkills: An array of relevant skills required to solve the issue (e.g., ["React", "MongoDB"]).

Respond ONLY in this JSON format and do not include any other text or markdown in the answer:

{
"summary": "Short summary of the ticket",
"priority": "high",
"helpfulNotes": "Here are useful tips...",
"relatedSkills": ["React", "Node.js"]
}

---

Ticket information:

- Title: ${ticket.title}
- Description: ${ticket.description}`;

const SKILL_KEYWORDS = {
  React: /\b(react|jsx|frontend|ui|component)\b/i,
  "Node.js": /\b(node|express|backend|api|server)\b/i,
  MongoDB: /\b(mongo|database|db|atlas|connection pool)\b/i,
  JavaScript: /\b(javascript|js|typescript|ts)\b/i,
  DevOps: /\b(deploy|vercel|docker|ci\/cd|pipeline|504|timeout)\b/i,
  Security: /\b(auth|login|password|token|jwt|unauthorized)\b/i,
  Payments: /\b(stripe|payment|checkout|billing|webhook)\b/i,
};

const normalizeApiKey = (key) => key?.trim().replace(/^["']|["']$/g, "") ?? "";

const parseAiJson = (raw) => {
  const match = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  const jsonString = match ? match[1] : raw.trim();
  const objectMatch = jsonString.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(objectMatch ? objectMatch[0] : jsonString);

  return {
    priority: parsed.priority,
    helpfulNotes: parsed.helpfulNotes,
    relatedSkills: Array.isArray(parsed.relatedSkills)
      ? parsed.relatedSkills
      : [],
  };
};

const buildRequest = (apiKey, model, ticket, useJsonMode, useQueryParam) => {
  const url = useQueryParam
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const headers = {
    "Content-Type": "application/json",
    ...(useQueryParam ? {} : { "x-goog-api-key": apiKey }),
  };

  const body = {
    contents: [{ parts: [{ text: PROMPT(ticket) }] }],
    ...(useJsonMode
      ? { generationConfig: { responseMimeType: "application/json" } }
      : {}),
  };

  return { url, headers, body };
};

const callGemini = async (apiKey, model, ticket) => {
  const attempts = [
    { useJsonMode: true, useQueryParam: false },
    { useJsonMode: false, useQueryParam: false },
    { useJsonMode: false, useQueryParam: true },
  ];

  for (const attempt of attempts) {
    const { url, headers, body } = buildRequest(
      apiKey,
      model,
      ticket,
      attempt.useJsonMode,
      attempt.useQueryParam
    );

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Gemini API error (${model}, json=${attempt.useJsonMode}, query=${attempt.useQueryParam}):`,
        response.status,
        errorText.slice(0, 500)
      );
      continue;
    }

    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    if (!raw) {
      console.error(
        `Gemini returned empty response (${model}):`,
        JSON.stringify(data).slice(0, 500)
      );
      continue;
    }

    try {
      return parseAiJson(raw);
    } catch (e) {
      console.error(`Failed to parse Gemini JSON (${model}):`, e.message);
    }
  }

  return null;
};

const inferPriority = (text) => {
  if (/\b(critical|urgent|down|outage|crash|500|504|security breach)\b/i.test(text)) {
    return "high";
  }
  if (/\b(slow|timeout|error|broken|fail|cannot|can't)\b/i.test(text)) {
    return "medium";
  }
  return "low";
};

const inferSkills = (text) =>
  Object.entries(SKILL_KEYWORDS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([skill]) => skill)
    .slice(0, 4);

const buildFallbackAnalysis = (ticket) => {
  const text = `${ticket.title} ${ticket.description}`;
  const skills = inferSkills(text);
  const priority = inferPriority(text);

  return {
    priority,
    relatedSkills: skills.length ? skills : ["General Support"],
    helpfulNotes: [
      `**Summary:** ${ticket.title}`,
      "",
      "**Suggested triage steps:**",
      "1. Reproduce the issue in a staging environment.",
      "2. Check recent deployments and error logs around the reported time.",
      "3. Confirm environment variables, API keys, and third-party service status.",
      "4. Assign to a moderator with matching skills and update ticket status.",
      "",
      `**Detected skills:** ${(skills.length ? skills : ["General Support"]).join(", ")}`,
    ].join("\n"),
  };
};

const analyzeTicket = async (ticket) => {
  const ticketInput = {
    title: ticket.title,
    description: ticket.description,
  };

  const apiKey = normalizeApiKey(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  );

  if (apiKey) {
    const models = [
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-flash",
      "gemini-1.5-flash-8b",
    ];

    for (const model of models) {
      try {
        const result = await callGemini(apiKey, model, ticketInput);
        if (result) return result;
      } catch (e) {
        console.error(`Failed to analyze ticket with ${model}:`, e.message);
      }
    }

    console.error("Gemini unavailable, using rule-based fallback analysis");
  } else {
    console.error("GEMINI_API_KEY is not set, using rule-based fallback analysis");
  }

  return buildFallbackAnalysis(ticketInput);
};

export default analyzeTicket;
