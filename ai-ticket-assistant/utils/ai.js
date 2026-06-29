const PROMPT = (ticket) => `You are an expert support assistant. Analyze the ticket and return ONLY a strict JSON object with no extra text, headers, or markdown fences.

Classify the ticket intent first:
- "issue" — bugs, outages, login failures, broken features
- "request" — password reset, account changes, access requests
- "question" — learning requests like "explain React components"

Write helpfulNotes in markdown tailored to the intent:
- For issues: concrete troubleshooting steps, likely root causes, and what to verify
- For requests: step-by-step resolution path for the moderator to help the user
- For questions: a clear educational answer the moderator can share, with links to official docs when relevant

Do NOT use generic triage steps like "reproduce in staging" unless the ticket is clearly a production bug.

Fields:
- summary: 1-2 sentence summary of what the user needs
- priority: "low", "medium", or "high"
- helpfulNotes: detailed, ticket-specific guidance in markdown (use headings and numbered lists)
- relatedSkills: array of relevant skills (e.g. ["React", "Security"])

Respond ONLY in this JSON format:

{
  "summary": "Short summary",
  "priority": "medium",
  "helpfulNotes": "Detailed markdown guidance...",
  "relatedSkills": ["React", "Security"]
}

---

Ticket:
- Title: ${ticket.title}
- Description: ${ticket.description}`;

const SKILL_KEYWORDS = {
  React: /\b(react|jsx|frontend|ui|component)\b/i,
  "Node.js": /\b(node|express|backend|api|server)\b/i,
  MongoDB: /\b(mongo|database|db|atlas|connection pool)\b/i,
  JavaScript: /\b(javascript|js|typescript|ts)\b/i,
  DevOps: /\b(deploy|vercel|docker|ci\/cd|pipeline|504|timeout)\b/i,
  Security: /\b(auth|login|password|token|jwt|unauthorized|reset)\b/i,
  Payments: /\b(stripe|payment|checkout|billing|webhook)\b/i,
};

const normalizeApiKey = (key) => key?.trim().replace(/^["']|["']$/g, "") ?? "";

const formatHelpfulNotes = (summary, helpfulNotes) => {
  const parts = [];

  if (summary?.trim()) {
    parts.push(`**Summary:** ${summary.trim()}`);
  }

  if (helpfulNotes?.trim()) {
    if (parts.length) parts.push("");
    parts.push(helpfulNotes.trim());
  }

  return parts.join("\n");
};

const parseAiJson = (raw) => {
  const match = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  const jsonString = match ? match[1] : raw.trim();
  const objectMatch = jsonString.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(objectMatch ? objectMatch[0] : jsonString);

  const summary = parsed.summary ?? "";
  const helpfulNotes = parsed.helpfulNotes ?? "";

  return {
    priority: parsed.priority,
    summary,
    helpfulNotes: formatHelpfulNotes(summary, helpfulNotes),
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
  if (/\b(slow|timeout|error|broken|fail|cannot|can't|locked out)\b/i.test(text)) {
    return "medium";
  }
  return "low";
};

const inferSkills = (text) =>
  Object.entries(SKILL_KEYWORDS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([skill]) => skill)
    .slice(0, 4);

const detectTicketIntent = (text) => {
  if (/\b(explain|what is|what are|how does|how do|teach|learn|describe|components of|difference between)\b/i.test(text)) {
    return "question";
  }
  if (/\b(reset|forgot|forgotten|recover|change my password)\b/i.test(text)) {
    return "password_reset";
  }
  if (/\b(login|log in|sign in|signin|authentication|auth|unauthorized|401)\b/i.test(text)) {
    return "login_issue";
  }
  if (/\b(deploy|deployment|vercel|render|504|timeout|build fail)\b/i.test(text)) {
    return "deployment";
  }
  if (/\b(mongo|database|db|connection|atlas)\b/i.test(text)) {
    return "database";
  }
  if (/\b(react|jsx|component|frontend|ui)\b/i.test(text)) {
    return "react";
  }
  return "general";
};

const buildContextualNotes = (ticket, intent, skills) => {
  const title = ticket.title.trim();
  const description = ticket.description?.trim() || "";

  switch (intent) {
    case "password_reset":
      return [
        "**Recommended resolution:**",
        "1. Confirm the user's registered email address in the admin panel.",
        "2. If a forgot-password flow exists, guide them to use it and check their inbox/spam folder.",
        "3. If no reset flow is implemented, an admin can set a temporary password and ask the user to change it after login.",
        "4. Verify SMTP/Mailtrap credentials if reset emails are not being delivered.",
        "5. Check that passwords are hashed with bcrypt and JWT auth is configured correctly.",
        "",
        "**Security checks:**",
        "- Never share the current password in plain text.",
        "- Use a one-time reset token with expiry if implementing a reset endpoint.",
        "",
        "**Useful resources:**",
        "- [OWASP Password Reset Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)",
      ].join("\n");

    case "login_issue":
      return [
        "**Recommended resolution:**",
        "1. Ask which error message the user sees (invalid credentials, token expired, network error).",
        "2. Verify the email/password combination and that the account exists and is active.",
        "3. Check JWT_SECRET is set in production and matches across deployments.",
        "4. Confirm CORS and API URL on the frontend point to the correct backend.",
        "5. Inspect browser devtools Network tab for failed `/api/auth/login` requests.",
        "",
        "**Common causes:**",
        "- Wrong credentials or unregistered email",
        "- Missing or expired JWT token in localStorage",
        "- Backend env vars not set on Render/Vercel",
      ].join("\n");

    case "question":
      if (/\breact\b/i.test(`${title} ${description}`)) {
        return [
          "**Answer for the moderator to share:**",
          "",
          "React components are reusable pieces of UI. The main ideas are:",
          "",
          "1. **Function components** — JavaScript functions that return JSX (most common today).",
          "2. **JSX** — syntax that looks like HTML but compiles to JavaScript function calls.",
          "3. **Props** — read-only inputs passed from a parent component to a child.",
          "4. **State** — data a component manages locally, usually with the `useState` hook.",
          "5. **Hooks** — functions like `useState`, `useEffect`, and `useContext` that add behavior to function components.",
          "",
          "**Example:**",
          "```jsx",
          "function Greeting({ name }) {",
          "  const [count, setCount] = useState(0);",
          "  return <button onClick={() => setCount(count + 1)}>Hello {name}</button>;",
          "}",
          "```",
          "",
          "**Useful resources:**",
          "- [React Docs — Your First Component](https://react.dev/learn/your-first-component)",
          "- [React Docs — Passing Props](https://react.dev/learn/passing-props-to-a-component)",
          "- [React Docs — State: A Component's Memory](https://react.dev/learn/state-a-components-memory)",
        ].join("\n");
      }

      return [
        "**Answer for the moderator to share:**",
        "Provide a clear, structured explanation based on the user's question above.",
        "Break the topic into key concepts, give a short example if helpful, and link to official documentation.",
      ].join("\n");

    case "deployment":
      return [
        "**Recommended resolution:**",
        "1. Check deployment logs on Render/Vercel for build or runtime errors.",
        "2. Confirm all required environment variables are set in the hosting dashboard.",
        "3. Verify the health check endpoint responds (`/health`).",
        "4. Test the API base URL from the frontend matches the deployed backend URL.",
        "5. Review recent git commits for breaking changes.",
      ].join("\n");

    case "database":
      return [
        "**Recommended resolution:**",
        "1. Verify `MONGO_URI` is set correctly in production (Atlas IP whitelist, credentials).",
        "2. Check MongoDB Atlas cluster status and connection limits.",
        "3. Look for connection timeout or authentication errors in server logs.",
        "4. Confirm Mongoose models match the expected schema.",
      ].join("\n");

    case "react":
      return [
        "**Recommended resolution:**",
        "1. Reproduce the UI issue in the browser with devtools open (Console + Network).",
        "2. Check for React errors in the console (missing keys, invalid hooks usage).",
        "3. Verify API calls from the frontend return expected data.",
        "4. Inspect component props/state and recent changes in the affected page.",
        "",
        "**Useful resources:**",
        "- [React Docs](https://react.dev)",
        "- [React DevTools](https://react.dev/learn/react-developer-tools)",
      ].join("\n");

    default:
      return [
        "**Recommended resolution:**",
        "1. Read the ticket carefully and clarify any missing details with the user.",
        "2. Reproduce or validate the reported behavior.",
        "3. Check relevant logs, env vars, and recent changes.",
        "4. Provide a clear fix or workaround and update the ticket status.",
        "",
        `**Relevant skills:** ${(skills.length ? skills : ["General Support"]).join(", ")}`,
      ].join("\n");
  }
};

const buildFallbackAnalysis = (ticket) => {
  const text = `${ticket.title} ${ticket.description}`;
  const skills = inferSkills(text);
  const priority = inferPriority(text);
  const intent = detectTicketIntent(text);
  const summary =
    intent === "question"
      ? `User is asking: ${ticket.title}`
      : intent === "password_reset"
        ? "User needs help resetting their password."
        : intent === "login_issue"
          ? "User is experiencing a login or authentication issue."
          : ticket.description?.trim() || ticket.title;

  const helpfulNotes = formatHelpfulNotes(
    summary,
    buildContextualNotes(ticket, intent, skills)
  );

  return {
    priority,
    relatedSkills: skills.length ? skills : ["General Support"],
    helpfulNotes,
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
