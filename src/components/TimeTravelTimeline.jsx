import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  fetchRealRepositoryTimeline,
  fetchSelectedCommitDetails,
  parseRepoIdentifier,
  fetchGitHubRateLimitStatus,
} from '../services/githubTimelineService';

export default function TimeTravelTimeline({ repo = 'facebook/react', onBack }) {
  const [timelineData, setTimelineData] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [rateLimitStatus, setRateLimitStatus] = useState(null);
  const [commitDetails, setCommitDetails] = useState({});
  const [graph3DTilt, setGraph3DTilt] = useState({ x: 0, y: 0 });
  const [hoveredBarIndex, setHoveredBarIndex] = useState(null);
  const trackRef = useRef(null);
  const graphStageRef = useRef(null);

  const { owner, repo: repoName, fullName } = parseRepoIdentifier(repo);

  const [errorType, setErrorType] = useState(null);
  const [errorDetails, setErrorDetails] = useState(null);

  // 1. Fetch Real Repository Timeline on mount or when repo changes
  const loadRealTimeline = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setErrorType(null);
    setErrorDetails(null);
    setIsRateLimited(false);
    setIsPlaying(false);

    fetchGitHubRateLimitStatus().then((st) => {
      if (st) setRateLimitStatus(st);
    });

    try {
      const data = await fetchRealRepositoryTimeline(repo);
      setTimelineData(data);
      // Default to the major milestone if present, or midway through history
      const majorMilestone = data.milestones?.find((m) => m.isMajor);
      const initialIdx = majorMilestone 
        ? majorMilestone.commitIndex 
        : Math.floor((data.commits.length - 1) / 2);
      setSelectedIndex(Math.max(0, Math.min(data.commits.length - 1, initialIdx)));
      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
      const type = err.type || (err.message === 'RATE_LIMIT_EXCEEDED' ? 'RATE_LIMIT' : 'UNKNOWN');
      setErrorType(type);
      setErrorDetails(err.details || null);
      if (type === 'RATE_LIMIT') {
        setIsRateLimited(true);
      }
      setErrorMessage(err.message || 'Unable to fetch GitHub repository history.');
    }
  };

  useEffect(() => {
    loadRealTimeline();
    fetchGitHubRateLimitStatus().then((st) => {
      if (st) setRateLimitStatus(st);
    });
  }, [repo]);

  const commits = timelineData?.commits || [];
  const selectedCommit = commits[selectedIndex] || commits[0];

  // 2. Fetch Selected Commit Details (Files Changed & Stats) on-demand (Endpoint B)
  useEffect(() => {
    if (!selectedCommit?.sha || !owner || !repoName) return;

    if (commitDetails[selectedCommit.sha]) return; // already cached

    let isSubscribed = true;
    fetchSelectedCommitDetails(owner, repoName, selectedCommit.sha)
      .then((details) => {
        if (isSubscribed) {
          setCommitDetails((prev) => ({
            ...prev,
            [selectedCommit.sha]: details,
          }));
        }
      })
      .catch((err) => {
        console.warn('Commit details fetch info:', err);
      });

    return () => {
      isSubscribed = false;
    };
  }, [selectedCommit?.sha, owner, repoName, commitDetails]);

  // 3. Playback timer
  useEffect(() => {
    let timer;
    if (isPlaying && commits.length > 0) {
      timer = setInterval(() => {
        setSelectedIndex((prev) => {
          if (prev >= commits.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1500);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, commits.length]);

  const handleTogglePlay = () => {
    if (selectedIndex >= commits.length - 1) {
      setSelectedIndex(0);
      setIsPlaying(true);
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handlePrev = () => {
    setIsPlaying(false);
    setSelectedIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNext = () => {
    setIsPlaying(false);
    setSelectedIndex((prev) => Math.min(commits.length - 1, prev + 1));
  };

  // Jump directly to milestone
  const handleMilestoneClick = (commitIndex) => {
    setIsPlaying(false);
    setSelectedIndex(Math.max(0, Math.min(commits.length - 1, commitIndex)));
  };

  // Click on track to scrub to closest commit
  const handleTrackClick = (e) => {
    if (!trackRef.current || commits.length === 0) return;
    const rect = trackRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickRatio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetIdx = Math.round(clickRatio * (commits.length - 1));
    setIsPlaying(false);
    setSelectedIndex(targetIdx);
  };

  // 3D Mouse Parallax over the graph stage
  const handleGraphMouseMove = (e) => {
    if (!graphStageRef.current) return;
    const rect = graphStageRef.current.getBoundingClientRect();
    const normX = (e.clientX - rect.left) / rect.width - 0.5;
    const normY = (e.clientY - rect.top) / rect.height - 0.5;
    setGraph3DTilt({
      x: -(normY * 14).toFixed(2),
      y: (normX * 16).toFixed(2),
    });
  };

  const handleGraphMouseLeave = () => {
    setGraph3DTilt({ x: 0, y: 0 });
    setHoveredBarIndex(null);
  };


  // Details for active commit
  const activeDetails = selectedCommit?.sha ? commitDetails[selectedCommit.sha] : null;
  const filesChangedCount = activeDetails?.filesCount ?? 1;

  // Collision-free milestones: strictly ensure at least 18% distance between any consecutive milestones
  const spacedMilestones = useMemo(() => {
    const rawMilestones = timelineData?.milestones || [];
    if (rawMilestones.length <= 2) return rawMilestones;

    const filtered = [rawMilestones[0]];
    for (let i = 1; i < rawMilestones.length - 1; i++) {
      const candidate = rawMilestones[i];
      const prev = filtered[filtered.length - 1];
      const next = rawMilestones[rawMilestones.length - 1];
      if (Math.abs(candidate.pct - prev.pct) >= 18 && Math.abs(next.pct - candidate.pct) >= 16) {
        filtered.push(candidate);
      }
    }
    filtered.push(rawMilestones[rawMilestones.length - 1]);
    return filtered;
  }, [timelineData?.milestones]);

  const histogramBars = timelineData?.histogramBars || [];
  const currentPct = selectedCommit?.pct ?? (commits.length > 1 ? (selectedIndex / (commits.length - 1)) * 100 : 50);

  // -------------------------------------------------------------------------
  // RENDER: LOADING STATE
  // -------------------------------------------------------------------------
  if (isLoading) {
    return (
      <div className="apple-minimal-stage">
        <div className="repo-timeline-clean-card timeline-loading-state">
          <div className="timeline-spinner-apple"></div>
          <h3 className="timeline-loading-title">Fetching Real GitHub History</h3>
          <p className="timeline-loading-subtitle">
            Connecting to GitHub API for <span className="highlight-repo">{fullName}</span>: fetching commit history, milestones & 3D activity graph...
          </p>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // RENDER: RATE LIMIT EXCEEDED
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // RENDER: RATE LIMIT EXCEEDED (403)
  // -------------------------------------------------------------------------
  if (isRateLimited || errorType === 'RATE_LIMIT') {
    return (
      <div className="apple-minimal-stage">
        <div className="repo-timeline-clean-card timeline-error-card">
          <div className="rate-limit-badge">
            <i className="bi bi-shield-exclamation text-amber me-2"></i>
            <span>GitHub API Rate Limit Reached</span>
          </div>
          <h3 className="timeline-loading-title">API Rate Limit Throttled</h3>
          <p className="timeline-loading-subtitle">
            {errorMessage || 'GitHub API rate limit exceeded. Requests are cached server-side.'}
          </p>
          <div className="d-flex gap-2 justify-content-center mt-3">
            <button type="button" className="apple-hub-return-btn" onClick={loadRealTimeline}>
              Retry Connection
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

  // -------------------------------------------------------------------------
  // RENDER: AUTHENTICATION ERROR (401)
  // -------------------------------------------------------------------------
  if (errorType === 'UNAUTHORIZED') {
    return (
      <div className="apple-minimal-stage">
        <div className="repo-timeline-clean-card timeline-error-card">
          <div className="error-icon-pill danger mb-3">
            <i className="bi bi-key-fill text-danger" style={{ fontSize: '32px' }}></i>
          </div>
          <h3 className="timeline-loading-title">Server Token Authentication Failed (401)</h3>
          <p className="timeline-loading-subtitle">
            {errorMessage || 'The server-configured GITHUB_TOKEN is invalid or has expired. Please check your .env file on the server.'}
          </p>
          <div className="d-flex gap-2 justify-content-center mt-3">
            <button type="button" className="apple-hub-return-btn" onClick={loadRealTimeline}>
              Retry After Updating .env
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

  // -------------------------------------------------------------------------
  // RENDER: VALIDATION ERROR (Malformed repo input / Prompt text)
  // -------------------------------------------------------------------------
  if (errorType === 'VALIDATION') {
    return (
      <div className="apple-minimal-stage">
        <div className="repo-timeline-clean-card timeline-error-card">
          <div className="error-icon-pill warning mb-3">
            <i className="bi bi-exclamation-triangle-fill text-warning" style={{ fontSize: '32px' }}></i>
          </div>
          <h3 className="timeline-loading-title">Invalid Repository Identifier</h3>
          <p className="timeline-loading-subtitle">{errorMessage}</p>
          
          <div className="validation-helper-box mt-3 p-3 text-start" style={{ maxWidth: '480px', width: '100%', background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
            <div className="small fw-semibold text-secondary mb-1">Accepted formats:</div>
            <code className="d-block text-dark small mb-1">• facebook/react</code>
            <code className="d-block text-dark small mb-1">• https://github.com/facebook/react</code>
            <code className="d-block text-dark small">• https://github.com/facebook/react/</code>
          </div>

          <div className="d-flex gap-2 justify-content-center mt-3">
            {onBack && (
              <button type="button" className="apple-hub-return-btn" onClick={onBack}>
                ← Back to Search
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // RENDER: REPOSITORY NOT FOUND (404)
  // -------------------------------------------------------------------------
  if (errorType === 'NOT_FOUND') {
    return (
      <div className="apple-minimal-stage">
        <div className="repo-timeline-clean-card timeline-error-card">
          <div className="error-icon-pill danger mb-3">
            <i className="bi bi-search text-danger" style={{ fontSize: '32px' }}></i>
          </div>
          <h3 className="timeline-loading-title">Repository Not Found (404)</h3>
          <p className="timeline-loading-subtitle">{errorMessage}</p>
          <div className="d-flex gap-2 justify-content-center mt-3">
            <button type="button" className="apple-hub-return-btn" onClick={loadRealTimeline}>
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

  // -------------------------------------------------------------------------
  // RENDER: NETWORK / OFFLINE ERROR
  // -------------------------------------------------------------------------
  if (errorType === 'NETWORK') {
    return (
      <div className="apple-minimal-stage">
        <div className="repo-timeline-clean-card timeline-error-card">
          <div className="error-icon-pill danger mb-3">
            <i className="bi bi-wifi-off text-danger" style={{ fontSize: '32px' }}></i>
          </div>
          <h3 className="timeline-loading-title">Network Connection Error</h3>
          <p className="timeline-loading-subtitle">{errorMessage}</p>
          <div className="d-flex gap-2 justify-content-center mt-3">
            <button type="button" className="apple-hub-return-btn" onClick={loadRealTimeline}>
              Retry Connection
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

  // -------------------------------------------------------------------------
  // RENDER: GENERIC ERROR STATE
  // -------------------------------------------------------------------------
  if (errorMessage || commits.length === 0) {
    return (
      <div className="apple-minimal-stage">
        <div className="repo-timeline-clean-card timeline-error-card">
          <i className="bi bi-exclamation-circle text-danger mb-3" style={{ fontSize: '32px' }}></i>
          <h3 className="timeline-loading-title">Unable to Load Repository</h3>
          <p className="timeline-loading-subtitle">{errorMessage || 'No commit history available.'}</p>
          <div className="d-flex gap-2 justify-content-center mt-3">
            <button type="button" className="apple-hub-return-btn" onClick={loadRealTimeline}>
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

  // -------------------------------------------------------------------------
  // RENDER: PRISTINE REPOSITORY TIMELINE CARD WITH DYNAMIC 3D GRAPH
  // -------------------------------------------------------------------------
  return (
    <div className="apple-minimal-stage">
      
      {/* Return to 3D Hub button */}
      {onBack && (
        <div className="apple-hub-return-strip">
          <button 
            type="button" 
            className="apple-hub-return-btn" 
            onClick={onBack}
            title="Return to 3D Hub"
          >
            <i className="bi bi-arrow-left me-2"></i>
            <span>3D Hub</span>
          </button>
        </div>
      )}

      {/* ==============================================================
          THE CLEAN APPLE-GRADE REPOSITORY TIMELINE CARD
          Matches reference design: 100% real GitHub data!
          ============================================================== */}
      <div className="repo-timeline-clean-card">

        {/* 1. TOP BAR: GitHub Icon, Title, Public Pill, Play History */}
        <div className="timeline-top-bar">
          <div className="timeline-top-left">
            <svg className="github-clean-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            <h2 className="timeline-clean-title">Repository Timeline</h2>
            <span className="public-repo-pill">
              <span className="public-repo-dot"></span>
              <span>{timelineData.meta.isPrivate ? 'Private Repository' : 'Public Repository'}</span>
            </span>

            {rateLimitStatus && (
              <span 
                className="public-repo-pill" 
                style={{
                  borderColor: rateLimitStatus.isValid ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)',
                  background: rateLimitStatus.isValid ? 'rgba(16, 185, 129, 0.05)' : 'rgba(245, 158, 11, 0.05)'
                }}
                title={rateLimitStatus.isValid ? `Authenticated as @${rateLimitStatus.username}. Limit resets at ${rateLimitStatus.rateLimit?.resetDate}.` : (rateLimitStatus.message || 'Operating in public rate-limited mode')}
              >
                <i className={`bi ${rateLimitStatus.isValid ? 'bi-shield-check text-success' : 'bi-shield-exclamation text-warning'} me-1`}></i>
                {rateLimitStatus.isValid 
                  ? `@${rateLimitStatus.username} (${rateLimitStatus.rateLimit?.remaining ?? 5000} req left)` 
                  : 'Public Mode (60 req/hr)'}
              </span>
            )}
          </div>

          <div className="timeline-top-right">
            <button 
              type="button" 
              className={`play-history-btn ${isPlaying ? 'is-active' : ''}`}
              onClick={handleTogglePlay}
            >
              <i className={`bi ${isPlaying ? 'bi-pause-fill' : 'bi-play-fill'} me-1`}></i>
              <span>{isPlaying ? 'Pause' : 'Play History'}</span>
            </button>
          </div>
        </div>

        {/* 2. MIDDLE AREA: INTERACTIVE 3D GRAPH + MILESTONES + GRADIENT TRACK */}
        <div 
          className="timeline-interactive-stage"
          ref={graphStageRef}
          onMouseMove={handleGraphMouseMove}
          onMouseLeave={handleGraphMouseLeave}
        >
          
          {/* Milestone Labels with Connector Lines Above the Track (Collison-Free!) */}
          <div className="milestones-labels-overlay">
            {spacedMilestones.map((m, idx) => {
              const isSelected = Math.abs(m.commitIndex - selectedIndex) <= 2;
              const isMajor = m.isMajor;
              return (
                <div 
                  key={idx} 
                  className={`milestone-pin-anchor ${isSelected ? 'is-selected' : ''} ${isMajor ? 'is-major' : ''}`}
                  style={{ left: `${m.pct}%` }}
                  onClick={() => handleMilestoneClick(m.commitIndex)}
                >
                  <div className="milestone-text-block">
                    <span className="milestone-label-title">{m.label}</span>
                    <span className="milestone-label-date">{m.date}</span>
                  </div>
                  {/* Vertical connector line */}
                  <div className={`milestone-connector-line ${isSelected ? 'connector-active' : 'connector-dotted'}`}></div>
                </div>
              );
            })}
          </div>

          {/* DYNAMIC 3D ISOMETRIC ACTIVITY GRAPH (Changes dynamically with Date & Scrubbing!) */}
          <div 
            className="timeline-3d-graph-container"
            style={{
              transform: `perspective(900px) rotateX(${10 + Number(graph3DTilt.x)}deg) rotateY(${Number(graph3DTilt.y)}deg)`,
            }}
          >
            <svg 
              className="timeline-3d-svg-canvas" 
              viewBox="0 0 1000 135" 
              preserveAspectRatio="none"
            >
              <defs>
                {/* 3D Pillar Linear Gradients */}
                <linearGradient id="barFrontGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.75" />
                </linearGradient>

                <linearGradient id="barFrontActiveGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#c084fc" stopOpacity="1" />
                  <stop offset="50%" stopColor="#818cf8" stopOpacity="1" />
                  <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.9" />
                </linearGradient>

                <linearGradient id="spotlightBeam" x1="0%" y1="100%" x2="0%" y2="0%">
                  <stop offset="0%" stopColor="rgba(99, 102, 241, 0.45)" />
                  <stop offset="100%" stopColor="rgba(192, 132, 252, 0)" />
                </linearGradient>

                <filter id="glow3D" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3.5" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* 3D Isometric Floor Grid Plane */}
              <g className="grid-floor-plane" opacity="0.35">
                <line x1="20" y1="120" x2="980" y2="120" stroke="#cbd5e1" strokeWidth="1" />
                <line x1="20" y1="126" x2="980" y2="126" stroke="#e2e8f0" strokeWidth="1" strokeDasharray="6 4" />
              </g>

              {/* 48 Isometric 3D Columns */}
              {histogramBars.map((baseHeight, idx) => {
                const totalBars = histogramBars.length;
                const barPct = (idx / (totalBars - 1)) * 100;
                
                // Dynamic 3D elevation wave responding dynamically to selected date!
                const distToActive = Math.abs(barPct - currentPct);
                const activeProximity = Math.max(0, 1 - distToActive / 12);
                const liveHeight = Math.min(108, Math.round(baseHeight + activeProximity * 36));

                const isNearActive = distToActive < 3;
                const isHovered = hoveredBarIndex === idx;

                // 3D Geometry calculations
                const w = 9.5; // Column width
                const dx = 4.5; // 3D Extrusion X
                const dy = 5.5; // 3D Extrusion Y
                const baseY = 120;
                const x = 20 + idx * ((960 - w) / (totalBars - 1));
                const topY = baseY - liveHeight;

                // Dynamic coloring: blue -> indigo -> violet across time
                const hue = Math.round(205 + (idx / totalBars) * 65);
                const frontColor = isNearActive ? 'url(#barFrontActiveGrad)' : `hsl(${hue}, 80%, 65%)`;
                const topColor = isNearActive ? '#f3e8ff' : `hsl(${hue}, 85%, 82%)`;
                const sideColor = isNearActive ? '#4338ca' : `hsl(${hue}, 70%, 45%)`;

                return (
                  <g 
                    key={idx} 
                    className={`cuboid-3d-column ${isNearActive ? 'is-active-column' : ''}`}
                    onMouseEnter={() => setHoveredBarIndex(idx)}
                    onClick={() => {
                      // Click on 3D bar to jump to that time slice!
                      const targetIdx = Math.round((idx / (totalBars - 1)) * (commits.length - 1));
                      setIsPlaying(false);
                      setSelectedIndex(targetIdx);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* 1. Ground Contact Shadow */}
                    <ellipse 
                      cx={x + w / 2 + dx / 2} 
                      cy={baseY + 3} 
                      rx={w / 2 + 3} 
                      ry={2.5} 
                      fill="rgba(15, 23, 42, 0.12)" 
                    />

                    {/* 2. Active 3D Vertical Spotlight Beam */}
                    {isNearActive && (
                      <line 
                        x1={x + w / 2} 
                        y1={topY} 
                        x2={x + w / 2} 
                        y2={0} 
                        stroke="url(#spotlightBeam)" 
                        strokeWidth={w + 4} 
                        strokeLinecap="round" 
                      />
                    )}

                    {/* 3. Front Face */}
                    <rect 
                      x={x} 
                      y={topY} 
                      width={w} 
                      height={liveHeight} 
                      rx="2"
                      fill={frontColor}
                      filter={isNearActive ? 'url(#glow3D)' : undefined}
                      opacity={isNearActive || isHovered ? 1 : 0.82}
                    />

                    {/* 4. Top 3D Rhombus Cap */}
                    <polygon 
                      points={`
                        ${x},${topY} 
                        ${x + dx},${topY - dy} 
                        ${x + w + dx},${topY - dy} 
                        ${x + w},${topY}
                      `}
                      fill={topColor}
                      opacity={isNearActive ? 1 : 0.9}
                    />

                    {/* 5. Right Depth Facet */}
                    <polygon 
                      points={`
                        ${x + w},${topY} 
                        ${x + w + dx},${topY - dy} 
                        ${x + w + dx},${baseY - dy} 
                        ${x + w},${baseY}
                      `}
                      fill={sideColor}
                      opacity={isNearActive ? 1 : 0.75}
                    />
                  </g>
                );
              })}
            </svg>

            {/* Floating 3D HUD Pill tracking the active date position */}
            <div 
              className="active-date-3d-hud"
              style={{ left: `${currentPct}%` }}
            >
              <div className="hud-pill-inner">
                <span className="hud-live-dot" />
                <span className="hud-date-text">{selectedCommit.date}</span>
                <span className="hud-commit-badge">{selectedIndex + 1}/{commits.length}</span>
              </div>
            </div>
          </div>

          {/* The Connected Gradient Slider Rail */}
          <div 
            className="timeline-slider-track-wrap" 
            ref={trackRef}
            onClick={handleTrackClick}
          >
            {/* Native range input for accessible, smooth keyboard and touch time-travel */}
            <input 
              type="range"
              min={0}
              max={Math.max(0, commits.length - 1)}
              value={selectedIndex}
              onChange={(e) => {
                setIsPlaying(false);
                setSelectedIndex(Number(e.target.value));
              }}
              className="timeline-native-scrubber-input"
              aria-label="Travel through repository history"
            />

            {/* Visual Rounded Rail Container */}
            <div className="timeline-slider-rail">
              
              {/* Left Filled Gradient (Blue to Indigo) */}
              <div 
                className="rail-gradient-fill fill-left"
                style={{ width: `${currentPct}%` }}
              />

              {/* Right Filled Gradient (Violet to Purple) */}
              <div 
                className="rail-gradient-fill fill-right"
                style={{ left: `${currentPct}%`, width: `${Math.max(0, 100 - currentPct)}%` }}
              />

              {/* Milestone Dots along the track */}
              {spacedMilestones.map((m, idx) => {
                const isSelected = Math.abs(m.commitIndex - selectedIndex) <= 1;
                if (isSelected) return null; // rendered as active handle
                return (
                  <div 
                    key={idx} 
                    className="rail-milestone-dot" 
                    style={{ left: `${m.pct}%` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMilestoneClick(m.commitIndex);
                    }}
                  />
                );
              })}

              {/* Active Scrubber Handle with Pointer Notch */}
              <div 
                className="active-scrubber-handle"
                style={{ left: `${currentPct}%` }}
              >
                <div className="handle-outer-glow">
                  <div className="handle-inner-gradient"></div>
                </div>
                {/* Pointer Notch pointing down to the active card */}
                <div className="handle-down-notch"></div>
              </div>

            </div>
          </div>

          {/* Track Ends Dates: First commit & Latest commit */}
          <div className="timeline-ends-meta">
            <div className="end-date-left">
              <span className="end-date-strong">{timelineData.firstCommitDate}</span>
              <span className="end-date-sub">First commit</span>
            </div>
            <div className="end-date-right">
              <span className="end-date-strong">{timelineData.latestCommitDate}</span>
              <span className="end-date-sub">Latest commit</span>
            </div>
          </div>

        </div>

        {/* 3. BOTTOM ROW: PREVIOUS COMMIT, ACTIVE COMMIT DETAIL CARD (FIXED SIZING!), NEXT COMMIT */}
        <div className="timeline-bottom-controls-row">
          
          {/* Previous Commit Button (Fixed Width, No Movement) */}
          <button 
            type="button" 
            className="commit-nav-btn prev-btn"
            onClick={handlePrev}
            disabled={selectedIndex === 0}
          >
            <i className="bi bi-chevron-left me-2"></i>
            <span>Previous commit</span>
          </button>

          {/* Floating Active Commit Detail Card (ROCK-SOLID FIXED DIMENSIONS: NEVER JUMPS OR CHANGES SIZE!) */}
          <div className="active-commit-detail-card fixed-dimensions-lock">
            
            {/* Git Branch Icon Circle */}
            <div className="commit-branch-icon-box">
              <i className="bi bi-bezier2"></i>
            </div>

            {/* Commit Narrative Info (Strict Fixed Width with Clean Ellipsis Truncation) */}
            <div className="commit-content-info fixed-info-lock">
              <span className="commit-date-label">{selectedCommit.date}</span>
              <h4 className="commit-message-title" title={selectedCommit.title}>
                {selectedCommit.title}
              </h4>
              <span className="commit-meta-hash">
                {selectedCommit.shortSha} · {filesChangedCount} {filesChangedCount === 1 ? 'file' : 'files'} changed
              </span>
            </div>

            {/* View on GitHub Button (Fixed Position) */}
            <a 
              href={selectedCommit.htmlUrl}
              target="_blank" 
              rel="noopener noreferrer"
              className="view-github-action-btn"
              title={`View ${selectedCommit.shortSha} on GitHub`}
            >
              <i className="bi bi-box-arrow-up-right me-1"></i>
              <span>View on GitHub</span>
            </a>

          </div>

          {/* Next Commit Button (Fixed Width, No Movement) */}
          <button 
            type="button" 
            className="commit-nav-btn next-btn"
            onClick={handleNext}
            disabled={selectedIndex === commits.length - 1}
          >
            <span>Next commit</span>
            <i className="bi bi-chevron-right ms-2"></i>
          </button>

        </div>

      </div>

    </div>
  );
}
