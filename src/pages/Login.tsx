import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import useStore from '../store/useStore';
import GovHeader from '../components/GovHeader';
import jharkhandEmblem from '../assets/jharkhand-emblem.png';
import ptrLogo from '../assets/ptr-logo.png';

function roleHome(role: string): string {
  if (role === 'director') return '/director';
  if (role === 'range_officer') return '/officer';
  return '/guard';
}

export default function Login() {
  const navigate = useNavigate();
  const { loginWithSupabase } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const trimmedEmail = email.trim().toLowerCase();

    try {
      await loginWithSupabase(trimmedEmail, password);
      // onAuthStateChange in AuthContext will set currentUser via setCurrentUser
      // Wait briefly for the state to propagate, then navigate
      setTimeout(() => {
        const user = useStore.getState().currentUser;
        if (user) navigate(roleHome(user.role), { replace: true });
        setLoading(false);
      }, 500);
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      if (status === 402) {
        // The Supabase project itself is billing-restricted (e.g. egress
        // quota exceeded), not a bad login. Its error body is internal
        // infra detail — don't show it verbatim to end users.
        setError('Login is temporarily unavailable. Please contact your system administrator.');
      } else {
        setError(err instanceof Error ? err.message : 'Invalid email or password.');
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-n-10">
      <div className="lg:hidden">
        <GovHeader />
      </div>

      {/* Brand panel — desktop only */}
      <div className="hidden lg:flex lg:w-[42%] xl:w-[38%] flex-col bg-ptr-green-dark text-white p-10 xl:p-14 flex-shrink-0 relative overflow-hidden">
        {/* subtle vertical gradient */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 35%, rgba(0,0,0,0.12) 100%)',
          }}
        />
        {/* barely-visible fine grid, evokes a topographic/map reference */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.025]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, rgba(255,255,255,0.8) 0px, rgba(255,255,255,0.8) 1px, transparent 1px, transparent 64px), repeating-linear-gradient(90deg, rgba(255,255,255,0.8) 0px, rgba(255,255,255,0.8) 1px, transparent 1px, transparent 64px)',
          }}
        />

        <div className="relative flex flex-col justify-between h-full">
          {/* Letterhead */}
          <div className="flex items-start gap-3.5">
            <img src={jharkhandEmblem} alt="" className="w-11 h-11 flex-shrink-0" />
            <div className="leading-tight pt-0.5">
              <div className="text-[13px] font-bold tracking-[0.09em] uppercase text-white">
                Government of Jharkhand
              </div>
              <div className="text-[11px] text-white/50 tracking-wide mt-1 leading-snug max-w-[13rem]">
                Department of Forest,
                <br />
                Environment &amp; Climate Change
              </div>
            </div>
          </div>

          {/* System identity */}
          <div className="border-t border-white/10 pt-8">
            <div className="w-16 h-16 rounded-full bg-white/95 flex items-center justify-center mb-6 overflow-hidden">
              <img src={ptrLogo} alt="Palamau Tiger Reserve emblem" className="w-full h-full object-contain p-1" />
            </div>
            <div className="text-[11px] font-semibold tracking-[0.14em] uppercase text-white/60">
              Palamau Tiger Reserve
            </div>
            <h1 className="text-2xl xl:text-[1.75rem] font-bold tracking-tight leading-snug mt-1.5">
              Field Operations
              <br />
              Management System
            </h1>

            <div className="border-t border-white/10 mt-6 mb-5 w-14" />

            <p className="text-white/50 text-[13px] leading-relaxed max-w-sm">
              Internal platform for patrol management, incident reporting, wildlife monitoring, task assignment, and
              reserve administration.
            </p>
          </div>

          {/* Footer meta */}
          <div className="border-t border-white/10 pt-5 flex flex-col gap-1.5 text-[11px] text-white/40">
            <div className="flex items-center justify-between">
              <span className="uppercase tracking-[0.08em]">Government Network</span>
              <span className="tracking-wide">Version 2.1.0</span>
            </div>
            <div className="uppercase tracking-[0.08em] text-white/40">Authorized Personnel Only</div>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-4 lg:p-10 bg-n-10">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-md border border-n-30 shadow-card p-8">
            <h2 className="text-lg font-semibold text-n-100">Secure login</h2>
            <p className="text-13 text-n-80 mt-1 mb-6">
              Sign in with your registered credentials to continue.
            </p>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-[13px] font-semibold text-ptr-brown mb-1.5">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  autoComplete="email"
                  className="w-full px-3.5 py-3 border border-n-40 rounded text-n-100 placeholder:text-n-70 focus:outline-none focus:ring-2 focus:ring-ptr-accent/30 focus:border-ptr-accent transition-all min-h-[48px] bg-white"
                  style={{ fontSize: '16px' }}
                  required
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-ptr-brown mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    autoComplete="current-password"
                    className="w-full px-3.5 py-3 pr-10 border border-n-40 rounded text-n-100 placeholder:text-n-70 focus:outline-none focus:ring-2 focus:ring-ptr-accent/30 focus:border-ptr-accent transition-all min-h-[48px] bg-white"
                    style={{ fontSize: '16px' }}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ptr-brown-light hover:text-ptr-brown transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-md">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full h-[52px] flex items-center justify-center bg-ptr-green text-white font-semibold text-sm tracking-wide rounded-md hover:bg-ptr-green-light disabled:opacity-60 transition-colors"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-ptr-cream-dark flex gap-2.5">
              <Lock className="w-3.5 h-3.5 text-ptr-brown-light/70 flex-shrink-0 mt-0.5" />
              <p className="text-[11.5px] leading-relaxed text-ptr-brown-light/80">
                <span className="font-semibold text-ptr-brown-light">Restricted Access.</span> This system is
                intended for authorized personnel of the Government of Jharkhand only. All activities are monitored
                and logged.
              </p>
            </div>
          </div>

          <p className="text-center text-[11px] text-ptr-brown-light/70 mt-6 leading-relaxed tracking-wide">
            Department of Forest,
            <br />
            Environment &amp; Climate Change
          </p>
        </div>
      </div>
    </div>
  );
}
