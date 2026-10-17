import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  fetchCollaboratorAnalytics,
  filterCollaboratorAnalytics,
} from '../services/collaboratorAnalyticsService';
import { parseRepoIdentifier } from '../services/githubTimelineService';

export default function ExploreCollaborators({ repo = 'facebook/react', onBack }) {
  const [rawData, setRawData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState({ phase: 'starting', loaded: 0, total: 100 });
  const [errorMessage, setErrorMessage] = useState(null);
  const [errorType, setErrorType] = useState(null);
  const [tokenInput, setTokenInput] = useState('');

  // Active Tab: 'directories' | 'activity' | 'matrix'
  const [activeTab, setActiveTab] = useState('directories');

  // Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDirectory, setSelectedDirectory] = useState(null);
  const [selectedContributor, setSelectedContributor] = useState(null);
  const [dateRangePreset, setDateRangePreset] = useState('all'); // 'all' | '30d' | '90d' | '180d' | '365d'
  const [timeGrouping, setTimeGrouping] = useState('week'); // 'day' | 'week' | 'month'
  const [hideBots, setHideBots] = useState(true);
  const [hideMerges, setHideMerges] = useState(false);

  // Inspector modal / drawer
  const [inspectingContributor, setInspectingContributor] = useState(null);
  const [inspectingCommit, setInspectingCommit] = useState(null);
  const [selectedFileDrilldown, setSelectedFileDrilldown] = useState(null);

  const parsedRepo = useMemo(() => parseRepoIdentifier(repo), [repo]);
  const fullName = parsedRepo.fullName;

  // 1. Fetch Real Repository Collaborator Analytics
  const loadData = async (forceRefresh = false) => {
    setIsLoading(true);
    setErrorMessage(null);
    setErrorType(null);

    try {
      const data = await fetchCollaboratorAnalytics(repo, {
        maxCommits: 100,
        maxDetailsToFetch: 40,
        forceRefresh,
        onProgress: (prog) => {
          setLoadingProgress(prog);
        },
      });
      setRawData(data);
      if (data.directories && data.directories.length > 0) {
        setSelectedDirectory(data.directories[0].path);
      }
      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
      setErrorType(err.type || (err.message === 'RATE_LIMIT_EXCEEDED' ? 'RATE_LIMIT' : 'UNKNOWN'));
      setErrorMessage(err.message || 'Unable to load collaborator analytics.');
    }
  };

  useEffect(() => {
    loadData();
  }, [repo]);

  // Save personal access token
  const handleSaveToken = (e) => {
    e.preventDefault();
    if (tokenInput.trim()) {
      localStorage.setItem('github_token', tokenInput.trim());
      loadData(true);
    }
  };

  // 2. Compute Date Range from Preset
  const dateRangeBounds = useMemo(() => {
    if (dateRangePreset === 'all') return { startDate: null, endDate: null };
    const now = new Date();
    let days = 30;
    if (dateRangePreset === '90d') days = 90;
    if (dateRangePreset === '180d') days = 180;
    if (dateRangePreset === '365d') days = 365;
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { startDate: start.toISOString(), endDate: now.toISOString() };
  }, [dateRangePreset]);

  // 3. Compute Filtered Analytics
  const filteredData = useMemo(() => {
    if (!rawData) return null;
    return filterCollaboratorAnalytics(rawData, {
      startDate: dateRangeBounds.startDate,
      endDate: dateRangeBounds.endDate,
      selectedContributorId: selectedContributor?.id || null,
      selectedDirectory: null, // we filter directories in UI views
      hideBots,
      hideMerges,
      grouping: timeGrouping,
    });
  }, [rawData, dateRangeBounds, selectedContributor, hideBots, hideMerges, timeGrouping]);

  // 4. Directory & File Search Filtering
  const displayedDirectories = useMemo(() => {
    if (!filteredData) return [];
    let list = filteredData.directories || [];
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      list = list.filter((d) => 
        (d.path || '').toLowerCase().includes(query) ||
        (d.contributors || []).some((c) => (c.login || '').toLowerCase().includes(query) || (c.name || '').toLowerCase().includes(query)) ||
        (d.files || []).some((f) => (f.filename || '').toLowerCase().includes(query))
      );
    }
    return list;
  }, [filteredData, searchQuery]);

  const activeDirectoryData = useMemo(() => {
    if (!filteredData || !displayedDirectories.length) return null;
    return displayedDirectories.find((d) => d.path === selectedDirectory) || displayedDirectories[0];
  }, [filteredData, displayedDirectories, selectedDirectory]);

  // Mini-screen drawer / modal open status
  const isMiniScreenOpen = Boolean(inspectingContributor || inspectingCommit || selectedFileDrilldown);

  // Lock main screen scrolling when any mini screen is open
  useEffect(() => {
    if (isMiniScreenOpen) {
      document.body.classList.add('mini-screen-locked');
      document.documentElement.classList.add('mini-screen-locked');
      if (window.__lenis) {
        window.__lenis.stop();
      }
    } else {
      document.body.classList.remove('mini-screen-locked');
      document.documentElement.classList.remove('mini-screen-locked');
      if (window.__lenis) {
        window.__lenis.start();
      }
    }

    return () => {
      document.body.classList.remove('mini-screen-locked');
      document.documentElement.classList.remove('mini-screen-locked');
      if (window.__lenis) {
        window.__lenis.start();
      }
    };
  }, [isMiniScreenOpen]);

  // ---------------------------------------------------------------------------
  // RENDER: LOADING STATE
  // ---------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="apple-minimal-stage">
        <div className="repo-timeline-clean-card timeline-loading-state">
          <div className="timeline-spinner-apple"></div>
          <h3 className="timeline-loading-title">Analyzing Repository Collaborators</h3>
          <p className="timeline-loading-subtitle">
            Extracting real commit history, changed file paths, and directory knowledge distribution for <span className="highlight-repo">{fullName}</span>...
          </p>
          <div className="analytics-progress-indicator mt-3">
            <div className="progress-bar-track">
              <div 
                className="progress-bar-fill" 
                style={{ 
                  width: loadingProgress.total > 0 
                    ? `${Math.min(100, Math.round((loadingProgress.loaded / loadingProgress.total) * 100))}%` 
                    : '40%' 
                }}
              />
            </div>
            <span className="progress-status-text">
              {loadingProgress.phase === 'fetching_commits' && 'Fetching commits list...'}
              {loadingProgress.phase === 'fetching_details' && `Inspecting commit file changes (${loadingProgress.loaded}/${loadingProgress.total})...`}
              {loadingProgress.phase === 'processing_analytics' && 'Calculating directory knowledge concentrations...'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // RENDER: ERROR / RATE LIMIT STATE
  // ---------------------------------------------------------------------------
  if (errorType === 'RATE_LIMIT') {
    return (
      <div className="apple-minimal-stage">
        <div className="repo-timeline-clean-card timeline-error-card">
          <div className="rate-limit-badge">
            <i className="bi bi-shield-exclamation text-amber me-2"></i>
            <span>GitHub API Rate Limit Reached</span>
          </div>
          <h3 className="timeline-loading-title">Public API Limit Reached (60 req/hr)</h3>
          <p className="timeline-loading-subtitle">
            GitHub limits unauthenticated REST requests. Provide a personal GitHub token to increase your limit to 5,000 requests/hr.
          </p>
          <form className="token-input-form" onSubmit={handleSaveToken}>
            <input 
              type="password"
              className="token-text-input"
              placeholder="Paste GitHub Token (ghp_... or github_pat_...)"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <button type="submit" className="token-submit-btn">
              Apply Token & Retry
            </button>
          </form>
          {onBack && (
            <button type="button" className="apple-hub-return-btn mt-3" onClick={onBack}>
              ← Return to 3D Hub
            </button>
          )}
        </div>
      </div>
    );
  }

  if (errorMessage || !rawData) {
    return (
      <div className="apple-minimal-stage">
        <div className="repo-timeline-clean-card timeline-error-card">
          <i className="bi bi-exclamation-circle text-danger mb-3" style={{ fontSize: '32px' }}></i>
          <h3 className="timeline-loading-title">Unable to Load Collaborators</h3>
          <p className="timeline-loading-subtitle">{errorMessage || 'No commit or contributor data found.'}</p>
          <div className="d-flex gap-2 justify-content-center mt-3">
            <button type="button" className="apple-hub-return-btn" onClick={() => loadData(true)}>
              Retry
            </button>
            {onBack && (
              <button type="button" className="apple-hub-return-btn" onClick={onBack}>
                ← Return to 3D Hub
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Active dataset metrics
  const totalCommitsCount = filteredData?.commits?.length || 0;
  const uniqueContributorsCount = filteredData?.contributors?.length || 0;
  const uniqueDirectoriesCount = filteredData?.directories?.length || 0;
  const highConcentrationCount = (filteredData?.directories || []).filter((d) => d.concentration?.riskLevel === 'high').length;

  return (
    <div className="collaborator-viewport-stage animate-fade-in" id="explore-collab-stage">
      
      {/* 1. Ultra-Compact Top Header Bar */}
      <div className="collab-viewport-header d-flex align-items-center justify-content-between mb-2">
        <div className="d-flex align-items-center gap-2">
          {onBack && (
            <button 
              type="button" 
              className="btn-back-clean-sm" 
              onClick={onBack}
              title="Return to 3D Navigation Hub"
            >
              <i className="bi bi-arrow-left me-1"></i>
              <span>3D Hub</span>
            </button>
          )}

          <div className="feature-icon-badge-sm" style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #10b981 100%)' }}>
            <i className="bi bi-people-fill"></i>
          </div>

          <h2 className="code-viewport-title mb-0">Explore Collaborators</h2>

          <a 
            href={`https://github.com/${fullName}`} 
            target="_blank" 
            rel="noreferrer"
            className="repo-pill-badge"
            title="Inspect repository on GitHub"
          >
            <i className="bi bi-github me-1"></i>
            {fullName}
          </a>

          <span className="code-live-dot" title="Grounded in real GitHub commit history">
            <span className="pulse-pink-dot" style={{ background: '#10b981' }}></span> Real GitHub Data
          </span>
        </div>

        <div className="d-flex align-items-center gap-2">
          <button 
            type="button" 
            className="btn-refresh-clean-sm"
            onClick={() => loadData(true)}
            title="Refresh repository collaborator data"
          >
            <i className="bi bi-arrow-clockwise me-1"></i>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* 2. Compact Single-Row Metric Strip */}
      <div className="collab-compact-metrics-strip mb-2">
        <div className="collab-metric-pill">
          <span className="metric-tag">COMMITS</span>
          <span className="metric-val">{totalCommitsCount}</span>
        </div>
        <div className="collab-metric-pill">
          <span className="metric-tag">CONTRIBUTORS</span>
          <span className="metric-val text-primary">{uniqueContributorsCount}</span>
        </div>
        <div className="collab-metric-pill">
          <span className="metric-tag">DIRECTORIES</span>
          <span className="metric-val">{uniqueDirectoriesCount}</span>
        </div>
        <div className="collab-metric-pill highlight-silo">
          <span className="metric-tag">SILOS (&ge;70%)</span>
          <span className="metric-val text-amber">{highConcentrationCount}</span>
        </div>
        <div className="collab-policy-note ms-auto" title={rawData?.attributionNotice}>
          <i className="bi bi-shield-check text-cyan me-1"></i>
          <span>{rawData?.attributionNotice || 'Attributed objectively by commit file changes'}</span>
        </div>
      </div>

      {/* 3. Combined Filter & Navigation Bar */}
      <div className="collab-compact-ribbon mb-2">
        {/* Left: Tab selectors */}
        <div className="collab-ribbon-tabs">
          <button 
            type="button"
            className={`collab-ribbon-tab ${activeTab === 'directories' ? 'active' : ''}`}
            onClick={() => setActiveTab('directories')}
          >
            <i className="bi bi-folder-check me-1"></i>
            Directories &amp; Silos
          </button>
          <button 
            type="button"
            className={`collab-ribbon-tab ${activeTab === 'activity' ? 'active' : ''}`}
            onClick={() => setActiveTab('activity')}
          >
            <i className="bi bi-graph-up me-1"></i>
            Activity Trends
          </button>
          <button 
            type="button"
            className={`collab-ribbon-tab ${activeTab === 'matrix' ? 'active' : ''}`}
            onClick={() => setActiveTab('matrix')}
          >
            <i className="bi bi-diagram-3 me-1"></i>
            Contribution Matrix
          </button>
        </div>

        {/* Right: Inline Compact Filters */}
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {/* Search Box */}
          <div className="collab-mini-search-wrap">
            <i className="bi bi-search mini-search-icon"></i>
            <input 
              type="text"
              className="collab-mini-search-input"
              placeholder="Search files/people..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button 
                type="button" 
                className="mini-clear-btn"
                onClick={() => setSearchQuery('')}
              >
                <i className="bi bi-x-circle-fill"></i>
              </button>
            )}
          </div>

          {/* Time Range Pills */}
          <div className="collab-mini-segmented">
            <span className="mini-seg-label">Range:</span>
            {[
              { id: 'all', label: 'All' },
              { id: '30d', label: '30d' },
              { id: '90d', label: '90d' },
              { id: '365d', label: '1yr' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                className={`mini-seg-btn ${dateRangePreset === p.id ? 'active' : ''}`}
                onClick={() => setDateRangePreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Toggles */}
          <label className="collab-mini-checkbox" title="Hide known bots and automated commit accounts">
            <input 
              type="checkbox" 
              checked={hideBots} 
              onChange={(e) => setHideBots(e.target.checked)} 
            />
            <span>No Bots</span>
          </label>
          <label className="collab-mini-checkbox" title="Hide merge commits">
            <input 
              type="checkbox" 
              checked={hideMerges} 
              onChange={(e) => setHideMerges(e.target.checked)} 
            />
            <span>No Merges</span>
          </label>
        </div>
      </div>

      {/* 4. Main Viewport Content (Fills remaining vertical space) */}
      <div className="collab-viewport-content">

        {/* ==============================================================
            TAB 1: DIRECTORY ATTRIBUTION & KNOWLEDGE CONCENTRATION
            ============================================================== */}
        {activeTab === 'directories' && (
          <div className="collab-tab-content animate-fade-in">
            <div className="directory-split-layout">
              
              {/* Left Column: Directories List */}
              <div className="directory-list-sidebar">
                <div className="sidebar-header-row">
                  <span className="sidebar-title">Directories ({displayedDirectories.length})</span>
                  <span className="sidebar-hint">Select to inspect contributors</span>
                </div>

                <div className="directory-items-scroll">
                  {displayedDirectories.length === 0 ? (
                    <div className="empty-filter-state p-4 text-center">
                      <i className="bi bi-folder-x text-muted" style={{ fontSize: '28px' }}></i>
                      <p className="text-secondary small mt-2">No directories match your current search.</p>
                    </div>
                  ) : (
                    displayedDirectories.map((dir) => {
                      const isHighRisk = dir.concentration.riskLevel === 'high';
                      const isSelected = activeDirectoryData?.path === dir.path;

                      return (
                        <button
                          key={dir.path}
                          type="button"
                          className={`directory-row-item ${isSelected ? 'selected' : ''}`}
                          onClick={() => setSelectedDirectory(dir.path)}
                        >
                          <div className="d-flex align-items-center justify-content-between w-100">
                            <div className="d-flex align-items-center gap-2 overflow-hidden">
                              <i className={`bi ${dir.path === '(root)' ? 'bi-hdd-network' : 'bi-folder2'} dir-icon`}></i>
                              <span className="dir-item-name" title={dir.path}>{dir.path}</span>
                            </div>
                            <span className="dir-item-commits">{dir.uniqueCommitsCount} commits</span>
                          </div>

                          {/* Top Author Mini Meter */}
                          <div className="d-flex align-items-center justify-content-between mt-2">
                            <span className="dir-mini-contribs">
                              <i className="bi bi-person me-1"></i>
                              {dir.contributorsCount} contributor{dir.contributorsCount !== 1 ? 's' : ''}
                            </span>
                            <span className={`concentration-pill ${dir.concentration?.riskLevel || 'low'}`}>
                              {isHighRisk && <i className="bi bi-exclamation-triangle-fill me-1"></i>}
                              {dir.concentration?.topContributorSharePct ?? 0}% by top 1
                            </span>
                          </div>

                          {/* Mini Contributor Share Strip */}
                          <div className="dir-mini-share-track mt-2">
                            {(dir.contributors || []).slice(0, 5).map((c, idx) => {
                              const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4'];
                              return (
                                <div
                                  key={idx}
                                  className="dir-mini-share-seg"
                                  style={{ width: `${c.sharePct}%`, backgroundColor: colors[idx % colors.length] }}
                                  title={`${c.name || c.login}: ${c.sharePct}%`}
                                />
                              );
                            })}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Directory Detail Inspector */}
              <div className="directory-detail-main">
                {activeDirectoryData ? (
                  <div className="active-dir-card">
                    {/* Active Directory Title & Header */}
                    <div className="active-dir-header">
                      <div>
                        <div className="d-flex align-items-center gap-2 flex-wrap">
                          <h3 className="active-dir-title mb-0">
                            <i className="bi bi-folder2-open text-primary me-2"></i>
                            {activeDirectoryData.path}
                          </h3>
                        </div>
                      </div>

                      <div className="dir-stats-summary-strip">
                        <div className="dir-stat-unit">
                          <span className="unit-label">
                            <i className="bi bi-file-earmark-check me-1"></i>Commits
                          </span>
                          <span className="unit-val">{activeDirectoryData.uniqueCommitsCount}</span>
                        </div>
                        <div className="dir-stat-unit">
                          <span className="unit-label">
                            <i className="bi bi-people me-1"></i>Authors
                          </span>
                          <span className="unit-val text-primary">{activeDirectoryData.contributorsCount}</span>
                        </div>
                        <div className="dir-stat-unit">
                          <span className="unit-label">
                            <i className="bi bi-code-slash me-1"></i>Diff Lines
                          </span>
                          <span className="unit-val">
                            <span className="text-success me-1">+{activeDirectoryData.additions}</span>
                            <span className="text-danger">-{activeDirectoryData.deletions}</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Visual 3-Tier Bus Factor Gauge */}
                    <div className="bus-factor-visual-gauge mt-3 mb-3">
                      <div className="d-flex align-items-center justify-content-between mb-1">
                        <span className="gauge-label">
                          <i className="bi bi-shield-check me-1"></i>
                          Bus Factor Distribution
                        </span>
                        <span className={`gauge-value-badge ${activeDirectoryData.concentration?.riskLevel || 'low'}`}>
                          {activeDirectoryData.concentration?.riskLevel === 'high' ? 'High Silo Risk' : activeDirectoryData.concentration?.riskLevel === 'moderate' ? 'Moderate Concentration' : 'Healthy Distribution'} • {activeDirectoryData.concentration?.topContributorSharePct ?? 0}%
                        </span>
                      </div>
                      <div className="gauge-track-3tier">
                        <div className={`gauge-tier low ${activeDirectoryData.concentration?.riskLevel === 'low' ? 'active' : ''}`}>
                          <span>&lt;40% Distributed</span>
                        </div>
                        <div className={`gauge-tier moderate ${activeDirectoryData.concentration?.riskLevel === 'moderate' ? 'active' : ''}`}>
                          <span>40-70% Moderate</span>
                        </div>
                        <div className={`gauge-tier high ${activeDirectoryData.concentration?.riskLevel === 'high' ? 'active' : ''}`}>
                          <span>&ge;70% Silo</span>
                        </div>
                      </div>
                    </div>

                    {/* Proportional Interactive Contribution Bar */}
                    <div className="contribution-distribution-bar mb-4">
                      <div className="dist-bar-track">
                        {(activeDirectoryData.contributors || []).map((c, idx) => {
                          const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#64748b'];
                          const color = colors[idx % colors.length];
                          return (
                            <div 
                              key={c.contributorId || idx}
                              className="dist-bar-segment"
                              style={{ width: `${c.sharePct}%`, backgroundColor: color, cursor: 'pointer' }}
                              title={`Click to inspect ${c.name || c.login}: ${c.count} commits (${c.sharePct}%)`}
                              onClick={() => {
                                const fullContrib = (filteredData.contributors || []).find((fc) => fc.id === c.contributorId);
                                setInspectingContributor(fullContrib || c);
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>

                    {/* Historical Contributors List for this Directory */}
                    <div className="dir-contributors-section mb-4">
                      <h4 className="section-sub-title mb-3">
                        <i className="bi bi-people me-2"></i>
                        Contributors ({(activeDirectoryData.contributors || []).length})
                      </h4>

                      <div className="dir-contribs-grid">
                        {(activeDirectoryData.contributors || []).map((c, rank) => (
                          <div 
                            key={c.contributorId} 
                            className="dir-contrib-card"
                            onClick={() => {
                              const fullContrib = (filteredData.contributors || []).find((fc) => fc.id === c.contributorId);
                              setInspectingContributor(fullContrib || c);
                            }}
                          >
                            <div className="d-flex align-items-center justify-content-between mb-2">
                              <div className="d-flex align-items-center gap-2">
                                <span className={`contrib-rank-chip rank-${rank < 3 ? rank + 1 : 'other'}`}>
                                  {rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank + 1}`}
                                </span>
                                <img 
                                  src={c.avatarUrl || 'https://avatars.githubusercontent.com/u/0?v=4'} 
                                  alt={c.name}
                                  className="contrib-avatar-small"
                                />
                                <div className="overflow-hidden">
                                  <div className="contrib-card-name" title={c.name}>{c.name}</div>
                                  <div className="contrib-card-login">@{c.login}</div>
                                </div>
                              </div>
                              <div className="text-end">
                                <div className="contrib-card-share">{c.sharePct}%</div>
                                <div className="contrib-card-commits">{c.count} commits</div>
                              </div>
                            </div>
                            {/* Visual Progress Bar */}
                            <div className="contrib-card-progress-track">
                              <div className="contrib-card-progress-fill" style={{ width: `${c.sharePct}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Files within this Directory (with drilldown) */}
                    <div className="dir-files-section">
                      <h4 className="section-sub-title mb-3">
                        <i className="bi bi-file-earmark-code me-2"></i>
                        Modified Files in Directory ({(activeDirectoryData.files || []).length})
                      </h4>

                      <div className="files-drilldown-list">
                        {(activeDirectoryData.files || []).length === 0 ? (
                          <div className="text-muted small p-3 bg-light rounded">
                            Detailed file breakdowns are populated for recently inspected commits.
                          </div>
                        ) : (
                          (activeDirectoryData.files || []).map((file) => (
                            <div key={file.filename} className="file-drilldown-row">
                              <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                                <div className="d-flex align-items-center gap-2">
                                  <i className="bi bi-file-text text-secondary"></i>
                                  <span className="file-name-strong">{file.baseName}</span>
                                  <span className={`file-status-pill ${file.status}`}>
                                    {file.status || 'modified'}
                                  </span>
                                </div>
                                <div className="d-flex align-items-center gap-2">
                                  <span className="text-muted small">
                                    {file.commitsCount} commit{file.commitsCount !== 1 ? 's' : ''} &bull; {file.contributorsCount} author{file.contributorsCount !== 1 ? 's' : ''}
                                  </span>
                                  <button
                                    type="button"
                                    className="file-inspect-toggle-btn"
                                    onClick={() => setSelectedFileDrilldown(selectedFileDrilldown === file.filename ? null : file.filename)}
                                  >
                                    {selectedFileDrilldown === file.filename ? 'Hide Commits' : 'View Commits'}
                                  </button>
                                </div>
                              </div>

                              {/* Commits Touching This File */}
                              {selectedFileDrilldown === file.filename && (
                                <div className="file-commits-sublist animate-fade-in mt-2 p-3 bg-light rounded">
                                  <div className="small fw-bold text-secondary mb-2">Commits affecting {file.baseName}:</div>
                                  {(file.commits || []).map((c) => (
                                    <div key={c.sha} className="file-commit-item-row">
                                      <div className="d-flex align-items-center gap-2">
                                        <code className="commit-sha-pill">{c.shortSha}</code>
                                        <span className="commit-row-msg">{c.message}</span>
                                      </div>
                                      <div className="d-flex align-items-center gap-2 flex-shrink-0">
                                        <span className="commit-author-tag">@{c.author.login}</span>
                                        <span className="commit-date-tag">{new Date(c.date).toLocaleDateString()}</span>
                                        <a 
                                          href={c.htmlUrl} 
                                          target="_blank" 
                                          rel="noreferrer" 
                                          className="commit-gh-icon-link"
                                          title="View on GitHub"
                                        >
                                          <i className="bi bi-box-arrow-up-right"></i>
                                        </a>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                  </div>
                ) : (
                  <div className="p-5 text-center text-muted">Select a directory to inspect</div>
                )}
              </div>

            </div>
          </div>
        )}

        {/* ==============================================================
            TAB 2: ACTIVITY TIMELINE & EVOLUTION
            ============================================================== */}
        {activeTab === 'activity' && (
          <div className="collab-tab-content animate-fade-in">
            {/* Time Grouping Selector */}
            <div className="d-flex align-items-center justify-content-between mb-4 flex-wrap gap-2">
              <div>
                <h4 className="section-sub-title mb-1">
                  <i className="bi bi-calendar-week me-2"></i>
                  Contribution Velocity Over Time
                </h4>
                <p className="small text-secondary mb-0">
                  Inspect commit intensity and author distribution across time buckets.
                </p>
              </div>

              <div className="d-flex align-items-center gap-2">
                <span className="small text-muted fw-semibold">Group by:</span>
                <div className="segmented-pill-selector">
                  {['day', 'week', 'month'].map((grp) => (
                    <button
                      key={grp}
                      type="button"
                      className={`segmented-pill-btn ${timeGrouping === grp ? 'active' : ''}`}
                      onClick={() => setTimeGrouping(grp)}
                    >
                      {grp.charAt(0).toUpperCase() + grp.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Visual Activity Timeline Bars */}
            <div className="activity-timeline-chart-card mb-4">
              <div className="activity-bars-scroll-stage">
                {filteredData.timelineBuckets.map((bucket) => {
                  const maxBucket = Math.max(1, ...filteredData.timelineBuckets.map((b) => b.totalCommits));
                  const heightPct = Math.max(14, Math.round((bucket.totalCommits / maxBucket) * 100));

                  return (
                    <div 
                      key={bucket.bucketKey} 
                      className="activity-bar-column"
                      onClick={() => setInspectingCommit(bucket.commits[0] || null)}
                    >
                      <div className="activity-bar-tooltip">
                        <strong>{bucket.bucketKey}</strong>
                        <div>{bucket.totalCommits} commits</div>
                        <div className="small text-muted">Click to inspect</div>
                      </div>
                      <div 
                        className="activity-bar-fill" 
                        style={{ height: `${heightPct}%` }}
                      />
                      <span className="activity-bar-label">{bucket.bucketKey.slice(-5)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top Collaborators Leaderboard */}
            <h4 className="section-sub-title mb-3">
              <i className="bi bi-award me-2"></i>
              Top Repository Contributors in Scope ({(filteredData.contributors || []).length})
            </h4>

            <div className="collab-leaderboard-grid">
              {(filteredData.contributors || []).map((contrib, rank) => (
                <div 
                  key={contrib.id}
                  className="leaderboard-item-card"
                  onClick={() => setInspectingContributor(contrib)}
                >
                  <div className="d-flex align-items-center gap-3">
                    <span className={`rank-num rank-badge-${rank < 3 ? rank + 1 : 'other'}`}>
                      {rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `#${rank + 1}`}
                    </span>
                    <img 
                      src={contrib.avatarUrl} 
                      alt={contrib.name} 
                      className="leaderboard-avatar"
                    />
                    <div className="overflow-hidden">
                      <div className="leaderboard-name" title={contrib.name}>{contrib.name}</div>
                      <div className="leaderboard-username">
                        @{contrib.login}
                        {contrib.isBot && <span className="bot-pill-mini ms-1">bot</span>}
                      </div>
                    </div>
                  </div>

                  <div className="d-flex align-items-center gap-4">
                    <div className="text-end">
                      <div className="leaderboard-commits-num">{contrib.commitsCount}</div>
                      <div className="leaderboard-commits-label">commits</div>
                    </div>
                    <div className="text-end d-none d-sm-block">
                      <div className="leaderboard-dirs-num">{contrib.directories?.length || 0}</div>
                      <div className="leaderboard-dirs-label">directories</div>
                    </div>
                    <i className="bi bi-chevron-right text-muted"></i>
                  </div>
                </div>
              ))}
            </div>

          </div>
        )}

        {/* ==============================================================
            TAB 3: CONTRIBUTOR-DIRECTORY MATRIX
            ============================================================== */}
        {activeTab === 'matrix' && (
          <div className="collab-tab-content animate-fade-in">
            <div className="mb-4">
              <h4 className="section-sub-title mb-1">
                <i className="bi bi-grid-3x3-gap me-2"></i>
                Author &bull; Directory Interaction Matrix
              </h4>
              <p className="small text-secondary mb-0">
                Cross-references which developers have modified which repository directories.
              </p>
            </div>

            <div className="matrix-table-card table-responsive">
              <table className="table matrix-clean-table align-middle">
                <thead>
                  <tr>
                    <th style={{ minWidth: '220px' }}>Contributor</th>
                    <th style={{ minWidth: '180px' }}>Directory</th>
                    <th className="text-center" style={{ width: '120px' }}>Commits</th>
                    <th style={{ minWidth: '200px' }}>Recent Commit Summary</th>
                    <th className="text-end" style={{ width: '100px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(filteredData.contributorDirectoryPairs || []).slice(0, 35).map((pair, idx) => (
                    <tr key={`${pair.contributorId}-${pair.directory}-${idx}`}>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <img 
                            src={pair.contributor.avatarUrl} 
                            alt={pair.contributor.name}
                            className="matrix-avatar-micro"
                          />
                          <div>
                            <span className="fw-semibold text-dark d-block">{pair.contributor.name}</span>
                            <span className="text-muted small">@{pair.contributor.login}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="matrix-dir-badge">
                          <i className="bi bi-folder2 text-primary me-1"></i>
                          {pair.directory}
                        </span>
                      </td>
                      <td className="text-center">
                        <span className={`matrix-count-pill ${pair.count >= 6 ? 'density-high' : pair.count >= 3 ? 'density-med' : 'density-low'}`}>
                          {pair.count} commits
                        </span>
                      </td>
                      <td>
                        <span className="matrix-commit-msg" title={pair.commits[0]?.message}>
                          {pair.commits[0]?.message || 'Update'}
                        </span>
                      </td>
                      <td className="text-end">
                        <button
                          type="button"
                          className="apple-action-btn-clean py-1 px-2"
                          onClick={() => {
                            const fullContrib = filteredData.contributors.find((c) => c.id === pair.contributorId);
                            setInspectingContributor(fullContrib || pair.contributor);
                          }}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* ==============================================================
          CONTRIBUTOR DETAIL SLIDE-OUT DRAWER / MODAL (SCROLLABLE, BACKGROUND LOCKED)
          ============================================================== */}
      {inspectingContributor && (
        <div 
          className="pipe-feature-modal-backdrop" 
          onClick={() => setInspectingContributor(null)}
          onWheel={(e) => e.stopPropagation()}
          data-lenis-prevent="true"
        >
          <div 
            className="collab-detail-drawer animate-slide-left" 
            onClick={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            data-lenis-prevent="true"
          >
            {/* Drawer Header */}
            <div className="drawer-header">
              <div className="d-flex align-items-center gap-3">
                <img 
                  src={inspectingContributor.avatarUrl} 
                  alt={inspectingContributor.name} 
                  className="drawer-avatar" 
                />
                <div>
                  <h3 className="drawer-title">{inspectingContributor.name}</h3>
                  <div className="d-flex align-items-center gap-2">
                    <span className="text-muted">@{inspectingContributor.login}</span>
                    {inspectingContributor.htmlUrl && (
                      <a 
                        href={inspectingContributor.htmlUrl} 
                        target="_blank" 
                        rel="noreferrer"
                        className="drawer-gh-link"
                      >
                        <i className="bi bi-box-arrow-up-right me-1"></i> GitHub Profile
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <button 
                type="button" 
                className="drawer-close-btn"
                onClick={() => setInspectingContributor(null)}
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            {/* Drawer Stats */}
            <div className="drawer-stats-row mt-3 mb-4">
              <div className="drawer-stat-card">
                <span className="stat-label">Total Commits</span>
                <span className="stat-value">{inspectingContributor.commitsCount || inspectingContributor.commits?.length || 0}</span>
              </div>
              <div className="drawer-stat-card">
                <span className="stat-label">Directories Touched</span>
                <span className="stat-value">{inspectingContributor.directories?.length || inspectingContributor.directoriesChanged?.length || 0}</span>
              </div>
              <div className="drawer-stat-card">
                <span className="stat-label">Net Changes</span>
                <span className="stat-value text-success">+{inspectingContributor.totalAdditions || inspectingContributor.additions || 0}</span>
              </div>
            </div>

            {/* Directories Touched by This Contributor */}
            <div className="drawer-section mb-4">
              <h4 className="drawer-section-heading">Directories Modified</h4>
              <div className="d-flex flex-wrap gap-2 mt-2">
                {(inspectingContributor.directories || inspectingContributor.directoriesChanged || []).map((dir) => (
                  <span key={dir} className="dir-tag-pill">
                    <i className="bi bi-folder me-1 text-primary"></i>
                    {dir}
                  </span>
                ))}
              </div>
            </div>

            {/* Recent Commits Authored by Contributor */}
            <div className="drawer-section">
              <h4 className="drawer-section-heading">
                Recent Authored Commits ({(inspectingContributor.commits || []).length})
              </h4>
              <div className="drawer-commits-list mt-2">
                {(inspectingContributor.commits || []).map((commit) => (
                  <div key={commit.sha} className="drawer-commit-card">
                    <div className="d-flex align-items-center justify-content-between mb-1">
                      <code className="commit-sha-pill">{commit.shortSha}</code>
                      <span className="commit-time-meta">
                        {new Date(commit.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                    <div className="drawer-commit-msg">{commit.message}</div>
                    <div className="d-flex align-items-center justify-content-between mt-2 pt-2 border-top">
                      <span className="small text-muted">
                        {commit.filesCount > 0 ? `${commit.filesCount} files changed` : 'Commit recorded'}
                      </span>
                      <a 
                        href={commit.htmlUrl} 
                        target="_blank" 
                        rel="noreferrer"
                        className="commit-gh-pill-link"
                      >
                        View Commit on GitHub <i className="bi bi-arrow-right ms-1"></i>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
