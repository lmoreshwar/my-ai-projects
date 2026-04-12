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
        <div className="w-full max-w-[1200px] grid grid-cols-1 md:grid-cols-12 gap-0 overflow-hidden rounded-xl shadow-[0_12px_32px_rgba(29,26,34,0.06)] bg-surface-container-lowest">
          
          {/* Branding/Visual Side */}
          <div className="hidden md:flex md:col-span-5 bg-primary-container p-12 flex-col justify-between relative overflow-hidden">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-white blur-3xl"></div>
              <div className="absolute bottom-1/4 right-0 w-64 h-64 rounded-full bg-primary blur-3xl"></div>
            </div>
            <div className="relative z-10">
              <div className="mb-20 flex items-center gap-2">
                <span className="material-symbols-outlined text-4xl text-white" style={{ fontVariationSettings: "'FILL' 1" }}>rocket_launch</span>
                <span className="font-headline font-black text-2xl tracking-tighter text-white">B.L.A.S.T AGENT</span>
              </div>
              <h2 className="text-white text-5xl font-black tracking-tighter leading-none mb-6">
                Autonomous <br /> Intelligence. <br /> Perfected.
              </h2>
              <p className="text-on-primary-container opacity-90 text-lg max-w-xs font-medium leading-relaxed">
                Welcome to the Test Command Center. Where precision logic meets self-healing automation.
              </p>
            </div>
            <div className="relative z-10">
              <div className="flex items-center gap-4 text-white/80 text-sm font-label uppercase tracking-widest">
                <span className="w-8 h-[2px] bg-white"></span>
                B.L.A.S.T AGENT Infrastructure
              </div>
            </div>
          </div>

          {/* Form Side */}
          <div className="col-span-1 md:col-span-7 p-8 md:p-16 lg:p-24 flex flex-col justify-center">
            <div className="mb-10">
              <div className="md:hidden mb-8 flex items-center gap-2">
                <span className="material-symbols-outlined text-2xl text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>rocket_launch</span>
                <span className="font-headline font-black text-xl tracking-tighter text-on-surface">B.L.A.S.T AGENT</span>
              </div>
              <h1 className="text-primary-container text-4xl md:text-5xl font-extrabold tracking-tighter mb-2">Create Your Account</h1>
              <p className="text-secondary font-medium text-sm">Step into the TEST COMMAND CENTER.</p>
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
                    placeholder="admin@blastai.com"
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
                  className="w-full sm:w-auto px-10 py-4 bg-gradient-to-br from-primary to-primary-container text-white font-bold rounded-md shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-95 transition-all duration-150 disabled:opacity-70 disabled:cursor-not-allowed"
                  type="submit"
                  disabled={loading}
                >
                  {loading ? 'Signing Up...' : 'Sign Up'}
                </button>
                <Link className="text-sm font-medium text-on-surface-variant hover:text-primary transition-colors" to="/login">
                  Already have an account? <span className="text-secondary font-bold underline underline-offset-4 decoration-outline-variant/30 hover:decoration-secondary">Sign In</span>
                </Link>
              </div>
            </form>

            {/* Legal/Trust */}
            <div className="mt-16 pt-8 border-t border-outline-variant/15">
              <p className="text-[11px] text-on-surface-variant/60 leading-relaxed max-w-sm">
                By signing up, you agree to the B.L.A.S.T AGENT <Link className="underline" to="#">Terms of Service</Link> and <Link className="underline" to="#">Privacy Policy</Link>. We use encryption to protect your data.
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
          © 2026 B.L.A.S.T AGENT. All rights reserved.
        </p>
      </footer>
    </div>
  );
}