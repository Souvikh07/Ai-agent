# 🤖 AI-Powered Ticket Management System

A full-stack intelligent support ticket platform built and maintained by **Souvikh07**. It uses AI to automatically analyze, prioritize, and route tickets to the right team members — reducing response time and manual triage effort.

> **Live Demo:** [ai-ticket-frontend-ebon.vercel.app](https://ai-ticket-frontend-ebon.vercel.app)

---

## ✨ Key Features

### 🧠 AI-Powered Ticket Processing
- Automatic ticket categorization and skill extraction
- Smart priority assignment (low / medium / high / critical)
- AI-generated contextual notes tailored to each ticket (issues, requests, or learning questions)
- Smart rule-based fallback with topic-specific guidance when Gemini is unavailable

### 🎯 Intelligent Moderator Assignment
- Skill-based matching — tickets route to the most qualified moderator
- Automatic fallback to admin when no match is found
- Real-time assignment updates on the frontend

### 👥 Role-Based Access Control
- **User** — create and track tickets
- **Moderator** — view assigned tickets with AI insights
- **Admin** — manage users, roles, skills, and view all tickets

### ⚡ Event-Driven Architecture
- Background processing via [Inngest](https://www.inngest.com/) — decoupled from HTTP requests
- Automatic retries on failure
- Email notifications to assigned moderators via Nodemailer

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React, Vite, React Router, Tailwind CSS, DaisyUI |
| **Backend** | Node.js, Express 5 |
| **Database** | MongoDB (Mongoose ODM) |
| **Authentication** | JWT (JSON Web Tokens) |
| **Background Jobs** | Inngest (event-driven functions) |
| **AI** | Google Gemini API + rule-based fallback |
| **Email** | Nodemailer + Mailtrap (dev) |
| **Deployment** | Vercel (frontend + backend) |

---

## 🏗️ Architecture

```
User creates ticket
  → Express API saves to MongoDB
  → Inngest event: ticket/created
  → Step 1: AI analyzes ticket (Gemini API)
  → Step 2: Sets priority, skills, helpful notes
  → Step 3: Assigns best-matching moderator (or admin fallback)
  → Step 4: Sends email notification
  → Frontend polls and displays AI results
```

---

## 📋 Prerequisites

- Node.js (v18 or higher)
- MongoDB (local or Atlas)
- Google Gemini API key
- Mailtrap account (for email testing)

## ⚙️ Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/Souvikh07/Ai-agent.git
   cd Ai-agent
   ```

2. **Install backend dependencies**

   ```bash
   cd ai-ticket-assistant
   npm install
   ```

3. **Install frontend dependencies**

   ```bash
   cd ../ai-ticket-frontend
   npm install
   ```

4. **Environment Setup**

   Create a `.env` file in `ai-ticket-assistant/`:

   ```env
   # MongoDB
   MONGO_URI=your_mongodb_uri

   # JWT
   JWT_SECRET=your_jwt_secret

   # Email (Mailtrap)
   MAILTRAP_SMTP_HOST=your_mailtrap_host
   MAILTRAP_SMTP_PORT=your_mailtrap_port
   MAILTRAP_SMTP_USER=your_mailtrap_user
   MAILTRAP_SMTP_PASS=your_mailtrap_password

   # AI (Gemini)
   GEMINI_API_KEY=your_gemini_api_key

   # Application
   APP_URL=http://localhost:3000
   ```

   Create a `.env` file in `ai-ticket-frontend/`:

   ```env
   VITE_API_URL=http://localhost:3000
   ```

## 🚀 Running Locally

1. **Start the backend**

   ```bash
   cd ai-ticket-assistant
   npm run dev
   ```

2. **Start the Inngest dev server**

   ```bash
   npx inngest-cli@latest dev
   ```

3. **Start the frontend**

   ```bash
   cd ai-ticket-frontend
   npm run dev
   ```

---

## 📝 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/signup` | Register a new user |
| POST | `/api/auth/login` | Login and receive JWT |

### Tickets
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/tickets` | Create a new ticket |
| GET | `/api/tickets` | Get all tickets for logged-in user |
| GET | `/api/tickets/:id` | Get ticket details with AI analysis |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/auth/users` | Get all users (Admin only) |
| POST | `/api/auth/update-user` | Update user role & skills (Admin only) |

---

## 🔄 Ticket Processing Pipeline

1. **Ticket Creation** — User submits a ticket with title and description
2. **AI Analysis** — Inngest triggers background function; Gemini API extracts skills, priority, type, and generates helpful notes
3. **Moderator Assignment** — System matches ticket skills to moderator skills using regex-based matching; falls back to admin if no match
4. **Notification** — Email sent to assigned moderator with ticket details and AI-generated context

---

## 🔍 Troubleshooting

| Issue | Solution |
|-------|----------|
| AI fields not appearing | Check `GEMINI_API_KEY` in env; contextual fallback notes are generated automatically |
| Generic helpful notes | Ensure `GEMINI_API_KEY` is set on Render; fallback now provides ticket-specific guidance |
| Email not sending | Verify Mailtrap SMTP credentials |
| Port conflicts | Kill process on conflicting port and restart |
| Tickets not assigning | Ensure at least one admin exists in the database |

---

## 📦 Dependencies

### Backend
`express` · `mongoose` · `bcrypt` · `jsonwebtoken` · `cors` · `dotenv` · `inngest` · `nodemailer` · `@google/generative-ai`

### Frontend
`react` · `react-router-dom` · `vite` · `tailwindcss` · `daisyui` · `axios`

---

## 🌐 Deployment

| Service | URL |
|---------|-----|
| Frontend | [ai-ticket-frontend-ebon.vercel.app](https://ai-ticket-frontend-ebon.vercel.app) |
| Backend API | [ai-ticket-assistant-orcin.vercel.app](https://ai-ticket-assistant-orcin.vercel.app) |
| GitHub | [github.com/Souvikh07/Ai-agent](https://github.com/Souvikh07/Ai-agent) |

---

## 👤 Author

**Souvikh07** — sole developer and maintainer of this project.

- GitHub: [github.com/Souvikh07](https://github.com/Souvikh07)
- Repository: [github.com/Souvikh07/Ai-agent](https://github.com/Souvikh07/Ai-agent)

---

## 📄 License

MIT License — free to use with attribution.
