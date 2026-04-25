import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useApp } from "@/contexts/AppContext";

export default function SettingsPage() {
  const { user } = useAuth();
  const { t } = useApp();
  const [coachName, setCoachName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [language, setLanguage] = useState("ar");
  const [tone, setTone] = useState("friendly");
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select(
        "coach_name, business_name, language_preference, chatbot_tone, system_prompt_override",
      )
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setCoachName(data.coach_name);
          setBusinessName(data.business_name);
          setLanguage(data.language_preference || "ar");
          setTone(data.chatbot_tone || "friendly");
          setCustomPrompt(data.system_prompt_override || "");
          setUseCustomPrompt(!!data.system_prompt_override);
        }
        setLoading(false);
      });
  }, [user]);

  const chatUrl = `${window.location.origin}/chat?userId=${user?.id || "YOUR_ID"}`;

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        coach_name: coachName,
        business_name: businessName,
        language_preference: language,
        chatbot_tone: tone,
        system_prompt_override: useCustomPrompt ? customPrompt || null : null,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) toast.error("Failed to save settings");
    else toast.success("Settings saved ✅");
  };

  if (loading) {
    return (
      <div className="max-w-2xl space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-card rounded-2xl border border-border p-6 animate-pulse"
          >
            <div className="h-5 bg-secondary rounded w-1/4 mb-4" />
            <div className="h-10 bg-secondary rounded mb-3" />
            <div className="h-10 bg-secondary rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight">
          {t("settings.title")}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t("settings.sub")}
        </p>
      </div>

      <div className="space-y-4 max-w-2xl">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card rounded-2xl border border-border p-6 shadow-card"
        >
          <h3 className="text-base font-semibold tracking-tight mb-4">
            {t("settings.profile")}
          </h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                {t("settings.coachName")}
              </label>
              <Input
                value={coachName}
                onChange={(e) => setCoachName(e.target.value)}
                className="h-11"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                {t("settings.business")}
              </label>
              <Input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="h-11"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                {t("settings.email")}
              </label>
              <Input
                value={user?.email || ""}
                disabled
                className="h-11 opacity-60"
              />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-card rounded-2xl border border-border p-6 shadow-card"
        >
          <h3 className="text-base font-semibold tracking-tight mb-4">
            {t("settings.behavior")}
          </h3>
          <div className="space-y-5">
            <div>
              <label className="text-sm font-medium mb-2.5 block">
                {t("settings.language")}
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: "ar", label: "Arabic 🇪🇬" },
                  { value: "en", label: "English" },
                  { value: "both", label: "Both" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setLanguage(opt.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      language === opt.value
                        ? "bg-gradient-primary text-primary-foreground shadow-soft"
                        : "bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-2.5 block">
                {t("settings.tone")}
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: "friendly", label: "😊 Friendly" },
                  { value: "sales", label: "💼 Sales" },
                  { value: "neutral", label: "📋 Neutral" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTone(opt.value)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      tone === opt.value
                        ? "bg-gradient-primary text-primary-foreground shadow-soft"
                        : "bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-card rounded-2xl border border-border p-6 shadow-card"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold tracking-tight">
              Custom AI Prompt
            </h3>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={useCustomPrompt}
                onChange={(e) => setUseCustomPrompt(e.target.checked)}
                className="w-4 h-4 rounded border-border text-primary focus:ring-primary accent-primary"
              />
              Use custom AI prompt
            </label>
          </div>

          {useCustomPrompt && (
            <div className="mt-4 animate-in fade-in slide-in-from-top-2">
              <p className="text-sm text-muted-foreground mb-3">
                Write your custom prompt here. Use{" "}
                <code className="bg-secondary px-1 py-0.5 rounded text-xs">
                  {"{{PLANS}}"}
                </code>{" "}
                to inject your active plans.
              </p>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="أنت مساعد مبيعات لياقة بدنية اسمك Agent X...&#10;&#10;الخطط:&#10;{{PLANS}}"
                className="w-full min-h-[150px] p-3 text-sm rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none transition-all resize-y"
              />
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card rounded-2xl border border-border p-6 shadow-card"
        >
          <h3 className="text-base font-semibold tracking-tight mb-1">
            {t("settings.link")}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {t("settings.linkSub")}
          </p>
          <div className="bg-secondary rounded-xl p-4 font-mono text-xs text-muted-foreground relative break-all">
            {chatUrl}
            <button
              onClick={() => {
                navigator.clipboard.writeText(chatUrl);
                toast.success("Copied 📋");
              }}
              className="absolute top-2 end-2 p-2 hover:bg-card rounded-lg transition-colors"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => window.open(chatUrl, "_blank")}
          >
            <ExternalLink className="w-4 h-4 me-2" />
            {t("settings.openBot")}
          </Button>
        </motion.div>

        <Button
          onClick={handleSave}
          className="w-full h-12 text-base bg-gradient-primary shadow-soft"
          disabled={saving}
        >
          {saving ? "…" : t("settings.save")}
        </Button>
      </div>
    </div>
  );
}
