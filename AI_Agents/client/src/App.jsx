import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import './index.css'

function App() {
  const [step, setStep] = useState(1);
  const [theme, setTheme] = useState('light');
  const [loading, setLoading] = useState(false);
  
  // Connectivity State
  const [connections, setConnections] = useState({
    jira: { url: 'https://moreaitesting.atlassian.net', email: '', token: '', status: 'disconnected', message: '' },
    confluence: { spaceKey: '~557058c1a87e0133ac4988ab2e375b24ac9302', parentId: '327682', status: 'idle', message: '' },
    llm: { platform: 'groq', apiKey: '', endpoint: '', status: 'disconnected', message: '' }
  });

  const [formData, setFormData] = useState({
    productName: '',
    projectKey: '',
    sprint: '',
    context: ''
  });

  const [issueData, setIssueData] = useState(null);
  const [result, setResult] = useState({ plan: '', downloadUrl: '', md_download_url: '' });

  const API_BASE = import.meta.env.DEV ? "http://localhost:8000" : "/api";

  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');
  
  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('testingbuddy_connections');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setConnections(prev => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error("Failed to load connections from storage", e);
      }
    }
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    // Only save URL, Email, Token and Confluence keys to avoid saving transient status
    const dataToSave = {
        jira: { ...connections.jira, status: 'disconnected', message: '' },
        confluence: { ...connections.confluence, status: 'idle', message: '' },
        llm: { ...connections.llm, status: 'disconnected', message: '' }
    };
    localStorage.setItem('testingbuddy_connections', JSON.stringify(dataToSave));
  }, [connections.jira.url, connections.jira.email, connections.jira.token, 
      connections.confluence.spaceKey, connections.confluence.parentId,
      connections.llm.platform, connections.llm.apiKey, connections.llm.endpoint]);

  const testConnection = async (type) => {
    const config = connections[type];
    setConnections(prev => ({
      ...prev,
      [type]: { ...prev[type], status: 'testing', message: 'Testing connection...' }
    }));

    try {
      const res = await fetch(`${API_BASE}/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, config })
      });
      const data = await res.json();
      setConnections(prev => ({
        ...prev,
        [type]: { 
          ...prev[type], 
          status: data.status === 'success' ? 'connected' : 'error', 
          message: data.message 
        }
      }));
    } catch (e) {
      setConnections(prev => ({
        ...prev,
        [type]: { ...prev[type], status: 'error', message: 'Network error or server down' }
      }));
    }
  };

  const fetchIssues = async () => {
    if (!connections.jira.token && !connections.ado.token) {
        alert("Please configure a connection first");
        setStep(1);
        return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/fetch-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, jira: connections.jira })
      });
      if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "Fetch failed");
      }
      const data = await res.json();
      setIssueData(data);
      setStep(3);
    } catch (e) {
      alert(e.message);
    }
    setLoading(false);
  };

  const generatePlan = async () => {
    if (connections.llm.status !== 'connected') {
        alert("Please connect your LLM (Groq/Ollama) first in Step 1");
        setStep(1);
        return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueData, llm: connections.llm })
      });
      if (!res.ok) throw new Error("Generation failed");
      const data = await res.json();
      setResult(data);
      setStep(4);
    } catch (e) {
      alert(e.message);
    }
    setLoading(false);
  };

  const publishToConfluence = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/publish-confluence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Test Plan: ${issueData.summary}`,
          content: result.plan,
          spaceKey: connections.confluence.spaceKey,
          parentId: connections.confluence.parentId || null,
          jira: connections.jira
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Publishing failed");
      alert("Successfully published to Confluence!");
      window.open(data.url, '_blank');
    } catch (e) {
      alert(e.message);
    }
    setLoading(false);
  };

  const steps = ["1. Setup", "2. Fetch Issues", "3. Review", "4. Test Plan"];

  return (
    <div className="layout">
      <Sidebar activeTab={step === 1 ? 'settings' : 'intelligent_test_planner'} />
      
      <main className="main-content">
        <header className="top-header">
          <div style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
             <div className="agent-icon">🎯</div>
             <div>
                <h2 style={{margin:0, fontSize: '1.2rem'}}>Intelligent Test Planning Agent</h2>
                <p style={{margin:0, fontSize: '0.8rem', color: 'var(--text-muted)'}}>Generate comprehensive test plans from Jira requirements using AI</p>
             </div>
          </div>
          <div style={{display: 'flex', gap: '1rem', alignItems: 'center'}}>
            <button className="dark-mode-toggle" onClick={toggleTheme}>
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
            <button className="btn-secondary" style={{padding: '0.6rem 1.5rem', borderRadius: '10px', border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--card-bg)', color: 'var(--text)'}}>
              View History
            </button>
          </div>
        </header>

        <div className="dashboard-container">
          <div className="stepper-row">
            {steps.map((s, i) => (
              <div 
                key={i} 
                className={`step-btn ${step === i + 1 ? 'active' : ''}`}
                onClick={() => setStep(i + 1)}
              >
                {s}
              </div>
            ))}
          </div>

          <div className="card">
            {step === 1 && (
              <div className="flow-setup">
                <div style={{marginBottom: '2rem'}}>
                    <h2>Connectivity Dashboard</h2>
                    <p style={{color: 'var(--text-muted)'}}>Configure your external platform and LLM connections</p>
                </div>
                
                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem'}}>
                    {/* Jira Section */}
                    <div className="setup-section">
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
                            <h3 style={{fontSize: '1rem'}}>🌐 Jira Connection</h3>
                            <span className={`test-badge test-${connections.jira.status}`}>{connections.jira.status}</span>
                        </div>
                        <div className="form-group">
                            <label>Atlassian URL</label>
                            <input value={connections.jira.url} onChange={e => setConnections({...connections, jira: {...connections.jira, url: e.target.value}})} disabled={loading} />
                        </div>
                        <div className="form-group">
                            <label>Email</label>
                            <input value={connections.jira.email} onChange={e => setConnections({...connections, jira: {...connections.jira, email: e.target.value}})} disabled={loading} />
                        </div>
                        <div className="form-group">
                            <label>API Token</label>
                            <input type="password" value={connections.jira.token} onChange={e => setConnections({...connections, jira: {...connections.jira, token: e.target.value}})} placeholder="••••••••" disabled={loading} />
                        </div>
                        
                        <div style={{marginTop: '1.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem'}}>
                           <h4 style={{fontSize: '0.8rem', margin: '0 0 1rem'}}>📘 Confluence Publishing Settings</h4>
                           <div className="form-group">
                              <label>Space Key (e.g. SCRUM)</label>
                              <input value={connections.confluence.spaceKey} onChange={e => setConnections({...connections, confluence: {...connections.confluence, spaceKey: e.target.value}})} placeholder="e.g. ~557058c1..." disabled={loading} />
                           </div>
                           <div className="form-group">
                              <label>Parent Page ID (Optional)</label>
                              <input value={connections.confluence.parentId} onChange={e => setConnections({...connections, confluence: {...connections.confluence, parentId: e.target.value}})} placeholder="e.g. 327682" disabled={loading} />
                           </div>
                        </div>

                        <button className="btn-primary" style={{width: '100%', marginBottom: '0.5rem', marginTop: '1rem'}} onClick={() => testConnection('jira')} disabled={loading}>
                            {connections.jira.status === 'testing' ? 'Testing...' : 'Verify All Atlassian'}
                        </button>
                    </div>

                    {/* LLM Section */}
                    <div className="setup-section">
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
                            <h3 style={{fontSize: '1rem'}}>🧠 LLM Connection (Groq/Ollama)</h3>
                            <span className={`test-badge test-${connections.llm.status}`}>{connections.llm.status}</span>
                        </div>
                        <div className="form-group">
                            <label>Platform</label>
                            <select value={connections.llm.platform} onChange={e => setConnections({...connections, llm: {...connections.llm, platform: e.target.value}})} disabled={loading}>
                                <option value="groq">Groq (Cloud)</option>
                                <option value="ollama">Ollama (Local)</option>
                                <option value="grok">Grok (xAI)</option>
                                <option value="gemini">Gemini</option>
                            </select>
                        </div>
                        {connections.llm.platform === 'ollama' && (
                            <div className="form-group">
                                <label>Ollama Endpoint</label>
                                <input value={connections.llm.endpoint} onChange={e => setConnections({...connections, llm: {...connections.llm, endpoint: e.target.value}})} placeholder="http://localhost:11434/v1" disabled={loading} />
                            </div>
                        )}
                        <div className="form-group">
                            <label>{connections.llm.platform === 'ollama' ? 'Model (e.g. llama3)' : 'API Key'}</label>
                            <input type={connections.llm.platform === 'ollama' ? 'text' : 'password'} value={connections.llm.apiKey} onChange={e => setConnections({...connections, llm: {...connections.llm, apiKey: e.target.value}})} placeholder={connections.llm.platform === 'ollama' ? 'llama3' : '••••••••'} disabled={loading} />
                        </div>
                        <button className="btn-primary" style={{width: '100%'}} onClick={() => testConnection('llm')} disabled={loading}>
                            {connections.llm.status === 'testing' ? 'Testing...' : 'Test LLM Connection'}
                        </button>
                        {connections.llm.message && <div style={{fontSize: '0.75rem', marginTop: '0.5rem', color: connections.llm.status === 'error' ? '#ef4444' : '#10b981'}}>{connections.llm.message}</div>}
                    </div>
                </div>

                <div style={{marginTop: '3rem', display: 'flex', justifyContent: 'flex-end'}}>
                    <button className="btn-primary" style={{padding: '0.8rem 3rem'}} onClick={() => setStep(2)}>Save & Continue</button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <h2>Fetch Jira Requirements</h2>
                <p style={{color: 'var(--text-muted)', marginBottom: '2rem'}}>Search for the feature or requirement to test</p>
                
                <div className="connection-banner">
                  <div>
                    <div style={{fontSize: '0.8rem', fontWeight: 600}}>Primary Source:</div>
                    <div style={{color: 'var(--primary)', fontWeight: 600}}>{connections.jira.url}</div>
                  </div>
                  <button className="btn-secondary" style={{padding: '0.4rem 1rem', borderRadius: '6px', cursor: 'pointer'}} onClick={() => setStep(1)}>Change Source</button>
                </div>

                <div className="form-row">
                   <div className="form-group">
                      <label>Product Name / System</label>
                      <input placeholder="e.g., App.vwo.com" value={formData.productName} onChange={e => setFormData({...formData, productName: e.target.value})} disabled={loading} />
                   </div>
                   <div className="form-group">
                      <label>Project Key (e.g. VWO) *</label>
                      <input placeholder="e.g., VWOAPP" value={formData.projectKey} onChange={e => setFormData({...formData, projectKey: e.target.value})} disabled={loading} />
                   </div>
                </div>

                <div className="form-group">
                  <label>Sprint / Fix Version / Requirement ID (Optional)</label>
                  <input placeholder="e.g., Sprint 15 or VWOAPP-123" value={formData.sprint} onChange={e => setFormData({...formData, sprint: e.target.value})} disabled={loading} />
                </div>

                <div className="form-group">
                  <label>Additional Instructions (Optional)</label>
                  <textarea rows="4" placeholder="Mention any specific testing constraints or edge cases..." value={formData.context} onChange={e => setFormData({...formData, context: e.target.value})} disabled={loading} />
                </div>

                <button className="btn-primary" style={{width: '100%', marginTop: '1rem'}} onClick={fetchIssues} disabled={loading}>
                    {loading ? (
                        <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                            <span className="spin">⌛</span> Generating Preview...
                        </div>
                    ) : '📥 Fetch & Preview Jira Issue'}
                </button>
              </div>
            )}

            {step === 3 && issueData && (
              <div className="preview-container">
                 <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
                    <h2>Fetch Preview</h2>
                    <span className="test-badge test-success">Successfully Fetched</span>
                 </div>
                 
                 <div className="connection-banner" style={{marginBottom: '1.5rem', background: 'rgba(16, 185, 129, 0.05)', borderColor: '#10b981'}}>
                    <div style={{display: 'flex', gap: '0.8rem', alignItems: 'center'}}>
                       <span style={{fontSize: '1.5rem'}}>📄</span> 
                       <div>
                          <div style={{fontSize: '0.7rem', textTransform: 'uppercase', color: '#10b981', fontWeight: 700}}>Jira Requirement</div>
                          <div style={{fontWeight: 700}}>{issueData.id}: {issueData.summary}</div>
                       </div>
                    </div>
                 </div>

                 <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem'}}>
                    <div className="form-group">
                        <label>Project</label>
                        <div className="preview-field">{issueData.project || 'N/A'}</div>
                    </div>
                    <div className="form-group">
                        <label>Status</label>
                        <div className="preview-field"><span className="test-badge" style={{background: '#e2e8f0', color: '#475569'}}>{issueData.status || 'N/A'}</span></div>
                    </div>
                 </div>

                 <div className="form-group">
                    <label>Description Preview</label>
                    <div style={{padding: '1.2rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '10px', maxHeight: '250px', overflowY: 'auto', fontSize: '0.9rem', lineHeight: '1.7', color: 'var(--text)'}}>
                        {issueData.description || <i style={{color: 'var(--text-muted)'}}>No description available for this issue.</i>}
                    </div>
                 </div>

                 <div className="form-group">
                    <label>Add Extra Logic/Context for AI (Optional)</label>
                    <textarea rows="3" placeholder="e.g. Focus on edge cases for mobile devices..." value={formData.context} onChange={e => setFormData({...formData, context: e.target.value})} />
                 </div>

                 <div style={{display: 'flex', gap: '1rem', marginTop: '2rem'}}>
                    <button className="btn-secondary" style={{flex: 1, padding: '1rem', borderRadius: '10px'}} onClick={() => setStep(2)}>Back to Search</button>
                    <button className="btn-primary" style={{flex: 2, padding: '1rem', borderRadius: '10px'}} onClick={generatePlan} disabled={loading}>
                        {loading ? 'Architecting Strategy...' : '🚀 Generate Professional Test Plan'}
                    </button>
                 </div>
              </div>
            )}

            {step === 4 && (
              <div style={{textAlign: 'center'}}>
                 {loading ? (
                    <div style={{padding: '4rem 0'}}>
                        <div style={{fontSize: '4rem', marginBottom: '1rem', animation: 'spin 2s linear infinite'}}>⚙️</div>
                        <h2>Architecting Test Strategy...</h2>
                        <p style={{color: 'var(--text-muted)'}}>Using {connections.llm.platform} to generate a comprehensive plan</p>
                    </div>
                 ) : result.plan ? (
                    <div style={{textAlign: 'left'}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
                            <h2>Generated Test Plan</h2>
                            <div style={{display: 'flex', gap: '0.5rem'}}>
                                <button className="btn-primary" onClick={() => window.open(`${API_BASE}${result.download_url}`, '_blank')}>
                                    📥 Word
                                </button>
                                <button className="btn-primary" style={{background: '#059669'}} onClick={() => window.open(`${API_BASE}${result.md_download_url}`, '_blank')}>
                                    📄 Markdown
                                </button>
                                <button className="btn-primary" style={{background: '#0a45b1'}} onClick={publishToConfluence} disabled={loading}>
                                    {loading ? 'Publishing...' : '📘 Publish to Confluence'}
                                </button>
                            </div>
                        </div>
                        <div className="card" style={{backgroundColor: 'var(--bg)', border: '1px solid var(--primary)', whiteSpace: 'pre-wrap', maxHeight: '500px', overflowY: 'auto', padding: '1.5rem', fontSize: '0.9rem', lineHeight: '1.7'}}>
                            {result.plan}
                        </div>
                    </div>
                 ) : (
                    <div style={{padding: '4rem 0'}}>
                        <div style={{fontSize: '4rem', marginBottom: '1rem'}}>📄</div>
                        <h2>No Plan Available</h2>
                        <p style={{color: 'var(--text-muted)'}}>Return to step 2 to fetch new requirements</p>
                        <button className="btn-primary" style={{marginTop: '1.5rem'}} onClick={() => setStep(2)}>Go Back</button>
                    </div>
                 )}
              </div>
            )}
          </div>
        </div>
      </main>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .setup-section {
            background: rgba(99, 102, 241, 0.02);
            padding: 1.5rem;
            border-radius: 12px;
            border: 1px solid var(--border);
        }
      `}} />
    </div>
  )
}

export default App
