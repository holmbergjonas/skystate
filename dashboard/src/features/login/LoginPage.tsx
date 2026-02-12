import { Github, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { redirectToLogin, isTestMode, clearSignedOut } from '@/lib/auth';

const features = ['JSON Editor', 'Version Control', 'CDN Reads'];

export function LoginPage() {
  const handleLogin = () => {
    clearSignedOut();
    if (isTestMode()) {
      window.location.href = '/';
      return;
    }
    redirectToLogin();
  };

  return (
    <div className="min-h-screen bg-app flex flex-col items-center justify-center px-4">
      {/* Branding */}
      <div className="flex items-center gap-3 mb-4">
        <Send size={40} color="#3399FF" strokeWidth={0.5} />
        <span className="text-3xl font-bold bg-linear-to-r from-[#3399FF] to-[#8b5cf6] bg-clip-text text-transparent">
          SkyState
        </span>
      </div>

      <p className="text-text-secondary text-sm mb-10 tracking-wide">
        Persistent state for your services
      </p>

      {/* Sign-in card */}
      <div className="w-full max-w-[380px] rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] backdrop-blur-sm p-8">
        <h1 className="text-lg font-semibold text-foreground text-center">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground text-center">
          Sign in to your console
        </p>

        <Button className="mt-6 w-full cursor-pointer" onClick={handleLogin}>
          <Github className="h-4 w-4" />
          Sign in with GitHub
        </Button>

        <div className="mt-8 flex items-center justify-center gap-6 text-text-muted">
          {features.map((f) => (
            <span key={f} className="flex items-center gap-1.5 text-xs">
              <span className="text-primary">&#10003;</span>
              {f}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
