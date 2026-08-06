import { useNavigate } from 'react-router-dom';

export default function DevHome() {
  const navigate = useNavigate();

  const handleContinue = () => {
    // Set a dev token in localStorage
    localStorage.setItem('token', 'dev-mode-token');
    localStorage.setItem('user', JSON.stringify({
      email: 'dev@localhost',
      name: 'Developer',
      _id: 'dev-user-id'
    }));
    navigate('/app');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white/10 backdrop-blur-xl rounded-2xl border border-white/20 p-8 text-center">
        <div className="text-6xl mb-4">🚀</div>
        <h1 className="text-3xl font-bold text-white mb-2">B.L.A.S.T AGENT</h1>
        <p className="text-purple-200 mb-2">Development Mode</p>
        <p className="text-sm text-gray-400 mb-6">
          Database not connected. Running in local dev mode.
        </p>
        
        <button
          onClick={handleContinue}
          className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold py-3 rounded-lg hover:opacity-90 transition-all"
        >
          Continue to App
        </button>

        <div className="mt-6 text-xs text-gray-400">
          <p>✅ Test Generation Features Available</p>
          <p>✅ Automation Code Generation Available</p>
          <p>⚠️ Database features disabled (no history)</p>
        </div>
      </div>
    </div>
  );
}
