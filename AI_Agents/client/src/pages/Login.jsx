import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Use relative URL in production, localhost in dev
  const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }

      // Clear any stale data from a previous user session before setting new user's data
      localStorage.removeItem('ai_test_agent_connections');
      localStorage.removeItem('ai_test_agent_testcases');
      localStorage.removeItem('ai_test_agent_lifted_state');

      // Save token and user details to localStorage (no sensitive data logged)
      localStorage.setItem('blast_token', data.token);
      localStorage.setItem('blast_user', JSON.stringify(data.user));

      // Notify App to re-fetch saved connections immediately
      if (onLogin) onLogin();
      
      navigate('/dashboard');
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Unable to connect to server. Please try again.' : err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col font-body">
      <main className="flex-grow flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-12 gap-0 overflow-hidden rounded-2xl shadow-[0_24px_60px_-15px_rgba(230,0,18,0.25)] ring-1 ring-black/5 bg-surface-container-lowest blast-rise">
          <div className="md:col-span-5 p-8 md:p-12 flex flex-col justify-between">
            <div>
              <div className="mb-12 flex items-center gap-3 blast-rise blast-rise-1">
                <span className="grid place-items-center w-11 h-11 rounded-xl bg-gradient-to-br from-app-red to-primary text-white shadow-lg shadow-primary/30 blast-glow">
                  <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>rocket_launch</span>
                </span>
                <div className="leading-none">
                  <span className="font-headline font-black text-2xl tracking-tighter bg-gradient-to-r from-app-red to-primary bg-clip-text text-transparent">BLAST</span>
                  <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface-variant mt-0.5">AIQA Platform</span>
                </div>
              </div>
              <div className="space-y-3 mb-10 blast-rise blast-rise-2">
                <h1 className="text-4xl font-black tracking-tighter leading-none bg-gradient-to-br from-primary via-app-red to-secondary bg-clip-text text-transparent">
                  Welcome back
                </h1>
                <p className="text-on-surface-variant text-lg font-medium">
                  Browser-Level Autonomous Software Testing
                </p>
              </div>
              {error && (
                <div className="mb-6 flex items-center gap-3 p-4 bg-error-container text-on-error-container rounded-lg border-l-4 border-error">
                  <span className="material-symbols-outlined text-error">error</span>
                  <span className="text-sm font-bold">{error}</span>
                </div>
              )}
              <form className="space-y-6" onSubmit={handleLogin} autoComplete="off">
                <div className="space-y-1">
                  <label className="text-secondary text-sm font-semibold tracking-wide block" htmlFor="login-email">Email</label>
                  <input
                    className="w-full border-0 border-b-2 border-outline-variant bg-surface-container-highest px-4 py-3 focus:ring-0 focus:border-primary transition-colors duration-200"
                    id="login-email"
                    name="login-email"
                    placeholder="you@blastaiqa.com"
                    type="email"
                    autoComplete="off"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-secondary text-sm font-semibold tracking-wide block" htmlFor="login-password">Password</label>
                    <Link className="text-tertiary text-xs font-medium hover:text-primary transition-colors" to="#">Forgot Password?</Link>
                  </div>
                  <input
                    className="w-full border-0 border-b-2 border-outline-variant bg-surface-container-highest px-4 py-3 focus:ring-0 focus:border-primary transition-colors duration-200"
                    id="login-password"
                    name="login-password"
                    placeholder="••••••••"
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <button
                  className="blast-shine relative overflow-hidden w-full bg-gradient-to-r from-app-red via-primary to-app-red bg-[length:200%_auto] hover:bg-[position:right_center] text-white font-bold py-4 rounded-xl shadow-lg shadow-primary/30 hover:shadow-primary/50 active:scale-[0.98] transition-all duration-300 disabled:opacity-70 disabled:cursor-not-allowed"
                  type="submit"
                  disabled={loading}
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {loading ? 'Signing In...' : 'Sign In'}
                    {!loading && <span className="material-symbols-outlined text-lg">arrow_forward</span>}
                  </span>
                </button>
              </form>
            </div>
            <div className="mt-12 text-center">
              <p className="text-on-surface-variant text-sm">
                Don't have an account? <Link className="text-primary font-bold hover:underline" to="/signup">Sign Up</Link>
              </p>
            </div>
          </div>
          <div className="hidden md:block md:col-span-7 relative overflow-hidden bg-[#1a0407]">
            {/* Animated aurora backdrop */}
            <div className="blast-aurora absolute inset-0 bg-[linear-gradient(120deg,#e60012,#b7000c,#2d5bb3,#b7000c,#e60012)] opacity-90"></div>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.25),transparent_40%)]"></div>
            {/* Floating glass orbs */}
            <div className="blast-float absolute -top-10 -right-10 w-52 h-52 rounded-full bg-white/10 blur-2xl"></div>
            <div className="blast-float-slow absolute bottom-10 -left-8 w-40 h-40 rounded-full bg-secondary/30 blur-2xl"></div>

            <div className="relative z-10 h-full flex flex-col justify-center p-12 lg:p-16 text-white">
              <div className="blast-glass rounded-2xl p-8 shadow-2xl blast-rise blast-rise-2">
                <p className="text-xs font-bold uppercase tracking-[0.25em] text-white/70 mb-4">What BLAST stands for</p>
                <ul className="space-y-3">
                  {[
                    { l: 'B', w: 'Browser-Level', d: 'Tests run exactly where your users live — the real browser.' },
                    { l: 'A', w: 'Autonomous', d: 'AI authors, heals and maintains the suite on its own.' },
                    { l: 'S', w: 'Software', d: 'Enterprise-grade coverage for any web application.' },
                    { l: 'T', w: 'Testing', d: 'From exploration to CI/CD pull requests — end to end.' },
                  ].map((row) => (
                    <li key={row.w} className="flex items-start gap-4">
                      <span className="grid place-items-center shrink-0 w-9 h-9 rounded-lg bg-white/15 border border-white/25 font-black text-lg">{row.l}</span>
                      <div>
                        <p className="font-bold leading-tight">{row.w}</p>
                        <p className="text-sm text-white/75 leading-snug">{row.d}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 pt-5 border-t border-white/15 flex items-center gap-2 text-sm font-semibold text-white/90">
                  <span className="material-symbols-outlined text-base">groups</span>
                  Built for every team. Trusted across every industry.
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <footer className="w-full flex flex-col items-center gap-4 py-12 px-8 bg-surface dark:bg-[#1d1a22] border-t border-outline-variant/15">
        <div className="flex gap-8 mb-2">
          <Link className="text-on-surface-variant text-xs font-normal hover:text-primary transition-colors" to="#">Privacy Policy</Link>
          <Link className="text-on-surface-variant text-xs font-normal hover:text-primary transition-colors" to="#">Terms of Service</Link>
          <Link className="text-on-surface-variant text-xs font-normal hover:text-primary transition-colors" to="#">Help Center</Link>
        </div>
        <p className="text-on-surface-variant text-xs font-normal tracking-wide">
          © 2026 BLAST AIQA · Browser-Level Autonomous Software Testing. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
