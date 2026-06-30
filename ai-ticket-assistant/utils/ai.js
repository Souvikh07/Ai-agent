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
  React: /\b(react|jsx|frontend|ui|component|hooks?)\b/i,
  "Node.js": /\b(node\.?js|express|backend|server-side|rest api)\b/i,
  MongoDB: /\b(mongo|database|db|atlas|connection pool)\b/i,
  JavaScript: /\b(javascript|js|typescript|ts|promise|async|await|fetch)\b/i,
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
  if (/\b(explain|what is|what are|how does|how do|teach|learn|describe|components of|difference between|show me|help me understand)\b/i.test(text)) {
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

const detectQuestionTopic = (text) => {
  if (/\b(hooks?|usestate|useeffect|usecontext|usereducer|usememo|usecallback|useref|custom hook)\b/i.test(text)) {
    return "react_hooks";
  }
  if (/\b(components?|jsx|props|rendering)\b/i.test(text) && /\breact\b/i.test(text)) {
    return "react_components";
  }
  if (/\b(react router|routing|context api|redux|state management)\b/i.test(text)) {
    return "react_advanced";
  }
  if (/\breact\b/i.test(text)) {
    return "react_general";
  }
  if (/\b(promises?|async|await|fetch api|fetch\()\b/i.test(text)) {
    return "js_async";
  }
  if (/\b(closures?|hoisting|scope|event loop|prototype|this keyword)\b/i.test(text)) {
    return "js_concepts";
  }
  if (/\b(javascript|typescript|\bjs\b|\bts\b)\b/i.test(text)) {
    return "javascript_general";
  }
  return "general_question";
};

const QUESTION_ANSWERS = {
  react_hooks: [
    "**Answer for the moderator to share:**",
    "",
    "React **Hooks** let function components use state and lifecycle features without classes.",
    "",
    "**Core hooks:**",
    "1. **`useState`** — store and update local component state.",
    "2. **`useEffect`** — run side effects after render (API calls, subscriptions, DOM updates).",
    "3. **`useContext`** — read shared data from a React Context provider.",
    "",
    "**Rules of Hooks:**",
    "- Only call hooks at the top level of a function component (not inside loops/conditions).",
    "- Only call hooks from React function components or custom hooks.",
    "",
    "**Example:**",
    "```jsx",
    "import { useState, useEffect } from 'react';",
    "",
    "function UserProfile({ userId }) {",
    "  const [user, setUser] = useState(null);",
    "",
    "  useEffect(() => {",
    "    fetch(`/api/users/${userId}`)",
    "      .then(res => res.json())",
    "      .then(setUser);",
    "  }, [userId]);",
    "",
    "  if (!user) return <p>Loading...</p>;",
    "  return <h1>{user.name}</h1>;",
    "}",
    "```",
    "",
    "**Useful resources:**",
    "- [React Docs — Introducing Hooks](https://react.dev/reference/react)",
    "- [React Docs — useState](https://react.dev/reference/react/useState)",
    "- [React Docs — useEffect](https://react.dev/reference/react/useEffect)",
  ].join("\n"),

  react_components: [
    "**Answer for the moderator to share:**",
    "",
    "React **components** are reusable pieces of UI. The main ideas are:",
    "",
    "1. **Function components** — JavaScript functions that return JSX (most common today).",
    "2. **JSX** — syntax that looks like HTML but compiles to JavaScript function calls.",
    "3. **Props** — read-only inputs passed from a parent component to a child.",
    "4. **State** — data a component manages locally, usually with the `useState` hook.",
    "5. **Composition** — build complex UIs by nesting smaller components.",
    "",
    "**Example:**",
    "```jsx",
    "function Greeting({ name }) {",
    "  const [count, setCount] = useState(0);",
    "  return (",
    "    <button onClick={() => setCount(count + 1)}>",
    "      Hello {name} — clicked {count} times",
    "    </button>",
    "  );",
    "}",
    "```",
    "",
    "**Useful resources:**",
    "- [React Docs — Your First Component](https://react.dev/learn/your-first-component)",
    "- [React Docs — Passing Props](https://react.dev/learn/passing-props-to-a-component)",
    "- [React Docs — State: A Component's Memory](https://react.dev/learn/state-a-components-memory)",
  ].join("\n"),

  react_general: [
    "**Answer for the moderator to share:**",
    "",
    "React is a JavaScript library for building user interfaces with reusable components.",
    "",
    "**Key concepts:** components, JSX, props, state, hooks, and one-way data flow.",
    "",
    "Ask the user which area they want to go deeper on — components, hooks, routing, or state management — and share the relevant React docs section.",
    "",
    "**Useful resources:**",
    "- [React Docs — Quick Start](https://react.dev/learn)",
    "- [React Docs — Thinking in React](https://react.dev/learn/thinking-in-react)",
  ].join("\n"),

  react_advanced: [
    "**Answer for the moderator to share:**",
    "",
    "For advanced React topics (routing, Context, Redux, etc.), start with the user's specific question in the description.",
    "",
    "**Common topics:**",
    "- **React Router** — client-side navigation between pages",
    "- **Context API** — share state without prop drilling",
    "- **Redux / Zustand** — global state management for larger apps",
    "",
    "**Useful resources:**",
    "- [React Router](https://reactrouter.com/)",
    "- [React Docs — Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context)",
  ].join("\n"),

  js_async: [
    "**Answer for the moderator to share:**",
    "",
    "JavaScript handles asynchronous work with **Promises**, **async/await**, and the **Fetch API**.",
    "",
    "**1. Promises** — represent a value that will be available later.",
    "```javascript",
    "const promise = new Promise((resolve, reject) => {",
    "  setTimeout(() => resolve('Done!'), 1000);",
    "});",
    "",
    "promise.then(result => console.log(result)).catch(err => console.error(err));",
    "```",
    "",
    "**2. async/await** — cleaner syntax for working with promises.",
    "```javascript",
    "async function getUser(id) {",
    "  try {",
    "    const response = await fetch(`https://api.example.com/users/${id}`);",
    "    const user = await response.json();",
    "    return user;",
    "  } catch (error) {",
    "    console.error('Failed to fetch user:', error);",
    "  }",
    "}",
    "```",
    "",
    "**3. Fetch API** — built-in way to make HTTP requests in the browser.",
    "```javascript",
    "fetch('/api/tickets')",
    "  .then(res => {",
    "    if (!res.ok) throw new Error('Network error');",
    "    return res.json();",
    "  })",
    "  .then(data => console.log(data))",
    "  .catch(err => console.error(err));",
    "```",
    "",
    "**Key points:**",
    "- `async` functions always return a Promise.",
    "- `await` pauses inside an `async` function until the Promise settles.",
    "- Always handle errors with `try/catch` or `.catch()`.",
    "",
    "**Useful resources:**",
    "- [MDN — Using Promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises)",
    "- [MDN — async function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function)",
    "- [MDN — Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)",
  ].join("\n"),

  js_concepts: [
    "**Answer for the moderator to share:**",
    "",
    "Cover the specific concept the user asked about (closures, hoisting, scope, etc.) with a short definition and a minimal code example.",
    "",
    "**Useful resources:**",
    "- [MDN — JavaScript Guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide)",
    "- [javascript.info](https://javascript.info/)",
  ].join("\n"),

  javascript_general: [
    "**Answer for the moderator to share:**",
    "",
    "JavaScript is the programming language of the web. Core areas include variables, functions, objects, arrays, DOM manipulation, and asynchronous code.",
    "",
    "Use the ticket description to focus the answer on what the user actually asked.",
    "",
    "**Useful resources:**",
    "- [MDN — JavaScript Guide](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide)",
    "- [javascript.info](https://javascript.info/)",
  ].join("\n"),

  general_question: [
    "**Answer for the moderator to share:**",
    "",
    "Read the ticket title and description carefully, then provide a structured explanation:",
    "1. Brief definition of the topic",
    "2. Key concepts broken into bullet points",
    "3. A short code example if applicable",
    "4. Links to official documentation",
  ].join("\n"),
};

const buildQuestionSummary = (ticket, topic) => {
  const description = ticket.description?.trim();
  const title = ticket.title?.trim() || "support question";

  if (description) {
    return `User is asking: ${description}`;
  }

  const topicSummaries = {
    react_hooks: "User wants to learn about React hooks.",
    react_components: "User wants to learn about React components.",
    react_general: "User has a general React learning question.",
    js_async: "User wants to learn about Promises, async/await, and the Fetch API.",
    javascript_general: "User has a JavaScript learning question.",
  };

  return topicSummaries[topic] || `User is asking: ${title}`;
};

const buildContextualNotes = (ticket, intent, skills) => {
  const title = ticket.title.trim();
  const description = ticket.description?.trim() || "";
  const text = `${title} ${description}`;

  if (intent === "question") {
    const topic = detectQuestionTopic(text);
    return QUESTION_ANSWERS[topic] || QUESTION_ANSWERS.general_question;
  }

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
  const questionTopic = intent === "question" ? detectQuestionTopic(text) : null;
  const summary =
    intent === "question"
      ? buildQuestionSummary(ticket, questionTopic)
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
