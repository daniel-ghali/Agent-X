
-- Profiles
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users PRIMARY KEY,
  coach_name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  language_preference TEXT DEFAULT 'ar',
  chatbot_tone TEXT DEFAULT 'friendly',
  system_prompt_override TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Allow public read of business_name for chatbot header
CREATE POLICY "Public can read business name" ON public.profiles FOR SELECT USING (true);

-- Plans
CREATE TABLE public.plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  currency TEXT DEFAULT 'EGP',
  description TEXT,
  features JSONB DEFAULT '[]',
  payment_options JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches see own plans" ON public.plans FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Coaches create own plans" ON public.plans FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Coaches update own plans" ON public.plans FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Coaches delete own plans" ON public.plans FOR DELETE USING (user_id = auth.uid());
-- Public read for chatbot AI
CREATE POLICY "Public can read active plans" ON public.plans FOR SELECT USING (is_active = true);

-- Conversations
CREATE TABLE public.conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  visitor_name TEXT DEFAULT 'زائر',
  visitor_phone TEXT,
  channel TEXT DEFAULT 'web',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches see own conversations" ON public.conversations FOR ALL USING (user_id = auth.uid());
-- Allow anonymous inserts for chatbot
CREATE POLICY "Anyone can create conversations" ON public.conversations FOR INSERT WITH CHECK (true);

-- Messages
CREATE TABLE public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE NOT NULL,
  sender TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches see own messages" ON public.messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));
-- Allow anonymous inserts for chatbot
CREATE POLICY "Anyone can create messages" ON public.messages FOR INSERT WITH CHECK (true);

-- Leads
CREATE TABLE public.leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  visitor_name TEXT,
  visitor_phone TEXT,
  status TEXT DEFAULT 'COLD',
  goal TEXT,
  interested_plan TEXT,
  notes TEXT,
  converted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coaches see own leads" ON public.leads FOR ALL USING (user_id = auth.uid());
-- Allow anonymous inserts/updates for chatbot
CREATE POLICY "Anyone can create leads" ON public.leads FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update leads" ON public.leads FOR UPDATE USING (true);

-- Update timestamp function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
