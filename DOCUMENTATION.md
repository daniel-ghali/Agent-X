# Agent X - AI-Powered CRM & Automation Platform

Agent X is a premium, high-performance SaaS platform built for fitness coaches and content creators to automate their sales, qualify leads, and manage their business using conversational AI.

This platform seamlessly integrates a high-conversion landing page, an AI-powered conversational agent (chatbot), and a comprehensive CRM dashboard, all powered by React and Supabase.

---

## 🏗 Technology Stack

- **Frontend Framework**: React 18 with Vite for lightning-fast HMR and building.
- **Language**: TypeScript for end-to-end type safety.
- **Styling**: Tailwind CSS combined with custom CSS (`index.css`) for high-end "glass-premium" aesthetics, neon glows, and dark mode support.
- **Animations**: Framer Motion for scroll reveals, micro-interactions, and complex UI transitions.
- **Components**: Radix UI (via `shadcn/ui`) for accessible, headless UI primitives.
- **Routing**: React Router v6 (`BrowserRouter`).
- **State & Data Fetching**: TanStack Query (React Query) and React Context (`AppContext`).
- **Backend & Auth**: Supabase (PostgreSQL, Authentication, Edge Functions).

---

## 🗺 Application Architecture & Routing

The application relies on a unified routing structure defined in `src/App.tsx`.

### 1. Public Routes
- `/` (**Landing Page**): The public-facing marketing site. Built with premium components like `HeroSection`, `FeaturesSection`, `AutomationSection`, and `ROIVisualizer` to convert visitors.
- `/login` & `/register` (**Auth Flow**): Custom authentication pages integrated with Supabase Auth.
- `/chat` (**Public Chatbot**): A standalone, embeddable conversational UI where leads can talk directly to the AI agent to learn about plans and get qualified.

### 2. Protected Routes (CRM Dashboard)
All dashboard routes are wrapped in a `<ProtectedRoute>` component which verifies the user session via the `useAuth` hook. They share the `<DashboardLayout>` (Sidebar and Navbar).

- `/dashboard`: The main overview containing analytics and quick actions (`StatCard` components).
- `/dashboard/conversations`: Allows the coach to view the chat history between their leads and the AI agent.
- `/dashboard/leads`: A Kanban/table view of all leads captured by the AI, tracked by status (HOT, WARM, COLD).
- `/dashboard/plans`: Management interface for the coach to create, edit, and price their fitness training plans.
- `/dashboard/settings`: User profile, AI tone configuration, and system preferences.

---

## 🤖 AI Chat Integration (Edge Function)

The core feature of Agent X is the AI Sales Assistant. This is powered by a Supabase Edge Function located at `src/supabase/functions/chat/index.ts`.

**How it works:**
1. A visitor sends a message from the `/chat` route.
2. The Edge function receives the message, fetches the coach's active **Plans** and their preferred **Chatbot Tone** from the Supabase database.
3. It constructs a system prompt for the AI (using Google Gemini via Lovable Gateway), injecting the coach's specific plans and rules.
4. The AI responds naturally (in Arabic/Egyptian slang or English) to answer questions, handle objections, and recommend plans.
5. **Lead Qualification:** The AI returns a structured JSON payload determining if the lead is `HOT`, `WARM`, or `COLD`, what their `goal` is, and which `plan` they want.
6. The database is updated in real-time, appearing instantly on the coach's CRM dashboard.

---

## 🎨 Design System & Aesthetics

Agent X is designed to look like a top-tier luxury SaaS product.

- **Theme Strategy:** Primarily dark-mode optimized, using deep backgrounds (`bg-background`) contrasted with vivid neon green (`#4ade80`) and primary blue gradients.
- **Glassmorphism:** Heavy use of the `.glass-premium` class which combines `backdrop-blur-xl`, semi-transparent borders, and subtle drop shadows to create a futuristic layered effect.
- **Typography:** Uses the `Inter` font for clean, modern readability, with `Cairo` for RTL (Arabic) support.
- **Context Management:** `AppContext` handles toggling between Light/Dark mode and English/Arabic (`en`/`ar`) seamlessly.

---

## 📂 Key Directory Structure

```text
src/
├── components/          # Reusable UI components
│   ├── dashboard/       # CRM specific components (StatCard, ChatBubble)
│   ├── layout/          # Layout wrappers (DashboardLayout)
│   ├── ui/              # shadcn/ui generic primitives (Buttons, Inputs, Dialogs)
│   └── *.tsx            # Landing page sections (HeroSection, Navbar, etc.)
├── contexts/            # React Contexts (AppContext.tsx)
├── hooks/               # Custom React hooks (useAuth, use-toast, use-mobile)
├── integrations/        # Third-party integrations
│   └── supabase/        # Supabase client initialization & auto-generated types
├── pages/               # Route components
│   ├── pages/           # CRM & Auth Pages (Dashboard.tsx, Login.tsx, etc.)
│   ├── Index.tsx        # Main Landing Page entry point
│   └── NotFound.tsx     # 404 Error page
├── supabase/            # Supabase backend code
│   └── functions/       # Edge functions (chat AI logic)
├── App.tsx              # Main routing configuration
├── index.css            # Global CSS, Tailwind directives, and premium custom classes
└── main.tsx             # React DOM entry point & Providers
```

---

## 🚀 Running and Deploying

### Local Development
```bash
# Install dependencies
npm install

# Start the Vite development server
npm run dev
```

### Production Build
```bash
# Type-check and build for production
npm run build

# Preview the built production application
npm run preview
```

### Environment Variables
The application requires the following environment variables in `.env` to function properly:
- `VITE_SUPABASE_URL`: Your Supabase project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: Your Supabase anon key for the frontend client.

*(The Edge function will also require `SUPABASE_SERVICE_ROLE_KEY` and `LOVABLE_API_KEY` configured in the Supabase dashboard).*
