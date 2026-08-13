import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function SignUp() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSignUp = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';
      const response = await fetch(`${API_BASE}/api/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({ firstName, lastName, email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Registration failed');
      }
      setSuccessMsg("Registration successful! Click 'Sign In' below to log in.");
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'Unable to connect to server. Please try again.' : err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col items-center font-body">
      <main className="w-full flex-1 flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-[1200px] grid grid-cols-1 md:grid-cols-12 gap-0 overflow-hidden rounded-2xl shadow-[0_24px_60px_-15px_rgba(230,0,18,0.25)] ring-1 ring-black/5 bg-surface-container-lowest blast-rise">
          
          {/* Branding/Visual Side */}
          <div className="hidden md:flex md:col-span-5 p-12 flex-col justify-between relative overflow-hidden bg-[#1a0407]">
            <div className="blast-aurora absolute inset-0 bg-[linear-gradient(120deg,#e60012,#b7000c,#2d5bb3,#b7000c,#e60012)] opacity-90"></div>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,rgba(255,255,255,0.22),transparent_45%)]"></div>
            <div className="blast-float absolute -top-16 -left-10 w-72 h-72 rounded-full bg-white/10 blur-3xl"></div>
            <div className="blast-float-slow absolute bottom-1/4 -right-10 w-52 h-52 rounded-full bg-secondary/30 blur-3xl"></div>

            <div className="relative z-10">
              <div className="mb-16 flex items-center gap-3">
                <span className="grid place-items-center w-11 h-11 rounded-xl bg-white shadow-lg ring-1 ring-white/40 blast-glow">
                  <img src="/blast-mark.png?v=3" alt="BLAST AIQA" className="w-8 h-8 object-contain" />
                </span>
                <div className="leading-none">
                  <span className="font-headline font-black text-2xl tracking-tighter text-white">BLAST</span>
                  <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-white/70 mt-0.5">AIQA Platform</span>
                </div>
              </div>
              <h2 className="text-white text-4xl font-black tracking-tighter leading-tight mb-4">
                Browser-Level<br />Autonomous<br />Software Testing.
              </h2>
              <p className="text-white/85 text-base max-w-xs font-medium leading-relaxed mb-8">
                AI that explores your app, writes the tests, heals them, and ships pull requests — automatically.
              </p>
              <ul className="space-y-2.5">
                {[
                  { l: 'B', w: 'Browser-Level' },
                  { l: 'A', w: 'Autonomous' },
                  { l: 'S', w: 'Software' },
                  { l: 'T', w: 'Testing' },
                ].map((row) => (
                  <li key={row.w} className="flex items-center gap-3 text-white">
                    <span className="grid place-items-center w-7 h-7 rounded-md bg-white/15 border border-white/25 font-black text-sm">{row.l}</span>
                    <span className="font-semibold text-sm">{row.w}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative z-10">
              <div className="blast-glass rounded-xl px-4 py-3 flex items-center gap-3 text-white text-sm font-semibold">
                <span className="material-symbols-outlined text-base">groups</span>
                For every team, across every industry.
              </div>
            </div>
          </div>

          {/* Form Side */}
          <div className="col-span-1 md:col-span-7 p-8 md:p-16 lg:p-24 flex flex-col justify-center">
            <div className="mb-10">
              <div className="md:hidden mb-8 flex items-center gap-2">
                <img src="/blast-mark.png?v=3" alt="BLAST AIQA" className="w-8 h-8 object-contain" />
                <span className="font-headline font-black text-xl tracking-tighter text-on-surface">BLAST AIQA</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter mb-2 bg-gradient-to-br from-primary via-app-red to-secondary bg-clip-text text-transparent">Create your account</h1>
              <p className="text-secondary font-medium text-sm">Join the autonomous testing platform.</p>
            </div>

            {error && (
              <div className="mb-6 flex items-center gap-3 p-4 bg-error-container text-on-error-container rounded-lg border-l-4 border-error">
                <span className="material-symbols-outlined text-error">error</span>
                <span className="text-sm font-bold">{error}</span>
              </div>
            )}
            
            {successMsg && (
              <div className="mb-6 flex flex-col gap-3 p-4 bg-green-100 text-green-800 rounded-lg border-l-4 border-green-600">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-green-600">check_circle</span>
                  <span className="text-sm font-bold">{successMsg}</span>
                </div>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 w-fit px-6 py-2.5 bg-gradient-to-br from-primary to-primary-container text-white font-bold rounded-md shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all duration-150 text-sm"
                >
                  <span className="material-symbols-outlined text-sm">login</span>
                  Go to Sign In
                </Link>
              </div>
            )}

            <form className="space-y-8 max-w-lg" onSubmit={handleSignUp} autoComplete="off">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* First Name */}
                <div className="relative group">
                  <label className="block text-xs font-bold uppercase tracking-wider text-secondary mb-2" htmlFor="first_name">First Name</label>
                  <input
                    className="w-full bg-surface-container-highest border-0 border-b-2 border-transparent focus:border-primary-container focus:ring-0 transition-all duration-200 px-4 py-3 rounded-t-md text-on-surface placeholder:text-on-surface-variant/40"
                    id="first_name"
                    name="first_name"
                    placeholder="E.g. John"
                    type="text"
                    autoComplete="off"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                {/* Last Name */}
                <div className="relative group">
                  <label className="block text-xs font-bold uppercase tracking-wider text-secondary mb-2" htmlFor="last_name">Last Name</label>
                  <input
                    className="w-full bg-surface-container-highest border-0 border-b-2 border-transparent focus:border-primary-container focus:ring-0 transition-all duration-200 px-4 py-3 rounded-t-md text-on-surface placeholder:text-on-surface-variant/40"
                    id="last_name"
                    name="last_name"
                    placeholder="E.g. Doe"
                    type="text"
                    autoComplete="off"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Email Address */}
              <div className="relative group">
                <label className="block text-xs font-bold uppercase tracking-wider text-secondary mb-2" htmlFor="email">Email Address</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/60 text-sm">mail</span>
                  <input
                    className="w-full bg-surface-container-highest border-0 border-b-2 border-transparent focus:border-primary-container focus:ring-0 transition-all duration-200 pl-12 pr-4 py-3 rounded-t-md text-on-surface placeholder:text-on-surface-variant/40"
                    id="signup-email"
                    name="signup-email"
                    placeholder="you@blastaiqa.com"
                    type="email"
                    autoComplete="off"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Password */}
              <div className="relative group">
                <label className="block text-xs font-bold uppercase tracking-wider text-secondary mb-2" htmlFor="password">Create Password</label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/60 text-sm">lock</span>
                  <input
                    className="w-full bg-surface-container-highest border-0 border-b-2 border-transparent focus:border-primary-container focus:ring-0 transition-all duration-200 pl-12 pr-4 py-3 rounded-t-md text-on-surface placeholder:text-on-surface-variant/40"
                    id="signup-password"
                    name="signup-password"
                    placeholder="••••••••"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <p className="mt-2 text-[10px] text-on-surface-variant opacity-70">Password must contain at least 8 characters, one uppercase, and one number.</p>
              </div>

              {/* Action Button */}
              <div className="pt-4 flex flex-col sm:flex-row items-center gap-6">
                <button
                  className="blast-shine relative overflow-hidden w-full sm:w-auto px-10 py-4 bg-gradient-to-r from-app-red via-primary to-app-red bg-[length:200%_auto] hover:bg-[position:right_center] text-white font-bold rounded-xl shadow-lg shadow-primary/30 hover:shadow-primary/50 active:scale-95 transition-all duration-300 disabled:opacity-70 disabled:cursor-not-allowed"
                  type="submit"
                  disabled={loading}
                >
                  <span className="relative z-10">{loading ? 'Signing Up...' : 'Sign Up'}</span>
                </button>
                <Link className="text-sm font-medium text-on-surface-variant hover:text-primary transition-colors" to="/login">
                  Already have an account? <span className="text-secondary font-bold underline underline-offset-4 decoration-outline-variant/30 hover:decoration-secondary">Sign In</span>
                </Link>
              </div>
            </form>

            {/* Legal/Trust */}
            <div className="mt-16 pt-8 border-t border-outline-variant/15">
              <p className="text-[11px] text-on-surface-variant/60 leading-relaxed max-w-sm">
                By signing up, you agree to the BLAST AIQA <Link className="underline" to="#">Terms of Service</Link> and <Link className="underline" to="#">Privacy Policy</Link>. We use encryption to protect your data.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full flex flex-col items-center gap-4 py-12 px-8 bg-surface border-t border-outline-variant/15">
        <div className="flex flex-wrap justify-center gap-8 mb-4">
          <Link className="text-xs font-normal text-on-surface-variant hover:text-primary-container transition-colors" to="#">Privacy Policy</Link>
          <Link className="text-xs font-normal text-on-surface-variant hover:text-primary-container transition-colors" to="#">Terms of Service</Link>
          <Link className="text-xs font-normal text-on-surface-variant hover:text-primary-container transition-colors" to="#">Help Center</Link>
        </div>
        <p className="text-xs font-normal text-on-surface-variant/60">
          © 2026 BLAST AIQA · Browser-Level Autonomous Software Testing. All rights reserved.
        </p>
      </footer>
    </div>
  );
}