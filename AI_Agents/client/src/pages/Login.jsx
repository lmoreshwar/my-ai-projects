import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('http://localhost:10000/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Login failed');
      }

      console.log('User logged in:', data.user);
      // Save token and user details to localStorage
      localStorage.setItem('blast_token', data.token);
      localStorage.setItem('blast_user', JSON.stringify(data.user));
      
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    // We will integrate Firebase or Google OAuth here later
    alert("Google Login will be implemented in the next step.");
  };

  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col font-body">
      <main className="flex-grow flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-12 gap-0 overflow-hidden rounded-xl shadow-[0_12px_32px_rgba(29,26,34,0.06)] bg-surface-container-lowest">
          <div className="md:col-span-5 p-8 md:p-12 flex flex-col justify-between">
            <div>
              <div className="mb-12 flex items-center gap-2">
                <span className="material-symbols-outlined text-4xl text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>rocket_launch</span>
                <span className="font-headline font-black text-2xl tracking-tighter text-on-surface">BLAST AGENT</span>
              </div>
              <div className="space-y-2 mb-10">
                <h1 className="text-primary-container text-4xl font-black tracking-tighter leading-none">
                  TEST COMMAND CENTER
                </h1>
                <p className="text-on-surface-variant text-lg font-medium">
                  Autonomous Intelligence · Precision Engineering
                </p>
              </div>
              {error && (
                <div className="mb-6 flex items-center gap-3 p-4 bg-error-container text-on-error-container rounded-lg border-l-4 border-error">
                  <span className="material-symbols-outlined text-error">error</span>
                  <span className="text-sm font-bold">{error}</span>
                </div>
              )}
              <form className="space-y-6" onSubmit={handleLogin}>
                <div className="space-y-1">
                  <label className="text-secondary text-sm font-semibold tracking-wide block" htmlFor="email">Email</label>
                  <input
                    className="w-full border-0 border-b-2 border-outline-variant bg-surface-container-highest px-4 py-3 focus:ring-0 focus:border-primary transition-colors duration-200"
                    id="email"
                    name="email"
                    placeholder="admin@blastai.com"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-secondary text-sm font-semibold tracking-wide block" htmlFor="password">Password</label>
                    <Link className="text-tertiary text-xs font-medium hover:text-primary transition-colors" to="#">Forgot Password?</Link>
                  </div>
                  <input
                    className="w-full border-0 border-b-2 border-outline-variant bg-surface-container-highest px-4 py-3 focus:ring-0 focus:border-primary transition-colors duration-200"
                    id="password"
                    name="password"
                    placeholder="••••••••"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <button
                  className="w-full bg-gradient-to-r from-primary to-primary-container text-white font-bold py-4 rounded-md shadow-md hover:scale-[0.98] transition-transform duration-150 ease-in-out disabled:opacity-70 disabled:cursor-not-allowed"
                  type="submit"
                  disabled={loading}
                >
                  {loading ? 'Signing In...' : 'Sign In'}
                </button>
              </form>
              <div className="relative my-8">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-outline-variant/30"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-surface-container-lowest px-2 text-on-surface-variant font-medium tracking-widest">or continue with</span>
                </div>
              </div>
              <button
                onClick={handleGoogleLogin}
                type="button"
                className="w-full flex items-center justify-center gap-3 bg-surface-container-highest text-on-secondary-container font-semibold py-4 rounded-md border border-outline-variant/10 hover:bg-surface-variant transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"></path>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"></path>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"></path>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"></path>
                </svg>
                Sign in with Google
              </button>
            </div>
            <div className="mt-12 text-center">
              <p className="text-on-surface-variant text-sm">
                Don't have an account? <Link className="text-primary font-bold hover:underline" to="/signup">Sign Up</Link>
              </p>
            </div>
          </div>
          <div className="hidden md:block md:col-span-7 relative bg-primary overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary-container to-secondary opacity-90 mix-blend-multiply"></div>
            <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1558494949-ef010cbdcc31?q=80&w=2034&auto=format&fit=crop')] bg-cover bg-center opacity-40 mix-blend-overlay"></div>
            <div className="absolute inset-0 flex flex-col justify-end p-16 text-white space-y-4">
              <div className="backdrop-blur-md bg-white/10 p-8 rounded-xl border border-white/20">
                <span className="material-symbols-outlined text-4xl mb-4">terminal</span>
                <h2 className="text-3xl font-black tracking-tight mb-2">Architecting Autonomous Testing</h2>
                <p className="text-lg text-primary-fixed opacity-90 font-light leading-relaxed">
                  Access the global hub for BLAST AGENT's proprietary QA frameworks and deterministic command protocols.
                </p>
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
          © 2026 BLAST AGENT. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
