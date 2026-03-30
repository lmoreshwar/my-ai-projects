import React from 'react';

const Sidebar = ({ activeTab = 'intelligent_test_planner' }) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">TB</div>
        <div className="sidebar-brand">
          <div className="brand-name">TestingBuddy AI</div>
          <div className="brand-tagline">Testing Platform</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">
          <div className="nav-title">Main</div>
          <div className={`nav-item ${activeTab === 'intelligent_test_planner' ? 'active' : ''}`}>
            <span className="nav-icon">🎯</span> Test Planner
          </div>
          <div className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}>
            <span className="nav-icon">📊</span> Dashboard / Settings
          </div>
        </div>
      </nav>
    </aside>
  );
};

export default Sidebar;
