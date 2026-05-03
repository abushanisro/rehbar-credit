import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthProvider";
import { toast } from "sonner";

const schema = z.object({
  email: z.string().trim().email("Invalid email").max(255),
  password: z.string().min(6, "Min 6 chars").max(128),
  fullName: z.string().trim().max(100).optional(),
});

const Auth = () => {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (session) navigate("/", { replace: true }); }, [session, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password, fullName });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Account created. Logging in...");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err: any) {
      toast.error(err.message ?? "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-primary text-3xl font-bold tracking-[0.3em] glow">FINANALYZER</div>
          <div className="text-muted-foreground text-xs tracking-[0.4em] mt-1">// TERMINAL ACCESS v2.6.1</div>
        </div>

        <div className="terminal-panel scanlines">
          <div className="terminal-panel-header">
            <span>● {mode === "signin" ? "AUTHENTICATE" : "REGISTER OPERATOR"}</span>
            <span className="text-muted-foreground">SECURE LINK</span>
          </div>
          <form onSubmit={submit} className="p-5 space-y-4">
            {mode === "signup" && (
              <div>
                <label className="terminal-label block mb-1">▶ OPERATOR NAME</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full bg-input border border-border px-3 py-2 text-primary font-mono focus:outline-none focus:border-primary focus:shadow-[0_0_0_1px_hsl(var(--primary))]"
                  placeholder="John Doe"
                />
              </div>
            )}
            <div>
              <label className="terminal-label block mb-1">▶ EMAIL ID</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-input border border-border px-3 py-2 text-primary font-mono focus:outline-none focus:border-primary"
                placeholder="user@firm.com"
              />
            </div>
            <div>
              <label className="terminal-label block mb-1">▶ PASSPHRASE</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-input border border-border px-3 py-2 text-primary font-mono focus:outline-none focus:border-primary"
                placeholder="••••••••"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground py-2.5 font-bold tracking-widest hover:brightness-110 disabled:opacity-50 transition"
            >
              {loading ? "▶ PROCESSING..." : mode === "signin" ? "▶ ENTER TERMINAL" : "▶ CREATE ACCESS"}
            </button>
            <button
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              className="w-full text-xs text-muted-foreground hover:text-primary tracking-widest"
            >
              {mode === "signin" ? "[NO ACCESS? REGISTER]" : "[HAVE ACCESS? SIGN IN]"}
            </button>
          </form>
        </div>

        <div className="text-center mt-4 text-[10px] text-muted-foreground tracking-widest">
          POWERED BY LOVABLE CLOUD · ENCRYPTED CHANNEL
        </div>
      </div>
    </div>
  );
};

export default Auth;
